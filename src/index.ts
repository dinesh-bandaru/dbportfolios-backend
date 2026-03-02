// v1.1.0 — type safety, error handling, email normalization
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { UserSignup } from "./endpoints/userSignup";
import { UserLogin } from "./endpoints/userLogin";

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

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.post("/api/auth/signup", UserSignup);
openapi.post("/api/auth/login", UserLogin);

// Export the Hono app
export default app;
