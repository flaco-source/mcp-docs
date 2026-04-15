# Analog Devices (ADI) provider — design spec

**Status:** Approved for implementation planning  
**Date:** 2026-04-15  

## Purpose

Add **Analog Devices** as a third documentation vendor to the electronics-docs MCP with **feature parity** to existing Texas Instruments (TI) and STMicroelectronics (ST) providers. The MCP **tool surface stays identical** for all vendors; vendor-specific behavior lives only in a dedicated provider implementation.

## Requirements

1. **Parity:** Support the same capabilities as TI/ST: `searchDocs`, `readDoc`, `queryContent`, and orchestrated `lookupDoc` / `getDocumentPageText` (local FTS first, then `suggestedDocuments` without auto-download).
2. **Unified interface:** Callers pass `vendor` (see Vendor ID below); no vendor-specific MCP tools.
3. **Isolation:** All Analog-specific fetching, HTML parsing, URL normalization, and document-type mapping reside in **`AnalogDevicesProvider`** (plus small private helpers in the same module), following the pattern of `TexasInstrumentsProvider` and `StMicroelectronicsProvider`.
4. **Documentation:** Update user-facing instructions (server `instructions`, `tool-usage-guide.md`, `README`, and project Cursor skills) so agents know ADI is supported and any ADI-specific caveats are stated briefly.

## Vendor ID

- **`ADI`** — short, unambiguous, consistent with two-letter style of `TI` / `ST`.

## Architecture

### New component

- **`src/providers/AnalogDevicesProvider.ts`**  
  - Extends `VendorProvider`.  
  - Declares `vendorId = 'ADI'` and a human-readable `vendorName`.  
  - Implements: `searchDocs`, `readDoc`, `queryContent`, `lookupDoc`, `getDocumentPageText` (mirroring patterns from ST/TI: `DocumentCache`, `pdfExtract`, `lookupRanking` as appropriate).

### Discovery strategy (product page first — see research section)

1. **Primary:** `GET` the **English product page** `https://www.analog.com/en/products/{slug}.html` where `slug` is derived from the user query (normalize like TI: trim, lowercase, then **slug fallbacks** if the first response is 404 — e.g. `ltc6946-1` → try `ltc6946`).  
2. **Extract PDFs** from the returned HTML with regex and/or Cheerio: collect `https://www.analog.com/...pdf`, `http(s)://mds.analog.com/...pdf`, and relative `href` ending in `.pdf` resolved against `https://www.analog.com`.  
3. **Classify** each URL by path segment under `www.analog.com/media/en/` (see **Web scraping research** below). **Deprioritize or omit** obvious noise for `suggestedDocuments` (PCN forms, generic `mds.analog.com` package drawings) unless we keep them only in `search_docs` full list — implementation can mirror ST’s “lookup filters noise” pattern.  
4. **Do not rely** on `https://www.analog.com/en/search.html?q=...` for discovery in the first implementation: initial probes show **no product links and no PDFs** in the static HTML (likely client-rendered). Revisit only if we add a headless or API path later.  
5. **HTTP:** Use **`fetch`** + browser-like headers (same idea as ST). Node 20+ `fetch` from this environment successfully retrieved product pages (status 200, ~130–220kB HTML).

### Registration

- **`src/mcpServerFactory.ts`:** Instantiate `AnalogDevicesProvider` as a singleton; add to `vendors` map keyed by `ADI`.  
- **Remove hardcoded vendor allowlists** where they duplicate the map: validation for tools (including `list_indexed_documents`) should accept **any key present in `vendors`** (or a single derived `SUPPORTED_VENDOR_IDS` array), so adding vendors does not require editing multiple `if` chains.

### No schema change

- SQLite `documents` / FTS tables already use string `vendor`; no migration required for `ADI`.

## Files to touch (implementation checklist)

