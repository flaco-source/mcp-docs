# Electronics Docs MCP — Tool usage guide

## Purpose

This MCP server exposes **official vendor PDF documentation** (datasheets, Technical Reference Manuals, application notes) with **local full-text search** (SQLite FTS5 + BM25). It reduces hallucinations by grounding answers in indexed source text.

## Choosing the right entry tool

### `lookup_electronics_doc` (part-based)

Use when the user has a **TI part number** (e.g. `BQ40Z50-R2`, `CC3301`) and a **natural-language question**.

- It searches the **local index** first, then **scrapes the TI product page** (`ti.com/product/<PART>`) to find `/lit/...` links, **downloads PDFs**, and searches again.
- It works best for links that appear on that product page (often **TRMs** under paths like `/lit/ug/...`, app notes, etc.).
- It does **not** reliably discover every PDF format. In particular, **direct datasheet URLs** such as `https://www.ti.com/lit/ds/symlink/<part>.pdf` are often **not** linked the same way on the product page. If the user or a search engine gives you that **exact PDF URL**, use **`read_electronics_doc`** first with that URL, then `query_doc_content` / **`read_electronics_doc_page`**.

### `read_electronics_doc` (URL-based)

Use when you already have the **exact PDF URL** (including `/lit/ds/symlink/....pdf?...` or `/lit/ug/tidac/...`).

- **Always pass `part`** when known so `query_doc_content` filters work.
- After indexing, run **`query_doc_content`** to find locations, **or** jump to **`read_electronics_doc_page`** if you already know the page.

### `read_electronics_doc_page` (full page text)

Use **after** `query_doc_content` or `lookup_electronics_doc` returns a hit with **`pageNum`** (and **`docUrl`** in the JSON).

- **`docUrl`** is included in each result row so you do not have to guess the URL.
- Pass **`page`** (1-based, same as `pageNum`). Optionally **`pageEnd`** for a contiguous range.
- Returns **full indexed plain text** for that page(s) (all chunk rows for those pages joined). Snippets from FTS are short; this tool is for **tables, register maps, and full context**.

### `query_doc_content`

BM25 search over indexed chunks. **Each result includes `docUrl`** for follow-up with `read_electronics_doc_page`.

### `search_electronics_docs`

Lists PDF links for a part (metadata only). Does not index.

## Recommended flows

1. **Part + question, no URL:** `lookup_electronics_doc` → if results, optionally `read_electronics_doc_page` using `docUrl` + `pageNum`.
2. **Known PDF URL (especially symlink datasheet):** `read_electronics_doc` → `query_doc_content` → `read_electronics_doc_page` as needed.
3. **Snippet too short:** `read_electronics_doc_page` with `docUrl` and `page` from the last search result.

## How to phrase `question` (for lookup / query)

- Use **register names**, **hex addresses** (`0x51`), **signal names**, **electrical parameters**.
- Prefer **short, keyword-rich** queries; FTS uses stemmed tokens and prefix matching.
- Multi-word queries work; avoid special characters that are not part of the real text.

## Limits and caveats

- **PDF text extraction** can scramble **multi-column layouts** and **complex tables**; register tables may be imperfect.
- Search is **lexical (BM25)**, not semantic embeddings.
- **`read_electronics_doc_page`** is capped by **`maxChars`** (default 120000); `truncated` in the JSON indicates cut-off.
- **Images and schematics** are not interpreted; only extracted text is indexed.

## MCP resource

This guide is also available as MCP resource URI: **`electronics-docs://guide/tool-usage`**.

## Suggested answer pattern for the assistant

Cite **document title**, **page number**, and **excerpt** or **page text**; state that the text comes from the vendor PDF. If no match is found after indexing, say so clearly instead of guessing.
