export const P = {
  dashboard:       { view: "dashboard.view" },
  branches:        { view: "branches.view",   create: "branches.create",   edit: "branches.edit",   delete: "branches.delete" },
  users:           { view: "users.view",      create: "users.create",      edit: "users.edit",      suspend: "users.suspend" },
  roles:           { view: "roles.view",      edit: "roles.edit" },
  contacts:        { view: "contacts.view",   create: "contacts.create",   edit: "contacts.edit",   delete: "contacts.delete" },
  products:        { view: "products.view",   create: "products.create",   edit: "products.edit",   delete: "products.delete",   priceUpdate: "products.price_update" },
  stock:           { view: "stock.view",      adjust: "stock.adjust",      transfer: "stock.transfer" },
  purchases:       { view: "purchases.view",  create: "purchases.create",  edit: "purchases.edit",  receive: "purchases.receive", pay: "purchases.pay",   cancel: "purchases.cancel" },
  purchaseReturns: { view: "purchase_returns.view", create: "purchase_returns.create", confirm: "purchase_returns.confirm", cancel: "purchase_returns.cancel" },
  recipes:         { view: "recipes.view",    create: "recipes.create",    edit: "recipes.edit",    delete: "recipes.delete" },
  production:      { view: "production.view", create: "production.create", edit: "production.edit", launch: "production.launch", overrideShortage: "production.override_shortage", complete: "production.complete" },
  sales:           { view: "sales.view",      create: "sales.create",      edit: "sales.edit",      convert: "sales.convert",    cancel: "sales.cancel",  overrideCredit: "sales.override_credit_limit" },
  pos:             { view: "pos.view",        openSession: "pos.open_session", sell: "pos.sell",    refund: "pos.refund",        closeSession: "pos.close_session", overrideCredit: "pos.override_credit_limit" },
  reports:         { view: "reports.view",    export: "reports.export" },
  settings:        { view: "settings.view",   edit: "settings.edit" },
  expenses:        { view: "expenses.view",   create: "expenses.create",   edit: "expenses.edit" },
  adjustments:     { view: "adjustments.view", create: "adjustments.create" },
  transfers:       { view: "transfers.view",  create: "transfers.create",  receive: "transfers.receive" },
  returns:         { view: "returns.view",    create: "returns.create",    confirm: "returns.confirm",  refund: "returns.refund",  cancel: "returns.cancel",  issueCredit: "returns.issue_credit" },
  wallet:          { view: "wallet.view",    apply: "wallet.apply" },
  treasury:        { view: "treasury.view" },
  analytics:       { view: "analytics.view" },
  replenishment:   { view: "replenishment.view", create: "replenishment.create", print: "replenishment.print", export: "replenishment.export" },
  internalConsumptions: { view: "internal_consumptions.view", create: "internal_consumptions.create", confirm: "internal_consumptions.confirm", cancel: "internal_consumptions.cancel", export: "internal_consumptions.export" },
  workers:         { view: "workers.view", create: "workers.create", edit: "workers.edit", deactivate: "workers.deactivate" },
  preparationOrders: { view: "preparation_orders.view", create: "preparation_orders.create", send: "preparation_orders.send", cancel: "preparation_orders.cancel", print: "preparation_orders.print" },
  myPreparations:  { view: "my_preparations.view", updateStatus: "my_preparations.update_status" },
} as const;

export function hasPermission(permissions: string[], permission: string): boolean {
  if (permissions.includes("*")) return true;
  if (permissions.includes(permission)) return true;
  const module = permission.split(".")[0];
  if (permissions.includes(`${module}.*`)) return true;
  return false;
}

export function canAccessBranch(
  adminAccess: boolean,
  branchIds: number[],
  branchId: number
): boolean {
  if (adminAccess) return true;
  if (branchIds.length === 0) return false;
  return branchIds.includes(branchId);
}

export function filterByBranch(
  adminAccess: boolean,
  branchIds: number[],
  requestedBranchId: number | null | undefined
): number | null {
  if (adminAccess) return requestedBranchId ?? null;
  if (branchIds.length === 0) return -1;
  if (requestedBranchId && branchIds.includes(requestedBranchId)) return requestedBranchId;
  if (branchIds.length === 1) return branchIds[0];
  return null;
}

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  "Administrateur": ["*"],

  "Gérant": [
    "dashboard.view",
    "branches.view",
    "users.view", "users.create", "users.edit", "users.suspend",
    "contacts.*",
    "products.*",
    "stock.*",
    "purchases.*",
    "purchase_returns.*",
    "recipes.*",
    "production.*",
    "sales.*",
    "pos.*",
    "reports.*",
    "expenses.*",
    "adjustments.*",
    "transfers.*",
    "returns.*",
    "wallet.*",
    "treasury.view",
    "analytics.view",
    "settings.view",
    "replenishment.*",
    "internal_consumptions.*",
    "workers.*",
    "preparation_orders.*",
    "my_preparations.*",
  ],

  "Caissier": [
    "dashboard.view",
    "contacts.view", "contacts.create",
    "products.view",
    "pos.view", "pos.open_session", "pos.sell", "pos.refund", "pos.close_session",
    "sales.view", "sales.create",
    "returns.view", "returns.create",
    "wallet.view",
  ],

  "Responsable production": [
    "dashboard.view",
    "recipes.*",
    "production.*",
    "stock.view",
    "products.view",
    "contacts.view",
  ],

  "Responsable stock": [
    "dashboard.view",
    "products.view",
    "stock.*",
    "transfers.*",
    "adjustments.*",
    "purchases.view", "purchases.receive",
    "purchase_returns.view",
    "internal_consumptions.*",
  ],

  "Responsable achats": [
    "dashboard.view",
    "contacts.*",
    "products.view",
    "stock.view",
    "purchases.*",
    "purchase_returns.*",
    "reports.view",
    "replenishment.*",
  ],

  "Comptable": [
    "dashboard.view",
    "contacts.view",
    "sales.view",
    "purchases.view",
    "purchase_returns.view",
    "expenses.*",
    "reports.*",
    "returns.view",
    "transfers.view",
    "wallet.view",
    "treasury.view",
    "analytics.view",
    "settings.view",
  ],

  "Ouvrier": [
    "my_preparations.view",
    "my_preparations.update_status",
  ],
};
