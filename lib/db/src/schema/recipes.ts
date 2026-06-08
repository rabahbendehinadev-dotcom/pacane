import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recipesTable = pgTable("recipes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  productId: integer("product_id"),
  type: text("type").notNull().default("finished"),
  yield: numeric("yield", { precision: 15, scale: 3 }).notNull(),
  yieldUnitId: integer("yield_unit_id").notNull(),
  steps: text("steps"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const recipeIngredientsTable = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  productId: integer("product_id").notNull(),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitId: integer("unit_id").notNull(),
  wastageRate: numeric("wastage_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recipeItemsTable = pgTable("recipe_items", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  itemType: text("item_type").notNull().default("product"),
  itemId: integer("item_id").notNull(),
  quantity: numeric("quantity", { precision: 15, scale: 3 }).notNull(),
  unitId: integer("unit_id").notNull(),
  wastageRate: numeric("wastage_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecipeSchema = createInsertSchema(recipesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipesTable.$inferSelect;
export type RecipeIngredient = typeof recipeIngredientsTable.$inferSelect;
export type RecipeItem = typeof recipeItemsTable.$inferSelect;
