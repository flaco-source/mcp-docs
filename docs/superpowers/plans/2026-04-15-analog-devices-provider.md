# Analog Devices (ADI) provider — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vendor **`ADI`** with full parity to TI/ST (same MCP tools), using **product-page HTML scraping only** for discovery (no `search.html` dependency in v1), per `docs/superpowers/specs/2026-04-15-analog-devices-provider-design.md`.

**Architecture:** New `AnalogDevicesProvider` extends `VendorProvider`, mirrors **STMicroelectronics** patterns for `lookupDoc` / `getDocumentPageText` / DB merge in `searchDocs`, uses **native `fetch`** + browser-like headers for HTML and **`fetchPdfBuffer` with `useNativeFetch: true`** for PDFs (same lesson as ST). Slug fallbacks when product URL returns **404** (e.g. `ltc6946-1` → `ltc6946`). `mcpServerFactory` registers a singleton and replaces hardcoded `TI`/`ST` vendor checks with **keys of the `vendors` map**.

**Tech stack:** TypeScript (Node 20+), `fetch`, `cheerio`, `better-sqlite3` via `DocumentCache`, `pdfExtract` (`fetchPdfBuffer`, `extractPdfPages`), `lookupRanking` (`sortSearchResultsForLookup`, `capSuggestedDocuments`).

**Reference spec:** `docs/superpowers/specs/2026-04-15-analog-devices-provider-design.md`  
**Reference probes:** `scripts/probe-adi-fetch.mjs`, `scripts/probe-adi-search.mjs`

---

### Task 1: `AnalogDevicesProvider` — HTTP helpers, slug fallbacks, PDF extraction and typing

**Files:**

- Create: `src/providers/AnalogDevicesProvider.ts`
- Reference only: `src/providers/StMicroelectronicsProvider.ts` (patterns for `lookupDoc`, `readDoc`, `getDocumentPageText`, `queryContent`, DB merge)
- Reference only: `scripts/probe-adi-fetch.mjs` (URL patterns that work in practice)

- [ ] **Step 1: Add constants and fetch helper**

Add at top of `AnalogDevicesProvider.ts` (adjust only if lint requires):

```typescript
const ADI_PRODUCT_PAGE_BASE = "https://www.analog.com/en/products";
const ADI_HTML_TIMEOUT_MS = 35_000;
const ADI_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.analog.com/",
};

const ADI_PDF_FETCH_OPTS = { useNativeFetch: true as const };
```

Implement `async function adiFetchText(url: string): Promise<string | null>` using `fetch` + `AbortController` + `ADI_HTML_TIMEOUT_MS`, same structure as `stFetchText` in `StMicroelectronicsProvider.ts` (clear timeout in both success and catch paths).

- [ ] **Step 2: Slug candidates from user query**

Implement `slugCandidatesFromQuery(query: string): string[]` that:

1. Trims, lowercases, removes whitespace, strips `#`.
2. Pushes the full string if non-empty.
3. If it matches `^(.+)-(\d+)$` (trailing hyphen + digits only, e.g. `ltc6946-1`), push the **base** group `ltc6946` (dedupe, preserve order: try **longer slug first** so the first fetch is the user’s literal slug, then fallbacks — order should match spec: try literal first, then strip `-digits`).
4. Optionally mirror TI/ST revision: if `^(.+?)(-r\d+)$` case-insensitive, push base without `-rN`.

Return unique slugs in that order.

- [ ] **Step 3: Resolve first successful product HTML**

Implement `async function fetchAdiProductHtmlForQuery(query: string): Promise<{ slug: string; html: string } | null>`:

For each slug from `slugCandidatesFromQuery`, `GET` `${ADI_PRODUCT_PAGE_BASE}/${slug}.html`. If status **200** and body length reasonable (e.g. > 10_000), return `{ slug, html }`. If **404**, try next slug. Other non-OK statuses: treat as failure for that slug, continue. If all fail, return `null`.

- [ ] **Step 4: Extract absolute PDF URLs from HTML**

Implement `extractAdiPdfUrlsFromHtml(html: string): string[]`:

- Regex for absolute URLs ending in `.pdf` (case-insensitive), strip query/hash.
- Regex for `href="/...pdf"` relative to `https://www.analog.com`.
- Dedupe with a `Set`, normalize with a small `normalizeAdiPdfUrl(u: string): string` (https, strip query/hash, optional lowercase host `analog.com` → `www.analog.com` for `www` consistency).

Include both `www.analog.com` and `mds.analog.com` URLs in the raw list (classification next).

- [ ] **Step 5: Classify URL → `SearchResult['type']`**

