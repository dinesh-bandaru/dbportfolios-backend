import { Context } from "hono";

type Env = { AI: Ai };

function buildPriceTool(currency: string, countryName: string) {
    return {
        type: "function",
        function: {
            name: "report_prices",
            description: `Report the retail price of the item in the past year and today in ${countryName}.`,
            parameters: {
                type: "object",
                properties: {
                    pastItem:           { type: "string", description: "Exact name/spec of the item in the past year, e.g. '1 kg Basmati rice (2015)', 'iPhone 6 16GB (2015)', 'Honda Activa 3G (2015)'" },
                    nowItem:            { type: "string", description: "Exact name/spec of the same or closest equivalent item today, e.g. '1 kg Basmati rice (2025)', 'iPhone 16 128GB (2025)', 'Honda Activa 6G (2025)'" },
                    pastPrice:          { type: "number", description: `Retail price in ${currency} in the past year, as a plain integer` },
                    nowPrice:           { type: "number", description: `Retail price in ${currency} in 2025, as a plain integer` },
                    pastPriceFormatted: { type: "string", description: `Formatted past price, e.g. in local currency notation` },
                    nowPriceFormatted:  { type: "string", description: `Formatted current price, e.g. in local currency notation` },
                    source:             { type: "string", description: "Brief description of where the prices came from" },
                    insight:            { type: "string", description: `One sentence on what this price change reveals about inflation in ${countryName}` },
                },
                required: ["pastItem", "nowItem", "pastPrice", "nowPrice", "pastPriceFormatted", "nowPriceFormatted", "source", "insight"],
            },
        },
    } as const;
}

// Fallback geo when the client doesn't send location context
const DEFAULT_GEO = {
    country:     "US",
    countryName: "the United States",
    currency:    "USD",
    city:        "New York",
    timezone:    "America/New_York",
};

// ISO 3166-1 alpha-2 → readable country name (subset)
const COUNTRY_NAMES: Record<string, string> = {
    IN: "India", US: "the United States", GB: "the United Kingdom",
    DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", NL: "the Netherlands",
    BE: "Belgium", AT: "Austria", PT: "Portugal", GR: "Greece", FI: "Finland",
    IE: "Ireland", CA: "Canada", AU: "Australia", NZ: "New Zealand",
    SG: "Singapore", JP: "Japan", CN: "China", HK: "Hong Kong", KR: "South Korea",
    TW: "Taiwan", MY: "Malaysia", TH: "Thailand", ID: "Indonesia", PH: "the Philippines",
    VN: "Vietnam", PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka",
    AE: "the UAE", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", IL: "Israel",
    TR: "Turkey", ZA: "South Africa", NG: "Nigeria", KE: "Kenya", EG: "Egypt",
    BR: "Brazil", MX: "Mexico", AR: "Argentina", CL: "Chile", CO: "Colombia",
    SE: "Sweden", NO: "Norway", DK: "Denmark", CH: "Switzerland",
    PL: "Poland", CZ: "the Czech Republic", RO: "Romania", HU: "Hungary",
    RU: "Russia", UA: "Ukraine",
};

export async function priceLookupHandler(c: Context) {
    const env = c.env as Env;

    const body = await c.req.json<{
        item: string;
        year: string;
        country?: string;
        currency?: string;
        city?: string;
        timezone?: string;
    }>();
    const { item, year } = body;
    if (!item || !year) return c.json({ error: "item and year are required" }, 400);

    // Use client-supplied geo if present, otherwise fall back to Cloudflare CF headers, then defaults
    const cf = (c.req.raw as any).cf as Record<string, string> | undefined;
    const country  = body.country  ?? cf?.country  ?? DEFAULT_GEO.country;
    const currency = body.currency ?? DEFAULT_GEO.currency;
    const city     = body.city     ?? cf?.city     ?? DEFAULT_GEO.city;
    const timezone = body.timezone ?? cf?.timezone ?? DEFAULT_GEO.timezone;
    const countryName = COUNTRY_NAMES[country] ?? country;

    const enc = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (obj: Record<string, unknown>) =>
                controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

            try {
                send({ type: "log", message: `Looking up prices for "${item}" in ${year}…` });

                const PRICE_TOOL = buildPriceTool(currency, countryName);

                const res: any = await env.AI.run(
                    "@cf/zai-org/glm-4.7-flash",
                    {
                        messages: [
                            {
                                role: "system",
                                content:
                                    `You are a financial research assistant for a price inflation tracker in ${countryName}. ` +
                                    `Use web search to find real retail prices in ${countryName} for any item — groceries, electronics, vehicles, services, anything. ` +
                                    "For vehicles: compare the same variant tier (base-to-base or top-to-top). " +
                                    "For commodities (rice, petrol, gold, etc.): compare the same unit (per kg, per litre, per gram). " +
                                    "For electronics: compare the same or closest equivalent model. " +
                                    `All prices must be in ${currency}. Always call report_prices with the data you find.`,
                            },
                            {
                                role: "user",
                                content: `What was the retail price of "${item}" in ${countryName} in ${year}, and what does it cost today in 2025?`,
                            },
                        ],
                        tools: [PRICE_TOOL],
                        tool_choice: "required",
                        web_search_options: {
                            search_context_size: "high",
                            user_location: {
                                type: "approximate",
                                approximate: { country, city, timezone },
                            },
                        },
                        max_completion_tokens: 65536,
                    },
                    { gateway: { id: "dbportfolios" } }
                );

                const toolCall = res?.choices?.[0]?.message?.tool_calls?.[0];
                if (!toolCall) throw new Error("No tool call returned");

                const data = JSON.parse(toolCall.function?.arguments ?? toolCall.custom?.input ?? "{}");
                if (!data.pastPrice || !data.nowPrice) throw new Error("Incomplete price data");

                // Extract web search citation URLs from annotations
                const annotations: { type: string; url_citation: { url: string; title: string } }[] =
                    res?.choices?.[0]?.message?.annotations ?? [];
                const sourceLinks = annotations
                    .filter((a) => a.type === "url_citation" && a.url_citation?.url)
                    .map((a) => ({ url: a.url_citation.url, title: a.url_citation.title || a.url_citation.url }))
                    // deduplicate by URL
                    .filter((v, i, arr) => arr.findIndex((x) => x.url === v.url) === i);

                send({ type: "log", message: "Here's what inflation did to your money." });
                send({ type: "result", ...data, year, currency, country, sourceLinks });

            } catch (err: any) {
                console.error("priceLookup error:", err?.message);
                send({ type: "error", message: "Something went wrong. Please try again." });
            } finally {
                controller.enqueue(enc.encode("data: [DONE]\n\n"));
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
