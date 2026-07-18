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
    // Confirmation workflow columns — allow nullable product_id / quantity_change for multi-item adjustments
    await db.execute(sql`ALTER TABLE adjustments ALTER COLUMN product_id DROP NOT NULL;`);
    await db.execute(sql`ALTER TABLE adjustments ALTER COLUMN quantity_change DROP NOT NULL;`);
    await db.execute(sql`ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS overall_status TEXT;`);
    await db.execute(sql`ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS worker_one_id INTEGER;`);
    await db.execute(sql`ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS confirmed_by_user_id INTEGER;`);
    await db.execute(sql`ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE;`);
    // adjustment_items table (per-item confirmation)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS adjustment_items (
        id SERIAL PRIMARY KEY,
        adjustment_id INTEGER NOT NULL REFERENCES adjustments(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL,
        product_name_snapshot TEXT NOT NULL,
        sku_snapshot TEXT,
        quantity_change NUMERIC(15,3) NOT NULL,
        item_status TEXT NOT NULL DEFAULT 'en_attente',
        rejection_reason TEXT,
        rejection_photo_data TEXT,
        confirmed_by_user_id INTEGER REFERENCES users(id),
        confirmed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_adj_items_adjustment_id ON adjustment_items(adjustment_id);`);
    // adjustment_audit_logs table (immutable)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS adjustment_audit_logs (
        id SERIAL PRIMARY KEY,
        adjustment_id INTEGER NOT NULL REFERENCES adjustments(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        user_name TEXT,
        action TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_adj_audit_adjustment_id ON adjustment_audit_logs(adjustment_id);`);
    // Add audit_log notes column (added in v2 of audit log schema)
    await db.execute(sql`ALTER TABLE adjustment_audit_logs ADD COLUMN IF NOT EXISTS notes TEXT;`);
    // Grant adjustments.confirm to roles that have adjustments.* or existing adjustments perms
    await db.execute(sql`
      UPDATE roles
      SET permissions = array_append(permissions, 'adjustments.confirm')
      WHERE permissions IS NOT NULL
        AND 'adjustments.confirm' != ALL(permissions)
        AND (permissions && ARRAY['adjustments.*','adjustments.view','adjustments.create']::text[]);
    `);
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
    // Migrate production_orders — add columns introduced after initial deployment
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(15,2);`);
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(15,2);`);
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS cost_variance NUMERIC(15,2);`);
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS waste_percentage NUMERIC(5,2) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS bom_snapshot TEXT;`);
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS exploded_materials_snapshot TEXT;`);
    await db.execute(sql`ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;`);
    // Migrate production_order_items — add columns introduced after initial deployment
    await db.execute(sql`ALTER TABLE production_order_items ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'product';`);
    await db.execute(sql`ALTER TABLE production_order_items ADD COLUMN IF NOT EXISTS unit_abbreviation TEXT NOT NULL DEFAULT 'u';`);
    await db.execute(sql`ALTER TABLE production_order_items ADD COLUMN IF NOT EXISTS unit_cost_price NUMERIC(15,4) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE production_order_items ADD COLUMN IF NOT EXISTS wastage_rate NUMERIC(5,2) NOT NULL DEFAULT 0;`);
    await db.execute(sql`ALTER TABLE production_order_items ADD COLUMN IF NOT EXISTS nesting_level INTEGER NOT NULL DEFAULT 0;`);
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
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
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
    // workers: add phone column if missing
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS phone TEXT;`);
    // workers: fiche technique — personal info
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS last_name TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS first_name TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS birth_date DATE;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS gender TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS whatsapp TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS email TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS address TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS city TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS national_id TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS marital_status TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS children_count INTEGER;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS emergency_contact TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS emergency_phone TEXT;`);
    // workers: fiche technique — work info
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS hire_date DATE;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS position TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS department TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS contract_type TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS base_salary TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS commission_rate TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS work_hours TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS rest_days TEXT;`);
    // workers: fiche technique — medical
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS has_chronic_disease BOOLEAN;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS chronic_disease_details TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS takes_medication BOOLEAN;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS allergies TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS blood_type TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS medical_notes TEXT;`);
    // workers: fiche technique — notes + meta
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await db.execute(sql`ALTER TABLE workers ADD COLUMN IF NOT EXISTS meta JSONB;`);
    // worker_documents — dossier numérique de l'employé
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_documents (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        label TEXT NOT NULL,
        file_url TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER,
        uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        uploaded_by_user_id INTEGER
      );
    `);
    // worker_skills — compétences de l'employé
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_skills (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL,
        skill TEXT NOT NULL,
        level TEXT,
        years_experience INTEGER,
        certification TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    // worker_activity_logs — audit trail extensible
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_activity_logs (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        field TEXT,
        old_value TEXT,
        new_value TEXT,
        performed_by_user_id INTEGER,
        performed_by_name TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        meta JSONB
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_activity_logs_worker_id ON worker_activity_logs (worker_id, created_at DESC);`);
    // ── HR Management tables ──────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_attendance (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'present',
        check_in TIME,
        check_out TIME,
        reason TEXT,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(worker_id, date)
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_attendance_worker_date ON worker_attendance (worker_id, date DESC);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_warnings (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        severity VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'open',
        closed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_warnings_worker_id ON worker_warnings (worker_id, created_at DESC);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_bonuses (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        reason TEXT NOT NULL,
        bonus_type VARCHAR(50) DEFAULT 'performance',
        bonus_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_bonuses_worker_id ON worker_bonuses (worker_id, bonus_date DESC);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_notifications (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        reference_id INTEGER,
        title VARCHAR(200) NOT NULL,
        message TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_notifications_worker_unread ON worker_notifications (worker_id, is_read, created_at DESC);`);
    // HR extended tables
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_salaries (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        month DATE NOT NULL,
        base_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
        bonuses DECIMAL(12,2) NOT NULL DEFAULT 0,
        deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
        overtime_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        overtime_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        advance DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(worker_id, month)
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_salaries_worker_month ON worker_salaries (worker_id, month DESC);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_requests (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        start_date DATE,
        end_date DATE,
        amount DECIMAL(10,2),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        response_notes TEXT,
        responded_by_user_id INTEGER,
        responded_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_requests_worker_status ON worker_requests (worker_id, status, created_at DESC);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_objectives (
        id SERIAL PRIMARY KEY,
        worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
        month DATE NOT NULL,
        title VARCHAR(200) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'custom',
        target_value DECIMAL(10,2) NOT NULL,
        current_value DECIMAL(10,2) NOT NULL DEFAULT 0,
        unit VARCHAR(30),
        status VARCHAR(20) DEFAULT 'in_progress',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS worker_objectives_worker_month ON worker_objectives (worker_id, month DESC);`);
    // ── Discount reasons feature ───────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS discount_reasons (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        requires_note BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_reason_id INTEGER;`);
    await db.execute(sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_reason_label TEXT;`);
    await db.execute(sql`
      INSERT INTO discount_reasons (label, requires_note, is_active, sort_order)
      SELECT label, requires_note, is_active, sort_order FROM (VALUES
        ('Client fidèle', false, true, 1),
        ('Offre promotionnelle', false, true, 2),
        ('Liquidation stock', false, true, 3),
        ('Produit avec défaut mineur', false, true, 4),
        ('Accord du gérant', false, true, 5),
        ('Remise spéciale', false, true, 6),
        ('Compensation problème antérieur', false, true, 7),
        ('Autre raison', true, true, 8)
      ) AS v(label, requires_note, is_active, sort_order)
      WHERE NOT EXISTS (SELECT 1 FROM discount_reasons LIMIT 1);
    `);

    // ── Phase 2: Push Subscriptions + Notification Preferences ──────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        device_name TEXT,
        browser TEXT,
        os TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_active TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        push_enabled BOOLEAN NOT NULL DEFAULT true,
        in_app_enabled BOOLEAN NOT NULL DEFAULT true,
        pref_sales BOOLEAN NOT NULL DEFAULT true,
        pref_remise BOOLEAN NOT NULL DEFAULT true,
        pref_stock_low BOOLEAN NOT NULL DEFAULT true,
        pref_new_product BOOLEAN NOT NULL DEFAULT false,
        pref_receivables BOOLEAN NOT NULL DEFAULT true,
        pref_invoices BOOLEAN NOT NULL DEFAULT true,
        pref_returns BOOLEAN NOT NULL DEFAULT true,
        pref_expenses BOOLEAN NOT NULL DEFAULT true,
        pref_customers BOOLEAN NOT NULL DEFAULT false,
        pref_workers BOOLEAN NOT NULL DEFAULT false,
        pref_absence BOOLEAN NOT NULL DEFAULT false,
        pref_primes BOOLEAN NOT NULL DEFAULT false,
        pref_avertissements BOOLEAN NOT NULL DEFAULT false,
        pref_leaves BOOLEAN NOT NULL DEFAULT false,
        pref_updates BOOLEAN NOT NULL DEFAULT true,
        pref_security BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      ALTER TABLE erp_user_notifications ADD COLUMN IF NOT EXISTS link TEXT;
    `);

    // ── Worker Notifications & Tickets ───────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_worker_notifications (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'normal',
        priority TEXT NOT NULL DEFAULT 'normal',
        sender_user_id INTEGER,
        sender_name TEXT,
        expires_at TIMESTAMP WITH TIME ZONE,
        image_url TEXT,
        is_archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_notification_recipients (
        id SERIAL PRIMARY KEY,
        notification_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        worker_id INTEGER,
        worker_name TEXT,
        user_name TEXT,
        push_sent_at TIMESTAMP WITH TIME ZONE,
        push_failed BOOLEAN NOT NULL DEFAULT false,
        push_failure_reason TEXT,
        delivered_at TIMESTAMP WITH TIME ZONE,
        read_at TIMESTAMP WITH TIME ZONE,
        acknowledged_at TIMESTAMP WITH TIME ZONE,
        acknowledged_ip TEXT,
        acknowledged_device TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(notification_id, user_id)
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        ticket_ref TEXT UNIQUE,
        user_id INTEGER NOT NULL,
        user_name TEXT,
        worker_id INTEGER,
        worker_name TEXT,
        branch_id INTEGER,
        branch_name TEXT,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        description TEXT NOT NULL,
        urgency TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'new',
        assignee_user_id INTEGER,
        assignee_name TEXT,
        file_url TEXT,
        internal_note TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ticket_replies (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        user_name TEXT,
        body TEXT NOT NULL,
        is_internal BOOLEAN NOT NULL DEFAULT false,
        file_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    // ── Pointage Employés tables ──────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_attendance_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        branch_id INTEGER,
        pointage_enabled BOOLEAN NOT NULL DEFAULT false,
        work_start_time TEXT NOT NULL DEFAULT '08:00',
        work_end_time TEXT NOT NULL DEFAULT '17:00',
        work_days TEXT[] NOT NULL DEFAULT ARRAY['lun','mar','mer','jeu','ven'],
        grace_period_minutes INTEGER NOT NULL DEFAULT 10,
        base_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
        salary_type TEXT NOT NULL DEFAULT 'monthly',
        late_deduction_type TEXT NOT NULL DEFAULT 'per_minute',
        late_deduction_value NUMERIC(15,2) NOT NULL DEFAULT 0,
        absence_deduction_value NUMERIC(15,2) NOT NULL DEFAULT 0,
        early_leave_deduction_value NUMERIC(15,2) NOT NULL DEFAULT 0,
        overtime_rate_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.5,
        max_deduction_percent INTEGER NOT NULL DEFAULT 50,
        auto_deductions BOOLEAN NOT NULL DEFAULT false,
        approved_mobile_device_id TEXT,
        mobile_device_status TEXT NOT NULL DEFAULT 'none',
        admin_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        branch_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        status TEXT NOT NULL DEFAULT 'present',
        qr_token_nonce TEXT,
        mobile_device_id TEXT,
        latitude NUMERIC(10,7),
        longitude NUMERIC(10,7),
        location_accuracy NUMERIC(10,2),
        ip_address TEXT,
        late_minutes INTEGER,
        early_leave_minutes INTEGER,
        overtime_minutes INTEGER,
        selfie_data TEXT,
        is_suspicious BOOLEAN NOT NULL DEFAULT false,
        suspicious_reason TEXT,
        corrected_by_admin_id INTEGER,
        correction_reason TEXT,
        original_timestamp TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_attendance_records_user_id ON attendance_records(user_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_attendance_records_timestamp ON attendance_records(timestamp);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_attendance_records_branch_id ON attendance_records(branch_id);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employee_mobile_devices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL UNIQUE,
        device_name TEXT,
        user_agent TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_by_admin_id INTEGER,
        approved_at TIMESTAMP WITH TIME ZONE,
        revoked_at TIMESTAMP WITH TIME ZONE,
        last_seen_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS branch_desktop_devices (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL,
        device_token TEXT NOT NULL UNIQUE,
        device_name TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        activated_by_admin_id INTEGER,
        last_seen_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS qr_tokens (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL,
        device_id INTEGER NOT NULL,
        nonce TEXT NOT NULL UNIQUE,
        hmac TEXT NOT NULL,
        issued_at TIMESTAMP WITH TIME ZONE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires_at ON qr_tokens(expires_at);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS salary_adjustments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        period TEXT NOT NULL,
        type TEXT NOT NULL,
        amount NUMERIC(15,2) NOT NULL,
        reason TEXT,
        created_by_admin_id INTEGER,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS attendance_audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        target_user_id INTEGER,
        branch_id INTEGER,
        action TEXT NOT NULL,
        previous_value JSONB,
        new_value JSONB,
        device_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        admin_id INTEGER,
        reason TEXT,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      UPDATE roles SET permissions = array_append(permissions, 'pointage.view')
      WHERE permissions IS NOT NULL AND 'pointage.view' != ALL(permissions)
        AND (permissions && ARRAY['*','pointage.*']::text[]);
    `);
    await db.execute(sql`
      UPDATE roles SET permissions = array_append(permissions, 'pointage.admin')
      WHERE permissions IS NOT NULL AND 'pointage.admin' != ALL(permissions)
        AND (permissions && ARRAY['*','pointage.*']::text[]);
    `);
    // Kiosk slug + password system (added after initial deployment)
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS kiosk_slug TEXT;`);
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS kiosk_password_hash TEXT;`);
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS bound_device_token TEXT;`);
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS bound_device_ua TEXT;`);
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS bound_device_os TEXT;`);
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS bound_device_browser TEXT;`);
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS bound_device_ip TEXT;`);
    await db.execute(sql`ALTER TABLE branch_desktop_devices ADD COLUMN IF NOT EXISTS bound_at TIMESTAMP WITH TIME ZONE;`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_bdd_kiosk_slug ON branch_desktop_devices (kiosk_slug) WHERE kiosk_slug IS NOT NULL;`);
    // Auto-create attendance settings for all existing users who don't have them
    await db.execute(sql`
      INSERT INTO user_attendance_settings (
        user_id, branch_id, pointage_enabled,
        work_start_time, work_end_time, work_days,
        grace_period_minutes, base_salary, salary_type,
        late_deduction_type, late_deduction_value, absence_deduction_value,
        early_leave_deduction_value, overtime_rate_multiplier,
        max_deduction_percent, auto_deductions, updated_at
      )
      SELECT
        u.id,
        CASE WHEN array_length(u.branch_ids, 1) > 0 THEN u.branch_ids[1] ELSE NULL END,
        false,
        '08:00', '17:00', ARRAY['lun','mar','mer','jeu','ven']::text[],
        10, 0, 'monthly',
        'per_minute', 0, 0,
        0, 1.5,
        50, false, NOW()
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM user_attendance_settings uas WHERE uas.user_id = u.id
      )
      AND u.status = 'active';
    `);
    // ─────────────────────────────────────────────────────────────────────────
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

    // ── VAPID keys diagnostic (visible in Dokploy / any deployment logs) ──────
    const vapidPublic  = process.env["VAPID_PUBLIC_KEY"]  ?? "";
    const vapidPrivate = process.env["VAPID_PRIVATE_KEY"] ?? "";
    const vapidSubject = process.env["VAPID_SUBJECT"]     ?? "";
    if (vapidPublic && vapidPrivate) {
      logger.info({
        VAPID_PUBLIC_KEY:  vapidPublic.slice(0, 12) + "…",
        VAPID_SUBJECT:     vapidSubject || "(default: mailto:admin@pacane.dz)",
      }, "[VAPID] ✓ Clés VAPID chargées — push notifications activées");
    } else {
      logger.error({
        VAPID_PUBLIC_KEY_SET:  !!vapidPublic,
        VAPID_PRIVATE_KEY_SET: !!vapidPrivate,
        VAPID_SUBJECT_SET:     !!vapidSubject,
      }, "[VAPID] ✗ Clés VAPID MANQUANTES — ajoutez VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT dans les variables d'environnement Dokploy");
    }

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
