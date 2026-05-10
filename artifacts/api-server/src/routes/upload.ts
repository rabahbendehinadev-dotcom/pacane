import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

export function getUploadDir(): string {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.resolve(process.cwd(), "uploads");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(getUploadDir(), "products");
    ensureDir(dir);
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Type de fichier non valide"));
  },
});

router.post(
  "/upload/product-image",
  requireAuth,
  upload.single("image"),
  (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "Aucun fichier reçu" }); return; }
    const imageUrl = `/uploads/products/${req.file.filename}`;
    res.json({ imageUrl });
  },
);

export default router;
