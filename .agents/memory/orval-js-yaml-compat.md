---
name: Orval and js-yaml compatibility
description: Generator startup failure caused by resolving an incompatible major version of js-yaml.
---

Orval's ESM entry expects a default export from js-yaml; the newer major version of js-yaml does not provide that export, so code generation fails before reading the OpenAPI spec. A package-specific dependency override to the compatible js-yaml major is preferable to changing the global override or editing generated API files by hand.

**Why:** An OpenAPI change exposed a generator startup failure despite valid schema edits; pinning only Orval's dependency restored generation without changing runtime dependencies.

**How to apply:** When codegen fails with a missing default export from js-yaml, inspect the resolved Orval dependency and retain the scoped override when regenerating clients.