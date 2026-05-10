import { db, contactsTable, salesTable, creditOverrideLogsTable, usersTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";

export type CreditState = "no_limit" | "ok" | "warning" | "exceeded";

export interface CreditStatus {
  creditLimit: number | null;
  unpaidBalance: number;
  projectedBalance: number;
  remainingCredit: number | null;
  usagePercent: number | null;
  projectedUsagePercent: number | null;
  state: CreditState;
  canOverride: boolean;
}

export async function computeCreditStatus(customerId: number, newAmount: number): Promise<CreditStatus | null> {
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, customerId));
  if (!contact) return null;

  const creditLimit = contact.creditLimit != null ? parseFloat(contact.creditLimit as string) : null;

  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${salesTable.total} - ${salesTable.paid}), 0)` })
    .from(salesTable)
    .where(
      and(
        eq(salesTable.customerId, customerId),
        eq(salesTable.type, "sale"),
        inArray(salesTable.status, ["confirmed", "active"]),
        inArray(salesTable.paymentStatus, ["unpaid", "partially_paid"])
      )
    );

  const unpaidBalance = parseFloat(row?.total ?? "0");
  const projectedBalance = unpaidBalance + newAmount;

  if (creditLimit === null) {
    return {
      creditLimit: null,
      unpaidBalance,
      projectedBalance,
      remainingCredit: null,
      usagePercent: null,
      projectedUsagePercent: null,
      state: "no_limit",
      canOverride: false,
    };
  }

  const remainingCredit = Math.max(0, creditLimit - unpaidBalance);
  const usagePercent = creditLimit > 0 ? (unpaidBalance / creditLimit) * 100 : 0;
  const projectedUsagePercent = creditLimit > 0 ? (projectedBalance / creditLimit) * 100 : 0;

  let state: CreditState;
  if (projectedBalance > creditLimit) {
    state = "exceeded";
  } else if (projectedUsagePercent >= 80) {
    state = "warning";
  } else {
    state = "ok";
  }

  return {
    creditLimit,
    unpaidBalance,
    projectedBalance,
    remainingCredit,
    usagePercent,
    projectedUsagePercent,
    state,
    canOverride: false,
  };
}

export function canOverrideCredit(roleId: number | null | undefined): boolean {
  return roleId === 1 || roleId === 2;
}

export async function logCreditOverride(params: {
  customerId: number;
  saleId: number;
  userId: number;
  reason: string;
  creditLimit: number | null;
  unpaidBalance: number;
  newAmount: number;
}) {
  await db.insert(creditOverrideLogsTable).values({
    customerId: params.customerId,
    saleId: params.saleId,
    userId: params.userId,
    reason: params.reason,
    creditLimit: params.creditLimit?.toString() ?? null,
    unpaidBalance: params.unpaidBalance.toString(),
    newAmount: params.newAmount.toString(),
  });
}

export async function getCreditOverrideLogs(customerId: number) {
  const logs = await db
    .select({
      log: creditOverrideLogsTable,
      userName: usersTable.name,
    })
    .from(creditOverrideLogsTable)
    .leftJoin(usersTable, eq(creditOverrideLogsTable.userId, usersTable.id))
    .where(eq(creditOverrideLogsTable.customerId, customerId))
    .orderBy(sql`${creditOverrideLogsTable.createdAt} DESC`);

  return logs.map(l => ({
    id: l.log.id,
    customerId: l.log.customerId,
    saleId: l.log.saleId,
    userId: l.log.userId,
    userName: l.userName ?? "Inconnu",
    reason: l.log.reason,
    creditLimit: l.log.creditLimit ? parseFloat(l.log.creditLimit as string) : null,
    unpaidBalance: parseFloat(l.log.unpaidBalance as string),
    newAmount: parseFloat(l.log.newAmount as string),
    createdAt: l.log.createdAt,
  }));
}
