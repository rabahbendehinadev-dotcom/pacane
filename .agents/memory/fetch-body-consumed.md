---
name: Fetch response body consumed once
description: Response body stream can only be read once — calling .json() or .text() twice throws an error silently in some runtimes.
---

## Rule
Read a `fetch` response body exactly once. Never call `r.json()` (or `r.text()`) twice on the same response.

**Wrong pattern — body already consumed:**
```ts
if (!r.ok) throw new Error((await r.json()).error);   // consumes body
const data = await r.json();                          // throws — body already consumed
```

**Correct pattern — read once, branch after:**
```ts
const data = await r.json();
if (!r.ok) throw new Error(data.error ?? "Erreur");
```

**Why:** The Response body is a ReadableStream. Once consumed (.json() or .text() called), it cannot be re-read. The error is often silent or cryptic.

**How to apply:** Any time a fetch call reads the body inside an `if (!r.ok)` check AND also reads data from the same response, consolidate into a single `await r.json()` before the check.
