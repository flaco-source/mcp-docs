import fs from "fs";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { VendorProvider } from "./providers/VendorProvider.js";
import { TexasInstrumentsProvider } from "./providers/TexasInstrumentsProvider.js";
import { StMicroelectronicsProvider } from "./providers/StMicroelectronicsProvider.js";

const RESOURCE_GUIDE_URI = "electronics-docs://guide/tool-usage";

function loadToolUsageGuide(): string {
    const guidePath = path.join(__dirname, "resources", "tool-usage-guide.md");
    try {
        return fs.readFileSync(guidePath, "utf-8");
    } catch {
        return `# Tool usage guide\n\nGuide file not found at ${guidePath}. Rebuild the project so build/resources/tool-usage-guide.md exists.`;
    }
}

const server = new Server(
    {
        name: "electronics-docs-mcp-server",
        version: "2.2.0",
    },
    {
        capabilities: {
            tools: {},
            resources: {},
        },
        instructions:
            "Electronics documentation MCP: see resource " +
            RESOURCE_GUIDE_URI +
            " for when to use lookup_electronics_doc vs read_electronics_doc (direct PDF URLs). " +
            "After search returns a page number, use read_electronics_doc_page for full page text. " +
            "Tools: lookup_electronics_doc, search_electronics_docs, read_electronics_doc, query_doc_content, read_electronics_doc_page.",
    }
);

const tiProvider = new TexasInstrumentsProvider();
const stProvider = new StMicroelectronicsProvider();

