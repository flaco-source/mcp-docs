---
name: electronics-docs-mcp
description: >-
  Use the Electronics Docs MCP: lookup_electronics_doc for part+question; read_electronics_doc for
  direct PDF URLs (especially /lit/ds/symlink/...); read_electronics_doc_page when you have pageNum
  and docUrl from search; read resource electronics-docs://guide/tool-usage for full guidelines.
---

# Electronics Docs MCP — Agent instructions

## When this applies

Whenever the workspace uses the **electronics-docs** MCP (Texas Instruments PDFs, local FTS index).

## Which tool to call first

| Situation | Tool |
|-----------|------|
| User gives a **part number** and a **question** (no PDF URL) | **`lookup_electronics_doc`** |
| User gives a **direct PDF URL** (e.g. `.../lit/ds/symlink/...pdf` or `/lit/ug/...`) | **`read_electronics_doc`** with that URL + **`part`** if known |
| Search already returned **`pageNum`** and you need **full page / table** | **`read_electronics_doc_page`** with **`docUrl`** from the result + **`page`** |

### Why both lookup and read?

- **`lookup_electronics_doc`** discovers documents from the **TI product page**. It aligns well with links like **`/lit/ug/...`** (TRMs) that appear there.
- **Direct datasheet URLs** such as **`https://www.ti.com/lit/ds/symlink/<part>.pdf`** are not always discoverable the same way. If you have that URL, **`read_electronics_doc`** is the right first step.

## Follow-up sequence

1. Run **`query_doc_content`** or **`lookup_electronics_doc`** to get hits. Each hit includes **`docUrl`** (use it verbatim for the next step).
2. If snippets are insufficient, call **`read_electronics_doc_page`** with **`vendor`**, **`docUrl`**, **`page`** (same as `pageNum`). Use **`pageEnd`** only when you need a **page range**.

## Onboarding text

Call **`resources/list`** / **`resources/read`** on URI **`electronics-docs://guide/tool-usage`**, or read [`src/resources/tool-usage-guide.md`](../../../src/resources/tool-usage-guide.md) in this repo.

## Limits

Lexical search only; PDF layout may be imperfect; no image/schematic understanding.

## Version

Aligned with MCP server v2.2+ (`read_electronics_doc_page`, `docUrl` on search results).
