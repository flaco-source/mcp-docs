"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VendorProvider = void 0;
class VendorProvider {
    /**
     * Orchestrated flow: query index, discover docs if needed, index PDFs, then search again.
     * Override in vendors that support it; default throws.
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