Implement `classifyAdiPdfUrl(url: string): SearchResult['type']` using pathname rules from the spec:

| Path / host | Type |
|---------------|------|
| `.../technical-documentation/data-sheets/` | `datasheet` |
| `.../technical-documentation/application-notes/` or `.../application-notes/` | `application_note` |
| `.../user-guides/`, `.../evaluation-documentation/`, `eval-board-schematic`, `reference-design-documentation/`, `design-notes/` | `user_guide` |
| `.../pcn/`, `.../PCN/`, `.../product-change-notices/` | `other` |
| `mds.analog.com` | `other` |
| default | `other` |

- [ ] **Step 6: Build `SearchResult[]` from URLs**

For each unique normalized URL, build `{ title, description, url, type, cached: false }`. Title: prefer last path segment without `.pdf`, replace `[-_]+` with spaces (reuse the idea of `titleFromPdfPath` in ST). Description: use fixed labels map `ADI_DOC_TYPE_LABELS: Record<SearchResult['type'], string>` analogous to `ST_DOC_TYPE_LABELS`.

- [ ] **Step 7: Noise filter for lookup suggestions only**

Implement `adiExcludeNoiseForLookup(results: SearchResult[]): SearchResult[]` that removes entries where:

- `url` host is `mds.analog.com`, OR  
- pathname includes `/pcn/`, `/PCN/`, or `product-change-notices` (case-insensitive),

matching the spec’s “deprioritize / omit for suggestedDocuments” intent. **Do not** apply this filter to the full list returned by `searchDocs` (mirror ST: full list in `search_docs`, filtered list for `lookup_doc` pipeline).

- [ ] **Step 8: Commit**

```bash
git add src/providers/AnalogDevicesProvider.ts
git commit -m "feat(adi): add fetch, slug fallbacks, PDF extract and classify helpers"
```

---

### Task 2: `AnalogDevicesProvider` class — `searchDocs`, `readDoc`, `queryContent`

**Files:**

- Modify: `src/providers/AnalogDevicesProvider.ts`

- [ ] **Step 1: Implement `searchDocs` (scrape + DB merge + metadata rows)**

Pattern after `StMicroelectronicsProvider.searchDocs` (`src/providers/StMicroelectronicsProvider.ts` ~311–362):

1. Normalize part for cache keys: `const partUpper = query.trim().toUpperCase().replace(/\s+/g, "");` (and optionally reuse TI-like `{ basePart, exactPart, revision }` from a local `parsePartNumber` copy-paste from `TexasInstrumentsProvider.ts` lines 60–66 if you want revision-aware DB lookup like TI — **YAGNI:** start with single `partUpper` + slug fallbacks only; expand if tests need it).

2. Call `fetchAdiProductHtmlForQuery(query)`. If null, return `[]`.

3. `extractAdiPdfUrlsFromHtml` → build `SearchResult[]` scraped list; set `cached` using `findDocumentByUrl(normalizeAdiPdfUrl(url))` != null pattern (same idea as ST’s `isStDocInDb`).

4. Merge `getDocumentsByPart(this.vendorId, partUpper)` rows not already in scraped URL set (same merge pattern as ST).

5. **Persist metadata:** For each merged result, `insertDocument(this.vendorId, partUpper, r.title, r.type, normalizeAdiPdfUrl(r.url))` — same as ST loop so `list_indexed_documents` and future lookups see rows.

Export class:

```typescript
export class AnalogDevicesProvider extends VendorProvider {
  readonly vendorId = "ADI";
  readonly vendorName = "Analog Devices";
  // ...
}
```

- [ ] **Step 2: Implement `readDoc`**

Copy structure from `StMicroelectronicsProvider.readDoc` (lines 423–450): `getDocument` / `findDocumentByUrl`, `hasChunks` short-circuit, `fetchPdfBuffer(urlNoQuery, ADI_PDF_FETCH_OPTS)`, `extractPdfPages`, `insertDocument` or update path, `extractAdiDocTypeFromUrl` for new rows (delegate to `classifyAdiPdfUrl`), `updateDocumentPartIfUnknown` when `meta.part` set. Use `partForRow = meta?.part?.trim().toUpperCase().replace(/\s+/g, "") ?? "UNKNOWN"`.

- [ ] **Step 3: Implement `queryContent`**

Copy `StMicroelectronicsProvider.queryContent` (lines 453–484) verbatim with `this.vendorId` — optional `parsePartNumber` fallback if you added TI-style parsing; else pass `part` as stored.

- [ ] **Step 4: Commit**

