---
name: electronics-docs-mcp-adi
description: >-
  Analog Devices via Electronics Docs MCP: vendor ADI; lookup_doc is FTS-only + suggestedDocuments
  from analog.com/en/products HTML (no search.html in v1). read_doc for PDF URLs; query_doc_content
  and read_doc_page after indexing. Resource electronics-docs://guide/tool-usage.
---

# Electronics Docs MCP — Analog Devices

## Vendor id

Use **`vendor`: `"ADI"`** on every tool call.

## Flow

1. **`lookup_doc`** — queries index; if empty, **`suggestedDocuments`** from the **product page** PDF links (slug fallbacks if 404 for variants like `…-1`).
2. **`search_docs`** — full link list from the same scrape (includes PCN / `mds.analog.com` PDFs that lookup may omit from suggestions).
3. **`read_doc`** with URL + **`part`** when known, then **`query_doc_content`** / **`read_doc_page`**.

## Onboarding

[`tool-usage-guide.md`](../../tool-usage-guide.md) — ADI vendor notes.
