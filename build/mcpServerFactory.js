"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_VERSION = exports.SERVER_NAME = void 0;
exports.createMcpServer = createMcpServer;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const TexasInstrumentsProvider_js_1 = require("./providers/TexasInstrumentsProvider.js");
const StMicroelectronicsProvider_js_1 = require("./providers/StMicroelectronicsProvider.js");
const DocumentCache_js_1 = require("./cache/DocumentCache.js");
exports.SERVER_NAME = "electronics-docs-mcp-server";
exports.SERVER_VERSION = "2.5.0";
const RESOURCE_GUIDE_URI = "electronics-docs://guide/tool-usage";
// Providers are singletons — they hold the shared SQLite cache state
const tiProvider = new TexasInstrumentsProvider_js_1.TexasInstrumentsProvider();
const stProvider = new StMicroelectronicsProvider_js_1.StMicroelectronicsProvider();
const vendors = {
    [tiProvider.vendorId]: tiProvider,
    [stProvider.vendorId]: stProvider,
};
function loadToolUsageGuide() {
    const guidePath = path_1.default.join(__dirname, "resources", "tool-usage-guide.md");
    try {
        return fs_1.default.readFileSync(guidePath, "utf-8");
    }
    catch {
        return `# Tool usage guide\n\nGuide file not found at ${guidePath}. Rebuild the project so build/resources/tool-usage-guide.md exists.`;
    }
}
/**
 * Creates and returns a fully-configured MCP Server instance.
 *
 * Call this once for stdio mode, or once per request in HTTP stateless mode.
 * Providers (TI, ST) are module-level singletons and are shared across calls.
 */
