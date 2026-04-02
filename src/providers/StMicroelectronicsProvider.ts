import axios from 'axios';
import { VendorProvider, SearchResult, ReadDocMeta } from './VendorProvider';
import {
    getDocument,
    getDocumentsByPart,
    insertDocument,
    hasChunks,
    indexChunks,
    searchChunks,
    ChunkResult,
    updateDocumentPartIfUnknown,
    findDocumentByUrl,
} from '../cache/DocumentCache';
import { HEADERS_HTML, fetchPdfBuffer, extractPdfPages } from './pdfExtract';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cheerio = require('cheerio');

const ST_DOC_TYPE_LABELS: Record<SearchResult['type'], string> = {
    datasheet: 'Datasheet',
    user_guide: 'Reference / programming / user manual',
    application_note: 'Application note',
    errata: 'Errata',
    other: 'Document',
};

const ST_PRODUCT_PAGE_BASE = 'https://www.st.com/en/microcontrollers-microprocessors';

/** ST often responds better with browser-like context (fewer empty shells / slower bots). */
const ST_FETCH_HEADERS = {
    ...HEADERS_HTML,
    Referer: 'https://www.st.com/',
    'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Curated stable PDFs when HTML has no extractable links (JS portal). Key = series folder
 * (e.g. stm32g0-series) from `.../microcontrollers-microprocessors/<key>/documentation.html`.
 */
const ST_SERIES_KNOWN_PDFS: Record<
    string,
    Array<{ url: string; title: string; type: SearchResult['type'] }>
> = {
    'stm32g0-series': [
        {
            title: 'RM0444 — Reference manual STM32G0x1 advanced Arm-based 32-bit MCUs',
            url: 'https://www.st.com/resource/en/reference_manual/rm0444-stm32g0x1-advanced-armbased-32bit-mcus-stmicroelectronics.pdf',
            type: 'user_guide',
        },
    ],
};

function parsePartNumber(query: string): { basePart: string; exactPart: string; revision: string | null } {
    const upper = query.trim().toUpperCase().replace(/\s+/g, '');
    const revMatch = upper.match(/^(.+?)(-R?\d+)$/);
    if (revMatch) {
        return { basePart: revMatch[1], exactPart: upper, revision: revMatch[2] };
    }
    return { basePart: upper, exactPart: upper, revision: null };
}

function normalizeStUrl(url: string): string {
    return url.trim().split('?')[0];
}

/** Canonical form for dedupe: https, www.st.com, no query/hash. */
function normalizeStPdfCanonical(url: string): string {
    try {
        const u = new URL(url.trim());
        u.hash = '';
        u.search = '';
        u.protocol = 'https:';
        if (u.hostname.toLowerCase() === 'st.com') {
            u.hostname = 'www.st.com';
        }
        return u.href;
    } catch {
        return normalizeStUrl(url);
    }
}

/**
 * Map ST /resource/en/<segment>/... path segment to SearchResult type.
 */
function stResourceSegmentToType(segment: string): SearchResult['type'] {
    const s = segment.toLowerCase();
    if (s === 'datasheet') return 'datasheet';
    if (s === 'application_note') return 'application_note';
    if (s === 'reference_manual' || s === 'programming_manual' || s === 'user_manual') return 'user_guide';
    if (s === 'errata' || s.includes('errata')) return 'errata';
    return 'other';
}

function extractStDocTypeFromUrl(url: string): SearchResult['type'] {
    try {
        const u = new URL(url);
        const m = u.pathname.match(/\/resource\/en\/([^/]+)\//i);
        if (m) return stResourceSegmentToType(m[1]);
    } catch {
        /* ignore */
    }
    return 'other';
}

function titleFromPdfPath(pathname: string): string {
    const seg = pathname.split('/').filter(Boolean).pop() ?? 'document';
    return decodeURIComponent(seg.replace(/\.pdf$/i, '')).replace(/[-_]+/g, ' ').trim() || 'PDF document';
}

function resolveStHref(href: string): string {
    const h = href.trim();
    if (h.startsWith('http://') || h.startsWith('https://')) {
        return h;
    }
    return new URL(h, 'https://www.st.com/').href;
}

/** PDFs under ST resource paths (absolute URLs on st.com / content.st.com). */
const ST_RESOURCE_PDF_RE =
    /https?:\/\/(?:www\.|content\.)?st\.com\/resource\/en\/[a-z0-9_/+%.-]+\.pdf/gi;

/** Relative resource paths as used inside JSON / HTML attributes. */
const ST_RESOURCE_PDF_REL_RE = /\/resource\/en\/[a-z0-9_/+%.-]+\.pdf/gi;

/**
 * Second source: family documentation page often has more PDFs in static HTML than the part page.
 * Heuristics for STM32 slugs (ordering code lowercased, e.g. stm32g071rb).
 */
function deriveStMcuSeriesDocumentationUrl(productSlug: string): string | null {
    const s = productSlug.toLowerCase();
    if (s.startsWith('stm32mp')) {
        const m = s.match(/^stm32(mp[12])/i);
        if (m) {
            return `${ST_PRODUCT_PAGE_BASE}/${m[1].toLowerCase()}-series/documentation.html`;
        }
        return `${ST_PRODUCT_PAGE_BASE}/stm32mp1-series/documentation.html`;
    }
    if (s.startsWith('stm32wb')) {
        return `${ST_PRODUCT_PAGE_BASE}/stm32wb-series/documentation.html`;
    }
    if (s.startsWith('stm32wl')) {
        return `${ST_PRODUCT_PAGE_BASE}/stm32wl-series/documentation.html`;
    }
    const m = s.match(/^stm32([a-z])(\d)/i);
    if (m) {
        return `${ST_PRODUCT_PAGE_BASE}/stm32${m[1].toLowerCase()}${m[2]}-series/documentation.html`;
    }
    return null;
}

function seriesDocumentationPathKey(seriesDocUrl: string): string | null {
    const m = seriesDocUrl.match(
        /\/microcontrollers-microprocessors\/([^/]+)\/documentation\.html$/i
    );
    return m ? m[1].toLowerCase() : null;
}

/**
 * Add well-known family PDFs if not already discovered from HTML (deduped by URL).
 */
function injectKnownSeriesPdfs(
    seriesDocUrl: string | null,
    partUpper: string,
    seen: Set<string>,
    results: SearchResult[]
): void {
    if (!seriesDocUrl) return;
    const key = seriesDocumentationPathKey(seriesDocUrl);
    if (!key) return;
    const list = ST_SERIES_KNOWN_PDFS[key];
    if (!list) return;
    for (const item of list) {
        const clean = normalizeStPdfCanonical(item.url);
        if (seen.has(clean)) continue;
        seen.add(clean);
        results.push({
            title: item.title,
            description: `${ST_DOC_TYPE_LABELS[item.type]} for ${partUpper}`,
            url: clean,
            type: item.type,
            cached: false,
        });
    }
}

function isStTechnicalPdfUrl(url: string): boolean {
    const lower = url.toLowerCase();
    if (!lower.includes('st.com')) return false;
    if (!lower.includes('/resource/en/')) return false;
    if (!lower.endsWith('.pdf')) return false;
    if (lower.includes('/material_declaration/')) return false;
    return true;
}

/**
 * ST search API returns PDFs for many products; keep hits relevant to this MCU slug
 * (ordering code lowercased, e.g. stm32g071rb).
 */
function slugMatchesStPdfPath(productSlug: string, pdfUrl: string): boolean {
    const path = pdfUrl.toLowerCase();
    const s = productSlug.toLowerCase();
    if (path.includes(s)) return true;
    const m = s.match(/^stm32([a-z])(\d)/i);
    if (m) {
        const seriesStem = `stm32${m[1].toLowerCase()}${m[2]}`;
        if (path.includes(seriesStem)) return true;
    }
    if (/^stm32wb/i.test(s) && path.includes('stm32wb')) return true;
    if (/^stm32wl/i.test(s) && path.includes('stm32wl')) return true;
    if (/^stm32mp/i.test(s) && path.includes('stm32mp')) return true;
    // App notes often use dm00… filenames; match first 4 chars after "stm32" (e.g. g071).
    const tail = s.replace(/^stm32/i, '');
    if (tail.length >= 4) {
        const token = tail.slice(0, 4).toLowerCase();
        if (path.includes(token)) return true;
    }
    return !/^stm32/i.test(s);
}

function pushPdfResult(
    absUrl: string,
    partUpper: string,
    linkTitle: string | undefined,
    seen: Set<string>,
    results: SearchResult[]
): void {
    const cleanUrl = normalizeStPdfCanonical(absUrl);
    if (!isStTechnicalPdfUrl(cleanUrl)) return;
    if (seen.has(cleanUrl)) return;

    let segment = 'other';
    try {
        const path = new URL(cleanUrl).pathname;
        const m = path.match(/\/resource\/en\/([^/]+)\//i);
        if (m) segment = m[1].toLowerCase();
    } catch {
        return;
    }

    const docType = stResourceSegmentToType(segment);
    let rawTitle = (linkTitle ?? '').trim().replace(/\s+/g, ' ');
    if (!rawTitle || rawTitle.toLowerCase() === 'pdf') {
        try {
            rawTitle = titleFromPdfPath(new URL(cleanUrl).pathname);
        } catch {
            rawTitle = 'Document';
        }
    }

    seen.add(cleanUrl);
    results.push({
        title: rawTitle,
        description: `${ST_DOC_TYPE_LABELS[docType] || 'Document'} for ${partUpper}`,
        url: cleanUrl,
        type: docType,
        cached: false,
    });
}

/** Extract PDF URLs from any text (HTML or JSON). */
function extractPdfResultsFromRawText(
    text: string,
    partUpper: string,
    seen: Set<string>,
    results: SearchResult[]
): void {
    ST_RESOURCE_PDF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ST_RESOURCE_PDF_RE.exec(text)) !== null) {
        pushPdfResult(m[0], partUpper, undefined, seen, results);
    }
}

/**
 * Collect PDFs from anchor tags and from raw HTML (JSON-LD / inline scripts often embed URLs).
 */
function extractPdfResultsFromHtml(
    html: string,
    partUpper: string,
    seen: Set<string>,
    results: SearchResult[]
): void {
    const $ = cheerio.load(html);
    $('a[href]').each((_: unknown, el: unknown) => {
        const href: string = $(el).attr('href') ?? '';
        if (!href) return;
        let absUrl: string;
        try {
            absUrl = resolveStHref(href);
        } catch {
            return;
        }
        const title = $(el).text().trim().replace(/\s+/g, ' ');
        pushPdfResult(absUrl, partUpper, title, seen, results);
    });

    extractPdfResultsFromRawText(html, partUpper, seen, results);
}

/** Two parallel fetches; wall time ~= max of both, not sum. */
const ST_HTML_TIMEOUT_MS = 12_000;

/** Public JSON search used by st.com (see community notes); complements JS-only product UIs. */
const ST_SEARCH_API_TIMEOUT_MS = 18_000;

async function fetchStSearchResourcesTextForQuery(searchQuery: string): Promise<string> {
    const q = searchQuery.trim();
    if (!q) return '';
    const url = `https://www.st.com/bin/st/search/resources?q=${encodeURIComponent(q)}&limit=80&start=0`;
    try {
        const response = await axios.get(url, {
            headers: {
                ...ST_FETCH_HEADERS,
                Accept: 'application/json, text/plain, */*',
            },
            timeout: ST_SEARCH_API_TIMEOUT_MS,
            maxRedirects: 5,
            validateStatus: (s) => s >= 200 && s < 400,
        });
        if (response.data == null) return '';
        return typeof response.data === 'object'
            ? JSON.stringify(response.data)
            : String(response.data);
    } catch {
        return '';
    }
}

const ST_SEARCH_API_UNFILTERED_CAP = 45;

/**
 * ST portal JSON search (same backend as st.com search). Prefer PDFs whose path matches
 * the part / STM32 line; if the API returned a large payload but nothing passed the filter,
 * fall back to unfiltered hits (search `q=` is already part-scoped).
 */
async function extractPdfResultsFromStSearchApi(
    productSlug: string,
    partUpper: string,
    seen: Set<string>,
    results: SearchResult[]
): Promise<void> {
    const queries = [...new Set([partUpper, productSlug].map((s) => s.trim()).filter(Boolean))];
    const blobs = await Promise.all(queries.map((q) => fetchStSearchResourcesTextForQuery(q)));
    const combined = blobs.join('\n');
    if (combined.length === 0) {
        console.error(
            'DEBUG [ST]: bin/st/search/resources returned no data (timeout, network, or empty response)'
        );
    }

    const countBefore = results.length;

    ST_RESOURCE_PDF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ST_RESOURCE_PDF_RE.exec(combined)) !== null) {
        if (!slugMatchesStPdfPath(productSlug, m[0])) continue;
        pushPdfResult(m[0], partUpper, undefined, seen, results);
    }

    ST_RESOURCE_PDF_REL_RE.lastIndex = 0;
    while ((m = ST_RESOURCE_PDF_REL_RE.exec(combined)) !== null) {
        const abs = normalizeStPdfCanonical(`https://www.st.com${m[0]}`);
        if (!slugMatchesStPdfPath(productSlug, abs)) continue;
        pushPdfResult(abs, partUpper, undefined, seen, results);
    }

    const filteredAdded = results.length - countBefore;
    if (filteredAdded === 0 && combined.length > 200) {
        let unfiltered = 0;
        ST_RESOURCE_PDF_RE.lastIndex = 0;
        while ((m = ST_RESOURCE_PDF_RE.exec(combined)) !== null && unfiltered < ST_SEARCH_API_UNFILTERED_CAP) {
            const before = results.length;
            pushPdfResult(m[0], partUpper, undefined, seen, results);
            if (results.length > before) unfiltered += 1;
        }
        ST_RESOURCE_PDF_REL_RE.lastIndex = 0;
        while ((m = ST_RESOURCE_PDF_REL_RE.exec(combined)) !== null && unfiltered < ST_SEARCH_API_UNFILTERED_CAP) {
            const abs = normalizeStPdfCanonical(`https://www.st.com${m[0]}`);
            const before = results.length;
            pushPdfResult(abs, partUpper, undefined, seen, results);
            if (results.length > before) unfiltered += 1;
        }
    }
}