```bash
git add src/providers/AnalogDevicesProvider.ts
git commit -m "feat(adi): searchDocs, readDoc, queryContent"
```

---

### Task 3: `lookupDoc` and `getDocumentPageText`

**Files:**

- Modify: `src/providers/AnalogDevicesProvider.ts`

- [ ] **Step 1: Override `lookupDoc`**

Match `StMicroelectronicsProvider.lookupDoc` (lines 487–516):

1. `steps` array; first `await this.queryContent(question, partQuery, undefined, 8)`.
2. If chunks length > 0 → `{ chunks, steps: [...,'query_existing_index'] }`.
3. Else `steps.push('no_prior_index_match')`; `const docs = await this.searchDocs(partQuery)`.
4. If empty → return chunks `[]`, steps include message `No documents found for part '...'`.
5. Else `const filtered = adiExcludeNoiseForLookup(docs)`; `suggestedDocuments = capSuggestedDocuments(sortSearchResultsForLookup(question, filtered))`; return `{ chunks: [], steps, suggestedDocuments }`.

Ensure **`readDoc` is never called** inside `lookupDoc` (agent-flow asserts this for ST).

- [ ] **Step 2: Override `getDocumentPageText`**

Copy `StMicroelectronicsProvider.getDocumentPageText` (lines 519–561): validate page ≥ 1, `findDocumentByUrl(docUrl)` and optionally try `normalizeAdiPdfUrl(docUrl)`, vendor check `meta.vendor === 'ADI'`, `hasChunks`, `getIndexedTextForDocPages`, return `DocumentPageResult`.

- [ ] **Step 3: Commit**

```bash
git add src/providers/AnalogDevicesProvider.ts
git commit -m "feat(adi): lookupDoc and getDocumentPageText"
```

---

### Task 4: Register provider and dynamic vendor validation in `mcpServerFactory`

**Files:**

- Modify: `src/mcpServerFactory.ts`

- [ ] **Step 1: Import and instantiate**

After existing ST import:

```typescript
import { AnalogDevicesProvider } from "./providers/AnalogDevicesProvider.js";
const adiProvider = new AnalogDevicesProvider();
```

Extend `vendors`:

```typescript
const vendors: Record<string, VendorProvider> = {
  [tiProvider.vendorId]: tiProvider,
  [stProvider.vendorId]: stProvider,
  [adiProvider.vendorId]: adiProvider,
};
```

Add **once**, after the `vendors` object:

```typescript
const SUPPORTED_VENDOR_IDS = Object.keys(vendors);
function isKnownVendor(id: string): boolean {
  return SUPPORTED_VENDOR_IDS.includes(id.toUpperCase());
}
```

- [ ] **Step 2: Fix `list_indexed_documents` guard**

Replace:

```typescript
if (v !== "TI" && v !== "ST") {
```

with:

```typescript
if (!isKnownVendor(v)) {
```

Error text:

```typescript
`Vendor must be one of: ${SUPPORTED_VENDOR_IDS.join(", ")}.`
```

- [ ] **Step 3: Update MCP `instructions` and tool descriptions**

In `createMcpServer()`, change strings `(TI, ST)` to include ADI, e.g. `(TI, ST, ADI)`. In every tool `inputSchema.properties.vendor.description` that says `'TI', 'ST'` or `**TI** or **ST**`, replace with dynamic wording: `TI, ST, ADI` or `supported vendor IDs: ${SUPPORTED_VENDOR_IDS.join(", ")}` (if you interpolate at runtime, build the string once from `SUPPORTED_VENDOR_IDS.join(", ")`).

