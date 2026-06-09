import app from "./app";
import { logger } from "./lib/logger";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { importCsvProducts } from "./migrations/import-csv-products";
import { generateDailySalesAnalyticsNotifications } from "./routes/notifications";

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
    // Add per-day target columns for fine-grained replenishment scheduling
    await db.execute(sql`ALTER TABLE product_replenishment_rules ADD COLUMN IF NOT EXISTS target_dim NUMERIC(15,3) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE product_replenishment_rules ADD COLUMN IF NOT EXISTS target_lun NUMERIC(15,3) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE product_replenishment_rules ADD COLUMN IF NOT EXISTS target_mar NUMERIC(15,3) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE product_replenishment_rules ADD COLUMN IF NOT EXISTS target_mer NUMERIC(15,3) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE product_replenishment_rules ADD COLUMN IF NOT EXISTS target_jeu NUMERIC(15,3) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE product_replenishment_rules ADD COLUMN IF NOT EXISTS target_ven NUMERIC(15,3) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE product_replenishment_rules ADD COLUMN IF NOT EXISTS target_sat NUMERIC(15,3) NOT NULL DEFAULT 0;`);
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
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS erp_user_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'task_assigned',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        meta JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS erp_user_notifications_user_id_is_read ON erp_user_notifications (user_id, is_read);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS erp_user_notifications_created_at ON erp_user_notifications (created_at DESC);`);
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
    await db.execute(sql`ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS photo_data TEXT;`);
    // Rename legacy reason value
    await db.execute(sql`UPDATE adjustments SET reason = 'DLC' WHERE reason = 'Perte / Casse';`);
    // Vendeurs feature
    await db.execute(sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_id INTEGER;`);
    await db.execute(sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_name TEXT;`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS branch_sellers (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL,
        seller_name TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(branch_id, seller_name)
      );
    `);
    // Migrate branch_sellers: replace user_id column with seller_name text
    await db.execute(sql`ALTER TABLE branch_sellers ADD COLUMN IF NOT EXISTS seller_name TEXT;`);
    await db.execute(sql`DELETE FROM branch_sellers WHERE seller_name IS NULL;`);
    await db.execute(sql`ALTER TABLE branch_sellers DROP COLUMN IF EXISTS user_id;`);
    // Checklist feature
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS checklist_tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        assigned_to_user_id INTEGER NOT NULL,
        created_by_user_id INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        recurrence TEXT NOT NULL DEFAULT 'daily',
        recurring_days INTEGER[],
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS checklist_completions (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        completion_date TEXT NOT NULL,
        is_done BOOLEAN NOT NULL DEFAULT true,
        completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS checklist_completion_unique_idx ON checklist_completions (task_id, user_id, completion_date);`);
    // Production feature
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS production_orders (
        id SERIAL PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        recipe_id INTEGER NOT NULL,
        product_id INTEGER,
        planned_quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        actual_quantity NUMERIC(15,3),
        status TEXT NOT NULL DEFAULT 'draft',
        branch_id INTEGER NOT NULL,
        theoretical_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
        estimated_cost NUMERIC(15,2),
        actual_cost NUMERIC(15,2),
        cost_variance NUMERIC(15,2),
        waste_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
        notes TEXT,
        bom_snapshot TEXT,
        exploded_materials_snapshot TEXT,
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_by_user_id INTEGER,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS production_override_logs (
        id SERIAL PRIMARY KEY,
        production_order_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        availability_snapshot TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS production_order_items (
        id SERIAL PRIMARY KEY,
        production_order_id INTEGER NOT NULL,
        item_type TEXT NOT NULL DEFAULT 'product',
        item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        unit_abbreviation TEXT NOT NULL DEFAULT 'u',
        unit_cost_price NUMERIC(15,4) NOT NULL DEFAULT 0,
        total_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
        wastage_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        nesting_level INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    // Recipes feature
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        product_id INTEGER,
        type TEXT NOT NULL DEFAULT 'finished',
        yield NUMERIC(15,3) NOT NULL DEFAULT 1,
        yield_unit_id INTEGER NOT NULL DEFAULT 1,
        steps TEXT,
        notes TEXT,
        total_cost NUMERIC(15,2),
        cost_per_unit NUMERIC(15,4),
        last_cost_update TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS total_cost NUMERIC(15,2);`);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC(15,4);`);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS last_cost_update TIMESTAMP WITH TIME ZONE;`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        unit_id INTEGER NOT NULL DEFAULT 1,
        wastage_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recipe_items (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER NOT NULL,
        item_type TEXT NOT NULL DEFAULT 'product',
        item_id INTEGER NOT NULL,
        quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
        unit_id INTEGER NOT NULL DEFAULT 1,
        wastage_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    // stock_levels unique constraint required by ON CONFLICT (product_id, branch_id) in adjustStock
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS stock_levels_product_branch_unique
      ON stock_levels (product_id, branch_id);
    `);
    // transfers: add delete endpoints support columns (idempotent)
    await db.execute(sql`ALTER TABLE transfers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;`);
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

    // ── Daily analytics alerts → user notifications ──────────────────────────
    // Run 2 minutes after startup (let the DB settle), then every 24 hours.
    const runDailyAnalytics = () =>
      generateDailySalesAnalyticsNotifications().catch(err =>
        logger.warn({ err }, "Daily analytics cron failed (non-fatal)")
      );
    setTimeout(runDailyAnalytics, 2 * 60 * 1000);
    setInterval(runDailyAnalytics, 24 * 60 * 60 * 1000);
  });
});