async function fetchStHtml(url: string): Promise<string | null> {
    try {
        const response = await axios.get(url, {
            headers: ST_FETCH_HEADERS,
            timeout: ST_HTML_TIMEOUT_MS,
            maxRedirects: 5,
            validateStatus: (s) => s >= 200 && s < 500,
        });
        if (response.status !== 200 || response.data == null) return null;
        return String(response.data);
    } catch {
        return null;
    }
}

/** True if this PDF URL is already stored for vendor ST (metadata from a prior search or read). */
function isStDocInDb(url: string): boolean {
    const canon = normalizeStPdfCanonical(url);
    const meta = findDocumentByUrl(canon);
    return meta !== null && meta.vendor === 'ST';
}

export class StMicroelectronicsProvider extends VendorProvider {
    readonly vendorId = 'ST';
    readonly vendorName = 'STMicroelectronics';

    async searchDocs(query: string): Promise<SearchResult[]> {
        const { basePart, exactPart, revision } = parsePartNumber(query);
        const slug = exactPart.toLowerCase();
        console.error(`DEBUG [ST]: Searching for part: ${exactPart} (slug ${slug}) — scrape + DB merge`);

        const scraped = await this.scrapeProductPage(slug, exactPart);

        const urlKeys = new Set(scraped.map((r) => normalizeStPdfCanonical(r.url)));
        const fromDb: SearchResult[] = [];
        const partVariants = revision ? [exactPart, basePart] : [exactPart];
        const seenParts = new Set<string>();
        for (const p of partVariants) {
            if (seenParts.has(p)) continue;
            seenParts.add(p);
            for (const doc of getDocumentsByPart(this.vendorId, p)) {
                const url = normalizeStPdfCanonical(doc.url);
                if (urlKeys.has(url)) continue;
                urlKeys.add(url);
                fromDb.push({
                    title: doc.title,
                    description: `${ST_DOC_TYPE_LABELS[doc.docType as SearchResult['type']] ?? 'Document'} — ${doc.part} (local index)`,
                    url,
                    type: doc.docType as SearchResult['type'],
                    cached: true,
                });
            }
        }

        const merged: SearchResult[] = [
            ...scraped.map((r) => {
                const url = normalizeStPdfCanonical(r.url);
                return {
                    ...r,
                    url,
                    cached: isStDocInDb(url),
                };
            }),
            ...fromDb,
        ];

        const savedPart = exactPart;
        for (const r of merged) {
            insertDocument(this.vendorId, savedPart, r.title, r.type, r.url);
        }

        return merged;
    }

