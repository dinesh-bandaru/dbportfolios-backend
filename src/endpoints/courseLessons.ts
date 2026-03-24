import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";

/**
 * Returns the list of all lessons (id, title, description, sort_order, duration).
 * No signed video tokens — just metadata for the sidebar/UI.
 */
export class CourseLessons extends OpenAPIRoute {
    schema = {
        tags: ["Course"],
        summary: "List all course lessons",
        security: [{ bearerAuth: [] }],
        responses: {
            "200": {
                description: "List of lessons",
                content: {
                    "application/json": {
                        schema: z.object({
                            lessons: z.array(
                                z.object({
                                    id: z.string(),
                                    title: z.string(),
                                    description: z.string().nullable(),
                                    sortOrder: z.number(),
                                    duration: z.string().nullable(),
                                })
                            ),
                            totalDuration: z.string(),
                            lessonCount: z.number(),
                        }),
                    },
                },
            },
        },
    };

    async handle(c: Context) {
        const db = (c.env as { DB: D1Database }).DB;

        try {
            const { results } = await db
                .prepare("SELECT id, title, description, sort_order, duration_seconds FROM lessons ORDER BY sort_order ASC")
                .all();

            const lessons = (results || []).map((row: any) => ({
                id: row.id,
                title: row.title,
                description: row.description,
                sortOrder: row.sort_order,
                duration: formatDuration(row.duration_seconds),
            }));

            // Calculate total duration
            const totalSeconds = (results || []).reduce(
                (sum: number, row: any) => sum + (row.duration_seconds || 0),
                0
            );

            return c.json({
                lessons,
                totalDuration: formatDuration(totalSeconds),
                lessonCount: lessons.length,
            });
        } catch (error) {
            console.error("Error fetching lessons:", error);
            return c.json({ success: false, message: "Failed to load lessons" }, 500);
        }
    }
}

/** Convert seconds to human-readable duration (e.g. "5 min", "1h 20min") */
function formatDuration(seconds: number | null): string | null {
    if (!seconds || seconds <= 0) return null;
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}min` : `${hours}h`;
}