Keep TI-specific symlink note on `read_doc` / `lookup_doc` where it already exists.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: **exit code 0**, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcpServerFactory.ts
git commit -m "feat(adi): register ADI provider and dynamic vendor validation"
```

---

### Task 5: Documentation and skills

**Files:**

- Modify: `README.md` (vendor table + any “TI/ST” phrasing in supported vendors)
- Modify: `src/resources/tool-usage-guide.md` (intro line “Supports …”; add **ADI** subsection under vendor notes: product page `analog.com/en/products/{part}.html`, slug fallback if 404, no static search HTML in v1, optional noise in suggestions filtered like ST)
- Modify: `.cursor/skills/electronics-docs-mcp/SKILL.md` — vendor list includes ADI
- Modify: `.cursor/skills/electronics-docs-mcp-ti/SKILL.md` and `electronics-docs-mcp-st/SKILL.md` only if they claim “only TI” / “only ST”; add one line that **ADI** uses `vendor: ADI` and project skill `electronics-docs-mcp` for overview
- Optional: create `.cursor/skills/electronics-docs-mcp-adi/SKILL.md` (short mirror of TI/ST skills: FTS-only lookup, `read_doc` for PDF URL, native fetch for analog.com) — **recommended** for agent discoverability

- [ ] **Step 1: Edit README and tool-usage-guide**

Apply edits; no placeholders.

- [ ] **Step 2: Edit skills**

Apply edits.

- [ ] **Step 3: Run build** (copies `tool-usage-guide.md` to `build/resources/`)

```bash
npm run build
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add README.md src/resources/tool-usage-guide.md .cursor/skills/
git commit -m "docs: ADI vendor in README, tool guide, and skills"
```

---

### Task 6: Agent-flow fixtures and smoke loop

**Files:**

- Modify: `scripts/agent-flow/fixtures.ts`
- Modify: `scripts/agent-flow/run.ts`

- [ ] **Step 1: Extend `VendorKey` and fixtures**

In `fixtures.ts`:

```typescript
export type VendorKey = "TI" | "ST" | "ADI";

export const fixtures: Record<
  VendorKey,
  { defaultPart: string; defaultQuestion: string; sampleReadUrl: string }
> = {
  // ... existing TI, ST ...
  ADI: {
    defaultPart: "ADAU1701",
    defaultQuestion: "PLL",
    sampleReadUrl:
      "https://www.analog.com/media/en/technical-documentation/data-sheets/ADAU1701.pdf",
  },
};
```

- [ ] **Step 2: Wire provider factory and CLI**

In `run.ts`:

1. Import `AnalogDevicesProvider`.
2. `makeProvider`: add branch for `ADI`.
3. `parseArgs`: accept `ADI` wherever `TI`/`ST` are accepted.
4. `ALL_VENDORS`: `["TI", "ST", "ADI"]`.
5. Update `Usage:` string to show `TI|ST|ADI`.

- [ ] **Step 3: Run search + lookup for ADI (network)**

```bash
npm run build
npx tsx scripts/agent-flow/run.ts --tool search --vendor ADI
```

Expected: JSON with **`isError: false`** and **at least one** result whose `url` ends with `.pdf` and includes `analog.com` or `mds.analog.com`.

```bash
npx tsx scripts/agent-flow/run.ts --tool lookup --vendor ADI
```

Expected: **`readCalls`** path not used (lookup does not invoke read); console shows `suggestedCount` > 0 when index empty, or `chunkCount` > 0 when index already populated.

- [ ] **Step 4: Optional E2E** (set `RUN_E2E_NETWORK = true` in `run.ts` temporarily)

```bash
npx tsx scripts/agent-flow/run.ts --tool read --vendor ADI
```

Expected: log contains `Indexed` and a positive page count.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent-flow/fixtures.ts scripts/agent-flow/run.ts
git commit -m "test(agent-flow): ADI vendor fixtures and smoke wiring"
```

---

### Task 7: Default npm test and final verification

- [ ] **Step 1: Full default smoke**

```bash
npm test
```

Expected: builds, then `run.ts all` passes for **TI, ST, ADI** search + lookup; with default `RUN_E2E_NETWORK = false`, E2E read/query/page still skipped with message.

- [ ] **Step 2: Manual MCP sanity (optional)**

Start `npm run start:http` and call `list_indexed_documents` with `{ "vendor": "ADI" }` — expect **no** “Vendor must be TI or ST” error (should list empty array or indexed rows).

- [ ] **Step 3: Commit** (only if fixes needed from Task 7)

```bash
git add -A
git commit -m "fix: follow-up from ADI smoke tests"
```

---

## Plan self-review

| Spec requirement | Task covering it |
|------------------|-------------------|
| Parity: searchDocs, readDoc, queryContent, lookupDoc, getDocumentPageText | Tasks 1–3 |
| Unified MCP / vendor `ADI` | Task 4 |
| Product page first, slug 404 fallbacks, no search.html v1 | Task 1 steps 2–3; Task 5 tool guide |
| Path-based typing + noise filter for lookup | Task 1 steps 5–7; Task 3 |
| Remove hardcoded TI/ST validation | Task 4 step 2 |
| README + skills + tool guide | Task 5 |
| Agent-flow + fixtures | Task 6 |
| Build + npm test | Tasks 4, 6, 7 |

**Placeholder scan:** No TBD/TODO left in this plan.

**Type consistency:** `vendorId` string **`ADI`** used everywhere (`fixtures`, `makeProvider`, `list_indexed_documents`).

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-15-analog-devices-provider.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach do you want?**
