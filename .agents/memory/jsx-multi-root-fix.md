---
name: JSX multi-root return fix
description: How to properly wrap two sibling JSX elements in a React return statement
---

When a React component's `return (...)` needs to return two sibling JSX nodes (e.g. a main `<div>` and a portal-like `<Dialog>`), both must be wrapped in a Fragment:

```tsx
return (
  <>
    <div ...>...</div>
    <Dialog ...>...</Dialog>
  </>
);
```

**Why:** JSX allows only one root element per return. Without `<>...</>`, the parser sees the second element as a syntax error. A common mistake is adding `<>` before the first element but forgetting `</>` before `);`, or accidentally placing the closing `</>` after the function's closing `}` when there is a second function defined in the same file below.

**How to apply:** Always add BOTH `<>` and `</>` in the same edit. If a second function is defined after the component, make sure `</>` and `);` and `}` all appear before that second function's `function` keyword.
