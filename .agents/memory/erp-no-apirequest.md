---
name: ERP has no apiRequest util
description: ERP uses raw fetch with Bearer token pattern; there is no apiRequest or queryClient wrapper in src/lib/
---

# ERP API Call Pattern

The ERP frontend has no `apiRequest` utility in `src/lib/`. All API calls use:

```ts
const token = () => localStorage.getItem("erp_token") ?? "";

const r = await fetch("/api/some-endpoint", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
  body: JSON.stringify(data),
});
```

**Why:** The workspace uses `@workspace/api-client-react` for some endpoints (generated client), but the majority of internal fetch calls are raw. There is no `queryClient.ts` with an `apiRequest` export.

**How to apply:** When writing new ERP hooks or components that call the API, always use raw `fetch()` with the Bearer token pattern above. Never import `apiRequest` from `@/lib/queryClient` — that file doesn't exist.
