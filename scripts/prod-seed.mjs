#!/usr/bin/env node
/**
 * Production seed — idempotent (safe to run multiple times).
 * Requires: DATABASE_URL environment variable.
 */
import pg from "pg";
const { Client } = pg;

const DB = process.env.DATABASE_URL;
if (!DB) { console.error("DATABASE_URL not set"); process.exit(1); }

const client = new Client({ connectionString: DB });
await client.connect();

try {
  // ── Roles (unique: name) ──────────────────────────────────────────────────
  await client.query(`
    INSERT INTO roles (name, description, is_system, permissions)
    VALUES
      ('Administrateur',         'Accès complet à toutes les fonctionnalités', true,  ARRAY['*']),
      ('Gérant',                 'Gestion des opérations quotidiennes',         true,  ARRAY['branches.read','products.*','sales.*','purchases.*','stock.*','reports.*','expenses.*']),
      ('Caissier',               'Point de vente et encaissement',              true,  ARRAY['pos.*','sales.create','products.read','contacts.read']),
      ('Responsable production', 'Gestion des recettes et de la production',    false, ARRAY['recipes.*','production.*','stock.read','products.read']),
      ('Responsable stock',      'Gestion du stock et des inventaires',         false, ARRAY['stock.*','products.read']),
      ('Acheteur',               'Gestion des achats et fournisseurs',          false, ARRAY['purchases.*','contacts.read','stock.read']),
      ('Comptable',              'Accès aux données financières',               false, ARRAY['accounting.*','reports.*','sales.read','purchases.read'])
    ON CONFLICT (name) DO NOTHING
  `);
  console.log("✓ Roles seeded");

  // ── Branches (unique: code) ───────────────────────────────────────────────
  await client.query(`
    INSERT INTO branches (name, code, type, address, city, phone, is_active, is_main, pos_enabled, require_open_session, sales_active)
    VALUES ('Siège Central','SIEGE','central','12 Rue des Roses, Alger Centre','Alger','+213 555 000 100',true,true,false,false,false)
    ON CONFLICT (code) DO NOTHING
  `);
  console.log("✓ Branches seeded");

  // ── Users (unique: username) ──────────────────────────────────────────────
  const { rows: roles } = await client.query(`SELECT id, name FROM roles`);
  const roleId = (name) => roles.find(r => r.name === name)?.id;
  const { rows: branches } = await client.query(`SELECT id, code FROM branches`);
  const branchId = (code) => branches.find(b => b.code === code)?.id;

  const hashes = {
    admin:   "a20142bbaf46e6b21ed82e64f060077b0ab950120aef8606dd7fc8f000a993f6",
    manager: "1b1e15ad363d2b3e4c234f0306c534f83b9eeb7ae2e09c7957a1499d53a756f1",
  };

  for (const u of [
    { username: "admin",   name: "Administrateur", hash: hashes.admin,   role: "Administrateur", branch: "SIEGE" },
    { username: "manager", name: "Gérant Central",  hash: hashes.manager, role: "Gérant",         branch: "SIEGE" },
  ]) {
    const rid = roleId(u.role);
    const bid = branchId(u.branch);
    if (!rid) continue;
    const branchIds = bid ? [bid] : [];
    await client.query(`
      INSERT INTO users (username, name, email, password_hash, role_id, branch_ids, admin_access, pos_access, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,false,'active') ON CONFLICT DO NOTHING
    `, [u.username, u.name, `${u.username}@pacane.dz`, u.hash, rid, branchIds, u.role === "Administrateur"]);
  }
  console.log("✓ Users seeded");

  // ── Company settings ──────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO company_settings (name,email,phone,address,currency,currency_symbol,default_language,tax_rate,invoice_prefix,order_prefix)
    SELECT 'Pâtisserie Pacane','contact@pacane.dz','+213 555 000 100','12 Rue des Roses, Alger','DZD','DA','fr','9','FAC','CMD'
    WHERE NOT EXISTS (SELECT 1 FROM company_settings LIMIT 1)
  `);
  console.log("✓ Company settings seeded");

  // ── Payment methods ───────────────────────────────────────────────────────
  const { rows: pm } = await client.query(`SELECT COUNT(*) AS cnt FROM payment_methods`);
  if (parseInt(pm[0].cnt) === 0) {
    await client.query(`
      INSERT INTO payment_methods (name, type, is_active) VALUES
        ('Espèces','cash',true),
        ('Carte bancaire','card',true),
        ('Virement bancaire','transfer',true),
        ('Chèque','check',false),
        ('Crédit','credit',true)
    `);
    console.log("✓ Payment methods seeded");
  } else {
    console.log("✓ Payment methods already exist — skipped");
  }

  console.log("==> Seed complete.");
} catch (err) {
  console.error("Seed error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
