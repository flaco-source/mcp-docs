---
name: electronics-docs-mcp-st
description: >-
  STMicroelectronics via Electronics Docs MCP: lookup_doc is FTS-only + suggestedDocuments
  (noise-filtered). Index with read_doc; query_doc_content; read_doc_page for full pages.
  ST site uses native fetch (not axios). Resource electronics-docs://guide/tool-usage.
---

# Electronics Docs MCP — STMicroelectronics

## Vendor id

Use **`vendor`: `"ST"`** on every tool call.

## Flow

1. **`lookup_doc`** — local index first; if no chunks, **`suggestedDocuments`** (product + series + search API, with flyers/tape-and-reel filtered from suggestions).
2. **`read_doc`** — use PDF URLs from **`search_docs`** / **`lookup_doc`** (`https://www.st.com/resource/en/.../*.pdf`). ST does not invent datasheet URLs for unknown slugs.
3. **`query_doc_content`** then **`read_doc_page`** as needed.

## When to prefer `search_docs`

Use for the **full** PDF list (lookup suggestions are a subset + filtered).

## Part numbers

Normalize like **`STM32G071RB`** (slug for product page). Revision suffixes are handled similarly to TI.

## Onboarding

[`tool-usage-guide.md`](../../tool-usage-guide.md) — multi-vendor section.
