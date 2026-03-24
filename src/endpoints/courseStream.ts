import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";

/**
 * Generates a signed Cloudflare Stream token using RSA-256 (RS256).
 * This lets us create short-lived, self-signed URLs without hitting
 * the Stream API on every request.
 */
async function generateStreamToken(
    videoId: string,
    keyId: string,
    pemBase64: string,
    expiresInSeconds = 3600
): Promise<string> {
    // 1. Decode the base64-encoded PEM key
    const pemText = atob(pemBase64);

    // 2. Extract the binary key data from PEM (strip header/footer + whitespace)
    const pemContents = pemText
        .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
        .replace(/-----END RSA PRIVATE KEY-----/, "")
        .replace(/\s/g, "");
    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    // 3. Import as CryptoKey for RS256 signing
    const cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        binaryKey.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );

    // 4. Build JWT header + payload
    const header = { alg: "RS256", kid: keyId };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: videoId,
        kid: keyId,
        exp: now + expiresInSeconds,
        nbf: now - 60, // allow 1 min clock skew
    };

    const toBase64Url = (str: string) =>
        btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // 5. Sign
    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        new TextEncoder().encode(signingInput)
    );

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    return `${signingInput}.${encodedSignature}`;
}

/**
 * Fetch video duration from Cloudflare Stream API and cache it in D1.
 * Only called when duration_seconds is NULL.
 */
async function fetchAndCacheDuration(
    db: D1Database,
    lessonId: string,
    streamVideoId: string,
    accountId: string,
    apiToken: string
): Promise<number | null> {
    try {
        const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${streamVideoId}`,
            {
                headers: { Authorization: `Bearer ${apiToken}` },
            }
        );

        if (!res.ok) {
            console.error(`Stream API error: ${res.status} ${res.statusText}`);
            return null;
        }

        const data = (await res.json()) as {
            result: { duration: number };
            success: boolean;
        };

        if (data.success && data.result?.duration > 0) {
            const duration = data.result.duration;
            // Cache in D1 so we don't call the API again
            await db
                .prepare("UPDATE lessons SET duration_seconds = ? WHERE id = ?")
                .bind(duration, lessonId)
                .run();
            return duration;
        }
    } catch (error) {
        console.error("Error fetching Stream duration:", error);
    }
    return null;
}

/** Convert seconds to human-readable duration */
function formatDuration(seconds: number | null): string {
    if (!seconds || seconds <= 0) return "—";
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}min` : `${hours}h`;
}

export class CourseStream extends OpenAPIRoute {
    schema = {
        tags: ["Course"],
        summary: "Get signed video token and course metadata for a lesson",
        security: [{ bearerAuth: [] }],
        request: {
            query: z.object({
                lessonId: z.string().optional(),
            }),
        },
        responses: {
            "200": {
                description: "Course data with signed video token",
                content: {
                    "application/json": {
                        schema: z.object({
                            signedToken: z.string(),
                            customerCode: z.string(),
                            lesson: z.object({
                                id: z.string(),
                                title: z.string(),
                                description: z.string().nullable(),
                                duration: z.string(),
                                sortOrder: z.number(),
                            }),
                        }),
                    },
                },
            },
            "404": {
                description: "Lesson not found",
            },
            "500": {
                description: "Server error generating token",
            },
        },
    };

    async handle(c: Context) {
        const env = c.env as {
            DB: D1Database;
            STREAM_SIGNING_KEY_ID: string;
            STREAM_SIGNING_KEY_PEM: string;
            STREAM_CUSTOMER_CODE: string;
            STREAM_ACCOUNT_ID: string;
            STREAM_API_TOKEN: string;
        };

        const db = env.DB;

        // Validate required config
        if (!env.STREAM_SIGNING_KEY_ID || !env.STREAM_SIGNING_KEY_PEM || !env.STREAM_CUSTOMER_CODE) {
            console.error("Missing Stream configuration secrets.");
            return c.json({ success: false, message: "Video service not configured" }, 500);
        }

        // Get lesson from D1
        const lessonId = c.req.query("lessonId");
        let lesson: any;

        try {
            if (lessonId) {
                lesson = await db
                    .prepare("SELECT * FROM lessons WHERE id = ?")
                    .bind(lessonId)
                    .first();
            } else {
                // Default to first lesson by sort_order
                lesson = await db
                    .prepare("SELECT * FROM lessons ORDER BY sort_order ASC LIMIT 1")
                    .first();
            }
        } catch (error) {
            console.error("Error querying lessons:", error);
            return c.json({ success: false, message: "Failed to load lesson" }, 500);
        }

        if (!lesson) {
            return c.json({ success: false, message: "Lesson not found" }, 404);
        }

        try {
            // Auto-fetch duration from Stream API if not cached
            let durationSeconds = lesson.duration_seconds;
            if (durationSeconds == null && env.STREAM_ACCOUNT_ID && env.STREAM_API_TOKEN) {
                durationSeconds = await fetchAndCacheDuration(
                    db,
                    lesson.id,
                    lesson.stream_video_id,
                    env.STREAM_ACCOUNT_ID,
                    env.STREAM_API_TOKEN
                );
            }

            // Generate signed token for this lesson's video
            const signedToken = await generateStreamToken(
                lesson.stream_video_id,
                env.STREAM_SIGNING_KEY_ID,
                env.STREAM_SIGNING_KEY_PEM,
                3600
            );

            return c.json({
                signedToken,
                customerCode: env.STREAM_CUSTOMER_CODE,
                lesson: {
                    id: lesson.id,
                    title: lesson.title,
                    description: lesson.description,
                    duration: formatDuration(durationSeconds),
                    sortOrder: lesson.sort_order,
                },
            });
        } catch (error) {
            console.error("Error generating Stream token:", error);
            return c.json({ success: false, message: "Failed to generate video token" }, 500);
        }
    }
}
