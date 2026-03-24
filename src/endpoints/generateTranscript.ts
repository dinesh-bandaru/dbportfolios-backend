import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";

/**
 * Admin endpoint: generates AI captions for a lesson's video via Cloudflare Stream,
 * fetches the VTT, parses it to plain text, and stores it in R2.
 */
export class GenerateTranscript extends OpenAPIRoute {
    schema = {
        tags: ["Admin"],
        summary: "Generate and store transcript for a lesson",
        security: [{ bearerAuth: [] }],
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            lessonId: z.string(),
                        }),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Transcript generated and stored",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            message: z.string(),
                            wordCount: z.number().optional(),
                        }),
                    },
                },
            },
            "404": { description: "Lesson not found" },
            "500": { description: "Server error" },
        },
    };

    async handle(c: Context) {
        const env = c.env as {
            DB: D1Database;
            TRANSCRIPTS: R2Bucket;
            STREAM_ACCOUNT_ID: string;
            STREAM_API_TOKEN: string;
        };

        const { lessonId, mockText } = await c.req.json();

        if (mockText) {
            await env.TRANSCRIPTS.put(`transcripts/${lessonId}.txt`, mockText, {
                customMetadata: { lessonId, generatedAt: new Date().toISOString() },
            });
            return c.json({ success: true, message: "Mock transcript injected", wordCount: mockText.split(/\s+/).length });
        }

        // 1. Get lesson from D1
        const lesson = await env.DB
            .prepare("SELECT stream_video_id FROM lessons WHERE id = ?")
            .bind(lessonId)
            .first<{ stream_video_id: string }>();

        if (!lesson) {
            return c.json({ success: false, message: "Lesson not found" }, 404);
        }

        const videoId = lesson.stream_video_id;
        const accountId = env.STREAM_ACCOUNT_ID;
        const apiToken = env.STREAM_API_TOKEN;

        if (!accountId || !apiToken) {
            return c.json({ success: false, message: "Stream API not configured" }, 500);
        }

        try {
            // 2. Request AI caption generation
            const genRes = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoId}/captions/en`,
                {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ method: "automatic" }),
                }
            );

            if (!genRes.ok) {
                const errBody = await genRes.text();
                console.error("Caption generation failed:", errBody);
                // Caption might already exist — try fetching anyway
            }

            // 3. Wait a moment for caption to be ready, then fetch VTT
            // In practice, captions may take a few minutes. We'll try fetching immediately
            // and if it fails, the user can retry.
            await new Promise((resolve) => setTimeout(resolve, 3000));

            const vttRes = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoId}/captions/en/vtt`,
                {
                    headers: { Authorization: `Bearer ${apiToken}` },
                }
            );

            if (!vttRes.ok) {
                return c.json({
                    success: false,
                    message: "Captions not ready yet. Please try again in a few minutes.",
                }, 202);
            }

            const vttText = await vttRes.text();

            // 4. Parse VTT to plain text (strip timestamps, cue identifiers)
            const plainText = parseVttToText(vttText);

            if (!plainText.trim()) {
                return c.json({
                    success: false,
                    message: "Transcript is empty. The video may not have clear speech.",
                }, 200);
            }

            // 5. Store in R2
            await env.TRANSCRIPTS.put(`transcripts/${lessonId}.txt`, plainText, {
                customMetadata: {
                    lessonId,
                    videoId,
                    generatedAt: new Date().toISOString(),
                },
            });

            const wordCount = plainText.split(/\s+/).length;

            return c.json({
                success: true,
                message: `Transcript stored (${wordCount} words)`,
                wordCount,
            });
        } catch (error) {
            console.error("Error generating transcript:", error);
            return c.json({ success: false, message: "Failed to generate transcript" }, 500);
        }
    }
}

/** Parse WebVTT content into clean plain text */
function parseVttToText(vtt: string): string {
    const lines = vtt.split("\n");
    const textLines: string[] = [];
    const timestampRegex = /^\d{2}:\d{2}[\.:]\d{2}/;

    for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines, WEBVTT header, sequence numbers, timestamps
        if (
            !trimmed ||
            trimmed === "WEBVTT" ||
            trimmed.startsWith("NOTE") ||
            /^\d+$/.test(trimmed) ||
            timestampRegex.test(trimmed)
        ) {
            continue;
        }
        // Remove HTML tags from cue text
        const cleanText = trimmed.replace(/<[^>]+>/g, "");
        if (cleanText && !textLines.includes(cleanText)) {
            textLines.push(cleanText);
        }
    }

    return textLines.join(" ");
}