const vendors: Record<string, VendorProvider> = {
    [tiProvider.vendorId]: tiProvider,
    [stProvider.vendorId]: stProvider,
};

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [
            {
                uri: RESOURCE_GUIDE_URI,
                name: "Tool usage guide",
                description:
                    "How to use lookup_electronics_doc and primitive tools; limits and best practices (Markdown).",
                mimeType: "text/markdown",
            },
        ],
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "lookup_electronics_doc",
                description:
                    "Orchestrated search for a **part number**: queries the index, then discovers PDFs from the TI **product page** if needed. " +
                    "Does **not** use arbitrary direct datasheet URLs (e.g. `/lit/ds/symlink/...pdf`); for those, call **read_electronics_doc** with the URL first. " +
                    "After you have a **page number** from search results, use **read_electronics_doc_page** for full page text. " +
                    "See MCP resource " +
                    RESOURCE_GUIDE_URI +
                    ".",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: {
                            type: "string",
                            description: "Vendor ID (e.g., 'TI', 'ST').",
                        },
                        part: {
                            type: "string",
                            description:
                                "Part number (e.g., 'BQ40Z50', 'BQ40Z50-R2'). Revision suffixes are normalized.",
                        },
                        question: {
                            type: "string",
                            description:
                                "What to find: keywords, register hex (e.g. 0x51), signal names, parameters.",
                        },
                        maxDocsToIndex: {
                            type: "number",
                            description:
                                "Max PDFs to download/index in this call if the index had no match (default 3, max 5).",
                        },
                    },
                    required: ["vendor", "part", "question"],
                },
            },
            {
                name: "search_electronics_docs",
                description:
                    "**Primitive**: list PDF links (datasheet, TRM, app notes) for a part from the vendor site. " +
                    "Does not index or answer questions by itself. Prefer lookup_electronics_doc for end-user queries.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: {
                            type: "string",
                            description: "Vendor ID (e.g., 'TI', 'ST').",
                        },
                        query: {
                            type: "string",
                            description: "Part number or search term (e.g., 'LM317', 'BQ40Z50', 'BQ40Z50-R5').",
                        },
                    },
                    required: ["vendor", "query"],
                },
            },
            {
                name: "read_electronics_doc",
                description:
                    "Download and index a PDF by **direct URL** (required for TI `/lit/ds/symlink/....pdf` links and any PDF not found via lookup). " +
                    "Often works better than lookup when you already have the exact PDF link. " +
                    "Pass **part** when known. Then use query_doc_content or read_electronics_doc_page.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: {
                            type: "string",
                            description: "Vendor ID (e.g., 'TI', 'ST').",
                        },
                        docIdOrUrl: {
                            type: "string",
                            description: "PDF URL to download and index.",
                        },
                        part: {
                            type: "string",
                            description:
                                "Optional part number for metadata (strongly recommended; avoids UNKNOWN part rows).",
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
                description:
                    "BM25 full-text search over indexed chunks. Each hit includes **docUrl** and **pageNum** — use them with **read_electronics_doc_page** for full page text. " +
                    "Requires PDFs to be indexed first (read_electronics_doc or lookup_electronics_doc).",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: {
                            type: "string",
                            description: "Vendor ID (e.g., 'TI', 'ST').",
                        },
                        query: {
                            type: "string",
                            description:
                                "The text to search for within indexed documents " +
                                "(e.g., 'VCELL register', 'SoC calculation', 'maximum input voltage').",
                        },
                        part: {
                            type: "string",
                            description:
                                "Optional: restrict search to documents for a specific part number (e.g., 'BQ40Z50').",
                        },
                        docType: {
                            type: "string",
                            enum: ["datasheet", "user_guide", "application_note", "errata", "other"],
                            description:
                                "Optional: restrict search to a specific document type " +
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
                name: "read_electronics_doc_page",
                description:
                    "Return **full indexed plain text** for one PDF page or a **page range** (after query_doc_content / lookup gives you pageNum). " +
                    "Requires the document to already be indexed. Pass **docUrl** exactly as in search results (or the PDF URL used with read_electronics_doc). " +
                    "Use this when snippets are too short for tables or register maps.",
                inputSchema: {
                    type: "object",
                    properties: {
                        vendor: {
                            type: "string",
                            description: "Vendor ID (e.g., 'TI', 'ST').",
                        },
                        docUrl: {
                            type: "string",
                            description:
                                "PDF document URL as returned by search_electronics_docs / query_doc_content (doc is identified by URL).",
                        },
                        page: {
                            type: "number",
                            description: "1-based PDF page number (same numbering as query_doc_content pageNum).",
                        },
                        pageEnd: {
                            type: "number",
                            description:
                                "Optional inclusive end page for a range. If omitted, only **page** is returned.",
                        },
                        maxChars: {
                            type: "number",
                            description:
                                "Max characters of text to return (default 120000, hard cap 500000). Truncation sets truncated=true in the JSON.",
                        },
                    },
                    required: ["vendor", "docUrl", "page"],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
        throw new Error("Missing arguments");
    }

    const vendorId = args.vendor as string;
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
        if (name === "lookup_electronics_doc") {
            const part = args.part as string;
            const question = args.question as string;
            const maxRaw = args.maxDocsToIndex as number | undefined;
            const maxDocsToIndex =
                maxRaw !== undefined ? Math.min(Math.max(Math.floor(maxRaw), 1), 5) : undefined;

            const result = await provider.lookupDoc(part, question, { maxDocsToIndex });

            return {
                isError: false,
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }

        if (name === "search_electronics_docs") {
            const query = args.query as string;
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
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(results, null, 2),
                    },
                ],
            };
        }

        if (name === "read_electronics_doc") {
            const docIdOrUrl = args.docIdOrUrl as string;
            const part = args.part as string | undefined;
            const title = args.title as string | undefined;
            const content = await provider.readDoc(docIdOrUrl, { part, title });
            return {
                isError: false,
                content: [{ type: "text", text: content }],
            };
        }

        if (name === "query_doc_content") {
            const query = args.query as string;
            const part = args.part as string | undefined;
            const docType = args.docType as string | undefined;
            const limit = Math.min((args.limit as number | undefined) ?? 8, 20);

            const results = await provider.queryContent(query, part, docType, limit);

            if (results.length === 0) {
                return {
                    isError: false,
                    content: [
                        {
                            type: "text",
                            text:
                                `No indexed content matched '${query}'.` +
                                (part ? ` (part: ${part})` : "") +
                                `\n\nTip: use lookup_electronics_doc, or read_electronics_doc to index a PDF first.`,
                        },
                    ],
                };
            }

            return {
                isError: false,
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(results, null, 2),
                    },
                ],
            };
        }

        if (name === "read_electronics_doc_page") {
            const docUrl = args.docUrl as string;
            const page = Number(args.page);
            const pageEnd = args.pageEnd !== undefined ? Number(args.pageEnd) : undefined;
            const maxChars = args.maxChars !== undefined ? Number(args.maxChars) : undefined;

            if (!Number.isFinite(page) || page < 1) {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Invalid page: must be a number >= 1." }],
                };
            }
            if (pageEnd !== undefined && (!Number.isFinite(pageEnd) || pageEnd < 1)) {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Invalid pageEnd: must be a number >= 1." }],
                };
            }

            const result = await provider.getDocumentPageText(docUrl, Math.floor(page), {
                pageEnd: pageEnd !== undefined ? Math.floor(pageEnd) : undefined,
                maxChars:
                    maxChars !== undefined && Number.isFinite(maxChars)
                        ? Math.min(Math.max(Math.floor(maxChars), 1000), 500_000)
                        : undefined,
            });

            return {
                isError: false,
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (error: any) {
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

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Electronics Docs MCP Server v2.2 running on stdio (tools + resources)");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
