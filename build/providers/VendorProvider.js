"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VendorProvider = void 0;
class VendorProvider {
    /**
     * Query local FTS first; if no hits, discover PDF links via searchDocs and return suggestedDocuments
     * (does not download or index — use read_electronics_doc). maxDocsToIndex in options is ignored.
     */
    async lookupDoc(_partQuery, _question, _options) {
        throw new Error(`Orchestrated lookup is not implemented for vendor '${this.vendorId}'.`);
    }
    /**
     * Return concatenated indexed text for PDF page(s). Document must already be indexed.
     */
    async getDocumentPageText(_docUrl, _page, _options) {
        throw new Error(`getDocumentPageText is not implemented for vendor '${this.vendorId}'.`);
    }
}
exports.VendorProvider = VendorProvider;
