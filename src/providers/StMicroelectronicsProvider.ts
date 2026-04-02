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
import { fetchPdfBuffer, extractPdfPages } from './pdfExtract';

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

function isStSearchDebug(): boolean {
    const v = process.env.ST_SEARCH_DEBUG;
    return v === '1' || v === 'true';
}

const ST_FETCH_HEADERS: Record<string, string> = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: 'https://www.st.com/',
    'Accept-Language': 'en-US,en;q=0.9',
};

const ST_HTML_TIMEOUT_MS = 20_000;
const ST_SEARCH_API_TIMEOUT_MS = 25_000;

// ─── Native fetch helpers (axios blocked by Akamai CDN TLS fingerprinting) ───

async function stFetchText(url: string, timeoutMs: number, extraHeaders?: Record<string, string>): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { ...ST_FETCH_HEADERS, ...extraHeaders },
            redirect: 'follow',
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        return await res.text();
    } catch {
        clearTimeout(timer);
        return null;
    }
}

async function stFetchJson(url: string, timeoutMs: number): Promise<any | null> {
    const text = await stFetchText(url, timeoutMs, { Accept: 'application/json, text/plain, */*' });
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

// ─── ST Search API structured parsing ───

interface StSearchDoc {
    title_man?: string;
    doc_id?: string;
    taxo_class?: string;
    document_type?: string[];
    link?: string[];
    rpn_list?: string[];
    file_name?: string;
}

function stTaxoClassToType(taxo: string | undefined): SearchResult['type'] {
    const t = (taxo ?? '').toLowerCase();
    if (t.includes('datasheet') || t.includes('data sheet') || t === 'databrief') return 'datasheet';
    if (t.includes('application note') || t.includes('appnote')) return 'application_note';
    if (t.includes('reference manual') || t.includes('programming manual') || t.includes('user manual')) return 'user_guide';
    if (t.includes('errata')) return 'errata';
    return 'other';
}

function jcrLinkToCanonicalUrl(jcrPath: string): string | null {
    const m = jcrPath.match(/\/resource\/technical\/document\/([^/]+)\/.+?\/files\/([^/]+\.pdf)/i);
    if (!m) return null;
    const segment = m[1].replace(/_/g, '_');
    const filename = m[2];
    return `https://www.st.com/resource/en/${segment}/${filename}`;
}

// ─── URL helpers ───

function normalizeStUrl(url: string): string {
    return url.trim().split('?')[0];
}

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

function stResourceSegmentToType(segment: string): SearchResult['type'] {
    const s = segment.toLowerCase();
    if (s === 'datasheet' || s === 'data_brief') return 'datasheet';
    if (s === 'application_note') return 'application_note';
    if (s === 'reference_manual' || s === 'programming_manual' || s === 'user_manual') return 'user_guide';
    if (s === 'errata' || s === 'errata_sheet' || s.includes('errata')) return 'errata';
    return 'other';
}

function extractStDocTypeFromUrl(url: string): SearchResult['type'] {
    try {
        const u = new URL(url);
        const m = u.pathname.match(/\/resource\/en\/([^/]+)\//i);
        if (m) return stResourceSegmentToType(m[1]);
    } catch { /* ignore */ }
    return 'other';
}

function parsePartNumber(query: string): { basePart: string; exactPart: string; revision: string | null } {
    const upper = query.trim().toUpperCase().replace(/\s+/g, '');
    const revMatch = upper.match(/^(.+?)(-R?\d+)$/);
    if (revMatch) {
        return { basePart: revMatch[1], exactPart: upper, revision: revMatch[2] };
    }
    return { basePart: upper, exactPart: upper, revision: null };
}

function resolveStHref(href: string): string {
    const h = href.trim();
    if (h.startsWith('http://') || h.startsWith('https://')) return h;
    return new URL(h, 'https://www.st.com/').href;
}

function isStTechnicalPdfUrl(url: string): boolean {
    const lower = url.toLowerCase();
    if (!lower.includes('st.com')) return false;
    if (!lower.includes('/resource/en/')) return false;
    if (!lower.endsWith('.pdf')) return false;
    if (lower.includes('/material_declaration/')) return false;
    return true;
}

const ST_RESOURCE_PDF_RE =
    /https?:\/\/(?:www\.|content\.)?st\.com\/resource\/en\/[a-z0-9_/+%.-]+\.pdf/gi;
const ST_RESOURCE_PDF_REL_RE = /\/resource\/en\/[a-z0-9_/+%.-]+\.pdf/gi;

function titleFromPdfPath(pathname: string): string {
    const seg = pathname.split('/').filter(Boolean).pop() ?? 'document';
    return decodeURIComponent(seg.replace(/\.pdf$/i, '')).replace(/[-_]+/g, ' ').trim() || 'PDF document';
}

function pushPdfResult(
    absUrl: string,
    partUpper: string,
    linkTitle: string | undefined,
    seen: Set<string>,
    results: SearchResult[],
    source?: string,
    overrideType?: SearchResult['type']
): void {
    const cleanUrl = normalizeStPdfCanonical(absUrl);
    if (!isStTechnicalPdfUrl(cleanUrl)) return;
    if (seen.has(cleanUrl)) return;

    const docType = overrideType ?? extractStDocTypeFromUrl(cleanUrl);
    let rawTitle = (linkTitle ?? '').trim().replace(/\s+/g, ' ');
    if (!rawTitle || rawTitle.toLowerCase() === 'pdf') {
        try { rawTitle = titleFromPdfPath(new URL(cleanUrl).pathname); } catch { rawTitle = 'Document'; }
    }

    seen.add(cleanUrl);
    results.push({
        title: rawTitle,
        description: `${ST_DOC_TYPE_LABELS[docType] || 'Document'} for ${partUpper}`,
        url: cleanUrl,
        type: docType,
        cached: false,
    });
    if (isStSearchDebug() && source) {
        console.error(`DEBUG [ST][${source}] + ${docType} ${cleanUrl}`);
    }
}

// ─── HTML extraction (product page / series page) ───

function extractPdfResultsFromHtml(
    html: string,
    partUpper: string,
    seen: Set<string>,
    results: SearchResult[],
    source: string
): void {
    const $ = cheerio.load(html);
    $('a[href]').each((_: unknown, el: unknown) => {
        const href: string = $(el).attr('href') ?? '';
        if (!href) return;
        let absUrl: string;
        try { absUrl = resolveStHref(href); } catch { return; }
        const title = $(el).text().trim().replace(/\s+/g, ' ');
        pushPdfResult(absUrl, partUpper, title, seen, results, source);
    });

    ST_RESOURCE_PDF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ST_RESOURCE_PDF_RE.exec(html)) !== null) {
        pushPdfResult(m[0], partUpper, undefined, seen, results, source);
    }
}

