import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { getUploadDir } from "./routes/upload";
import { logger } from "./lib/logger";
import { db, preparationOrdersTable } from "@workspace/db";
import { sql, lte, isNotNull } from "drizzle-orm";

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
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use("/api", router);

// ── Serve uploaded files — BEFORE frontend static and SPA fallback ───────────
const uploadsRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

// Explicit GET handler: resolves the file path, validates it, and uses
// res.sendFile() so Express sets the correct Content-Type (image/jpeg etc.)
// instead of falling through to the SPA which returns text/html.
app.get("/uploads/{*path}", (req, res, next) => {
  const relativePath = req.path.replace(/^\/uploads\//, "");
  const filePath = path.resolve(uploadsRoot, relativePath);

  // Path traversal guard
  if (!filePath.startsWith(uploadsRoot)) {
    return res.status(403).send("Forbidden");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return next();
  }

  return res.sendFile(filePath);
});

// express.static as additional fallback (handles cache headers, ETags, etc.)
app.use("/uploads", express.static(uploadsRoot, { fallthrough: false }));

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

// ── Auto-cleanup: delete completion photos older than 30 days ──────────────
async function cleanupOldPhotos() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db.update(preparationOrdersTable)
      .set({ completionPhotoUrl: null })
      .where(
        sql`${preparationOrdersTable.completedAt} < ${cutoff} AND ${preparationOrdersTable.completionPhotoUrl} IS NOT NULL`
      )
      .returning({ id: preparationOrdersTable.id });
    if (result.length > 0) {
      logger.info({ count: result.length }, "Cleaned up completion photos older than 30 days");
    }
  } catch (err) {
    logger.error({ err }, "Failed to clean up old photos");
  }
}
// Run once at startup then every 24 hours
cleanupOldPhotos();
setInterval(cleanupOldPhotos, 24 * 60 * 60 * 1000);

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
