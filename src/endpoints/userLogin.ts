import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { sign } from "hono/jwt";
import { verifyPassword } from "../auth";

export class UserLogin extends OpenAPIRoute {
    schema = {
        tags: ["User"],
        summary: "Login a user",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            email: z.string().email(),
                            password: z.string(),
                        }),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Login successful",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            token: z.string(),
                            user: z.object({
                                id: z.string(),
                                email: z.string(),
                                name: z.string().nullable(),
                            }),
                        }),
                    },
                },
            },
            "401": {
                description: "Unauthorized - Invalid credentials",
            },
        },
    };

    async handle(c: Context) {
        const { email, password } = await c.req.json();
        const env = c.env as { DB: D1Database; JWT_SECRET: string };
        const db = env.DB;

        // Normalize email for consistent lookup
        const normalizedEmail = email.toLowerCase().trim();

        try {
            const user = await db
                .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
                .bind(normalizedEmail)
                .first<{ id: string; email: string; name: string | null; password_hash: string }>();

            if (!user) {
                return c.json({ success: false, message: "Invalid credentials" }, 401);
            }

            const isValid = await verifyPassword(password, user.password_hash);

            if (!isValid) {
                return c.json({ success: false, message: "Invalid credentials" }, 401);
            }

            // Generate JWT
            const secret = env.JWT_SECRET;
            if (!secret) {
                console.error("JWT_SECRET environment variable is not set!");
                return c.json({ success: false, message: "Server configuration error" }, 500);
            }

            const payload = {
                sub: user.id,
                email: user.email,
                name: user.name,
                exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours
            };

            const token = await sign(payload, secret);

            return c.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                },
            });
        } catch (error) {
            console.error("Login error:", error);
            return c.json({ success: false, message: "An unexpected error occurred" }, 500);
        }
    }
}