// ─── Search API (structured JSON via native fetch) ───

async function extractPdfResultsFromStSearchApi(
    productSlug: string,
    partUpper: string,
    seen: Set<string>,
    results: SearchResult[]
): Promise<void> {
    const url = `https://www.st.com/bin/st/search/resources?q=${encodeURIComponent(partUpper)}&limit=100&start=0`;
    if (isStSearchDebug()) {
        console.error(`DEBUG [ST][st_search_api] fetching ${url}`);
    }

    const data = await stFetchJson(url, ST_SEARCH_API_TIMEOUT_MS);
    if (!data) {
        console.error('DEBUG [ST]: search API returned no data (timeout or network error)');
        return;
    }

    const docs: StSearchDoc[] = data?.response?.docs ?? [];
    if (isStSearchDebug()) {
        console.error(`DEBUG [ST][st_search_api] numFound=${data?.response?.numFound ?? '?'} docs=${docs.length}`);
    }

    for (const doc of docs) {
        const jcrLinks = doc.link ?? [];
        const docType = stTaxoClassToType(doc.taxo_class);
        const title = doc.title_man ?? doc.doc_id ?? 'Document';
        const docIdPrefix = doc.doc_id ?? '';

        for (const jcrPath of jcrLinks) {
            const canonical = jcrLinkToCanonicalUrl(jcrPath);
            if (canonical) {
                pushPdfResult(canonical, partUpper, `${docIdPrefix} ${title}`.trim(), seen, results, 'st_search_api', docType);
            }
        }
    }
}

// ─── Series heuristics ───

function deriveStMcuSeriesDocumentationUrl(productSlug: string): string | null {
    const s = productSlug.toLowerCase();
    if (s.startsWith('stm32mp')) {
        const m = s.match(/^stm32(mp[12])/i);
        if (m) return `${ST_PRODUCT_PAGE_BASE}/${m[1].toLowerCase()}-series/documentation.html`;
        return `${ST_PRODUCT_PAGE_BASE}/stm32mp1-series/documentation.html`;
    }
    if (s.startsWith('stm32wb')) return `${ST_PRODUCT_PAGE_BASE}/stm32wb-series/documentation.html`;
    if (s.startsWith('stm32wl')) return `${ST_PRODUCT_PAGE_BASE}/stm32wl-series/documentation.html`;
    const m = s.match(/^stm32([a-z])(\d)/i);
    if (m) return `${ST_PRODUCT_PAGE_BASE}/stm32${m[1].toLowerCase()}${m[2]}-series/documentation.html`;
    return null;
}

// ─── Main provider ───

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
        console.error(`DEBUG [ST]: Searching for part: ${exactPart} (slug ${slug}) — fetch + search API + DB merge`);

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
            ...scraped.map((r) => ({
                ...r,
                url: normalizeStPdfCanonical(r.url),
                cached: isStDocInDb(r.url),
            })),
            ...fromDb,
        ];

        if (isStSearchDebug()) {
            console.error(
                `DEBUG [ST]: searchDocs merge: scraped=${scraped.length} extra_from_db=${fromDb.length} merged=${merged.length}`
            );
            for (const r of merged) {
                console.error(`DEBUG [ST]:   out: type=${r.type} cached=${r.cached} title=${JSON.stringify(r.title)} url=${r.url}`);
            }
        }

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

        if (isStSearchDebug()) {
            console.error(`DEBUG [ST]: scrapeProductPage urls: product=${productUrl} series=${seriesDocUrl ?? '(none)'}`);
        }

        await Promise.all([
            (async () => {
                const html = await stFetchText(productUrl, ST_HTML_TIMEOUT_MS);
                if (html) extractPdfResultsFromHtml(html, partUpper, seen, results, 'product_page');
            })(),
            (async () => {
                if (!seriesDocUrl) return;
                const html = await stFetchText(seriesDocUrl, ST_HTML_TIMEOUT_MS);
                if (html) extractPdfResultsFromHtml(html, partUpper, seen, results, 'series_documentation');
            })(),
            extractPdfResultsFromStSearchApi(slug, partUpper, seen, results),
        ]);

        const afterScrape = results.length;
        const withFb = this.withDatasheetFallback(slug, partUpper, results);
        if (isStSearchDebug()) {
            console.error(`DEBUG [ST]: scrape phase summary: before_fallback=${afterScrape} after=${withFb.length}`);
        }
        return withFb;
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
        if (isStSearchDebug()) {
            console.error(`DEBUG [ST][datasheet_fallback] + ${fallbackUrl}`);
        }
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
