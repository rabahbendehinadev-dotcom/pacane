import crypto from "crypto";

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "erp_salt_2024").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(userId: number, tokenVersion = 0): string {
  const payload = { userId, ts: Date.now(), tv: tokenVersion };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function parseToken(token: string): { userId: number; tv: number } | null {
  try {
    const payload = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    return { userId: payload.userId, tv: payload.tv ?? 0 };
  } catch {
    return null;
  }
}
