import { ChunkResult } from '../cache/DocumentCache';

/** Optional metadata when indexing a PDF so part filters work in query_doc_content. */
export interface ReadDocMeta {
    part?: string;
    title?: string;
}

/** Result of orchestrated search + optional indexing + query (lookup_electronics_doc). */
export interface LookupResult {
    chunks: ChunkResult[];
    steps: string[];
    indexedUrls?: string[];
}

/** Full indexed text for one or more PDF pages (read_electronics_doc_page). */
export interface DocumentPageResult {
    docTitle: string;
    docUrl: string;
    pageFrom: number;
    pageTo: number;
    text: string;
    truncated: boolean;
    charCount: number;
}

export interface SearchResult {
    title: string;
    description: string;
    url: string;
    type: 'datasheet' | 'application_note' | 'user_guide' | 'errata' | 'other';
    cached: boolean;
}

export abstract class VendorProvider {
    /** Unique short identifier for the vendor (e.g., 'TI', 'ST'). */
    abstract readonly vendorId: string;

    /** Human-readable vendor name. */
    abstract readonly vendorName: string;

    /**
     * Search for all relevant documents for a given part number or query.
     * Returns a list of found documents (datasheets, TRMs, app notes, etc.).
     * @param query Part number or search term (e.g., 'LM317', 'BQ40Z50-R5')
     */
    abstract searchDocs(query: string): Promise<SearchResult[]>;

    /**
     * Download, extract text, and index a document from its URL or part ID.
     * @param docIdOrUrl URL or identifier (e.g., part number for a direct datasheet)
     * @param meta Optional part/title for DB rows (avoids UNKNOWN part when filtering by part)
     */
    abstract readDoc(docIdOrUrl: string, meta?: ReadDocMeta): Promise<string>;

    /**
     * Search within already-indexed document chunks for the most relevant content.
     * Uses FTS5 full-text search with BM25 relevance scoring.
     * @param query The text to search for within indexed documents (e.g., 'VCELL register voltage')
     * @param part  Optional: restrict results to a specific part number
     * @param docType Optional: restrict by document type ('datasheet', 'user_guide', etc.)
     * @param limit  Max number of results (default 8)
     */
    abstract queryContent(
        query: string,
        part?: string,
        docType?: string,
        limit?: number
    ): Promise<ChunkResult[]>;

    /**
     * Orchestrated flow: query index, discover docs if needed, index PDFs, then search again.
     * Override in vendors that support it; default throws.
     */
    async lookupDoc(
        _partQuery: string,
        _question: string,
        _options?: { maxDocsToIndex?: number }
    ): Promise<LookupResult> {
        throw new Error(`Orchestrated lookup is not implemented for vendor '${this.vendorId}'.`);
    }

    /**
     * Return concatenated indexed text for PDF page(s). Document must already be indexed.
     */
    async getDocumentPageText(
        _docUrl: string,
        _page: number,
        _options?: { pageEnd?: number; maxChars?: number }
    ): Promise<DocumentPageResult> {
        throw new Error(`getDocumentPageText is not implemented for vendor '${this.vendorId}'.`);
    }
}