    private async scrapeProductPage(slug: string, partUpper: string): Promise<SearchResult[]> {
        const seen = new Set<string>();
        const results: SearchResult[] = [];

        const productUrl = `${ST_PRODUCT_PAGE_BASE}/${slug}.html`;
        const seriesDocUrl = deriveStMcuSeriesDocumentationUrl(slug);

        await Promise.all([
            (async () => {
                const html = await fetchStHtml(productUrl);
                if (html) extractPdfResultsFromHtml(html, partUpper, seen, results);
            })(),
            (async () => {
                if (!seriesDocUrl) return;
                const html = await fetchStHtml(seriesDocUrl);
                if (html) extractPdfResultsFromHtml(html, partUpper, seen, results);
            })(),
            extractPdfResultsFromStSearchApi(slug, partUpper, seen, results),
        ]);

        injectKnownSeriesPdfs(seriesDocUrl, partUpper, seen, results);

        return this.withDatasheetFallback(slug, partUpper, results);
    }

    private withDatasheetFallback(
        slug: string,
        partUpper: string,
        results: SearchResult[]
    ): SearchResult[] {
        const hasDatasheet = results.some((r) => r.type === 'datasheet');
        if (hasDatasheet) return results;

        const fallbackUrl = normalizeStPdfCanonical(
            `https://www.st.com/resource/en/datasheet/${slug}.pdf`
        );
        return [
            ...results,
            {
                title: `${partUpper} datasheet`,
                description: `${ST_DOC_TYPE_LABELS.datasheet} for ${partUpper} (canonical URL)`,
                url: fallbackUrl,
                type: 'datasheet' as const,
                cached: false,
            },
        ];
    }

