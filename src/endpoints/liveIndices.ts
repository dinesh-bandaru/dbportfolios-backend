import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";

// Each index needs: exchange, API index name, and display name
const FEATURED_INDICES = [
    { exchange: "bse", apiName: "sensex", displayName: "SENSEX" },
    { exchange: "nse", apiName: "nifty 50", displayName: "NIFTY 50" },
    { exchange: "bse", apiName: "bankex", displayName: "BANKEX" },
    { exchange: "nse", apiName: "nifty bank", displayName: "NIFTY BANK" },
    { exchange: "bse", apiName: "BSE_IT", displayName: "IT" },
    { exchange: "bse", apiName: "metal", displayName: "METAL" },
    { exchange: "bse", apiName: "auto", displayName: "AUTO" },
    { exchange: "nse", apiName: "nifty pharma", displayName: "PHARMA" },
    { exchange: "nse", apiName: "nifty energy", displayName: "ENERGY" },
];

async function fetchHistorical(exchange: string, indexName: string) {
    const url = `http://dbportfolioapis.cmlinks.com/Equity.svc/HistoricalLiveindices/${exchange}/${encodeURIComponent(indexName)}/m/1?responsetype=json`;
    const res = await fetch(url);
    const json = (await res.json()) as any;
    const records = json?.response?.data?.HistoricalLiveindicesList?.HistoricalLiveindices;
    if (!records || !Array.isArray(records) || records.length < 2) return null;
    // records[0] = today, records[1] = yesterday (sorted newest first)
    return { today: records[0], yesterday: records[1] };
}

export class LiveIndices extends OpenAPIRoute {
    schema = {
        tags: ["Market"],
        summary: "Get live BSE/NSE index data with day-over-day change",
        responses: {
            "200": {
                description: "Live market index data",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            data: z.array(
                                z.object({
                                    name: z.string(),
                                    price: z.string(),
                                    change: z.number(),
                                })
                            ),
                            updatedAt: z.string(),
                        }),
                    },
                },
            },
        },
    };

    async handle(c: Context) {
        try {
            // Fetch all historical data in parallel
            const results = await Promise.all(
                FEATURED_INDICES.map(async (idx) => {
                    const hist = await fetchHistorical(idx.exchange, idx.apiName);
                    if (!hist) return null;

                    const todayLtp = parseFloat(hist.today.ltp);
                    const yesterdayLtp = parseFloat(hist.yesterday.ltp);

                    // Day-over-day change: (today - yesterday) / yesterday * 100
                    const change = yesterdayLtp > 0
                        ? Math.round(((todayLtp - yesterdayLtp) / yesterdayLtp) * 10000) / 100
                        : 0;

                    return {
                        name: idx.displayName,
                        price: todayLtp.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        }),
                        change,
                    };
                })
            );

            const data = results.filter(Boolean);
            const updatedAt = new Date().toISOString();

            return c.json({ success: true, data, updatedAt }, 200);
        } catch (error) {
            console.error("LiveIndices error:", error);
            return c.json(
                { success: false, message: "Failed to fetch market data" },
                500
            );
        }
    }
}
