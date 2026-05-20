import crypto from "crypto";

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "erp_salt_2024").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(userId: number): string {
  const payload = { userId, ts: Date.now() };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function parseToken(token: string): { userId: number } | null {
  try {
    const payload = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
