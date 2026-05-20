/**
 * Seed realistic sales return (avoir) examples.
 * Run with: DATABASE_URL="$DATABASE_URL" tsx lib/db/src/seed-returns.ts
 */
import { db } from "./index";
import { salesReturnsTable, salesReturnItemsTable, salesTable, saleItemsTable, contactsTable, branchesTable, usersTable, stockLevelsTable, stockMovementsTable, productsTable } from "./schema/index";
import { eq, like, and, sql } from "drizzle-orm";

async function main() {
  console.log("🔄  Seeding sales returns...");

  const existing = await db.select({ ref: salesReturnsTable.reference })
    .from(salesReturnsTable).where(like(salesReturnsTable.reference, "RET-%"));
  if (existing.length > 0) {
    console.log("⚠️  Returns already seeded, skipping.");
    return;
  }

  const [admin] = await db.select().from(usersTable).where(eq(usersTable.username, "admin"));
  const [manager] = await db.select().from(usersTable).where(eq(usersTable.username, "manager"));

  const branches = await db.select().from(branchesTable);
  const siege = branches.find(b => b.name.toLowerCase().includes("siège") || b.isMain) ?? branches[0];
  const bab = branches.find(b => b.name.toLowerCase().includes("bab")) ?? branches[1] ?? siege;
  const hydra = branches.find(b => b.name.toLowerCase().includes("hydra")) ?? branches[2] ?? siege;

  const allSales = await db.select().from(salesTable)
    .where(and(sql`${salesTable.type} = 'sale'`, sql`${salesTable.status} != 'cancelled'`));

  if (allSales.length < 3) {
    console.log("⚠️  Not enough sales to create returns. Run seed-sales.ts first.");
    return;
  }

  const contacts = await db.select().from(contactsTable);
  const hotel = contacts.find(c => c.displayName?.toLowerCase().includes("hôtel") || c.displayName?.toLowerCase().includes("hotel") || c.displayName?.toLowerCase().includes("zitoun"));
  const catering = contacts.find(c => c.displayName?.toLowerCase().includes("catering") || c.displayName?.toLowerCase().includes("farouk"));
  const epicerie = contacts.find(c => c.displayName?.toLowerCase().includes("épicerie") || c.displayName?.toLowerCase().includes("epicerie"));

  const siegeSales = allSales.filter(s => s.branchId === siege.id);
  const babSales = allSales.filter(s => s.branchId === bab.id);
  const hydraSales = allSales.filter(s => s.branchId === hydra.id);

  const saleA = siegeSales[0] ?? allSales[0];
  const saleB = babSales[0] ?? allSales[1];
  const saleC = hydraSales[0] ?? allSales[2];
  const saleD = siegeSales[1] ?? allSales[Math.min(3, allSales.length - 1)];
  const saleE = babSales[1] ?? allSales[Math.min(4, allSales.length - 1)];

  async function getSaleItems(saleId: number) {
    return db.select({ si: saleItemsTable, productName: productsTable.name })
      .from(saleItemsTable)
      .leftJoin(productsTable, eq(saleItemsTable.productId, productsTable.id))
      .where(eq(saleItemsTable.saleId, saleId));
  }

  async function adjustStock(productId: number, branchId: number, qty: number, ref: string, returnId: number) {
    await db.update(stockLevelsTable)
      .set({ quantity: sql`${stockLevelsTable.quantity} + ${qty.toString()}` })
      .where(and(eq(stockLevelsTable.productId, productId), eq(stockLevelsTable.branchId, branchId)));
    await db.insert(stockMovementsTable).values({
      type: "return", productId, branchId, quantity: qty.toString(),
      unitCost: "0", reference: ref, referenceId: returnId,
    });
  }

  let counter = 1000;
  function ref() { return `RET-${++counter}`; }

  /* ── Return 1: Simple confirmed return from a paid invoice ── */
  const itemsA = await getSaleItems(saleA.id);
  if (itemsA.length > 0) {
    const item = itemsA[0];
    const qty = 2;
    const price = parseFloat(item.si.unitPrice as string);
    const total = qty * price;
    const reference = ref();
    const [ret1] = await db.insert(salesReturnsTable).values({
      reference, saleId: saleA.id, customerId: saleA.customerId,
      branchId: saleA.branchId, status: "confirmed",
      reason: "Produits endommagés lors de la livraison",
      totalAmount: total.toString(), refundedAmount: total.toString(),
      notes: "Macarons écrasés. Remplacés par le même montant.",
      createdByUserId: admin?.id,
    }).returning();
    await db.insert(salesReturnItemsTable).values({
      returnId: ret1.id, saleItemId: item.si.id,
      productId: item.si.productId, productName: item.productName ?? "Produit",
      quantity: qty.toString(), unitPrice: price.toString(), total: total.toString(),
    });
    await adjustStock(item.si.productId, saleA.branchId, qty, reference, ret1.id);
    console.log(`  ✓ Return 1 (simple + remboursé): ${reference} ← ${saleA.reference}`);
  }

  /* ── Return 2: Partial return draft (not yet confirmed) ── */
  const itemsB = await getSaleItems(saleB.id);
  if (itemsB.length > 0) {
    const item = itemsB[0];
    const qty = 1;
    const price = parseFloat(item.si.unitPrice as string);
    const total = qty * price;
    const reference = ref();
    const [ret2] = await db.insert(salesReturnsTable).values({
      reference, saleId: saleB.id, customerId: saleB.customerId,
      branchId: saleB.branchId, status: "draft",
      reason: "Commande passée en double par erreur",
      totalAmount: total.toString(), refundedAmount: "0",
      notes: "En attente de validation du gérant.",
      createdByUserId: manager?.id ?? admin?.id,
    }).returning();
    await db.insert(salesReturnItemsTable).values({
      returnId: ret2.id, saleItemId: item.si.id,
      productId: item.si.productId, productName: item.productName ?? "Produit",
      quantity: qty.toString(), unitPrice: price.toString(), total: total.toString(),
    });
    console.log(`  ✓ Return 2 (brouillon): ${reference} ← ${saleB.reference}`);
  }

  /* ── Return 3: Partial return confirmed, partially refunded ── */
  const itemsC = await getSaleItems(saleC.id);
  if (itemsC.length >= 1) {
    const item1 = itemsC[0];
    const qty1 = 3;
    const price1 = parseFloat(item1.si.unitPrice as string);
    const total1 = qty1 * price1;
    const reference = ref();
    const [ret3] = await db.insert(salesReturnsTable).values({
      reference, saleId: saleC.id, customerId: saleC.customerId,
      branchId: saleC.branchId, status: "partially_refunded",
      reason: "Non-conformité produit : date de péremption dépassée",
      totalAmount: total1.toString(), refundedAmount: (total1 / 2).toFixed(2),
      notes: "Remboursement partiel accordé — litige en cours.",
      createdByUserId: admin?.id,
    }).returning();
    await db.insert(salesReturnItemsTable).values({
      returnId: ret3.id, saleItemId: item1.si.id,
      productId: item1.si.productId, productName: item1.productName ?? "Produit",
      quantity: qty1.toString(), unitPrice: price1.toString(), total: total1.toString(),
    });
    await adjustStock(item1.si.productId, saleC.branchId, qty1, reference, ret3.id);
    console.log(`  ✓ Return 3 (partiel remboursé): ${reference} ← ${saleC.reference}`);
  }

  /* ── Return 4: Return on unpaid invoice (reduces receivable) ── */
  const itemsD = await getSaleItems(saleD.id);
  if (itemsD.length > 0) {
    const item = itemsD[itemsD.length > 1 ? 1 : 0];
    const qty = 1;
    const price = parseFloat(item.si.unitPrice as string);
    const total = qty * price;
    const reference = ref();
    const [ret4] = await db.insert(salesReturnsTable).values({
      reference, saleId: saleD.id, customerId: saleD.customerId,
      branchId: saleD.branchId, status: "confirmed",
      reason: "Client a refusé une partie de la commande à la livraison",
      totalAmount: total.toString(), refundedAmount: "0",
      notes: "La créance client est réduite du montant du retour.",
      createdByUserId: admin?.id,
    }).returning();
    await db.insert(salesReturnItemsTable).values({
      returnId: ret4.id, saleItemId: item.si.id,
      productId: item.si.productId, productName: item.productName ?? "Produit",
      quantity: qty.toString(), unitPrice: price.toString(), total: total.toString(),
    });
    await adjustStock(item.si.productId, saleD.branchId, qty, reference, ret4.id);
    const saleTotal = parseFloat(saleD.total as string);
    const salePaid = parseFloat(saleD.paid as string);
    const newTotal = Math.max(0, saleTotal - total);
    const newDue = newTotal - salePaid;
    await db.update(salesTable).set({
      total: newTotal.toString(),
      paymentStatus: newDue <= 0 ? "paid" : salePaid > 0 ? "partially_paid" : "unpaid",
    }).where(eq(salesTable.id, saleD.id));
    console.log(`  ✓ Return 4 (sur facture impayée, créance réduite): ${reference} ← ${saleD.reference}`);
  }

  /* ── Return 5: Branch-specific return with multiple items ── */
  const itemsE = await getSaleItems(saleE.id);
  if (itemsE.length >= 2) {
    const items = itemsE.slice(0, 2);
    const totalAmount = items.reduce((s, i) => s + 1 * parseFloat(i.si.unitPrice as string), 0);
    const reference = ref();
    const [ret5] = await db.insert(salesReturnsTable).values({
      reference, saleId: saleE.id, customerId: saleE.customerId,
      branchId: saleE.branchId, status: "confirmed",
      reason: "Erreur de préparation — produits non commandés inclus",
      totalAmount: totalAmount.toString(), refundedAmount: "0",
      notes: "Multi-articles retournés. Avoir émis.",
      createdByUserId: manager?.id ?? admin?.id,
    }).returning();
    for (const item of items) {
      const qty = 1;
      const price = parseFloat(item.si.unitPrice as string);
      await db.insert(salesReturnItemsTable).values({
        returnId: ret5.id, saleItemId: item.si.id,
        productId: item.si.productId, productName: item.productName ?? "Produit",
        quantity: qty.toString(), unitPrice: price.toString(), total: (qty * price).toString(),
      });
      await adjustStock(item.si.productId, saleE.branchId, qty, reference, ret5.id);
    }
    const saleTotal = parseFloat(saleE.total as string);
    const salePaid = parseFloat(saleE.paid as string);
    const newTotal = Math.max(0, saleTotal - totalAmount);
    const newDue = newTotal - salePaid;
    await db.update(salesTable).set({
      total: newTotal.toString(),
      paymentStatus: newDue <= 0 ? "paid" : salePaid > 0 ? "partially_paid" : "unpaid",
    }).where(eq(salesTable.id, saleE.id));
    console.log(`  ✓ Return 5 (multi-articles, succursale Bab): ${reference} ← ${saleE.reference}`);
  }

  console.log("✅  Returns seeded successfully.");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
