import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { getUploadDir } from "./routes/upload";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve uploaded product images
const uploadDir = getUploadDir();
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use("/uploads", express.static(uploadDir));

// ── Serve frontend static files in production ──────────────────────────────
// In production (Docker), the built frontend is copied to ./frontend-dist
// relative to the dist/index.mjs file location.
if (process.env.NODE_ENV === "production") {
  const distDir = process.env.FRONTEND_DIST
    ? path.resolve(process.env.FRONTEND_DIST)
    : path.resolve(path.dirname(new URL(import.meta.url).pathname), "../frontend-dist");

  if (fs.existsSync(distDir)) {
    logger.info({ distDir }, "Serving frontend static files");
    app.use(express.static(distDir));
    // SPA fallback — serve index.html for all non-API routes
    // Express 5 requires named wildcard syntax: /{*path}
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    logger.warn({ distDir }, "Frontend dist directory not found — API-only mode");
  }
}

// ── Global JSON error handler ──────────────────────────────────────────────
// Must be last middleware — catches any unhandled error and returns JSON
// so the frontend always receives a parseable error body.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled route error");
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  res.status(status).json({
    error: err.message ?? "Erreur serveur interne",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

export default app;
