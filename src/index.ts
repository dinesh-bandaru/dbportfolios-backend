// v1.2.0 — JWT auth middleware, secrets fix
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { verify } from "hono/jwt";
import { UserSignup } from "./endpoints/userSignup";
import { UserLogin } from "./endpoints/userLogin";
import { LiveIndices } from "./endpoints/liveIndices";

type Env = {
	DB: D1Database;
	JWT_SECRET: string;
	CORS_ORIGIN: string;
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

// Protected endpoints (JWT required) — add future endpoints here:
// openapi.get("/api/protected/portfolio", Portfolio);
// openapi.get("/api/protected/user/profile", UserProfile);

// Export the Hono app
export default app;

