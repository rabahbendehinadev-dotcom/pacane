import { Request, Response, NextFunction } from "express";
import { hasPermission, canAccessBranch } from "../lib/permissions";

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const permissions = req.userPermissions ?? [];
    if (!hasPermission(permissions, permission)) {
      res.status(403).json({
        error: "Accès refusé",
        code: "PERMISSION_DENIED",
        required: permission,
      });
      return;
    }
    next();
  };
}

/** Accepts if the user has ANY of the listed permissions (OR logic). */
export function requireAnyPermission(...perms: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const permissions = req.userPermissions ?? [];
    if (perms.some(p => hasPermission(permissions, p))) { next(); return; }
    res.status(403).json({
      error: "Accès refusé",
      code: "PERMISSION_DENIED",
      required: perms.join(" | "),
    });
  };
}

export function requireBranchAccess(getBranchId: (req: Request) => number | null | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) { res.status(401).json({ error: "Non authentifié" }); return; }
    if (user.adminAccess) { next(); return; }
    const branchId = getBranchId(req);
    if (branchId == null) { next(); return; }
    if (!canAccessBranch(user.adminAccess, user.branchIds, branchId)) {
      res.status(403).json({
        error: "Accès refusé à cette succursale",
        code: "BRANCH_ACCESS_DENIED",
        branchId,
      });
      return;
    }
    next();
  };
}

export function assertBranchAccess(
  user: { adminAccess: boolean; branchIds: number[] },
  branchId: number,
  res: Response
): boolean {
  if (canAccessBranch(user.adminAccess, user.branchIds, branchId)) return true;
  res.status(403).json({
    error: "Accès refusé à cette succursale",
    code: "BRANCH_ACCESS_DENIED",
    branchId,
  });
  return false;
}

export function visibleBranchIds(
  user: { adminAccess: boolean; branchIds: number[] },
  requestedBranchId?: number | null
): number[] | null {
  if (user.adminAccess) return requestedBranchId ? [requestedBranchId] : null;
  if (user.branchIds.length === 0) return [];
  if (requestedBranchId) {
    return user.branchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
  }
  return user.branchIds;
}
