---
name: electronics-docs-mcp-ti
description: >-
  Texas Instruments via Electronics Docs MCP: lookup_doc is FTS-only + suggestedDocuments from
  ti.com/product (no PDF download). Symlink datasheet URLs often need read_doc directly.
  query_doc_content and read_doc_page after indexing. Resource electronics-docs://guide/tool-usage.
---

# Electronics Docs MCP — Texas Instruments

## Vendor id

Use **`vendor`: `"TI"`** on every tool call.

## Flow

1. **`lookup_doc`** — queries index; if empty, **`suggestedDocuments`** from **`/lit/...`** links on the product page (no indexing).
2. If you have **`https://www.ti.com/lit/ds/symlink/<part>.pdf`**, call **`read_doc`** directly — it may not appear in suggestions.
3. **`query_doc_content`** then **`read_doc_page`** as needed.

## Onboarding

[`tool-usage-guide.md`](../../tool-usage-guide.md) — TI symlink note.
