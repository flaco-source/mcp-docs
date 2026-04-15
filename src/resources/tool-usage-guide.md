# Electronics Docs MCP — Tool usage guide

## Purpose

This MCP server exposes **official vendor PDF documentation** (datasheets, Technical Reference Manuals, application notes) with **local full-text search** (SQLite FTS5 + BM25). It reduces hallucinations by grounding answers in indexed source text.

Supports **Texas Instruments (TI)**, **STMicroelectronics (ST)**, and **Analog Devices (ADI)**.

## Four-phase workflow

1. **Phase 1 — `lookup_doc`:** Part number + question. Queries the **local index only** (FTS). If nothing matches, returns **`suggestedDocuments`** (prioritized PDF URLs/titles from the vendor site). **Does not download or index PDFs.**
2. **Phase 2 (optional) — `search_docs`:** List PDF links for a part (metadata only). Use when you want the full link list or to pick URLs manually.
3. **Phase 3 — `read_doc`:** Download and **index** a PDF by URL. Required before `query_doc_content` / `read_doc_page` for that document.
4. **Phase 4 — `query_doc_content` / `read_doc_page`:** Search indexed text; then fetch **full page text** when snippets are too short.

```text
lookup → (no chunks) → read_doc(url from suggestedDocuments or search) → query_doc_content → read_doc_page
```

Alternatively: **`search_docs`** → choose URL → **`read_doc`** → query / page.

## `lookup_doc` (part-based)

Use when the user has a **part number** and a **natural-language question**.

- **Never indexes PDFs.** If the index already has matching chunks, you get **`chunks`**. Otherwise you get **`suggestedDocuments`** (up to ~25 entries, type-prioritized for register-style vs general questions).
- **Next step:** call **`read_doc`** with a URL from **`suggestedDocuments`** (or from **`search_docs`**), then **`query_doc_content`** with the same part/question.

### Vendor notes

- **TI:** Suggestions come from the **product page** (`ti.com/product/<PART>`) `/lit/...` links. **Direct datasheet URLs** such as `https://www.ti.com/lit/ds/symlink/<part>.pdf` may **not** appear in suggestions; if you already have that URL, use **`read_doc`** directly.
- **ST:** Suggestions merge **product page**, **series documentation**, and **ST search API** results. Lookup filters out obvious noise (e.g. flyers, product presentations, tape-and-reel titles) from **`suggestedDocuments` only** — **`search_docs`** still returns the full merged list.
- **ADI:** Suggestions come from the **product page** `https://www.analog.com/en/products/<slug>.html` (PDF links in the HTML). If the URL returns **404** for a variant part (e.g. `LTC6946-1`), the server tries slug fallbacks (e.g. strip trailing `-1`). **`search.html`** is not used in v1 (static HTML has no product/PDF links). Lookup filters **PCN** PDFs and **`mds.analog.com`** package drawings from **`suggestedDocuments` only** — **`search_docs`** still returns the full list.

The **`maxDocsToIndex`** parameter is **legacy** and **ignored** (lookup does not index).

## `read_doc` (URL-based)

Use when you have the **exact PDF URL** (including TI `/lit/ds/symlink/....pdf`, ST `/resource/en/.../....pdf`, or ADI `analog.com/media/.../....pdf`).

- **Always pass `part`** when known so `query_doc_content` filters work.
- After indexing, run **`query_doc_content`**, or **`read_doc_page`** if you already know the page.

## `read_doc_page` (full page text)

Use **after** `query_doc_content` returns a hit with **`pageNum`** (and **`docUrl`**).

- Pass **`page`** (1-based, same as `pageNum`). Optionally **`pageEnd`** for a range.
- Returns **full indexed plain text** for that page(s). Snippets from FTS are short; this tool is for **tables, register maps, and full context**.

## `query_doc_content`

BM25 search over indexed chunks. **Each result includes `docUrl`**. Requires documents to be indexed first via **`read_doc`** (not via lookup alone).

## `list_indexed_documents`

Lists **indexed** PDF rows from the local database (**`vendor`** required: `TI`, `ST`, or `ADI`; optional **`part`**). Returns **`count`** and **`documents`** (metadata: id, part, title, docType, url, indexedAt). Does not query the web. Use this instead of raw SQL when you need how many PDFs are indexed for a part.

## `search_docs`

Lists PDF links for a part (metadata only). Does not index. Use when you need the **full** link list or prefer manual URL choice before **`read_doc`**.

## Recommended flows

1. **Part + question:** `lookup_doc` → if **`chunks`**, use them (and **`read_doc_page`** as needed). If **`suggestedDocuments`** only → **`read_doc`** on chosen URL(s) → **`query_doc_content`** → **`read_doc_page`**.
2. **Known PDF URL:** `read_doc` → `query_doc_content` → `read_doc_page` as needed.
3. **Snippet too short:** `read_doc_page` with `docUrl` and `page` from the last search result.

## How to phrase `question` (for lookup / query)

- Use **register names**, **hex addresses** (`0x51`), **signal names**, **electrical parameters**.
- Prefer **short, keyword-rich** queries; FTS uses stemmed tokens and prefix matching.

## Limits and caveats

- **PDF text extraction** can scramble **multi-column layouts** and **complex tables**.
- Search is **lexical (BM25)**, not semantic embeddings.
- **`read_doc_page`** is capped by **`maxChars`** (default 120000); `truncated` in the JSON indicates cut-off.
- **Images and schematics** are not interpreted.

## MCP resource

This guide is available as MCP resource URI: **`electronics-docs://guide/tool-usage`**.

## Suggested answer pattern for the assistant

Cite **document title**, **page number**, and **excerpt** or **page text**; state that the text comes from the vendor PDF. If no match is found after indexing, say so clearly instead of guessing.
