// v1.2.0 — JWT auth middleware, secrets fix
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { verify } from "hono/jwt";
import { UserSignup } from "./endpoints/userSignup";
import { UserLogin } from "./endpoints/userLogin";
import { LiveIndices } from "./endpoints/liveIndices";
import { CourseStream } from "./endpoints/courseStream";
import { CourseLessons } from "./endpoints/courseLessons";
import { GenerateTranscript } from "./endpoints/generateTranscript";
import { CourseChat } from "./endpoints/courseChat";

type Env = {
	DB: D1Database;
	TRANSCRIPTS: R2Bucket;
	AI: any;
	JWT_SECRET: string;
	CORS_ORIGIN: string;
	STREAM_SIGNING_KEY_ID: string;
	STREAM_SIGNING_KEY_PEM: string;
	STREAM_CUSTOMER_CODE: string;
	STREAM_ACCOUNT_ID: string;
	STREAM_API_TOKEN: string;
};

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Global error handler — prevents stack traces from leaking
app.onError((err, c) => {
	console.error("Unhandled error:", err.message, err.stack);
	return c.json(
		{ success: false, message: "Internal server error" },
		500,
	);
});

// CORS — uses CORS_ORIGIN env var, falls back to localhost for dev
app.use("/api/*", cors({
	origin: (origin, c) => {
		const allowed = c.env.CORS_ORIGIN || "http://localhost:4321";
		return allowed.split(",").includes(origin) ? origin : "";
	},
	allowMethods: ["POST", "GET", "OPTIONS"],
	allowHeaders: ["Content-Type", "Authorization"],
	exposeHeaders: ["Content-Length"],
	maxAge: 600,
	credentials: true,
}));

// JWT Authentication middleware — protects /api/protected/* routes
app.use("/api/protected/*", async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return c.json({ success: false, message: "Missing or invalid Authorization header" }, 401);
	}

	const token = authHeader.slice(7); // Remove "Bearer "
	const secret = c.env.JWT_SECRET;
	if (!secret) {
		console.error("JWT_SECRET is not configured");
		return c.json({ success: false, message: "Server configuration error" }, 500);
	}

	try {
		const payload = await verify(token, secret, "HS256");
		c.set("jwtPayload", payload);
		await next();
	} catch (err) {
		return c.json({ success: false, message: "Invalid or expired token" }, 401);
	}
});

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Public endpoints (no auth required)
openapi.post("/api/auth/signup", UserSignup);
openapi.post("/api/auth/login", UserLogin);
openapi.get("/api/market/indices", LiveIndices);

// Protected endpoints (JWT required)
openapi.get("/api/protected/course", CourseStream);
openapi.get("/api/protected/course/lessons", CourseLessons);
openapi.post("/api/protected/course/chat", CourseChat);

// Admin endpoints
openapi.post("/api/admin/generate-transcript", GenerateTranscript);

// Export the Hono app
export default app;

