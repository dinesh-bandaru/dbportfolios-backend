import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";

/**
 * AI chat endpoint: answers user questions based on lesson transcript.
 * Loads transcript from R2, sends to Workers AI with context.
 */
export class CourseChat extends OpenAPIRoute {
    schema = {
        tags: ["Course"],
        summary: "Ask a question about a lesson",
        security: [{ bearerAuth: [] }],
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            lessonId: z.string(),
                            message: z.string().min(1).max(1000),
                            history: z
                                .array(
                                    z.object({
                                        role: z.enum(["user", "assistant"]),
                                        content: z.string(),
                                    })
                                )
                                .max(10)
                                .optional(),
                        }),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "AI response",
                content: {
                    "application/json": {
                        schema: z.object({
                            reply: z.string(),
                        }),
                    },
                },
            },
            "404": { description: "Transcript not found" },
            "500": { description: "Server error" },
        },
    };

    async handle(c: Context) {
        const env = c.env as {
            TRANSCRIPTS: R2Bucket;
            AI: any;
        };

        const { lessonId, message, history = [] } = await c.req.json();

        try {
            // 1. Load transcript from R2
            const obj = await env.TRANSCRIPTS.get(`transcripts/${lessonId}.txt`);
            if (!obj) {
                return c.json(
                    { reply: "No transcript available for this lesson yet. The instructor may need to generate it." },
                    200
                );
            }

            const transcript = await obj.text();

            // 2. Build messages for AI
            const systemPrompt = `You are a helpful and expert AI learning assistant for the financial education platform "dBPortfolios". 
Your primary goal is to analyze the student's question and clear their doubts based ONLY on the provided lesson transcript.

INSTRUCTIONS:
1. Carefully read the user's question and identify their core doubt.
2. Analyze the transcript to find the exact concepts or answers relevant to their question.
3. Explain the concept clearly, concisely, and accurately to resolve their confusion.
4. If the user asks something completely unrelated to the transcript, politely guide them back to the topic.
5. Use markdown formatting for readability (bolding key terms, bullet points for lists).

LESSON TRANSCRIPT:
${transcript}`;

            const messages = [
                { role: "system", content: systemPrompt },
                ...history.slice(-8), // Keep last 8 messages for context
                { role: "user", content: message },
            ];

            // 3. Call Workers AI with streaming
            const responseStream = await env.AI.run(
                "@cf/zai-org/glm-4.7-flash",
                { messages, stream: true }
            );

            return new Response(responseStream as any, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        } catch (error) {
            console.error("Chat error:", error);
            return c.json(
                { reply: "Something went wrong. Please try again." },
                500
            );
        }
    }
}
