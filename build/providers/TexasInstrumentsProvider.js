"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TexasInstrumentsProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const VendorProvider_1 = require("./VendorProvider");
const DocumentCache_1 = require("../cache/DocumentCache");
const lookupRanking_1 = require("./lookupRanking");
const pdfExtract_1 = require("./pdfExtract");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cheerio = require('cheerio');
const TI_DOC_TYPE_MAP = {
    ds: 'datasheet',
    ug: 'user_guide',
    an: 'application_note',
    er: 'errata',
    wp: 'other',
    ml: 'other',
    sg: 'other',
    sn: 'application_note',
};
const TI_DOC_TYPE_LABELS = {
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
function resolveTiHref(href) {
    const h = href.trim();
    if (h.startsWith('http://') || h.startsWith('https://')) {
        return h;
    }
    return new URL(h, 'https://www.ti.com/').href;
}
function parsePartNumber(query) {
    const upper = query.trim().toUpperCase();
    const revMatch = upper.match(/^(.+?)(-R?\d+)$/);
    if (revMatch) {
        return { basePart: revMatch[1], exactPart: upper, revision: revMatch[2] };
    }
    return { basePart: upper, exactPart: upper, revision: null };
}
function extractDocType(litPath) {
    const match = litPath.match(/\/lit\/([a-z]+)\//i);
    if (match) {
        return TI_DOC_TYPE_MAP[match[1].toLowerCase()] ?? 'other';
    }
    return 'other';
}
class TexasInstrumentsProvider extends VendorProvider_1.VendorProvider {
    vendorId = 'TI';
    vendorName = 'Texas Instruments';
    async searchDocs(query) {
        const { basePart, exactPart, revision } = parsePartNumber(query);
        console.error(`DEBUG: Searching for part: ${exactPart}`);
        let cached = (0, DocumentCache_1.getDocumentsByPart)(this.vendorId, exactPart);
        if (cached.length === 0 && revision) {
            cached = (0, DocumentCache_1.getDocumentsByPart)(this.vendorId, basePart);
        }
        if (cached.length > 0) {
            return cached.map(doc => ({
                title: doc.title,
                description: `${TI_DOC_TYPE_LABELS[doc.docType] ?? 'Document'} — ${doc.part}`,
                url: (0, DocumentCache_1.normalizeTiDocumentUrl)(doc.url),
                type: doc.docType,
                cached: true,
            }));
        }
        const results = await this.scrapeProductPage(exactPart, revision);
        // Save metadata
        const savedPart = results.length > 0 && results[0].url.toLowerCase().includes(exactPart.toLowerCase()) ? exactPart : basePart;
        for (const r of results) {
            (0, DocumentCache_1.insertDocument)(this.vendorId, savedPart, r.title, r.type, r.url);
        }
        return results;
    }
    async scrapeProductPage(basePart, revision) {
        const url = `https://www.ti.com/product/${basePart}`;
        try {
            const response = await axios_1.default.get(url, { headers: pdfExtract_1.HEADERS_HTML, timeout: 10000 });
            const $ = cheerio.load(response.data);
            const results = [];
            const seen = new Set();
            $('a[href*="/lit/"]').each((_, el) => {
                const href = $(el).attr('href') ?? '';
                if (href.includes('/html/') || href.includes('document-viewer'))
                    return;
                const absUrl = resolveTiHref(href);
                const cleanUrl = absUrl.split('?')[0];
                if (seen.has(cleanUrl))
                    return;
                let rawTitle = $(el).text().trim().replace(/\s+/g, ' ');
                if (rawTitle.startsWith('document-pdfAcrobat ')) {
                    rawTitle = rawTitle.replace('document-pdfAcrobat ', '').trim();
                }
                if (!rawTitle || rawTitle.toLowerCase() === 'pdf')
                    return;
                seen.add(cleanUrl);
                let docType = 'other';
                const lowerTitle = rawTitle.toLowerCase();
                if (lowerTitle.includes('datasheet'))
                    docType = 'datasheet';
                else if (lowerTitle.includes('manual') || lowerTitle.includes('user guide') || lowerTitle.includes('technical reference'))
                    docType = 'user_guide';
                else if (lowerTitle.includes('application'))
                    docType = 'application_note';
                results.push({
                    title: rawTitle,
                    description: `${TI_DOC_TYPE_LABELS[docType] || 'Document'} for ${basePart}`,
                    url: (0, DocumentCache_1.normalizeTiDocumentUrl)(absUrl),
                    type: docType,
                    cached: false,
                });
            });
            return results;
        }
        catch {
            return [];
        }
    }
    async readDoc(docIdOrUrl, meta) {
        const raw = docIdOrUrl.trim();
        const url = (0, DocumentCache_1.normalizeTiDocumentUrl)(raw);
        const existing = (0, DocumentCache_1.getDocument)(raw) ?? (0, DocumentCache_1.getDocument)(url) ?? (0, DocumentCache_1.findDocumentByUrl)(docIdOrUrl);
        if (existing && (0, DocumentCache_1.hasChunks)(existing.id)) {
            return `[CACHED] Document '${existing.title}' is already indexed.`;
        }
        const pdfBuffer = await (0, pdfExtract_1.fetchPdfBuffer)(url);
        const pages = await (0, pdfExtract_1.extractPdfPages)(pdfBuffer);
        const partForRow = meta?.part?.trim().toUpperCase() ?? 'UNKNOWN';
        const titleForRow = meta?.title ?? existing?.title ?? 'Document';
        let docId;
        if (existing) {
            docId = existing.id;
            if (meta?.part) {
                (0, DocumentCache_1.updateDocumentPartIfUnknown)(url, meta.part);
            }
        }
        else {
            const docType = extractDocType(url);
            docId = (0, DocumentCache_1.insertDocument)(this.vendorId, partForRow, titleForRow, docType, url);
        }
        (0, DocumentCache_1.indexChunks)(docId, pages);
        return `Indexed ${pages.length} pages from ${url}`;
    }
    async queryContent(query, part, docType, limit) {
        const lim = limit ?? 8;
        if (!part) {
            return (0, DocumentCache_1.searchChunks)(query, { vendor: this.vendorId, docType, limit: lim });
        }
        const { basePart, exactPart } = parsePartNumber(part);
        let res = await (0, DocumentCache_1.searchChunks)(query, {
            vendor: this.vendorId,
            part: basePart,
            docType,
            limit: lim,
        });
        if (res.length === 0 && exactPart !== basePart) {
            res = await (0, DocumentCache_1.searchChunks)(query, {
                vendor: this.vendorId,
                part: exactPart,
                docType,
                limit: lim,
            });
        }
        if (res.length === 0) {
            console.error(`DEBUG: Falling back to global search for '${query}'`);
            res = await (0, DocumentCache_1.searchChunks)(query, { vendor: this.vendorId, docType, limit: lim });
        }
        return res;
    }
    async lookupDoc(partQuery, question, _options) {
        const steps = [];
        const tryQuery = async () => this.queryContent(question, partQuery, undefined, 8);
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
        const suggestedDocuments = (0, lookupRanking_1.capSuggestedDocuments)((0, lookupRanking_1.sortSearchResultsForLookup)(question, docs));
        steps.push('suggested_documents_only');
        steps.push('next_step_read_doc');
        return { chunks: [], steps, suggestedDocuments };
    }
    async getDocumentPageText(docUrl, page, options) {
        const pageEnd = options?.pageEnd ?? page;
        const maxChars = Math.min(options?.maxChars ?? 120_000, 500_000);
        if (page < 1 || pageEnd < 1) {
            throw new Error('page and pageEnd must be >= 1');
        }
        const meta = (0, DocumentCache_1.findDocumentByUrl)(docUrl);
        if (!meta) {
            throw new Error(`No document in the index for this URL. Index it first with read_doc. URL: ${docUrl}`);
        }
        if (meta.vendor !== this.vendorId) {
            throw new Error(`Document vendor mismatch: expected ${this.vendorId}`);
        }
        if (!(0, DocumentCache_1.hasChunks)(meta.id)) {
            throw new Error(`Document is not indexed yet: ${meta.title}`);
        }
        const { text, truncated, pageFrom, pageTo } = (0, DocumentCache_1.getIndexedTextForDocPages)(meta.id, page, pageEnd, maxChars);
        if (!text.length) {
            throw new Error(`No indexed text for pages ${Math.min(page, pageEnd)}–${Math.max(page, pageEnd)} in "${meta.title}". ` +
                `The page may be out of range, blank, or not extracted from the PDF.`);
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
exports.TexasInstrumentsProvider = TexasInstrumentsProvider;
