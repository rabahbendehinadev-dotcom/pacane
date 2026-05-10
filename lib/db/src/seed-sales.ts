import { db } from "./index";
import { salesTable, saleItemsTable, salePaymentsTable, contactsTable, productsTable, branchesTable, usersTable } from "./schema/index";
import { eq, like } from "drizzle-orm";

async function seedSales() {
  console.log("Seeding sales documents...");

  const contacts = await db.select().from(contactsTable);
  const products = await db.select().from(productsTable).where(eq(productsTable.isSellable, true));
  const branches = await db.select().from(branchesTable);
  const users = await db.select().from(usersTable);

  const hotel = contacts.find(c => c.displayName.includes("Djazaïr"));
  const catering = contacts.find(c => c.displayName.includes("Catering"));
  const epicerie = contacts.find(c => c.displayName.includes("Épicerie"));

  const croissant = products.find(p => p.name.includes("Croissant"));
  const macaron = products.find(p => p.name.includes("Macaron"));
  const eclair = products.find(p => p.name.includes("Éclair"));
  const baklawa = products.find(p => p.name.includes("Baklawa"));
  const millefeuille = products.find(p => p.name.includes("Millefeuille"));

  const siege = branches.find(b => b.code === "SIEGE");
  const bab = branches.find(b => b.code === "BEO");
  const hydra = branches.find(b => b.code === "HYD");
  const lab = branches.find(b => b.code === "LAB");

  const admin = users.find(u => u.username === "admin");
  const manager = users.find(u => u.username === "manager");
  const caissier = users.find(u => u.username === "caissier1");

  if (!siege || !bab || !hydra || !croissant || !macaron || !eclair || !baklawa || !millefeuille || !admin) {
    console.error("Missing required entities - run main seed first");
    process.exit(1);
  }

  const existing = await db.select({ ref: salesTable.reference }).from(salesTable)
    .where(like(salesTable.reference, "BRO-%"));
  if (existing.length > 0) {
    console.log("Sales already seeded, skipping.");
    process.exit(0);
  }

  const now = new Date();
  function daysAgo(n: number) {
    const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString();
  }
  function dateStr(daysOffset: number) {
    const d = new Date(now); d.setDate(d.getDate() + daysOffset);
    return d.toISOString().slice(0, 10);
  }

  async function insertDoc(doc: {
    ref: string; type: string; status: string; payStatus?: string;
    customerId?: number | null; branchId: number; userId?: number;
    discount?: number; tax?: number; shipping?: number;
    notes?: string; promisedDate?: string;
    createdAt?: string;
    items: { productId: number; qty: number; price: number; disc?: number }[];
    payments?: { amount: number; method: string; date: string; notes?: string }[];
  }) {
    const subtotal = doc.items.reduce((s, i) => s + i.qty * i.price - (i.disc ?? 0), 0);
    const d = doc.discount ?? 0;
    const t = doc.tax ?? 0;
    const sf = doc.shipping ?? 0;
    const total = subtotal - d + t + sf;
    const paid = (doc.payments ?? []).reduce((s, p) => s + p.amount, 0);
    const payStatus = doc.payStatus ?? (
      doc.type !== "sale" ? "unpaid" :
        paid >= total ? "paid" : paid > 0 ? "partially_paid" : "unpaid"
    );

    const [sale] = await db.insert(salesTable).values({
      reference: doc.ref, type: doc.type,
      customerId: doc.customerId ?? null,
      branchId: doc.branchId,
      status: doc.status,
      paymentStatus: payStatus,
      fulfillmentType: "delivery",
      fulfillmentStatus: "pending",
      promisedDate: doc.promisedDate ?? null,
      subtotal: subtotal.toString(), discount: d.toString(),
      tax: t.toString(), shippingFee: sf.toString(),
      total: total.toString(), paid: paid.toString(),
      notes: doc.notes ?? null,
      createdByUserId: doc.userId ?? admin!.id,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    }).returning();

    for (const item of doc.items) {
      const itemTotal = item.qty * item.price - (item.disc ?? 0);
      await db.insert(saleItemsTable).values({
        saleId: sale.id, productId: item.productId,
        quantity: item.qty.toString(), unitPrice: item.price.toString(),
        discount: (item.disc ?? 0).toString(), total: itemTotal.toString()
      });
    }

    for (const pmt of doc.payments ?? []) {
      await db.insert(salePaymentsTable).values({
        saleId: sale.id, amount: pmt.amount.toString(),
        method: pmt.method, date: pmt.date, notes: pmt.notes ?? null
      });
    }
    return sale;
  }

  // ── DRAFTS (Brouillons) ───────────────────────────────
  await insertDoc({
    ref: "BRO-1001", type: "draft", status: "active",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    notes: "Proposition pour événement de mariage — à finaliser",
    createdAt: daysAgo(5),
    items: [
      { productId: macaron.id, qty: 30, price: 450 },
      { productId: baklawa.id, qty: 20, price: 700 },
      { productId: millefeuille.id, qty: 15, price: 160 },
    ],
  });
  await insertDoc({
    ref: "BRO-1002", type: "draft", status: "active",
    customerId: catering?.id, branchId: bab.id, userId: manager?.id ?? admin.id,
    notes: "Commande hebdomadaire à confirmer",
    createdAt: daysAgo(2),
    items: [
      { productId: croissant.id, qty: 100, price: 80 },
      { productId: eclair.id, qty: 50, price: 120 },
    ],
  });
  await insertDoc({
    ref: "BRO-1003", type: "draft", status: "active",
    customerId: null, branchId: hydra.id, userId: caissier?.id ?? admin.id,
    createdAt: daysAgo(1),
    items: [
      { productId: croissant.id, qty: 12, price: 80 },
      { productId: macaron.id, qty: 4, price: 450 },
    ],
  });
  await insertDoc({
    ref: "BRO-1004", type: "draft", status: "active",
    customerId: epicerie?.id, branchId: siege.id, userId: admin.id,
    notes: "Offre de partenariat mensuel",
    createdAt: daysAgo(3),
    items: [
      { productId: baklawa.id, qty: 40, price: 680, disc: 1000 },
      { productId: macaron.id, qty: 25, price: 430, disc: 500 },
    ],
    discount: 2000,
  });
  await insertDoc({
    ref: "BRO-1005", type: "draft", status: "converted",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    notes: "Converti en devis DEV-1001",
    createdAt: daysAgo(12),
    items: [
      { productId: millefeuille.id, qty: 20, price: 160 },
      { productId: eclair.id, qty: 30, price: 120 },
    ],
  });

  // ── QUOTATIONS (Devis) ───────────────────────────────
  await insertDoc({
    ref: "DEV-1001", type: "quotation", status: "pending",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    promisedDate: dateStr(14),
    notes: "Devis pour réception du 27 avril — buffet de pâtisseries",
    createdAt: daysAgo(10),
    items: [
      { productId: macaron.id, qty: 50, price: 450 },
      { productId: millefeuille.id, qty: 30, price: 160 },
      { productId: baklawa.id, qty: 25, price: 700 },
    ],
    tax: 3000, shipping: 1500,
  });
  await insertDoc({
    ref: "DEV-1002", type: "quotation", status: "approved",
    customerId: catering?.id, branchId: bab.id, userId: manager?.id ?? admin.id,
    promisedDate: dateStr(7),
    notes: "Devis accepté — en attente de confirmation de commande",
    createdAt: daysAgo(8),
    items: [
      { productId: croissant.id, qty: 200, price: 75, disc: 1000 },
      { productId: eclair.id, qty: 100, price: 110 },
    ],
    discount: 2000,
  });
  await insertDoc({
    ref: "DEV-1003", type: "quotation", status: "rejected",
    customerId: epicerie?.id, branchId: hydra.id, userId: manager?.id ?? admin.id,
    notes: "Client a trouvé moins cher ailleurs",
    createdAt: daysAgo(15),
    items: [
      { productId: baklawa.id, qty: 60, price: 650 },
      { productId: macaron.id, qty: 40, price: 420 },
    ],
    discount: 5000,
  });
  await insertDoc({
    ref: "DEV-1004", type: "quotation", status: "expired",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    promisedDate: dateStr(-3),
    notes: "Devis expiré sans réponse du client",
    createdAt: daysAgo(20),
    items: [
      { productId: millefeuille.id, qty: 10, price: 160 },
      { productId: eclair.id, qty: 20, price: 120 },
    ],
  });
  await insertDoc({
    ref: "DEV-1005", type: "quotation", status: "converted",
    customerId: catering?.id, branchId: bab.id, userId: manager?.id ?? admin.id,
    notes: "Converti en commande CMD-1001",
    createdAt: daysAgo(18),
    items: [
      { productId: croissant.id, qty: 150, price: 80 },
      { productId: macaron.id, qty: 30, price: 450 },
    ],
  });
  await insertDoc({
    ref: "DEV-1006", type: "quotation", status: "pending",
    customerId: epicerie?.id, branchId: siege.id, userId: admin.id,
    promisedDate: dateStr(10),
    notes: "Offre mensuelle pour approvisionnement régulier",
    createdAt: daysAgo(3),
    items: [
      { productId: baklawa.id, qty: 30, price: 700 },
      { productId: croissant.id, qty: 50, price: 80 },
    ],
    discount: 3000, shipping: 2000,
  });

  // ── ORDERS (Commandes) ───────────────────────────────
  await insertDoc({
    ref: "CMD-1001", type: "order", status: "pending",
    customerId: catering?.id, branchId: bab.id, userId: manager?.id ?? admin.id,
    promisedDate: dateStr(3),
    notes: "Commande issue du devis DEV-1005",
    createdAt: daysAgo(5),
    items: [
      { productId: croissant.id, qty: 150, price: 80 },
      { productId: macaron.id, qty: 30, price: 450 },
    ],
  });
  await insertDoc({
    ref: "CMD-1002", type: "order", status: "in_preparation",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    promisedDate: dateStr(1),
    notes: "Préparation en cours au laboratoire",
    createdAt: daysAgo(4),
    items: [
      { productId: macaron.id, qty: 60, price: 450 },
      { productId: baklawa.id, qty: 30, price: 700 },
      { productId: millefeuille.id, qty: 20, price: 160 },
    ],
    tax: 5000, shipping: 2000,
  });
  await insertDoc({
    ref: "CMD-1003", type: "order", status: "ready",
    customerId: epicerie?.id, branchId: hydra.id, userId: manager?.id ?? admin.id,
    promisedDate: dateStr(0),
    notes: "Prêt pour livraison — client à prévenir",
    createdAt: daysAgo(6),
    items: [
      { productId: baklawa.id, qty: 25, price: 700 },
      { productId: croissant.id, qty: 50, price: 80 },
    ],
    shipping: 1500,
  });
  await insertDoc({
    ref: "CMD-1004", type: "order", status: "delivered",
    customerId: catering?.id, branchId: bab.id, userId: manager?.id ?? admin.id,
    promisedDate: dateStr(-2),
    notes: "Livré — en attente de facturation",
    createdAt: daysAgo(9),
    items: [
      { productId: croissant.id, qty: 200, price: 75 },
      { productId: eclair.id, qty: 80, price: 110 },
    ],
    discount: 2000,
  });
  await insertDoc({
    ref: "CMD-1005", type: "order", status: "partially_fulfilled",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    promisedDate: dateStr(2),
    notes: "Livraison partielle effectuée — reste 20 macarons",
    createdAt: daysAgo(7),
    items: [
      { productId: macaron.id, qty: 40, price: 450 },
      { productId: millefeuille.id, qty: 25, price: 160 },
    ],
  });
  await insertDoc({
    ref: "CMD-1006", type: "order", status: "cancelled",
    customerId: epicerie?.id, branchId: hydra.id, userId: manager?.id ?? admin.id,
    notes: "Client a annulé suite à problème logistique",
    createdAt: daysAgo(14),
    items: [
      { productId: baklawa.id, qty: 15, price: 700 },
    ],
  });
  await insertDoc({
    ref: "CMD-1007", type: "order", status: "in_preparation",
    customerId: null, branchId: bab.id, userId: caissier?.id ?? admin.id,
    promisedDate: dateStr(1),
    createdAt: daysAgo(2),
    items: [
      { productId: croissant.id, qty: 30, price: 80 },
      { productId: eclair.id, qty: 20, price: 120 },
      { productId: macaron.id, qty: 5, price: 450 },
    ],
  });

  // ── INVOICES (Factures) ───────────────────────────────
  const fac1Total = 3 * 450 + 5 * 700 + 2 * 160;
  await insertDoc({
    ref: "FAC-1001", type: "sale", status: "confirmed",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    createdAt: daysAgo(1),
    items: [
      { productId: macaron.id, qty: 3, price: 450 },
      { productId: baklawa.id, qty: 5, price: 700 },
      { productId: millefeuille.id, qty: 2, price: 160 },
    ],
    payments: [
      { amount: fac1Total, method: "transfer", date: dateStr(-1), notes: "Virement réf. VIR-20260412" },
    ],
  });

  const fac2Subtotal = 100 * 80 + 50 * 120;
  const fac2Total = fac2Subtotal - 1500;
  await insertDoc({
    ref: "FAC-1002", type: "sale", status: "confirmed",
    customerId: catering?.id, branchId: bab.id, userId: manager?.id ?? admin.id,
    discount: 1500,
    createdAt: daysAgo(3),
    items: [
      { productId: croissant.id, qty: 100, price: 80 },
      { productId: eclair.id, qty: 50, price: 120 },
    ],
    payments: [
      { amount: 4000, method: "cash", date: dateStr(-3), notes: "Acompte initial" },
    ],
  });

  await insertDoc({
    ref: "FAC-1003", type: "sale", status: "confirmed",
    customerId: epicerie?.id, branchId: hydra.id, userId: manager?.id ?? admin.id,
    createdAt: daysAgo(5),
    notes: "Facture réglée par chèque le 10/04",
    items: [
      { productId: baklawa.id, qty: 20, price: 700 },
      { productId: macaron.id, qty: 15, price: 450 },
    ],
    payments: [
      { amount: 20750, method: "card", date: dateStr(-5) },
    ],
  });

  await insertDoc({
    ref: "FAC-1004", type: "sale", status: "confirmed",
    customerId: catering?.id, branchId: siege.id, userId: admin.id,
    createdAt: daysAgo(7),
    notes: "Facture non réglée — relance prévue",
    items: [
      { productId: millefeuille.id, qty: 30, price: 160 },
      { productId: eclair.id, qty: 40, price: 120 },
      { productId: croissant.id, qty: 50, price: 80 },
    ],
    tax: 2000,
  });

  await insertDoc({
    ref: "FAC-1005", type: "sale", status: "confirmed",
    customerId: hotel?.id, branchId: siege.id, userId: admin.id,
    createdAt: daysAgo(2),
    items: [
      { productId: macaron.id, qty: 8, price: 450 },
      { productId: baklawa.id, qty: 4, price: 700 },
    ],
    payments: [
      { amount: 6400, method: "transfer", date: dateStr(-2) },
    ],
    tax: 600,
  });

  await insertDoc({
    ref: "FAC-1006", type: "sale", status: "confirmed",
    customerId: null, branchId: bab.id, userId: caissier?.id ?? admin.id,
    createdAt: daysAgo(0),
    items: [
      { productId: croissant.id, qty: 5, price: 80 },
      { productId: eclair.id, qty: 3, price: 120 },
    ],
    payments: [
      { amount: 760, method: "cash", date: dateStr(0) },
    ],
  });

  await insertDoc({
    ref: "FAC-1007", type: "sale", status: "cancelled",
    customerId: epicerie?.id, branchId: hydra.id, userId: manager?.id ?? admin.id,
    createdAt: daysAgo(10),
    notes: "Annulée suite à litige qualité",
    items: [
      { productId: baklawa.id, qty: 10, price: 700 },
    ],
  });

  await insertDoc({
    ref: "FAC-1008", type: "sale", status: "confirmed",
    customerId: catering?.id, branchId: bab.id, userId: manager?.id ?? admin.id,
    createdAt: daysAgo(15),
    items: [
      { productId: croissant.id, qty: 200, price: 78 },
      { productId: macaron.id, qty: 20, price: 440 },
      { productId: eclair.id, qty: 60, price: 115 },
    ],
    discount: 5000, shipping: 3000,
    payments: [
      { amount: 10000, method: "cash", date: dateStr(-15) },
      { amount: 12000, method: "transfer", date: dateStr(-12), notes: "Virement VIR-20260328" },
    ],
  });

  console.log("Sales seed complete.");
  process.exit(0);
}

seedSales().catch(e => { console.error(e); process.exit(1); });
