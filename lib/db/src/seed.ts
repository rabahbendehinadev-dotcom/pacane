import { db } from "./index";
import {
  branchesTable, rolesTable, usersTable, contactsTable, categoriesTable, unitsTable,
  productsTable, stockLevelsTable, companySettingsTable, paymentMethodsTable
} from "./schema/index";
import crypto from "crypto";

function hash(password: string): string {
  return crypto.createHash("sha256").update(password + "erp_salt_2024").digest("hex");
}

async function seed() {
  console.log("Seeding database...");

  // Company settings
  await db.insert(companySettingsTable).values({
    name: "Pâtisserie Al-Baraka",
    email: "contact@albaraka-patisserie.dz",
    phone: "+213 555 000 100",
    address: "12 Rue des Roses, Alger Centre",
    currency: "DZD",
    currencySymbol: "DA",
    defaultLanguage: "fr",
    taxRate: "9",
    invoicePrefix: "FAC",
    orderPrefix: "CMD"
  }).onConflictDoNothing();

  // Payment methods
  await db.insert(paymentMethodsTable).values([
    { name: "Espèces", type: "cash", isActive: true },
    { name: "Carte bancaire", type: "card", isActive: true },
    { name: "Virement bancaire", type: "transfer", isActive: true },
    { name: "Chèque", type: "check", isActive: false },
    { name: "Crédit", type: "credit", isActive: true }
  ]).onConflictDoNothing();

  // Roles
  const [adminRole] = await db.insert(rolesTable).values({
    name: "Administrateur", description: "Accès complet à toutes les fonctionnalités",
    isSystem: true, permissions: ["*"]
  }).returning();
  const [managerRole] = await db.insert(rolesTable).values({
    name: "Gérant", description: "Gestion des opérations quotidiennes",
    isSystem: true, permissions: ["branches.read", "products.*", "sales.*", "purchases.*", "stock.*", "reports.*", "expenses.*"]
  }).returning();
  const [cashierRole] = await db.insert(rolesTable).values({
    name: "Caissier", description: "Point de vente et encaissement",
    isSystem: true, permissions: ["pos.*", "sales.create", "products.read", "contacts.read"]
  }).returning();
  const [productionRole] = await db.insert(rolesTable).values({
    name: "Responsable production", description: "Gestion des recettes et de la production",
    isSystem: false, permissions: ["recipes.*", "production.*", "stock.read", "products.read"]
  }).returning();

  // Branches — with realistic POS configurations per branch type
  const [branchCentral] = await db.insert(branchesTable).values({
    name: "Siège Central", code: "SIEGE", type: "central", address: "12 Rue des Roses", city: "Alger", phone: "+213 555 000 100",
    isActive: true, isMain: true,
    posEnabled: false, requireOpenSession: false, salesActive: false, // HQ only, no customer-facing POS
  }).returning();
  const [branchBab] = await db.insert(branchesTable).values({
    name: "Boutique Bab El Oued", code: "BEO", type: "shop", address: "45 Rue de la Liberté", city: "Alger", phone: "+213 555 000 101",
    isActive: true, isMain: false,
    posEnabled: true, requireOpenSession: true, salesActive: true, // Main retail boutique — session required before selling
  }).returning();
  const [branchHydra] = await db.insert(branchesTable).values({
    name: "Boutique Hydra", code: "HYD", type: "shop", address: "7 Chemin des Pins", city: "Alger", phone: "+213 555 000 102",
    isActive: true, isMain: false,
    posEnabled: true, requireOpenSession: false, salesActive: true, // Boutique — POS enabled, no session required
  }).returning();
  const [branchLab] = await db.insert(branchesTable).values({
    name: "Laboratoire de Production", code: "LAB", type: "lab", address: "Zone Industrielle Rouiba", city: "Alger", phone: "+213 555 000 103",
    isActive: true, isMain: false,
    posEnabled: false, requireOpenSession: false, salesActive: false, // Production lab — no direct sales to customers
  }).returning();

  // Users
  await db.insert(usersTable).values({
    name: "Ahmed Benali", email: "ahmed@albaraka.dz", username: "admin",
    passwordHash: hash("admin123"), status: "active", language: "fr",
    roleId: adminRole.id, branchIds: [branchCentral.id], posAccess: true, adminAccess: true
  });
  await db.insert(usersTable).values({
    name: "Fatima Ouali", email: "fatima@albaraka.dz", username: "manager",
    passwordHash: hash("manager123"), status: "active", language: "fr",
    roleId: managerRole.id, branchIds: [branchBab.id, branchHydra.id], posAccess: false, adminAccess: false
  });
  await db.insert(usersTable).values({
    name: "Karim Meziane", email: "karim@albaraka.dz", username: "caissier1",
    passwordHash: hash("caissier123"), status: "active", language: "fr",
    roleId: cashierRole.id, branchIds: [branchBab.id], posAccess: true, adminAccess: false
  });
  await db.insert(usersTable).values({
    name: "Amina Bouzid", email: "amina@albaraka.dz", username: "production1",
    passwordHash: hash("prod123"), status: "active", language: "ar",
    roleId: productionRole.id, branchIds: [branchLab.id], posAccess: false, adminAccess: false
  });
  await db.insert(usersTable).values({
    name: "Yacine Tahir", email: "yacine@albaraka.dz", username: "caissier2",
    passwordHash: hash("caissier456"), status: "active", language: "fr",
    roleId: cashierRole.id, branchIds: [branchHydra.id], posAccess: true, adminAccess: false
  });

  // Categories
  const [catPainViennoiserie] = await db.insert(categoriesTable).values({ name: "Pains & Viennoiseries" }).returning();
  const [catGateaux] = await db.insert(categoriesTable).values({ name: "Gâteaux & Entremets" }).returning();
  const [catMatieres] = await db.insert(categoriesTable).values({ name: "Matières premières" }).returning();
  const [catEmballage] = await db.insert(categoriesTable).values({ name: "Emballages" }).returning();
  const [catBoissons] = await db.insert(categoriesTable).values({ name: "Boissons" }).returning();
  // Subcategories
  const [catFarine] = await db.insert(categoriesTable).values({ name: "Farines & Féculents", parentId: catMatieres.id }).returning();
  const [catLaitage] = await db.insert(categoriesTable).values({ name: "Laitages & Matières grasses", parentId: catMatieres.id }).returning();
  const [catFruits] = await db.insert(categoriesTable).values({ name: "Fruits secs & Garnitures", parentId: catMatieres.id }).returning();

  // Units
  const [unitKg] = await db.insert(unitsTable).values({ name: "Kilogramme", abbreviation: "kg", allowDecimals: true }).returning();
  const [unitG] = await db.insert(unitsTable).values({ name: "Gramme", abbreviation: "g", allowDecimals: true }).returning();
  const [unitL] = await db.insert(unitsTable).values({ name: "Litre", abbreviation: "L", allowDecimals: true }).returning();
  const [unitCl] = await db.insert(unitsTable).values({ name: "Centilitre", abbreviation: "cL", allowDecimals: true }).returning();
  const [unitUnit] = await db.insert(unitsTable).values({ name: "Unité", abbreviation: "u", allowDecimals: false }).returning();
  const [unitPiece] = await db.insert(unitsTable).values({ name: "Pièce", abbreviation: "pcs", allowDecimals: false }).returning();
  const [unitCarton] = await db.insert(unitsTable).values({ name: "Carton", abbreviation: "ctn", allowDecimals: false }).returning();

  // Products - Finished goods
  const [prodCroissant] = await db.insert(productsTable).values({
    name: "Croissant au beurre", sku: "CRS-001", type: "finished", categoryId: catPainViennoiserie.id,
    unitId: unitUnit.id, costPrice: "45", sellingPrice: "80", alertQuantity: "20",
    isManaged: true, isSellable: true, isPurchasable: false, isFabricated: true
  }).returning();
  const [prodMacaron] = await db.insert(productsTable).values({
    name: "Macaron parisien (boîte 6)", sku: "MAC-001", type: "finished", categoryId: catGateaux.id,
    unitId: unitPiece.id, costPrice: "280", sellingPrice: "450", alertQuantity: "10",
    isManaged: true, isSellable: true, isPurchasable: false, isFabricated: true
  }).returning();
  const [prodEclair] = await db.insert(productsTable).values({
    name: "Éclair au chocolat", sku: "ECL-001", type: "finished", categoryId: catGateaux.id,
    unitId: unitUnit.id, costPrice: "65", sellingPrice: "120", alertQuantity: "15",
    isManaged: true, isSellable: true, isPurchasable: false, isFabricated: true
  }).returning();
  const [prodBaklawa] = await db.insert(productsTable).values({
    name: "Baklawa aux amandes (500g)", sku: "BAK-001", type: "finished", categoryId: catGateaux.id,
    unitId: unitPiece.id, costPrice: "350", sellingPrice: "700", alertQuantity: "8",
    isManaged: true, isSellable: true, isPurchasable: false, isFabricated: true
  }).returning();
  const [prodMillefeuille] = await db.insert(productsTable).values({
    name: "Millefeuille vanille", sku: "MLF-001", type: "finished", categoryId: catGateaux.id,
    unitId: unitUnit.id, costPrice: "90", sellingPrice: "160", alertQuantity: "10",
    isManaged: true, isSellable: true, isPurchasable: false, isFabricated: true
  }).returning();

  // Ingredients
  const [prodFarine] = await db.insert(productsTable).values({
    name: "Farine T55", sku: "ING-001", type: "ingredient", categoryId: catFarine.id,
    unitId: unitKg.id, costPrice: "85", sellingPrice: "0", alertQuantity: "10",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();
  const [prodBeurre] = await db.insert(productsTable).values({
    name: "Beurre 82% M.G.", sku: "ING-002", type: "ingredient", categoryId: catLaitage.id,
    unitId: unitKg.id, costPrice: "480", sellingPrice: "0", alertQuantity: "5",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();
  const [prodSucre] = await db.insert(productsTable).values({
    name: "Sucre semoule", sku: "ING-003", type: "ingredient", categoryId: catFarine.id,
    unitId: unitKg.id, costPrice: "120", sellingPrice: "0", alertQuantity: "8",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();
  const [prodOeufs] = await db.insert(productsTable).values({
    name: "Oeufs frais (plateau 30)", sku: "ING-004", type: "ingredient", categoryId: catLaitage.id,
    unitId: unitPiece.id, costPrice: "380", sellingPrice: "0", alertQuantity: "3",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();
  const [prodLait] = await db.insert(productsTable).values({
    name: "Lait entier", sku: "ING-005", type: "ingredient", categoryId: catLaitage.id,
    unitId: unitL.id, costPrice: "95", sellingPrice: "0", alertQuantity: "5",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();
  const [prodAmandes] = await db.insert(productsTable).values({
    name: "Amandes mondées", sku: "ING-006", type: "ingredient", categoryId: catFruits.id,
    unitId: unitKg.id, costPrice: "1200", sellingPrice: "0", alertQuantity: "2",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();
  const [prodChocolat] = await db.insert(productsTable).values({
    name: "Chocolat noir 70%", sku: "ING-007", type: "ingredient", categoryId: catFruits.id,
    unitId: unitKg.id, costPrice: "850", sellingPrice: "0", alertQuantity: "3",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();
  // Packaging
  const [prodBoiteGateau] = await db.insert(productsTable).values({
    name: "Boîte gâteau kraft (18x18)", sku: "PKG-001", type: "packaging", categoryId: catEmballage.id,
    unitId: unitUnit.id, costPrice: "25", sellingPrice: "0", alertQuantity: "50",
    isManaged: true, isSellable: false, isPurchasable: true, isFabricated: false
  }).returning();

  // Stock levels — ingredients at lab, finished goods at shops
  const stockData = [
    // Lab stock — ingredients
    { productId: prodFarine.id, branchId: branchLab.id, quantity: "45.5" },
    { productId: prodBeurre.id, branchId: branchLab.id, quantity: "18.0" },
    { productId: prodSucre.id, branchId: branchLab.id, quantity: "22.0" },
    { productId: prodOeufs.id, branchId: branchLab.id, quantity: "8" },
    { productId: prodLait.id, branchId: branchLab.id, quantity: "12.0" },
    { productId: prodAmandes.id, branchId: branchLab.id, quantity: "4.5" },
    { productId: prodChocolat.id, branchId: branchLab.id, quantity: "6.0" },
    { productId: prodBoiteGateau.id, branchId: branchLab.id, quantity: "200" },
    // Bab El Oued stock — finished goods
    { productId: prodCroissant.id, branchId: branchBab.id, quantity: "45" },
    { productId: prodMacaron.id, branchId: branchBab.id, quantity: "22" },
    { productId: prodEclair.id, branchId: branchBab.id, quantity: "30" },
    { productId: prodBaklawa.id, branchId: branchBab.id, quantity: "12" },
    { productId: prodMillefeuille.id, branchId: branchBab.id, quantity: "18" },
    // Hydra stock — finished goods
    { productId: prodCroissant.id, branchId: branchHydra.id, quantity: "38" },
    { productId: prodMacaron.id, branchId: branchHydra.id, quantity: "14" },
    { productId: prodEclair.id, branchId: branchHydra.id, quantity: "7" }, // low stock
    { productId: prodBaklawa.id, branchId: branchHydra.id, quantity: "5" }, // low stock
    { productId: prodMillefeuille.id, branchId: branchHydra.id, quantity: "11" },
    // Low stock at Bab El Oued (for alerts demo)
    { productId: prodAmandes.id, branchId: branchBab.id, quantity: "1.2" }, // critical!
  ];
  for (const s of stockData) {
    await db.insert(stockLevelsTable).values(s).onConflictDoNothing();
  }

  // Contacts — suppliers
  await db.insert(contactsTable).values({
    type: "supplier", displayName: "Moulins Atlas", companyName: "SARL Moulins Atlas",
    phone: "+213 21 000 200", email: "commandes@moulins-atlas.dz", city: "Alger",
    status: "active", creditLimit: "500000"
  });
  await db.insert(contactsTable).values({
    type: "supplier", displayName: "Laiterie Ben Abdallah", companyName: "EURL Laiterie Ben Abdallah",
    phone: "+213 21 000 201", email: "info@laiterie-ba.dz", city: "Blida",
    status: "active", creditLimit: "200000"
  });
  await db.insert(contactsTable).values({
    type: "supplier", displayName: "Import Fruits Secs SARL",
    phone: "+213 21 000 202", city: "Alger", status: "active"
  });
  // Contacts — customers
  await db.insert(contactsTable).values({
    type: "customer", displayName: "Hôtel El Djazaïr", companyName: "Hôtel El Djazaïr SPA",
    phone: "+213 21 000 300", email: "fbo@eldjazair.com", city: "Alger",
    status: "active", creditLimit: "1000000"
  });
  await db.insert(contactsTable).values({
    type: "customer", displayName: "Catering Samir & Fils",
    phone: "+213 555 000 400", city: "Alger", status: "active", creditLimit: "300000"
  });
  await db.insert(contactsTable).values({
    type: "both", displayName: "Épicerie Centrale Annaba",
    phone: "+213 38 000 500", city: "Annaba", status: "active"
  });

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
