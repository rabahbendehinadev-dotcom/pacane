import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { db, workersTable, productsTable, workerDocumentsTable, workerSkillsTable, workerActivityLogsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requirePermission } from "../middlewares/permissions";
import { P } from "../lib/permissions";
import { getUploadDir } from "./upload";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────
function getWorkerUploadsDir() {
  return path.join(getUploadDir(), "workers");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeWorkerMulter(subdir: string, imageOnly: boolean) {
  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(getWorkerUploadsDir(), subdir);
      ensureDir(dir);
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase() || ".bin";
      cb(null, `${randomUUID()}${ext}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: imageOnly ? 5 * 1024 * 1024 : 20 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
      if (imageOnly) {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("Image uniquement (JPG, PNG, WEBP)"));
      } else {
        const allowed = [
          "image/", "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ];
        if (allowed.some(t => file.mimetype.startsWith(t))) cb(null, true);
        else cb(new Error("Type de fichier non supporté"));
      }
    },
  });
}

const photoUpload = makeWorkerMulter("photos", true);
const docUpload = makeWorkerMulter("documents", false);

async function logActivity(
  workerId: number,
  action: string,
  opts: {
    field?: string;
    oldValue?: string;
    newValue?: string;
    userId?: number;
    userName?: string;
    meta?: Record<string, unknown>;
  } = {}
) {
  try {
    await db.insert(workerActivityLogsTable).values({
      workerId,
      action,
      field: opts.field ?? null,
      oldValue: opts.oldValue ?? null,
      newValue: opts.newValue ?? null,
      performedByUserId: opts.userId ?? null,
      performedByName: opts.userName ?? null,
      meta: opts.meta ?? null,
    });
  } catch {}
}

// ── GET /workers — liste ───────────────────────────────────────────────────────
router.get("/workers", requireAuth, requirePermission(P.workers.view), async (_req, res): Promise<void> => {
  const workers = await db.select({
    id: workersTable.id,
    name: workersTable.name,
    phone: workersTable.phone,
    isActive: workersTable.isActive,
    photoUrl: workersTable.photoUrl,
    position: workersTable.position,
    department: workersTable.department,
    hireDate: workersTable.hireDate,
    productCount: sql<number>`(SELECT COUNT(*) FROM products WHERE products.worker_id = ${workersTable.id})`,
    createdAt: workersTable.createdAt,
  }).from(workersTable).orderBy(workersTable.name);
  res.json(workers);
});

// ── GET /workers/:id — profil complet ─────────────────────────────────────────
router.get("/workers/:id", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [worker] = await db.select({
    ...workersTable,
    productCount: sql<number>`(SELECT COUNT(*) FROM products WHERE products.worker_id = ${workersTable.id})`,
  }).from(workersTable).where(eq(workersTable.id, id));

  if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }

  const [documents, skills, recentActivity] = await Promise.all([
    db.select().from(workerDocumentsTable).where(eq(workerDocumentsTable.workerId, id)).orderBy(desc(workerDocumentsTable.uploadedAt)),
    db.select().from(workerSkillsTable).where(eq(workerSkillsTable.workerId, id)).orderBy(workerSkillsTable.skill),
    db.select().from(workerActivityLogsTable).where(eq(workerActivityLogsTable.workerId, id)).orderBy(desc(workerActivityLogsTable.createdAt)).limit(50),
  ]);

  res.json({ ...worker, documents, skills, recentActivity });
});

// ── POST /workers — créer ──────────────────────────────────────────────────────
router.post("/workers", requireAuth, requirePermission(P.workers.create), async (req, res): Promise<void> => {
  const { name, phone } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Nom requis" }); return; }
  const [worker] = await db.insert(workersTable).values({ name: name.trim(), phone: phone?.trim() || null }).returning();

  await logActivity(worker.id, "created", {
    userId: (req as any).user?.id,
    userName: (req as any).user?.name,
  });

  res.status(201).json({ ...worker, productCount: 0, documents: [], skills: [], recentActivity: [] });
});

// ── PATCH /workers/:id — mettre à jour le profil ─────────────────────────────
router.patch("/workers/:id", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ALLOWED = [
    "name", "phone", "lastName", "firstName", "birthDate", "gender",
    "whatsapp", "email", "address", "city", "nationalId", "maritalStatus",
    "childrenCount", "emergencyContact", "emergencyPhone",
    "hireDate", "position", "department", "contractType", "baseSalary",
    "commissionRate", "workHours", "restDays",
    "hasChronicDisease", "chronicDiseaseDetails", "takesMedication",
    "allergies", "bloodType", "medicalNotes", "notes",
  ];

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in req.body) updates[key] = req.body[key] ?? null;
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Aucun champ à mettre à jour" }); return; }

  // Validate name if provided
  if ("name" in updates && !String(updates.name ?? "").trim()) {
    res.status(400).json({ error: "Le nom ne peut pas être vide" }); return;
  }

  updates.updatedAt = new Date();

  const [worker] = await db.update(workersTable)
    .set(updates as any)
    .where(eq(workersTable.id, id))
    .returning();

  if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }

  await logActivity(id, "updated", {
    userId: (req as any).user?.id,
    userName: (req as any).user?.name,
    meta: { fields: Object.keys(updates).filter(k => k !== "updatedAt") },
  });

  res.json(worker);
});

// ── PATCH /workers/:id/deactivate ─────────────────────────────────────────────
router.patch("/workers/:id/deactivate", requireAuth, requirePermission(P.workers.deactivate), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [worker] = await db.update(workersTable).set({ isActive: false }).where(eq(workersTable.id, id)).returning();
  if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }
  await logActivity(id, "deactivated", { userId: (req as any).user?.id, userName: (req as any).user?.name });
  res.json(worker);
});

// ── PATCH /workers/:id/activate ───────────────────────────────────────────────
router.patch("/workers/:id/activate", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [worker] = await db.update(workersTable).set({ isActive: true }).where(eq(workersTable.id, id)).returning();
  if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }
  await logActivity(id, "activated", { userId: (req as any).user?.id, userName: (req as any).user?.name });
  res.json(worker);
});

// ── POST /workers/:id/photo — upload photo ────────────────────────────────────
router.post("/workers/:id/photo", requireAuth, requirePermission(P.workers.edit),
  photoUpload.single("photo"),
  async (req: any, res: any): Promise<void> => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
    if (!req.file) { res.status(400).json({ error: "Aucun fichier reçu" }); return; }

    const photoUrl = `/uploads/workers/photos/${req.file.filename}`;

    const [existing] = await db.select({ photoUrl: workersTable.photoUrl }).from(workersTable).where(eq(workersTable.id, id));
    if (existing?.photoUrl) {
      const old = path.join(getUploadDir(), existing.photoUrl.replace(/^\/uploads\//, ""));
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    const [worker] = await db.update(workersTable).set({ photoUrl }).where(eq(workersTable.id, id)).returning();
    if (!worker) { res.status(404).json({ error: "Ouvrier introuvable" }); return; }

    await logActivity(id, "photo_uploaded", { userId: req.user?.id, userName: req.user?.name });
    res.json({ photoUrl });
  }
);

// ── DELETE /workers/:id/photo — supprimer photo ───────────────────────────────
router.delete("/workers/:id/photo", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [existing] = await db.select({ photoUrl: workersTable.photoUrl }).from(workersTable).where(eq(workersTable.id, id));
  if (existing?.photoUrl) {
    const old = path.join(getUploadDir(), existing.photoUrl.replace(/^\/uploads\//, ""));
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  await db.update(workersTable).set({ photoUrl: null }).where(eq(workersTable.id, id));
  await logActivity(id, "photo_deleted", { userId: (req as any).user?.id, userName: (req as any).user?.name });
  res.json({ success: true });
});

// ── GET /workers/:id/documents ────────────────────────────────────────────────
router.get("/workers/:id/documents", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const docs = await db.select().from(workerDocumentsTable).where(eq(workerDocumentsTable.workerId, id)).orderBy(desc(workerDocumentsTable.uploadedAt));
  res.json(docs);
});

// ── POST /workers/:id/documents — upload document ─────────────────────────────
router.post("/workers/:id/documents", requireAuth, requirePermission(P.workers.edit),
  docUpload.single("file"),
  async (req: any, res: any): Promise<void> => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
    if (!req.file) { res.status(400).json({ error: "Aucun fichier reçu" }); return; }

    const { category = "other", label } = req.body;
    if (!label?.trim()) { res.status(400).json({ error: "Libellé requis" }); return; }

    const fileUrl = `/uploads/workers/documents/${req.file.filename}`;

    const [doc] = await db.insert(workerDocumentsTable).values({
      workerId: id,
      category,
      label: label.trim(),
      fileUrl,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedByUserId: req.user?.id ?? null,
    }).returning();

    await logActivity(id, "document_added", {
      userId: req.user?.id,
      userName: req.user?.name,
      meta: { documentId: doc.id, label: doc.label, category: doc.category },
    });

    res.status(201).json(doc);
  }
);

// ── DELETE /workers/:id/documents/:docId ──────────────────────────────────────
router.delete("/workers/:id/documents/:docId", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const docId = parseInt(req.params.docId, 10);
  if (isNaN(id) || isNaN(docId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [doc] = await db.select().from(workerDocumentsTable).where(eq(workerDocumentsTable.id, docId));
  if (!doc || doc.workerId !== id) { res.status(404).json({ error: "Document introuvable" }); return; }

  const filePath = path.join(getUploadDir(), doc.fileUrl.replace(/^\/uploads\//, ""));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await db.delete(workerDocumentsTable).where(eq(workerDocumentsTable.id, docId));
  await logActivity(id, "document_deleted", {
    userId: (req as any).user?.id,
    userName: (req as any).user?.name,
    meta: { label: doc.label },
  });
  res.json({ success: true });
});

// ── GET /workers/:id/skills ───────────────────────────────────────────────────
router.get("/workers/:id/skills", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const skills = await db.select().from(workerSkillsTable).where(eq(workerSkillsTable.workerId, id)).orderBy(workerSkillsTable.skill);
  res.json(skills);
});

// ── POST /workers/:id/skills ──────────────────────────────────────────────────
router.post("/workers/:id/skills", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const { skill, level, yearsExperience, certification } = req.body;
  if (!skill?.trim()) { res.status(400).json({ error: "Compétence requise" }); return; }

  const [s] = await db.insert(workerSkillsTable).values({
    workerId: id,
    skill: skill.trim(),
    level: level || null,
    yearsExperience: yearsExperience ? parseInt(yearsExperience, 10) : null,
    certification: certification?.trim() || null,
  }).returning();

  await logActivity(id, "skill_added", {
    userId: (req as any).user?.id,
    userName: (req as any).user?.name,
    meta: { skill: s.skill },
  });

  res.status(201).json(s);
});

// ── PATCH /workers/:id/skills/:skillId ────────────────────────────────────────
router.patch("/workers/:id/skills/:skillId", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const skillId = parseInt(req.params.skillId, 10);
  if (isNaN(id) || isNaN(skillId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { skill, level, yearsExperience, certification } = req.body;
  const updates: Record<string, unknown> = {};
  if (skill != null) updates.skill = skill.trim();
  if (level !== undefined) updates.level = level || null;
  if (yearsExperience !== undefined) updates.yearsExperience = yearsExperience ? parseInt(yearsExperience, 10) : null;
  if (certification !== undefined) updates.certification = certification?.trim() || null;

  const [s] = await db.update(workerSkillsTable).set(updates as any).where(eq(workerSkillsTable.id, skillId)).returning();
  if (!s) { res.status(404).json({ error: "Compétence introuvable" }); return; }

  await logActivity(id, "skill_updated", { userId: (req as any).user?.id, userName: (req as any).user?.name });
  res.json(s);
});

// ── DELETE /workers/:id/skills/:skillId ───────────────────────────────────────
router.delete("/workers/:id/skills/:skillId", requireAuth, requirePermission(P.workers.edit), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const skillId = parseInt(req.params.skillId, 10);
  if (isNaN(id) || isNaN(skillId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [s] = await db.select().from(workerSkillsTable).where(eq(workerSkillsTable.id, skillId));
  if (!s) { res.status(404).json({ error: "Compétence introuvable" }); return; }

  await db.delete(workerSkillsTable).where(eq(workerSkillsTable.id, skillId));
  await logActivity(id, "skill_deleted", {
    userId: (req as any).user?.id,
    userName: (req as any).user?.name,
    meta: { skill: s.skill },
  });
  res.json({ success: true });
});

// ── GET /workers/:id/activity ─────────────────────────────────────────────────
router.get("/workers/:id/activity", requireAuth, requirePermission(P.workers.view), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const logs = await db.select().from(workerActivityLogsTable)
    .where(eq(workerActivityLogsTable.workerId, id))
    .orderBy(desc(workerActivityLogsTable.createdAt))
    .limit(100);
  res.json(logs);
});

export default router;
