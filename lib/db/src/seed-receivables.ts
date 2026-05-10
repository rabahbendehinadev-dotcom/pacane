/**
 * Seed realistic customer receivable alert scenarios.
 *
 * Creates 4 customers:
 *  1. Pâtisserie Aziz SARL        — warning (45j, 320 000 DA, 64% crédit)
 *  2. Groupe Hôtelier Riadh SPA   — critical (limite dépassée: 400k limit, 580k impayé)
 *  3. Restauration Belkacem SARL  — critical (95j, 1 150 000 DA, pas de limite)
 *  4. Café des Artistes Alger     — sain (payé récemment)
 */
import { db } from "./index";
import {
  contactsTable, salesTable, saleItemsTable, salePaymentsTable,
  productsTable, branchesTable, usersTable,
} from "./schema/index";
import { eq, like } from "drizzle-orm";

async function seedReceivables() {
  console.log("Seeding customer receivable alert data...");

  // Idempotency guard
  const existing = await db.select({ id: contactsTable.id })
    .from(contactsTable)
    .where(like(contactsTable.displayName, "%Aziz SARL%"));
  if (existing.length > 0) {
    console.log("Receivable seed already applied, skipping.");
    process.exit(0);
  }

  // ── Resolve dependencies ─────────────────────────────────────────────
  const branches = await db.select().from(branchesTable);
  const products = await db.select().from(productsTable)
    .where(eq(productsTable.isSellable, true));
  const users = await db.select().from(usersTable);

  const beo = branches.find(b => b.code === "BEO")!;
  const hyd = branches.find(b => b.code === "HYD")!;
  const siege = branches.find(b => b.code === "SIEGE") ?? beo;
  const admin = users.find(u => u.username === "admin")!;

  const p1 = products[0];
  const p2 = products[1] ?? p1;
  const p3 = products[2] ?? p1;

  if (!beo || !hyd || !p1 || !admin) {
    console.error("Missing branches or products — run main seed first");
    process.exit(1);
  }

  const now = new Date();
  function daysAgo(n: number): Date {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  }
  function dateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  // ── Helper: insert a sale with items and optional payments ───────────
  async function insertSale(opts: {
    ref: string;
    customerId: number;
    branchId: number;
    items: { productId: number; qty: number; price: number }[];
    payments?: { amount: number; method: string; date: string }[];
    createdAt: Date;
  }) {
    const subtotal = opts.items.reduce((s, i) => s + i.qty * i.price, 0);
    const total = subtotal;
    const paid = (opts.payments ?? []).reduce((s, p) => s + p.amount, 0);
    const paymentStatus = paid >= total ? "paid" : paid > 0 ? "partially_paid" : "unpaid";

    const [sale] = await db.insert(salesTable).values({
      reference: opts.ref,
      type: "sale",
      customerId: opts.customerId,
      branchId: opts.branchId,
      status: "confirmed",
      paymentStatus,
      fulfillmentType: "delivery",
      fulfillmentStatus: "delivered",
      subtotal: subtotal.toString(),
      discount: "0",
      tax: "0",
      shippingFee: "0",
      total: total.toString(),
      paid: paid.toString(),
      createdByUserId: admin.id,
      createdAt: opts.createdAt,
    }).returning();

    for (const item of opts.items) {
      await db.insert(saleItemsTable).values({
        saleId: sale.id,
        productId: item.productId,
        quantity: item.qty.toString(),
        unitPrice: item.price.toString(),
        discount: "0",
        total: (item.qty * item.price).toString(),
      });
    }

    for (const pmt of opts.payments ?? []) {
      await db.insert(salePaymentsTable).values({
        saleId: sale.id,
        amount: pmt.amount.toString(),
        method: pmt.method,
        date: pmt.date,
      });
    }
    return sale;
  }

  // ══════════════════════════════════════════════════════════════════════
  // CLIENT 1 — Pâtisserie Aziz SARL — WARNING (45j, 320 000 DA, 64%)
  // ══════════════════════════════════════════════════════════════════════
  const [aziz] = await db.insert(contactsTable).values({
    type: "customer",
    displayName: "Pâtisserie Aziz SARL",
    companyName: "Pâtisserie Aziz SARL",
    phone: "+213 555 100 200",
    email: "commandes@patisserie-aziz.dz",
    city: "Alger",
    status: "active",
    creditLimit: "500000",
    notes: "Client B2B régulier. Commandes hebdomadaires.",
  }).returning();

  // Invoice 45 days ago — 200 000 DA, partially paid (50 000)
  await insertSale({
    ref: "REC-AZIZ-001",
    customerId: aziz.id,
    branchId: beo.id,
    items: [
      { productId: p1.id, qty: 200, price: 650 },
      { productId: p2.id, qty: 100, price: 500 },
    ],
    payments: [
      { amount: 50000, method: "transfer", date: dateStr(daysAgo(40)) },
    ],
    createdAt: daysAgo(45),
  });

  // Invoice 38 days ago — 120 000 DA, unpaid
  await insertSale({
    ref: "REC-AZIZ-002",
    customerId: aziz.id,
    branchId: beo.id,
    items: [
      { productId: p1.id, qty: 100, price: 750 },
      { productId: p3.id, qty: 60, price: 450 },
    ],
    createdAt: daysAgo(38),
  });

  // ══════════════════════════════════════════════════════════════════════
  // CLIENT 2 — Groupe Hôtelier Riadh SPA — CRITICAL (limite dépassée)
  // ══════════════════════════════════════════════════════════════════════
  const [riadh] = await db.insert(contactsTable).values({
    type: "customer",
    displayName: "Groupe Hôtelier Riadh SPA",
    companyName: "Groupe Hôtelier Riadh SPA",
    phone: "+213 21 400 100",
    email: "achats@hotel-riadh.dz",
    city: "Alger",
    status: "active",
    creditLimit: "400000",
    notes: "Grand compte hôtelier. Plafond 400 000 DA actuellement dépassé.",
  }).returning();

  // Invoice 55 days ago — 250 000 DA, unpaid
  await insertSale({
    ref: "REC-RIADH-001",
    customerId: riadh.id,
    branchId: hyd.id,
    items: [
      { productId: p1.id, qty: 250, price: 600 },
      { productId: p2.id, qty: 100, price: 750 },
    ],
    createdAt: daysAgo(55),
  });

  // Invoice 30 days ago — 180 000 DA, unpaid (total: 430k > limit 400k)
  await insertSale({
    ref: "REC-RIADH-002",
    customerId: riadh.id,
    branchId: hyd.id,
    items: [
      { productId: p3.id, qty: 120, price: 900 },
      { productId: p1.id, qty: 120, price: 250 },
    ],
    createdAt: daysAgo(30),
  });

  // Invoice 15 days ago — 150 000 DA, partial payment 20 000 (total impayé ~560k)
  await insertSale({
    ref: "REC-RIADH-003",
    customerId: riadh.id,
    branchId: hyd.id,
    items: [
      { productId: p2.id, qty: 200, price: 500 },
      { productId: p1.id, qty: 80, price: 625 },
    ],
    payments: [
      { amount: 20000, method: "check", date: dateStr(daysAgo(10)) },
    ],
    createdAt: daysAgo(15),
  });

  // ══════════════════════════════════════════════════════════════════════
  // CLIENT 3 — Restauration Belkacem SARL — CRITICAL (95j, 1 150 000 DA)
  // ══════════════════════════════════════════════════════════════════════
  const [belkacem] = await db.insert(contactsTable).values({
    type: "customer",
    displayName: "Restauration Belkacem SARL",
    companyName: "Restauration Moderne Belkacem SARL",
    phone: "+213 555 700 900",
    email: "contact@resto-belkacem.dz",
    city: "Oran",
    status: "active",
    notes: "Ancien client actif. En retard de paiement depuis 3 mois. Sans plafond défini.",
  }).returning();

  // Invoice 95 days ago — 550 000 DA, unpaid
  await insertSale({
    ref: "REC-BLK-001",
    customerId: belkacem.id,
    branchId: siege.id,
    items: [
      { productId: p1.id, qty: 400, price: 800 },
      { productId: p2.id, qty: 250, price: 620 },
    ],
    createdAt: daysAgo(95),
  });

  // Invoice 72 days ago — 380 000 DA, partial payment 80 000
  await insertSale({
    ref: "REC-BLK-002",
    customerId: belkacem.id,
    branchId: siege.id,
    items: [
      { productId: p3.id, qty: 350, price: 800 },
      { productId: p1.id, qty: 150, price: 400 },
    ],
    payments: [
      { amount: 80000, method: "cash", date: dateStr(daysAgo(60)) },
    ],
    createdAt: daysAgo(72),
  });

  // Invoice 50 days ago — 300 000 DA, unpaid
  await insertSale({
    ref: "REC-BLK-003",
    customerId: belkacem.id,
    branchId: siege.id,
    items: [
      { productId: p2.id, qty: 400, price: 500 },
      { productId: p1.id, qty: 200, price: 250 },
    ],
    createdAt: daysAgo(50),
  });

  // ══════════════════════════════════════════════════════════════════════
  // CLIENT 4 — Café des Artistes Alger — SAIN (pas d'alerte)
  // ══════════════════════════════════════════════════════════════════════
  const [cafe] = await db.insert(contactsTable).values({
    type: "customer",
    displayName: "Café des Artistes Alger",
    companyName: "Café des Artistes SARL",
    phone: "+213 21 200 500",
    email: "commandes@cafe-artistes.dz",
    city: "Alger",
    status: "active",
    creditLimit: "200000",
    notes: "Bon payeur. Règle dans les 10 jours.",
  }).returning();

  // Invoice 8 days ago — 95 000 DA, fully paid
  await insertSale({
    ref: "REC-CAFE-001",
    customerId: cafe.id,
    branchId: beo.id,
    items: [
      { productId: p1.id, qty: 100, price: 650 },
      { productId: p2.id, qty: 50, price: 400 },
    ],
    payments: [
      { amount: 85000, method: "transfer", date: dateStr(daysAgo(5)) },
    ],
    createdAt: daysAgo(8),
  });

  // Invoice 3 days ago — 60 000 DA, unpaid (recent, OK)
  await insertSale({
    ref: "REC-CAFE-002",
    customerId: cafe.id,
    branchId: beo.id,
    items: [
      { productId: p3.id, qty: 80, price: 500 },
      { productId: p1.id, qty: 40, price: 250 },
    ],
    createdAt: daysAgo(3),
  });

  console.log("Receivable seed complete.");
  console.log(`  ✓ Pâtisserie Aziz SARL (id: ${aziz.id})`);
  console.log(`  ✓ Groupe Hôtelier Riadh SPA (id: ${riadh.id})`);
  console.log(`  ✓ Restauration Belkacem SARL (id: ${belkacem.id})`);
  console.log(`  ✓ Café des Artistes Alger (id: ${cafe.id})`);
  process.exit(0);
}

seedReceivables().catch(e => { console.error(e); process.exit(1); });
