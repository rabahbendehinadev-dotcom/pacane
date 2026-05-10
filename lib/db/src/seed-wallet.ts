/**
 * Seed realistic customer wallet (avoir credit) examples.
 * Run with: DATABASE_URL="$DATABASE_URL" tsx lib/db/src/seed-wallet.ts
 */
import { db } from "./index";
import {
  customerWalletMovementsTable, salesReturnsTable, salesTable,
  contactsTable, branchesTable, usersTable,
} from "./schema/index";
import { eq, like, and, sql, desc } from "drizzle-orm";

async function main() {
  console.log("💳  Seeding customer wallet (avoir credit)...");

  const existing = await db.select({ ref: customerWalletMovementsTable.reference })
    .from(customerWalletMovementsTable).where(like(customerWalletMovementsTable.reference, "CRED-%"));
  if (existing.length > 0) {
    console.log("⚠️  Wallet movements already seeded, skipping.");
    return;
  }

  const [admin] = await db.select().from(usersTable).where(eq(usersTable.username, "admin"));
  const [comptable] = await db.select().from(usersTable).where(eq(usersTable.username, "comptable1"));
  const actorAdmin = admin ?? comptable;
  const actorComptable = comptable ?? admin;

  const branches = await db.select().from(branchesTable);
  const siege = branches.find(b => b.isMain || b.name.toLowerCase().includes("siège")) ?? branches[0];
  const hydra = branches.find(b => b.name.toLowerCase().includes("hydra")) ?? branches[1] ?? siege;

  const contacts = await db.select().from(contactsTable);
  const hotel = contacts.find(c => c.displayName?.toLowerCase().includes("hôtel") || c.displayName?.toLowerCase().includes("zitoun"));
  const catering = contacts.find(c => c.displayName?.toLowerCase().includes("catering") || c.displayName?.toLowerCase().includes("samir"));
  const epicerie = contacts.find(c => c.displayName?.toLowerCase().includes("épicerie") || c.displayName?.toLowerCase().includes("epicerie"));
  const patis = contacts.find(c => c.displayName?.toLowerCase().includes("pâtisserie") || c.displayName?.toLowerCase().includes("patisserie"));

  if (!hotel && !catering && !epicerie) {
    console.log("⚠️  No suitable customer contacts found. Run main seed first.");
    return;
  }

  const confirmedReturns = await db.select().from(salesReturnsTable)
    .where(sql`${salesReturnsTable.status} IN ('confirmed', 'partially_refunded', 'refunded')`)
    .orderBy(desc(salesReturnsTable.id));

  const confirmedSales = await db.select().from(salesTable)
    .where(and(
      sql`${salesTable.type} = 'sale'`,
      sql`${salesTable.status} = 'confirmed'`,
      sql`${salesTable.paymentStatus} != 'paid'`,
    ))
    .orderBy(desc(salesTable.id));

  let counter = 1000;
  function nextRef() { return `CRED-${++counter}`; }

  const movements: Array<typeof customerWalletMovementsTable.$inferInsert> = [];

  // ─── Case 1: Hôtel Zitoun — full unused credit (2,100 DA avoir confirmed) ─
  if (hotel && confirmedReturns.length > 0) {
    const returnWithHotel = confirmedReturns.find(r => r.customerId === hotel.id) ?? confirmedReturns[0];
    if (returnWithHotel) {
      const totalAmt = parseFloat(returnWithHotel.totalAmount as string);
      const creditAmt = Math.min(totalAmt, 2100);

      await db.update(salesReturnsTable)
        .set({ creditAmount: creditAmt.toString(), status: "refunded" })
        .where(eq(salesReturnsTable.id, returnWithHotel.id));

      movements.push({
        reference: nextRef(),
        customerId: hotel.id,
        branchId: returnWithHotel.branchId,
        type: "credit_created",
        amount: creditAmt.toString(),
        sourceReturnId: returnWithHotel.id,
        usedOnSaleId: null,
        notes: `Avoir converti en crédit client — retour ${returnWithHotel.reference}`,
        createdByUserId: actorAdmin?.id ?? null,
      });

      console.log(`  ✓ Hôtel (${hotel.displayName}): Crédit de ${creditAmt} DA émis (non utilisé)`);
    }
  }

  // ─── Case 2: Catering — partially used credit (1,538 DA créé, 500 DA utilisé) ─
  if (catering && confirmedReturns.length > 1) {
    const returnWithCatering = confirmedReturns.find(r => r.customerId === catering.id) ?? confirmedReturns[1];
    const saleForCredit = confirmedSales.find(s => s.customerId === catering.id || !s.customerId);

    if (returnWithCatering) {
      const creditAmt = 1200;
      await db.update(salesReturnsTable)
        .set({ creditAmount: creditAmt.toString(), status: "refunded" })
        .where(eq(salesReturnsTable.id, returnWithCatering.id));

      const createRef = nextRef();
      movements.push({
        reference: createRef,
        customerId: catering.id,
        branchId: returnWithCatering.branchId,
        type: "credit_created",
        amount: creditAmt.toString(),
        sourceReturnId: returnWithCatering.id,
        usedOnSaleId: null,
        notes: `Avoir converti en crédit client — retour ${returnWithCatering.reference}`,
        createdByUserId: actorAdmin?.id ?? null,
      });

      // Used 500 DA on an existing sale
      if (saleForCredit) {
        const creditUsed = 500;
        const existingCredit = parseFloat((saleForCredit.creditApplied ?? "0") as string);
        const newCredit = existingCredit + creditUsed;
        const saleTotal = parseFloat(saleForCredit.total as string);
        const salePaid = parseFloat(saleForCredit.paid as string);
        const newDue = saleTotal - salePaid - newCredit;
        const newPayStatus = newDue <= 0 ? "paid" : salePaid + newCredit > 0 ? "partially_paid" : "unpaid";

        await db.update(salesTable)
          .set({ creditApplied: newCredit.toString(), paymentStatus: newPayStatus })
          .where(eq(salesTable.id, saleForCredit.id));

        movements.push({
          reference: nextRef(),
          customerId: catering.id,
          branchId: saleForCredit.branchId,
          type: "credit_used",
          amount: (-creditUsed).toString(),
          sourceReturnId: null,
          usedOnSaleId: saleForCredit.id,
          notes: `Crédit appliqué sur la vente ${saleForCredit.reference}`,
          createdByUserId: actorComptable?.id ?? actorAdmin?.id ?? null,
        });
        console.log(`  ✓ Catering (${catering.displayName}): Crédit ${creditAmt} DA créé, ${creditUsed} DA utilisé sur ${saleForCredit.reference}`);
      } else {
        console.log(`  ✓ Catering (${catering.displayName}): Crédit ${creditAmt} DA créé (pas de vente trouvée pour utilisation)`);
      }
    }
  }

  // ─── Case 3: Épicerie — no available credit (all used up) ─────────────────
  if (epicerie && confirmedReturns.length > 2) {
    const returnForEpicerie = confirmedReturns.find(r => r.customerId === epicerie.id) ?? confirmedReturns[2];
    const saleForEpicerie = confirmedSales.find(s => s.branchId === returnForEpicerie.branchId);

    if (returnForEpicerie) {
      const creditAmt = 518;
      await db.update(salesReturnsTable)
        .set({ creditAmount: creditAmt.toString(), status: "refunded" })
        .where(eq(salesReturnsTable.id, returnForEpicerie.id));

      movements.push({
        reference: nextRef(),
        customerId: epicerie.id,
        branchId: returnForEpicerie.branchId,
        type: "credit_created",
        amount: creditAmt.toString(),
        sourceReturnId: returnForEpicerie.id,
        usedOnSaleId: null,
        notes: `Avoir converti en crédit client — retour ${returnForEpicerie.reference}`,
        createdByUserId: actorAdmin?.id ?? null,
      });

      // Fully consumed on another sale
      if (saleForEpicerie) {
        const existingCredit = parseFloat((saleForEpicerie.creditApplied ?? "0") as string);
        const newCredit = existingCredit + creditAmt;
        const saleTotal = parseFloat(saleForEpicerie.total as string);
        const salePaid = parseFloat(saleForEpicerie.paid as string);
        const newDue = saleTotal - salePaid - newCredit;
        const newPayStatus = newDue <= 0 ? "paid" : salePaid + newCredit > 0 ? "partially_paid" : "unpaid";

        await db.update(salesTable)
          .set({ creditApplied: newCredit.toString(), paymentStatus: newPayStatus })
          .where(eq(salesTable.id, saleForEpicerie.id));

        movements.push({
          reference: nextRef(),
          customerId: epicerie.id,
          branchId: saleForEpicerie.branchId,
          type: "credit_used",
          amount: (-creditAmt).toString(),
          sourceReturnId: null,
          usedOnSaleId: saleForEpicerie.id,
          notes: `Solde crédit entièrement utilisé sur la vente ${saleForEpicerie.reference}`,
          createdByUserId: actorComptable?.id ?? actorAdmin?.id ?? null,
        });
        console.log(`  ✓ Épicerie (${epicerie.displayName}): Crédit ${creditAmt} DA créé et entièrement utilisé (solde = 0)`);
      } else {
        console.log(`  ✓ Épicerie (${epicerie.displayName}): Crédit ${creditAmt} DA créé`);
      }
    }
  }

  // ─── Insert all movements ─────────────────────────────────────────────────
  if (movements.length > 0) {
    await db.insert(customerWalletMovementsTable).values(movements);
    console.log(`\n✅  Inserted ${movements.length} wallet movements.`);
  } else {
    console.log("⚠️  No movements to insert.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
