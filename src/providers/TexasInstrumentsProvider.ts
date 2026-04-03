
import axios from 'axios';
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
    normalizeTiDocumentUrl,
} from '../cache/DocumentCache';
import { sortSearchResultsForLookup, capSuggestedDocuments } from './lookupRanking';
import { HEADERS_HTML, fetchPdfBuffer, extractPdfPages } from './pdfExtract';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cheerio = require('cheerio');

const TI_DOC_TYPE_MAP: Record<string, SearchResult['type']> = {
    ds: 'datasheet',
    ug: 'user_guide',
    an: 'application_note',
    er: 'errata',
    wp: 'other',
    ml: 'other',
    sg: 'other',
    sn: 'application_note',
};

const TI_DOC_TYPE_LABELS: Record<SearchResult['type'], string> = {
    datasheet: 'Datasheet',
    user_guide: 'Technical Reference Manual / User Guide',
    application_note: 'Application Note',
    errata: 'Errata',
    other: 'Document',
};

/**
 * Resolve TI page links: handles `/lit/...`, `//www.ti.com/...`, and full https URLs.
 * Avoids `https://www.ti.com//www.ti.com/...` when href is protocol-relative.
 */
function resolveTiHref(href: string): string {
    const h = href.trim();
    if (h.startsWith('http://') || h.startsWith('https://')) {
        return h;
    }
    return new URL(h, 'https://www.ti.com/').href;
}

function parsePartNumber(query: string): { basePart: string; exactPart: string; revision: string | null } {
    const upper = query.trim().toUpperCase();
    const revMatch = upper.match(/^(.+?)(-R?\d+)$/);
    if (revMatch) {
        return { basePart: revMatch[1], exactPart: upper, revision: revMatch[2] };
    }
    return { basePart: upper, exactPart: upper, revision: null };
}

function extractDocType(litPath: string): SearchResult['type'] {
    const match = litPath.match(/\/lit\/([a-z]+)\//i);
    if (match) {
        return TI_DOC_TYPE_MAP[match[1].toLowerCase()] ?? 'other';
    }
    return 'other';
}

export class TexasInstrumentsProvider extends VendorProvider {
    readonly vendorId = 'TI';
    readonly vendorName = 'Texas Instruments';

    async searchDocs(query: string): Promise<SearchResult[]> {
        const { basePart, exactPart, revision } = parsePartNumber(query);
        console.error(`DEBUG: Searching for part: ${exactPart}`);

        let cached = getDocumentsByPart(this.vendorId, exactPart);
        if (cached.length === 0 && revision) {
            cached = getDocumentsByPart(this.vendorId, basePart);
        }
        if (cached.length > 0) {
            return cached.map(doc => ({
                title: doc.title,
                description: `${TI_DOC_TYPE_LABELS[doc.docType as SearchResult['type']] ?? 'Document'} — ${doc.part}`,
                url: normalizeTiDocumentUrl(doc.url),
                type: doc.docType as SearchResult['type'],
                cached: true,
            }));
        }

        const results = await this.scrapeProductPage(exactPart, revision);

        // Save metadata
        const savedPart = results.length > 0 && results[0].url.toLowerCase().includes(exactPart.toLowerCase()) ? exactPart : basePart;
        for (const r of results) {
            insertDocument(this.vendorId, savedPart, r.title, r.type, r.url);
        }

        return results;
    }

    private async scrapeProductPage(basePart: string, revision: string | null): Promise<SearchResult[]> {
        const url = `https://www.ti.com/product/${basePart}`;
        try {
            const response = await axios.get(url, { headers: HEADERS_HTML, timeout: 10000 });
            const $ = cheerio.load(response.data);
            const results: SearchResult[] = [];
            const seen = new Set<string>();

            $('a[href*="/lit/"]').each((_: any, el: any) => {
                const href: string = $(el).attr('href') ?? '';
                if (href.includes('/html/') || href.includes('document-viewer')) return;

                const absUrl = resolveTiHref(href);
                const cleanUrl = absUrl.split('?')[0];

                if (seen.has(cleanUrl)) return;

                let rawTitle = $(el).text().trim().replace(/\s+/g, ' ');
                if (rawTitle.startsWith('document-pdfAcrobat ')) {
                    rawTitle = rawTitle.replace('document-pdfAcrobat ', '').trim();
                }

                if (!rawTitle || rawTitle.toLowerCase() === 'pdf') return;

                seen.add(cleanUrl);

                let docType: SearchResult['type'] = 'other';
                const lowerTitle = rawTitle.toLowerCase();
                if (lowerTitle.includes('datasheet')) docType = 'datasheet';
                else if (lowerTitle.includes('manual') || lowerTitle.includes('user guide') || lowerTitle.includes('technical reference')) docType = 'user_guide';
                else if (lowerTitle.includes('application')) docType = 'application_note';

                results.push({
                    title: rawTitle,
                    description: `${TI_DOC_TYPE_LABELS[docType] || 'Document'} for ${basePart}`,
                    url: normalizeTiDocumentUrl(absUrl),
                    type: docType,
                    cached: false,
                });
            });

            return results;
        } catch {
            return [];
        }
    }

    async readDoc(docIdOrUrl: string, meta?: ReadDocMeta): Promise<string> {
        const raw = docIdOrUrl.trim();
        const url = normalizeTiDocumentUrl(raw);
        const existing = getDocument(raw) ?? getDocument(url) ?? findDocumentByUrl(docIdOrUrl);
        if (existing && hasChunks(existing.id)) {
            return `[CACHED] Document '${existing.title}' is already indexed.`;
        }

        const pdfBuffer = await fetchPdfBuffer(url);

        const pages = await extractPdfPages(pdfBuffer);

        const partForRow = meta?.part?.trim().toUpperCase() ?? 'UNKNOWN';
        const titleForRow = meta?.title ?? existing?.title ?? 'Document';

        let docId: number;
        if (existing) {
            docId = existing.id;
            if (meta?.part) {
                updateDocumentPartIfUnknown(url, meta.part);
            }
        } else {
            const docType = extractDocType(url);
            docId = insertDocument(this.vendorId, partForRow, titleForRow, docType, url);
        }

        indexChunks(docId, pages);
        return `Indexed ${pages.length} pages from ${url}`;
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
            console.error(`DEBUG: Falling back to global search for '${query}'`);
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

        const suggestedDocuments = capSuggestedDocuments(sortSearchResultsForLookup(question, docs));
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
        const meta = findDocumentByUrl(docUrl);
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
