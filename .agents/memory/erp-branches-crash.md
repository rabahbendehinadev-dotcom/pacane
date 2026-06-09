---
name: ERP branches edit crash — infinite render loop fix
description: React Error #185 caused by useEffect depending on a computed [] array that creates a new reference every render
---

## The bug
Clicking the edit pencil on Branches page crashes with React Error #185 (Maximum update depth exceeded).

## Root cause
```js
// BAD: creates a new [] reference on every render when data is undefined
const fetchedSellers = Array.isArray(fetchedSellersRaw) ? fetchedSellersRaw : [];
useEffect(() => { ... }, [fetchedSellers, editing?.id]);
//                          ^^^^^ new [] !== prev [] on every render
```
The `[]` fallback is a new object on each render. React sees the dependency changed, runs the effect, calls `setSellers([new []])`, triggers a re-render, creates another new `[]`, runs effect again — infinite loop until React throws #185.

## Fix
```js
// GOOD: use the raw query result (undefined = stable primitive, array = same TQ ref)
useEffect(() => {
  if (editing) {
    setSellers(Array.isArray(fetchedSellersRaw) ? fetchedSellersRaw : []);
  } else {
    setSellers([]);
  }
}, [fetchedSellersRaw, editing?.id]);
//   ^^^^^^^^^^^^^^^^ undefined is stable, actual array from TQ is stable reference
```

**Why:** `fetchedSellersRaw` from `useQuery` is either `undefined` (stable primitive, doesn't change between renders during loading) or the actual TQ-cached array (same reference between renders). Neither creates new references spuriously.

**How to apply:** Any `useEffect` that computes a fallback array (`data ?? []`) inside the component body and puts it in the dependency array will have this problem. Always depend on the RAW query data, not a computed fallback.

## Additional defensive fixes applied
- `throwOnError: false` on sellers query
- null-safe queryFn: `editing ? customFetch(...) : Promise.resolve([])`
- `Array.isArray` guards before `.length` and `.map()` in render
- `Dialog.onOpenChange` resets `editing`, `sellers`, `newSeller` on close
- `PageErrorBoundary` now shows the actual error message (was blank before)
