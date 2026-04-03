"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOOKUP_SUGGESTED_MAX = void 0;
exports.sortSearchResultsForLookup = sortSearchResultsForLookup;
exports.capSuggestedDocuments = capSuggestedDocuments;
/** Max PDFs to return in lookup_doc suggestedDocuments (metadata only; no download). */
exports.LOOKUP_SUGGESTED_MAX = 25;
/**
 * Order search hits for lookup suggestions: TRM-first for register-style questions, else datasheet-first.
 */
function sortSearchResultsForLookup(question, docs) {
    const q = question.toLowerCase();
    const prefersTRM = /0x|register|bitfield|bit\b|address|trm|manual|reference|memory map|subsystem|command|i2c|smbus/i.test(q);
    const rank = (t) => {
        if (prefersTRM) {
            if (t === 'user_guide')
                return 0;
            if (t === 'datasheet')
                return 1;
            if (t === 'application_note')
                return 2;
            return 3;
        }
        if (t === 'datasheet')
            return 0;
        if (t === 'user_guide')
            return 1;
        if (t === 'application_note')
            return 2;
        return 3;
    };
    return [...docs].sort((a, b) => rank(a.type) - rank(b.type));
}
function capSuggestedDocuments(docs) {
    return docs.slice(0, exports.LOOKUP_SUGGESTED_MAX);
}
