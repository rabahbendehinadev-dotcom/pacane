---
name: ERP branches edit crash fix
description: Root cause analysis and fix for branches page crashing when clicking edit (pencil) icon — PageErrorBoundary pattern
---

## Pattern observed
- Fresh page load → click edit pencil → PageErrorBoundary "La page n'a pas pu se charger"
- Click Réessayer → click edit pencil → WORKS
- Full page refresh → click edit pencil → crash again

## Root cause theory
The crash happens because the sellers `useQuery` uses `editing!.id` (TypeScript non-null assertion). If TanStack Query calls the `queryFn` with a stale closure (before `editing` is set), `null.id` throws synchronously. In async context this becomes a rejected Promise, but TQ v5 may propagate it to the error boundary.

Additionally, if the sellers API returns unexpected data (non-array), `sellers.map()` throws during React render → caught by PageErrorBoundary.

## Fixes applied
1. `queryFn: () => editing ? customFetch(...) : Promise.resolve([])` — null-safe
2. `throwOnError: false` — explicit, prevents TQ from throwing to error boundary
3. `Array.isArray(fetchedSellersRaw)` guard on received data
4. `Array.isArray(sellers)` guard before `.length` and `.map()` in JSX
5. Fixed `Dialog.onOpenChange` to reset `editing`, `sellers`, `newSeller` on close (was only calling `setDialogOpen`)
6. Added error message display in PageErrorBoundary for future debugging

## Why it worked after Réessayer
TQ cache had sellers data from first attempt. Component remounts with fresh state but TQ cache preserved → sellers query returns cached result immediately → no race condition.
