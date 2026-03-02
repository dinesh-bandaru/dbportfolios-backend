import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import { hashPassword } from "../auth";

export class UserSignup extends OpenAPIRoute {
    schema = {
        tags: ["User"],
        summary: "Register a new user",
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            email: z.string().email(),
                            password: z.string().min(8),
                            name: z.string().optional(),
                        }),
                    },
                },
            },
        },
        responses: {
            "201": {
                description: "User successfully created",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: z.boolean(),
                            message: z.string(),
                        }),
                    },
                },
            },
            "400": {
                description: "Bad Request / Email already exists",
            },
        },
    };

    async handle(c: Context) {
        const { email, password, name } = await c.req.json();
        const db = (c.env as { DB: D1Database }).DB;

        // Normalize email to prevent duplicates
        const normalizedEmail = email.toLowerCase().trim();

        try {
            // Check if user exists
            const existingUser = await db
                .prepare("SELECT id FROM users WHERE email = ?")
                .bind(normalizedEmail)
                .first();

            if (existingUser) {
                return c.json({ success: false, message: "Email already exists" }, 400);
            }

            const id = crypto.randomUUID();
            const passwordHash = await hashPassword(password);

            await db
                .prepare("INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)")
                .bind(id, normalizedEmail, passwordHash, name || null)
                .run();

            return c.json({ success: true, message: "User created" }, 201);
        } catch (error) {
            console.error("Signup error:", error);
            return c.json({ success: false, message: "An unexpected error occurred" }, 500);
        }
    }
}
