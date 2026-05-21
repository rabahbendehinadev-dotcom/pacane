import app from "./app";
import { logger } from "./lib/logger";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { importCsvProducts } from "./migrations/import-csv-products";

async function runMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS branch_ids integer[] NOT NULL DEFAULT '{}';
    `);
    await db.execute(sql`
      ALTER TABLE products DROP COLUMN IF EXISTS branch_id;
    `);
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS default_branch_id integer;
    `);
    await db.execute(sql`
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS credit_applied NUMERIC(15,2) NOT NULL DEFAULT 0;
    `);
    await db.execute(sql`
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS pos_session_id INTEGER;
    `);
    await db.execute(sql`
      ALTER TABLE transfers ADD COLUMN IF NOT EXISTS received_by_user_id INTEGER;
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS product_replenishment_rules (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        branch_id INTEGER NOT NULL,
        target_sun_wed NUMERIC(15,3) NOT NULL DEFAULT 0,
        target_thu_sat NUMERIC(15,3) NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(product_id, branch_id),
        CONSTRAINT target_sun_wed_non_negative CHECK (target_sun_wed >= 0),
        CONSTRAINT target_thu_sat_non_negative CHECK (target_thu_sat >= 0)
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS erp_alerts (
        id SERIAL PRIMARY KEY,
        alert_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'warning',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        module TEXT NOT NULL,
        branch_id INTEGER,
        entity_id INTEGER,
        entity_type TEXT,
        meta JSONB,
        is_read BOOLEAN NOT NULL DEFAULT false,
        read_by_user_id INTEGER,
        read_at TIMESTAMP WITH TIME ZONE,
        resolved_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    // Remove old columns from internal_consumptions that conflict with current schema
    await db.execute(sql`ALTER TABLE internal_consumptions DROP COLUMN IF EXISTS branch_id;`);
    await db.execute(sql`ALTER TABLE internal_consumptions DROP COLUMN IF EXISTS date;`);
    await db.execute(sql`ALTER TABLE internal_consumptions DROP COLUMN IF EXISTS user_id;`);
    // Fix internal_consumption_items: old column was consumption_id, new is document_id
    await db.execute(sql`ALTER TABLE internal_consumption_items DROP COLUMN IF EXISTS consumption_id;`);
    await db.execute(sql`ALTER TABLE internal_consumption_items DROP COLUMN IF EXISTS cost_price;`);
    // Recreate internal_consumptions tables with correct schema (idempotent via IF NOT EXISTS + ADD COLUMN IF NOT EXISTS)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS internal_consumptions (
        id SERIAL PRIMARY KEY,
        reference TEXT,
        source_branch_id INTEGER NOT NULL DEFAULT 0,
        destination_branch_id INTEGER NOT NULL DEFAULT 0,
        document_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'draft',
        total_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
        notes TEXT,
        created_by_user_id INTEGER,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS reference TEXT;`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS source_branch_id INTEGER NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS destination_branch_id INTEGER NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS document_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS total_cost NUMERIC(15,2) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    await db.execute(sql`ALTER TABLE internal_consumptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS internal_consumption_items (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        unit_id INTEGER,
        unit_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
        total_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`ALTER TABLE internal_consumption_items ADD COLUMN IF NOT EXISTS document_id INTEGER NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumption_items ADD COLUMN IF NOT EXISTS product_id INTEGER NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumption_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(15,3) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumption_items ADD COLUMN IF NOT EXISTS unit_id INTEGER;`);
    await db.execute(sql`ALTER TABLE internal_consumption_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,2) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumption_items ADD COLUMN IF NOT EXISTS total_cost NUMERIC(15,2) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE internal_consumption_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    logger.info("DB migrations applied");
  } catch (err) {
    logger.warn({ err }, "Migration warning (non-fatal)");
  }

  try {
    await importCsvProducts(pool);
  } catch (err) {
    logger.warn({ err }, "CSV product import warning (non-fatal)");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runMigrations().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});
