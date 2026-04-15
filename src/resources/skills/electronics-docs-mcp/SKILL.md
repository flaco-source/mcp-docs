---
name: electronics-docs-mcp
description: >-
  Electronics Docs MCP (TI, ST): list_indexed_documents for indexed PDF counts; lookup_doc
  queries FTS only; read_doc to index; query_doc_content and read_doc_page after
  indexing. Read resource electronics-docs://guide/tool-usage.
---

# Electronics Docs MCP — Agent instructions

## When this applies

Whenever the workspace uses the **electronics-docs** MCP (TI/ST PDFs, local FTS index).

## Which tool to call first

| Situation | Tool |
|-----------|------|
| User gives a **part number** and a **question** (no PDF URL) | **`lookup_doc`** |
| Lookup returned **`suggestedDocuments`** but no **`chunks`** | **`read_doc`** on a chosen URL, then **`query_doc_content`** |
| User gives a **direct PDF URL** (e.g. TI `/lit/ds/symlink/...pdf`, ST `/resource/en/...pdf`) | **`read_doc`** with URL + **`part`** if known |
| Search returned **`pageNum`** and you need **full page / table** | **`read_doc_page`** with **`docUrl`** + **`page`** |
| **How many PDFs are indexed** for a vendor/part (no SQL) | **`list_indexed_documents`** with **`vendor`** + optional **`part`** |

### Lookup vs read

- **`lookup_doc`** does **not** download or index PDFs. It either returns **`chunks`** from the existing index or **`suggestedDocuments`** (prioritized links).
- **`read_doc`** indexes a PDF. **`maxDocsToIndex`** on lookup is legacy and ignored.

### TI vs ST

- **TI:** Symlink datasheet URLs may not appear in **`suggestedDocuments`**; if the user has that URL, **`read_doc`** first.
- **ST:** **`search_docs`** can return more links than lookup suggestions (lookup filters flyers / tape-and-reel noise from suggestions only).

## Follow-up sequence

1. After indexing: **`query_doc_content`** or use **`chunks`** from lookup if already indexed.
2. Use **`docUrl`** verbatim for **`read_doc_page`** with **`page`** = **`pageNum`**.

## Onboarding

**`resources/read`** URI **`electronics-docs://guide/tool-usage`**, or [`tool-usage-guide.md`](../../tool-usage-guide.md).

## Limits

Lexical search only; PDF layout may be imperfect; no image/schematic understanding.

## Version

Aligned with MCP server **v2.5+** (**`list_indexed_documents`**; tool names: **`lookup_doc`**, **`search_docs`**, **`read_doc`**, **`read_doc_page`**; ST **`getDocumentPageText`**).
