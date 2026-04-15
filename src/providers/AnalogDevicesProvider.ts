import {
    VendorProvider,
    SearchResult,
    ReadDocMeta,
    LookupResult,
    DocumentPageResult,
} from './VendorProvider';
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
    getIndexedTextForDocPages,
} from '../cache/DocumentCache';
import { sortSearchResultsForLookup, capSuggestedDocuments } from './lookupRanking';
import { fetchPdfBuffer, extractPdfPages, type FetchPdfOptions } from './pdfExtract';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cheerio = require('cheerio');

const ADI_PRODUCT_PAGE_BASE = 'https://www.analog.com/en/products';
const ADI_HTML_TIMEOUT_MS = 35_000;

const ADI_FETCH_HEADERS: Record<string, string> = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.analog.com/',
};

const ADI_PDF_FETCH_OPTS: FetchPdfOptions = { useNativeFetch: true };

const ADI_DOC_TYPE_LABELS: Record<SearchResult['type'], string> = {
    datasheet: 'Datasheet',
    user_guide: 'User guide / evaluation / reference material',
    application_note: 'Application note',
    errata: 'Errata',
    other: 'Document',
};

function isAdiSearchDebug(): boolean {
    const v = process.env.ADI_SEARCH_DEBUG;
    return v === '1' || v === 'true';
}

async function adiFetchText(url: string, timeoutMs: number): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: ADI_FETCH_HEADERS,
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

/** Try slug order: literal query slug, then strip trailing `-digits`, then strip `-rN` (TI-style). */
function slugCandidatesFromQuery(query: string): string[] {
    const raw = query.trim().toLowerCase().replace(/\s+/g, '').replace(/#/g, '');
    const out: string[] = [];
    const push = (s: string) => {
        if (s && !out.includes(s)) out.push(s);
    };
    if (!raw) return [];
    push(raw);
    const digitTail = raw.match(/^(.+)-(\d+)$/);
    if (digitTail) push(digitTail[1]!);
    const revTail = raw.match(/^(.+?)(-r\d+)$/i);
    if (revTail) push(revTail[1]!);
    return out;
}

function normalizeAdiPdfUrl(url: string): string {
    try {
        const u = new URL(url.trim());
        u.hash = '';
        u.search = '';
        u.protocol = 'https:';
        const host = u.hostname.toLowerCase();
        if (host === 'analog.com') u.hostname = 'www.analog.com';
        return u.href;
    } catch {
        return url.trim().split('?')[0];
    }
}

function classifyAdiPdfUrl(url: string): SearchResult['type'] {
    const lower = url.toLowerCase();
    if (lower.includes('mds.analog.com')) return 'other';
    if (lower.includes('/technical-documentation/data-sheets/')) return 'datasheet';
    if (
        lower.includes('/technical-documentation/application-notes/') ||
        lower.includes('/application-notes/')
    ) {
        return 'application_note';
    }
    if (
        lower.includes('/user-guides/') ||
        lower.includes('/evaluation-documentation/') ||
        lower.includes('/eval-board-schematic/') ||
        lower.includes('/reference-design-documentation/') ||
        lower.includes('/design-notes/')
    ) {
        return 'user_guide';
    }
    if (
        lower.includes('/pcn/') ||
        lower.includes('/product-change-notices/') ||
        /\/media\/en\/pcn\//i.test(lower)
    ) {
        return 'other';
    }
    return 'other';
}

function titleFromPdfPath(pathname: string): string {
    const seg = pathname.split('/').filter(Boolean).pop() ?? 'document';
    return decodeURIComponent(seg.replace(/\.pdf$/i, '')).replace(/[-_]+/g, ' ').trim() || 'PDF document';
}

function extractAdiPdfUrlsFromHtml(html: string): string[] {
    const seen = new Set<string>();
    const push = (u: string) => {
        const t = u.trim();
        if (!/\.pdf$/i.test(t)) return;
        try {
            seen.add(normalizeAdiPdfUrl(t));
        } catch {
            /* ignore */
        }
    };

    const $ = cheerio.load(html);
    $('a[href]').each((_: unknown, el: unknown) => {
        const href: string = $(el).attr('href') ?? '';
        if (!href || !/\.pdf$/i.test(href)) return;
        try {
            const abs = new URL(href, 'https://www.analog.com/').href;
            push(abs);
        } catch {
            /* ignore */
        }
    });

    const reAbs = /https?:\/\/[^"'>\s]+\.(?:pdf|PDF)/gi;
    let m: RegExpExecArray | null;
    while ((m = reAbs.exec(html)) !== null) push(m[0]);

    return [...seen];
}

async function fetchAdiProductHtmlForQuery(query: string): Promise<{ slug: string; html: string } | null> {
    for (const slug of slugCandidatesFromQuery(query)) {
        const url = `${ADI_PRODUCT_PAGE_BASE}/${slug}.html`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ADI_HTML_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                signal: ctrl.signal,
                headers: ADI_FETCH_HEADERS,
                redirect: 'follow',
            });
            clearTimeout(timer);
            if (res.status !== 200) continue;
            const html = await res.text();
            if (html.length < 10_000) continue;
            if (isAdiSearchDebug()) {
                console.error(`DEBUG [ADI]: product page OK slug=${slug} len=${html.length} url=${url}`);
            }
            return { slug, html };
        } catch {
            clearTimeout(timer);
            continue;
        }
    }
    return null;
}