| Area | Files |
|------|--------|
| Provider | `src/providers/AnalogDevicesProvider.ts` (new) |
| Server | `src/mcpServerFactory.ts` (import, singleton, tool descriptions, dynamic vendor validation) |
| Guide | `src/resources/tool-usage-guide.md` |
| README | `README.md` (vendor table, “adding a vendor” remains valid) |
| Skills | `.cursor/skills/electronics-docs-mcp/SKILL.md`, `electronics-docs-mcp-ti/SKILL.md`, `electronics-docs-mcp-st/SKILL.md` — add ADI where vendor list appears; optional: `electronics-docs-mcp-adi/SKILL.md` if we want symmetry |
| Scripts | `scripts/agent-flow/run.ts` — extend `VendorKey` and factory to include `ADI` |
| Dev probes (optional) | `scripts/probe-adi-fetch.mjs`, `scripts/probe-adi-search.mjs` — reproduce fetches without the MCP |
| MCP remote instructions | If duplicated (e.g. `mcps/user-electronics-docs-remote`), align vendor wording |

## Web scraping research (2026-04-15)

Evidence from **`node scripts/probe-adi-fetch.mjs <part>`** (same `fetch` + headers pattern intended for the provider):

| Part / URL | HTTP | Notes |
|------------|------|--------|
| `adau1701` → `/en/products/adau1701.html` | 200 | **8** PDFs in HTML, including `.../technical-documentation/data-sheets/ADAU1701.pdf`, UG, eval PDF, ref design, plus PCN PDFs and one `mds.analog.com` mechanical PDF. |
| `max485` → `/en/products/max485.html` | 200 | Datasheet path can be a **family** PDF (`MAX1487-MAX491.pdf`) or legacy `millitary-data-sheets/...`; several `mds.analog.com` package PDFs. |
| `ltc6946-1` → `/en/products/ltc6946-1.html` | **404** | No PDFs. |
| `ltc6946` → `/en/products/ltc6946.html` | 200 | **11** PDFs: `data-sheets/6946fb.pdf` (obfuscated name), app notes, user guides, eval schematics (`.PDF`), etc. |

**Search page:** `GET /en/search.html?q=LTC6946` and `q=LTC6946-1` returned ~50kB HTML with **zero** `/en/products/*.html` links and **zero** `.pdf` URLs in the raw response — not usable for server-side scrape without a different strategy.

**Actionable implementation simplification:**  
- **No** search-HTML crawler in v1.  
- **Yes** product-page fetch + PDF URL extraction + path-based typing + slug normalization when status is 404.  
- Datasheet filename may not equal the part number (`6946fb.pdf`); still fine for `read_doc` / DB as long as URL is stable.

**Path → `SearchResult['type']` (initial rules)**

- `.../technical-documentation/data-sheets/` → `datasheet`  
- `.../technical-documentation/application-notes/` (and similar `application_notes` paths if present) → `application_note`  
- `.../technical-documentation/user-guides/`, `.../evaluation-documentation/`, `eval-board-schematic`, `reference-design-documentation/` → `user_guide` or `application_note` (pick one convention and document in code comments)  
- `.../pcn/`, `.../PCN/`, `.../product-change-notices/` → `other` (and likely filtered out of lookup suggestions)  
- `https://mds.analog.com/...` → `other` (mechanical / package; filter from suggestions)  

## Testing

- Build: `npm run build`.  
- Manual or scripted smoke: `lookup_doc` / `search_docs` / `read_doc` / `query_doc_content` / `read_doc_page` / `list_indexed_documents` with `vendor: "ADI"` and at least one known Analog part number.  
- Confirm `list_indexed_documents` accepts `ADI` without the old TI/ST-only guard.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Site HTML or CDN behavior changes | Keep selectors and base URLs in named constants; narrow, logged debug output (env-gated) similar to ST |
| Bot protection / TLS issues | Reuse proven `fetch` + header patterns from ST; document if user-agent or timeouts need tuning |
| Incomplete PDF list vs ST/TI | Document in tool guide that users can still **`read_doc`** with a known PDF URL |

## Out of scope

- Changing BM25/FTS behavior globally.  
- Non-PDF document types as first-class indexed content.  
- Vendor-specific MCP tools or parameters beyond `vendor: "ADI"`.

## Self-review (2026-04-15)

- Scraping approach is **locked** to product-page + slug fallbacks; search HTML explicitly out of scope for v1.  
- Vendor ID fixed as `ADI`; consistent with unified MCP + isolated provider module.  
- Scope remains a single implementation plan (one new provider + wiring + docs + optional probe scripts).
