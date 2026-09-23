---
name: Ingredient sellability on receipt
description: Explicit business rule for purchased ingredients and manual Vendable settings.
---

Receiving a positive quantity of an ingredient automatically enables Vendable, even if someone disabled it manually before that purchase. The ingredient remains an ingredient; receiving and selling use the existing stock and CMUP paths.

**Why:** The user explicitly chose automatic re-enablement on every purchase over preserving a prior manual Vendable=OFF setting.

**How to apply:** Preserve this rule when changing ingredient purchase or sale eligibility. Do not apply it to other product types or to actions that are not a purchase receipt.