function parsePartNumber(query: string): { basePart: string; exactPart: string; revision: string | null } {
    const upper = query.trim().toUpperCase().replace(/\s+/g, '');
    const revMatch = upper.match(/^(.+?)(-R?\d+)$/);
    if (revMatch) {
        return { basePart: revMatch[1]!, exactPart: upper, revision: revMatch[2]! };
    }
    return { basePart: upper, exactPart: upper, revision: null };
}

function isAdiDocInDb(url: string): boolean {
    const canon = normalizeAdiPdfUrl(url);
    const meta = findDocumentByUrl(canon);
    return meta !== null && meta.vendor === 'ADI';
}

/** Remove PCN / package PDFs from lookup suggestions only (searchDocs keeps full list). */
function adiExcludeNoiseForLookup(docs: SearchResult[]): SearchResult[] {
    return docs.filter((d) => {
        const u = d.url.toLowerCase();
        if (u.includes('mds.analog.com')) return false;
        if (u.includes('/pcn/') || u.includes('/product-change-notices/')) return false;
        if (/\/media\/en\/pcn\//i.test(u)) return false;
        return true;
    });
}

export class AnalogDevicesProvider extends VendorProvider {
    readonly vendorId = 'ADI';
    readonly vendorName = 'Analog Devices';

    async searchDocs(query: string): Promise<SearchResult[]> {
        const { basePart, exactPart, revision } = parsePartNumber(query);
        const partUpper = exactPart;
        console.error(`DEBUG [ADI]: searchDocs part=${partUpper} (slug candidates from query)`);

        let cached = getDocumentsByPart(this.vendorId, exactPart);
        if (cached.length === 0 && revision) {
            cached = getDocumentsByPart(this.vendorId, basePart);
        }
        if (cached.length > 0) {
            return cached.map((doc) => ({
                title: doc.title,
                description: `${ADI_DOC_TYPE_LABELS[doc.docType as SearchResult['type']] ?? 'Document'} — ${doc.part}`,
                url: normalizeAdiPdfUrl(doc.url),
                type: doc.docType as SearchResult['type'],
                cached: true,
            }));
        }

        const fetched = await fetchAdiProductHtmlForQuery(query);
        if (!fetched) {
            return [];
        }

        const pdfUrls = extractAdiPdfUrlsFromHtml(fetched.html);
        const scraped: SearchResult[] = [];
        for (const url of pdfUrls) {
            const docType = classifyAdiPdfUrl(url);
            let title: string;
            try {
                title = titleFromPdfPath(new URL(url).pathname);
            } catch {
                title = 'PDF document';
            }
            scraped.push({
                title,
                description: `${ADI_DOC_TYPE_LABELS[docType] || 'Document'} for ${partUpper}`,
                url,
                type: docType,
                cached: isAdiDocInDb(url),
            });
        }

        const urlKeys = new Set(scraped.map((r) => normalizeAdiPdfUrl(r.url)));
        const fromDb: SearchResult[] = [];
        const partVariants = revision ? [exactPart, basePart] : [exactPart];
        const seenParts = new Set<string>();
        for (const p of partVariants) {
            if (seenParts.has(p)) continue;
            seenParts.add(p);
            for (const doc of getDocumentsByPart(this.vendorId, p)) {
                const url = normalizeAdiPdfUrl(doc.url);
                if (urlKeys.has(url)) continue;
                urlKeys.add(url);
                fromDb.push({
                    title: doc.title,
                    description: `${ADI_DOC_TYPE_LABELS[doc.docType as SearchResult['type']] ?? 'Document'} — ${doc.part} (local index)`,
                    url,
                    type: doc.docType as SearchResult['type'],
                    cached: true,
                });
            }
        }

        const merged: SearchResult[] = [...scraped, ...fromDb];

        const savedPart = exactPart;
        for (const r of merged) {
            insertDocument(this.vendorId, savedPart, r.title, r.type, normalizeAdiPdfUrl(r.url));
        }

        if (isAdiSearchDebug()) {
            console.error(`DEBUG [ADI]: merged scraped=${scraped.length} db=${fromDb.length} total=${merged.length}`);
        }

        return merged;
    }

    async readDoc(docIdOrUrl: string, meta?: ReadDocMeta): Promise<string> {
        const raw = docIdOrUrl.trim();
        const urlNoQuery = normalizeAdiPdfUrl(raw);
        const existing =
            getDocument(raw) ?? getDocument(urlNoQuery) ?? findDocumentByUrl(docIdOrUrl) ?? findDocumentByUrl(urlNoQuery);
        if (existing && hasChunks(existing.id)) {
            return `[CACHED] Document '${existing.title}' is already indexed.`;
        }

        const pdfBuffer = await fetchPdfBuffer(urlNoQuery, ADI_PDF_FETCH_OPTS);
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
            const docType = classifyAdiPdfUrl(urlNoQuery);
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
            console.error(`DEBUG [ADI]: Falling back to global search for '${query}'`);
            res = await searchChunks(query, { vendor: this.vendorId, docType, limit: lim });
        }
        return res;
    }

    override async lookupDoc(
        partQuery: string,
        question: string,
        _options?: { maxDocsToIndex?: number }
    ): Promise<LookupResult> {
        const steps: string[] = [];
        const tryQuery = async (): Promise<ChunkResult[]> =>
            this.queryContent(question, partQuery, undefined, 8);

        let chunks = await tryQuery();
        if (chunks.length > 0) {
            steps.push('query_existing_index');
            return { chunks, steps };
        }
        steps.push('no_prior_index_match');

        const docs = await this.searchDocs(partQuery);
        if (docs.length === 0) {
            steps.push('search_docs_empty');
            return {
                chunks: [],
                steps: [...steps, `No documents found for part '${partQuery}'.`],
            };
        }

        const filtered = adiExcludeNoiseForLookup(docs);
        const suggestedDocuments = capSuggestedDocuments(sortSearchResultsForLookup(question, filtered));
        steps.push('suggested_documents_only');
        steps.push('next_step_read_doc');
        return { chunks: [], steps, suggestedDocuments };
    }

    override async getDocumentPageText(
        docUrl: string,
        page: number,
        options?: { pageEnd?: number; maxChars?: number }
    ): Promise<DocumentPageResult> {
        const pageEnd = options?.pageEnd ?? page;
        const maxChars = Math.min(options?.maxChars ?? 120_000, 500_000);
        if (page < 1 || pageEnd < 1) {
            throw new Error('page and pageEnd must be >= 1');
        }
        const meta =
            findDocumentByUrl(docUrl) ??
            findDocumentByUrl(normalizeAdiPdfUrl(docUrl));
        if (!meta) {
            throw new Error(
                `No document in the index for this URL. Index it first with read_doc. URL: ${docUrl}`
            );
        }
        if (meta.vendor !== this.vendorId) {
            throw new Error(`Document vendor mismatch: expected ${this.vendorId}`);
        }
        if (!hasChunks(meta.id)) {
            throw new Error(`Document is not indexed yet: ${meta.title}`);
        }
        const { text, truncated, pageFrom, pageTo } = getIndexedTextForDocPages(
            meta.id,
            page,
            pageEnd,
            maxChars
        );
        if (!text.length) {
            throw new Error(
                `No indexed text for pages ${Math.min(page, pageEnd)}–${Math.max(page, pageEnd)} in "${meta.title}". ` +
                    `The page may be out of range, blank, or not extracted from the PDF.`
            );
        }
        return {
            docTitle: meta.title,
            docUrl: meta.url,
            pageFrom,
            pageTo,
            text,
            truncated,
            charCount: text.length,
        };
    }
}