    async readDoc(docIdOrUrl: string, meta?: ReadDocMeta): Promise<string> {
        const raw = docIdOrUrl.trim();
        const urlNoQuery = normalizeStUrl(raw);
        const existing =
            getDocument(raw) ?? getDocument(urlNoQuery) ?? findDocumentByUrl(docIdOrUrl);
        if (existing && hasChunks(existing.id)) {
            return `[CACHED] Document '${existing.title}' is already indexed.`;
        }

        const pdfBuffer = await fetchPdfBuffer(urlNoQuery);
        const pages = await extractPdfPages(pdfBuffer);

        const partForRow = meta?.part?.trim().toUpperCase().replace(/\s+/g, '') ?? 'UNKNOWN';
        const titleForRow = meta?.title ?? existing?.title ?? 'Document';

        let docId: number;
        if (existing) {
            docId = existing.id;
            if (meta?.part) {
                updateDocumentPartIfUnknown(urlNoQuery, meta.part);
            }
        } else {
            const docType = extractStDocTypeFromUrl(urlNoQuery);
            docId = insertDocument(this.vendorId, partForRow, titleForRow, docType, urlNoQuery);
        }

        indexChunks(docId, pages);
        return `Indexed ${pages.length} pages from ${urlNoQuery}`;
    }

    async queryContent(
        query: string,
        part?: string,
        docType?: string,
        limit?: number
    ): Promise<ChunkResult[]> {
        const lim = limit ?? 8;
        if (!part) {
            return searchChunks(query, { vendor: this.vendorId, docType, limit: lim });
        }
        const { basePart, exactPart } = parsePartNumber(part);
        let res = await searchChunks(query, {
            vendor: this.vendorId,
            part: basePart,
            docType,
            limit: lim,
        });

        if (res.length === 0 && exactPart !== basePart) {
            res = await searchChunks(query, {
                vendor: this.vendorId,
                part: exactPart,
                docType,
                limit: lim,
            });
        }

        if (res.length === 0) {
            console.error(`DEBUG [ST]: Falling back to global search for '${query}'`);
            res = await searchChunks(query, { vendor: this.vendorId, docType, limit: lim });
        }
        return res;
    }
}
