---
name: ERP permissions come from roles DB table
description: How the ERP resolves user permissions at login — roles.permissions column, not code constant
---

## Rule
User permissions are resolved at login from the `roles.permissions` TEXT[] column in the DB, **not** from the `ROLE_PERMISSIONS` constant in `permissions.ts`.

**Why:** The auth route does:
```typescript
permissions = (role?.permissions as string[]) ?? [];
if (user.adminAccess) permissions = ["*"];
```
`adminAccess=true` users always get `["*"]`. Everyone else gets whatever is in their role's DB array.

**How to apply:**
- When adding a new permission to a feature, also add a migration in `api-server/src/index.ts` startup block:
  ```sql
  UPDATE roles
  SET permissions = array_append(permissions, 'module.action')
  WHERE permissions IS NOT NULL
    AND 'module.action' != ALL(permissions)
    AND (permissions && ARRAY['module.*','module.view']::text[]);
  ```
- `ROLE_PERMISSIONS` in `permissions.ts` is only used by the roles management UI to suggest defaults when creating new roles — it does NOT auto-update existing roles.
- Dev test users: `testadmin` has `adminAccess=true` (permissions=["*"]); other test users (amina, dina…) have `adminAccess=false` and get permissions from their role's DB array.