function createMcpServer() {
    const server = new index_js_1.Server({ name: exports.SERVER_NAME, version: exports.SERVER_VERSION }, {
        capabilities: { tools: {}, resources: {} },
        instructions: "Electronics documentation MCP (TI, ST): see resource " +
            RESOURCE_GUIDE_URI +
            ". lookup_doc queries the local index only and returns suggestedDocuments when empty — it does NOT download PDFs; use read_doc to index. " +
            "After query_doc_content returns pageNum, use read_doc_page for full page text. " +
            "Tools: lookup_doc, search_docs, read_doc, query_doc_content, read_doc_page, list_indexed_documents.",
    });
    server.setRequestHandler(types_js_1.ListResourcesRequestSchema, async () => ({
        resources: [
            {
                uri: RESOURCE_GUIDE_URI,
                name: "Tool usage guide",
                description: "How to use lookup_doc and primitive tools; limits and best practices (Markdown).",
                mimeType: "text/markdown",
            },
        ],
    }));
    server.setRequestHandler(types_js_1.ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri;
        if (uri !== RESOURCE_GUIDE_URI) {
            throw new Error(`Unknown resource: ${uri}`);
        }
        return {
            contents: [
                {
                    uri: RESOURCE_GUIDE_URI,
                    mimeType: "text/markdown",
                    text: loadToolUsageGuide(),
                },
            ],
        };
    });
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "lookup_doc",
                description: "Part number + question: **FTS over the local index only** — does **not** download or index PDFs. " +
                    "If the index matches, returns **chunks**; otherwise returns **suggestedDocuments** (prioritized PDF URLs from the vendor site). " +
                    "Next step: **read_doc** on a chosen URL, then **query_doc_content**. " +
                    "TI symlink datasheets may be missing from suggestions — use **read_doc** if you already have the PDF URL. " +
                    "See resource " +
                    RESOURCE_GUIDE_URI +
                    ".",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: { type: "string", description: "Vendor ID (e.g., 'TI', 'ST')." },
                        part: {
                            type: "string",
                            description: "Part number (e.g., 'BQ40Z50', 'BQ40Z50-R2'). Revision suffixes are normalized.",
                        },
                        question: {
                            type: "string",
                            description: "What to find: keywords, register hex (e.g. 0x51), signal names, parameters.",
                        },
                        maxDocsToIndex: {
                            type: "number",
                            description: "Ignored (legacy). Lookup does not index PDFs; use read_doc.",
                        },
                    },
                    required: ["vendor", "part", "question"],
                },
            },
            {
                name: "search_docs",
                description: "**Primitive**: list PDF links (datasheet, TRM, app notes) for a part from the vendor site. " +
                    "Does not index. After lookup returns only suggestions, you can use this for a fuller link list.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: { type: "string", description: "Vendor ID (e.g., 'TI', 'ST')." },
                        query: {
                            type: "string",
                            description: "Part number or search term (e.g., 'LM317', 'BQ40Z50', 'BQ40Z50-R5').",
                        },
                    },
                    required: ["vendor", "query"],
                },
            },
            {
                name: "read_doc",
                description: "Download and index a PDF by **direct URL** (required for TI `/lit/ds/symlink/....pdf` links and any PDF not found via lookup). " +
                    "Often works better than lookup when you already have the exact PDF link. " +
                    "Pass **part** when known. Then use query_doc_content or read_doc_page.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: { type: "string", description: "Vendor ID (e.g., 'TI', 'ST')." },
                        docIdOrUrl: { type: "string", description: "PDF URL to download and index." },
                        part: {
                            type: "string",
                            description: "Optional part number for metadata (strongly recommended; avoids UNKNOWN part rows).",
                        },
                        title: {
                            type: "string",
                            description: "Optional document title for metadata.",
                        },
                    },
                    required: ["vendor", "docIdOrUrl"],
                },
            },
            {
                name: "query_doc_content",
                description: "BM25 full-text search over indexed chunks. Each hit includes **docUrl** and **pageNum** — use them with **read_doc_page** for full page text. " +
                    "Requires PDFs indexed via **read_doc** (lookup alone does not index).",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: { type: "string", description: "Vendor ID (e.g., 'TI', 'ST')." },
                        query: {
                            type: "string",
                            description: "The text to search for within indexed documents " +
                                "(e.g., 'VCELL register', 'SoC calculation', 'maximum input voltage').",
                        },
                        part: {
                            type: "string",
                            description: "Optional: restrict search to documents for a specific part number (e.g., 'BQ40Z50').",
                        },
                        docType: {
                            type: "string",
                            enum: [
                                "datasheet",
                                "user_guide",
                                "application_note",
                                "errata",
                                "other",
                            ],
                            description: "Optional: restrict search to a specific document type " +
                                "('user_guide' for TRMs, 'datasheet' for electrical specs).",
                        },
                        limit: {
                            type: "number",
                            description: "Max number of results to return (default: 8, max: 20).",
                        },
                    },
                    required: ["vendor", "query"],
                },
            },
            {
                name: "read_doc_page",
                description: "Return **full indexed plain text** for one PDF page or a **page range** (after query_doc_content gives you pageNum). " +
                    "Requires the document to already be indexed. Pass **docUrl** exactly as in search results (or the PDF URL used with read_doc). " +
                    "Use this when snippets are too short for tables or register maps.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: { type: "string", description: "Vendor ID (e.g., 'TI', 'ST')." },
                        docUrl: {
                            type: "string",
                            description: "PDF document URL as returned by search_docs / query_doc_content (doc is identified by URL).",
                        },
                        page: {
                            type: "number",
                            description: "1-based PDF page number (same numbering as query_doc_content pageNum).",
                        },
                        pageEnd: {
                            type: "number",
                            description: "Optional inclusive end page for a range. If omitted, only **page** is returned.",
                        },
                        maxChars: {
                            type: "number",
                            description: "Max characters of text to return (default 120000, hard cap 500000). Truncation sets truncated=true in the JSON.",
                        },
                    },
                    required: ["vendor", "docUrl", "page"],
                },
            },
            {
                name: "list_indexed_documents",
                description: "List **indexed** PDF metadata from the local database (no web fetch). " +
                    "Returns **count** and **documents** (id, part, title, docType, url, indexedAt). " +
                    "Optional **part** filters to that part number (normalized like other tools). " +
                    "Omit **part** to list all documents for the vendor.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: { type: "string", description: "Vendor ID: **TI** or **ST**." },
                        part: {
                            type: "string",
                            description: "Optional part number (e.g. **STM32G071RB**). If omitted, all indexed docs for the vendor are returned.",
                        },
                    },
                    required: ["vendor"],
                },
            },
        ],
    }));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        if (!args) {
            throw new Error("Missing arguments");
        }
        if (name === "list_indexed_documents") {
            const vendorRaw = args.vendor?.trim();
            if (!vendorRaw) {
                return { isError: true, content: [{ type: "text", text: "Missing vendor." }] };
            }
            const v = vendorRaw.toUpperCase();
            if (v !== "TI" && v !== "ST") {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Vendor must be TI or ST." }],
                };
            }
            const partArg = args.part;
            const documents = (0, DocumentCache_js_1.listIndexedDocuments)(v, partArg);
            return {
                isError: false,
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            vendor: v,
                            partFilter: partArg?.trim() || null,
                            count: documents.length,
                            documents,
                        }, null, 2),
                    },
                ],
            };
        }
        const vendorId = args.vendor;
        const provider = vendors[vendorId];
        if (!provider) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Vendor '${vendorId}' is not supported. Supported vendors: ${Object.keys(vendors).join(", ")}`,
                    },
                ],
            };
        }
        try {
            if (name === "lookup_doc") {
                const part = args.part;
                const question = args.question;
                const maxRaw = args.maxDocsToIndex;
                const maxDocsToIndex = maxRaw !== undefined
                    ? Math.min(Math.max(Math.floor(maxRaw), 1), 5)
                    : undefined;
                const result = await provider.lookupDoc(part, question, { maxDocsToIndex });
                return {
                    isError: false,
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            if (name === "search_docs") {
                const query = args.query;
                const results = await provider.searchDocs(query);
                if (results.length === 0) {
                    return {
                        isError: false,
                        content: [
                            {
                                type: "text",
                                text: `No documents found for '${query}'. Try a simpler part number (e.g., without revision suffix).`,
                            },
                        ],
                    };
                }
                return {
                    isError: false,
                    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                };
            }
            if (name === "read_doc") {
                const docIdOrUrl = args.docIdOrUrl;
                const part = args.part;
                const title = args.title;
                const content = await provider.readDoc(docIdOrUrl, { part, title });
                return { isError: false, content: [{ type: "text", text: content }] };
            }
            if (name === "query_doc_content") {
                const query = args.query;
                const part = args.part;
                const docType = args.docType;
                const limit = Math.min(args.limit ?? 8, 20);
                const results = await provider.queryContent(query, part, docType, limit);
                if (results.length === 0) {
                    return {
                        isError: false,
                        content: [
                            {
                                type: "text",
                                text: `No indexed content matched '${query}'.` +
                                    (part ? ` (part: ${part})` : "") +
                                    `\n\nTip: read_doc to index a PDF; lookup_doc only suggests URLs until you read.`,
                            },
                        ],
                    };
                }
                return {
                    isError: false,
                    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
                };
            }
            if (name === "read_doc_page") {
                const docUrl = args.docUrl;
                const page = Number(args.page);
                const pageEnd = args.pageEnd !== undefined ? Number(args.pageEnd) : undefined;
                const maxChars = args.maxChars !== undefined ? Number(args.maxChars) : undefined;
                if (!Number.isFinite(page) || page < 1) {
                    return {
                        isError: true,
                        content: [
                            { type: "text", text: "Invalid page: must be a number >= 1." },
                        ],
                    };
                }
                if (pageEnd !== undefined && (!Number.isFinite(pageEnd) || pageEnd < 1)) {
                    return {
                        isError: true,
                        content: [
                            { type: "text", text: "Invalid pageEnd: must be a number >= 1." },
                        ],
                    };
                }
                const result = await provider.getDocumentPageText(docUrl, Math.floor(page), {
                    pageEnd: pageEnd !== undefined ? Math.floor(pageEnd) : undefined,
                    maxChars: maxChars !== undefined && Number.isFinite(maxChars)
                        ? Math.min(Math.max(Math.floor(maxChars), 1000), 500_000)
                        : undefined,
                });
                return {
                    isError: false,
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            throw new Error(`Unknown tool: ${name}`);
        }
        catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error executing '${name}': ${error.message}`,
                    },
                ],
            };
        }
    });
    return server;
}
