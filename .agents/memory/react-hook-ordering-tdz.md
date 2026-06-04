---
name: React hook ordering — const TDZ crash
description: useMemo dependency arrays referencing a const declared later in the component body throw ReferenceError at runtime, caught by PageErrorBoundary.
---

## The rule

In a React component function body, **define a derived value BEFORE any hook that references it in its dependency array**.

## Why

JavaScript `const` has a Temporal Dead Zone (TDZ). When React renders the component, the function body executes top-to-bottom. If `useMemo(fn, [displayedAdjustments])` appears before `const displayedAdjustments = useMemo(...)`, the dependency array `[displayedAdjustments]` accesses the variable while it is still in the TDZ → `ReferenceError: Cannot access 'displayedAdjustments' before initialization`.

## How to apply

- In `adjustments.tsx`, `uniqueProductIds` and `soldQtyParams` useMemos MUST come after `displayedAdjustments` is defined.
- General rule: sort hooks so that each hook's dependency array only references variables already declared above it.
- This can be silent in Vite dev mode (HMR) but crashes in production builds caught by `PageErrorBoundary`.
