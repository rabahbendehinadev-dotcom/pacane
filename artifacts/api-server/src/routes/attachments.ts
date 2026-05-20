import { Router, type IRouter } from "express";
import { db, attachmentsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { visibleBranchIds } from "../middlewares/permissions";
import { ALLOWED_MIME_TYPES, MAX_ATTACHMENT_SIZE_BYTES } from "@workspace/db";

const router: IRouter = Router();

// ── Validation helpers ─────────────────────────────────────────────────
const ALLOWED_ENTITY_TYPES = ["expense", "purchase", "sale"] as const;

function isMimeAllowed(mime: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

// ── GET /attachments?entityType=expense&entityId=1 ─────────────────────
router.get("/attachments", requireAuth, async (req, res): Promise<void> => {
  const { entityType, entityId } = req.query as Record<string, string>;

  if (!entityType || !entityId || !ALLOWED_ENTITY_TYPES.includes(entityType as any)) {
    res.status(400).json({ error: "entityType et entityId requis" });
    return;
  }

  const id = parseInt(entityId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "entityId invalide" });
    return;
  }

  try {
    const scope = visibleBranchIds(req.user!);
    const rows = await db
      .select({
        id: attachmentsTable.id,
        entityType: attachmentsTable.entityType,
        entityId: attachmentsTable.entityId,
        originalFilename: attachmentsTable.originalFilename,
        objectPath: attachmentsTable.objectPath,
        mimeType: attachmentsTable.mimeType,
        sizeBytes: attachmentsTable.sizeBytes,
        uploadedByUserId: attachmentsTable.uploadedByUserId,
        uploadedByName: usersTable.name,
        branchId: attachmentsTable.branchId,
        createdAt: attachmentsTable.createdAt,
      })
      .from(attachmentsTable)
      .leftJoin(usersTable, eq(attachmentsTable.uploadedByUserId, usersTable.id))
      .where(
        and(
          eq(attachmentsTable.entityType, entityType),
          eq(attachmentsTable.entityId, id)
        )
      )
      .orderBy(attachmentsTable.createdAt);

    const filtered = scope === null
      ? rows
      : rows.filter(r => r.branchId === null || scope.includes(r.branchId));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la récupération des pièces jointes" });
  }
});

// ── POST /attachments — Register attachment after upload ────────────────
router.post("/attachments", requireAuth, async (req, res): Promise<void> => {
  const { entityType, entityId, originalFilename, objectPath, mimeType, sizeBytes, branchId } = req.body;

  // Validation
  if (!entityType || !entityId || !originalFilename || !objectPath || !mimeType || !sizeBytes) {
    res.status(400).json({ error: "Champs obligatoires manquants" });
    return;
  }
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
    res.status(400).json({ error: "Type d'entité non supporté" });
    return;
  }
  if (!isMimeAllowed(mimeType)) {
    res.status(400).json({
      error: "Type de fichier non autorisé. Types acceptés : PDF, images (JPG, PNG, WEBP), documents Office"
    });
    return;
  }
  if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    res.status(400).json({ error: `Fichier trop volumineux. Taille maximale : 10 Mo` });
    return;
  }

  // Branch access check
  const allowed = visibleBranchIds(req.user!);
  if (branchId && allowed !== null && !allowed.includes(branchId)) {
    res.status(403).json({ error: "Accès refusé à cette succursale" });
    return;
  }

  try {
    const [attachment] = await db.insert(attachmentsTable).values({
      entityType,
      entityId: parseInt(entityId, 10),
      originalFilename: originalFilename.replace(/[^a-zA-Z0-9._\-\u00C0-\u024F ]/g, "_").substring(0, 255),
      objectPath,
      mimeType,
      sizeBytes: parseInt(sizeBytes, 10),
      uploadedByUserId: req.user!.id,
      branchId: branchId ? parseInt(branchId, 10) : null,
    }).returning();

    res.status(201).json({
      ...attachment,
      uploadedByName: req.user!.name ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de l'enregistrement de la pièce jointe" });
  }
});

// ── DELETE /attachments/:id ─────────────────────────────────────────────
router.delete("/attachments/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID invalide" });
    return;
  }

  // Fetch to check ownership/branch
  const [existing] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Pièce jointe introuvable" });
    return;
  }

  // Branch access check
  const allowed = visibleBranchIds(req.user!);
  if (existing.branchId && allowed !== null && !allowed.includes(existing.branchId)) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  // Only uploader or admin (no branch restriction = admin) can delete
  const user = req.user!;
  const allowed2 = visibleBranchIds(user);
  const isAdmin = allowed2 === null; // null = no restriction = admin role
  if (!isAdmin && existing.uploadedByUserId !== user.id) {
    res.status(403).json({ error: "Vous ne pouvez supprimer que vos propres pièces jointes" });
    return;
  }

  try {
    await db.delete(attachmentsTable).where(eq(attachmentsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

export default router;
