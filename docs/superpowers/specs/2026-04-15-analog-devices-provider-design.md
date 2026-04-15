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

### Discovery strategy (hybrid, implementation detail inside the provider)

1. **Primary:** Resolve part number / query to Analog product or documentation pages and **extract PDF links** from HTML (Cheerio or equivalent, consistent with ST).  
2. **Typing:** Map link text / paths to `SearchResult['type']` via a local map (analogous to TI/ST label maps).  
3. **Fallback:** If the primary path yields insufficient results, use additional navigation (e.g. site search results page or alternate URL heuristics) **without** changing the MCP contract.  
4. **HTTP:** Use the same fetch strategy as other providers where the site blocks non-browser clients (prefer **`fetch`** with realistic headers like ST if needed; align with `FetchPdfOptions` in `pdfExtract` for PDFs).

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
| MCP remote instructions | If duplicated (e.g. `mcps/user-electronics-docs-remote`), align vendor wording |

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

- No TBD left for product decisions; URL-level scraping details belong in implementation notes/code comments during build.  
- Vendor ID fixed as `ADI`; consistent with unified MCP + isolated provider module.  
- Scope is a single implementation plan (one new provider + wiring + docs).
