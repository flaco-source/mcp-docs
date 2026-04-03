/**
 * Agent-flow smoke tests: --tool <mode> --vendor TI|ST
 * Set RUN_E2E_NETWORK to true to run read/query/page network-heavy steps in `read`, `query`, `page`, `flow`, and `all`.
 */
import path from "path";
import fs from "fs";
import { TexasInstrumentsProvider } from "../../src/providers/TexasInstrumentsProvider.ts";
import { StMicroelectronicsProvider } from "../../src/providers/StMicroelectronicsProvider.ts";
import type { VendorProvider } from "../../src/providers/VendorProvider.ts";
import type { ReadDocMeta } from "../../src/providers/VendorProvider.ts";
import { fixtures, type VendorKey } from "./fixtures.ts";

/** When false, `read` / `query` / `page` and the network phase of `flow` / `all` are skipped (no PDF download). */
const RUN_E2E_NETWORK = true;

const TOOL_NAMES = new Set([
    "resource",
    "search",
    "lookup",
    "read",
    "query",
    "page",
    "flow",
    "all",
]);

function parseArgs(): { tool: string; vendor: VendorKey } {
    const a = process.argv.slice(2);
    let tool = "";
    let vendor: VendorKey = "TI";
    for (let i = 0; i < a.length; i++) {
        if (a[i] === "--tool" && a[i + 1]) {
            tool = a[++i]!;
            continue;
        }
        if (a[i] === "--vendor" && a[i + 1]) {
            const v = a[++i]!.toUpperCase();
            if (v === "TI" || v === "ST") vendor = v;
            continue;
        }
    }
    // Fallback when npm strips leading --flags: `tsx run.ts lookup ST`
    if (!tool && a.length >= 1 && TOOL_NAMES.has(a[0]!)) {
        tool = a[0]!;
        if (a.length >= 2 && (a[1] === "TI" || a[1] === "ST")) {
            vendor = a[1]!;
        }
    }
    return { tool, vendor };
}

function makeProvider(vendor: VendorKey): VendorProvider {
    return vendor === "TI" ? new TexasInstrumentsProvider() : new StMicroelectronicsProvider();
}

function withReadSpy(provider: VendorProvider): { getReadCount: () => number } {
    let n = 0;
    const originalRead = provider.readDoc.bind(provider);
    (provider as { readDoc: typeof provider.readDoc }).readDoc = async (
        doc: string,
        meta?: ReadDocMeta
    ) => {
        n++;
        return originalRead(doc, meta);
    };
    return { getReadCount: () => n };
}

async function runResource(): Promise<void> {
    const guidePath = path.join(process.cwd(), "src", "resources", "tool-usage-guide.md");
    const text = fs.readFileSync(guidePath, "utf-8");
    if (!text.includes("Electronics Docs MCP")) {
        throw new Error("tool-usage-guide.md missing expected header");
    }
    console.log("resource: OK", guidePath, `(${text.length} chars)`);
}

async function runSearch(vendor: VendorKey): Promise<void> {
    const p = makeProvider(vendor);
    const f = fixtures[vendor];
    const query = f.defaultPart;
    const results = await p.searchDocs(query);

    const text =
        results.length === 0
            ? `No documents found for '${query}'. Try a simpler part number (e.g., without revision suffix).`
            : JSON.stringify(results, null, 2);

    const mcpLike = {
        isError: false,
        content: [{ type: "text" as const, text }],
    };

    console.log(JSON.stringify(mcpLike, null, 2));
}

async function runLookup(vendor: VendorKey): Promise<void> {
    const provider = makeProvider(vendor);
    const { getReadCount } = withReadSpy(provider);
    const f = fixtures[vendor];
    const res = await provider.lookupDoc(f.defaultPart, f.defaultQuestion);
    const readCalls = getReadCount();
    if (readCalls !== 0) {
        throw new Error(`lookup must not call readDoc; got ${readCalls} call(s)`);
    }
    console.log(
        JSON.stringify(
            {
                vendor,
                steps: res.steps,
                chunkCount: res.chunks.length,
                suggestedCount: res.suggestedDocuments?.length ?? 0,
            },
            null,
            2
        )
    );
}

function requireE2e(): void {
    if (!RUN_E2E_NETWORK) {
        console.error("Skipping network-heavy step (set RUN_E2E_NETWORK = true in scripts/agent-flow/run.ts to run read/query/page).");
        process.exit(0);
    }
}

async function runRead(vendor: VendorKey): Promise<void> {
    requireE2e();
    const p = makeProvider(vendor);
    const f = fixtures[vendor];
    const msg = await p.readDoc(f.sampleReadUrl, { part: f.defaultPart });
    console.log("read:", msg);
}

async function runQuery(vendor: VendorKey): Promise<void> {
    requireE2e();
    const p = makeProvider(vendor);
    const f = fixtures[vendor];
    const hits = await p.queryContent(f.defaultQuestion, f.defaultPart, undefined, 4);
    console.log("query: hits=", hits.length, hits[0] ? `docUrl=${hits[0].docUrl}` : "");
}

async function runPage(vendor: VendorKey): Promise<void> {
    requireE2e();
    const p = makeProvider(vendor);
    const f = fixtures[vendor];
    const hits = await p.queryContent(f.defaultQuestion, f.defaultPart, undefined, 2);
    if (hits.length === 0) {
        console.log("page: no query hits; index with read first");
        return;
    }
    const h = hits[0]!;
    const page = h.pageNum ?? 1;
    const out = await p.getDocumentPageText(h.docUrl, page, { maxChars: 8000 });
    console.log("page:", out.docTitle, "chars=", out.charCount, "truncated=", out.truncated);
}

async function runFlow(vendor: VendorKey): Promise<void> {
    const p = makeProvider(vendor);
    const f = fixtures[vendor];
    const lookup = await p.lookupDoc(f.defaultPart, f.defaultQuestion);
    if (lookup.chunks.length > 0) {
        console.log("flow: chunks from index, skip read");
        return;
    }
    const url = lookup.suggestedDocuments?.[0]?.url ?? f.sampleReadUrl;
    if (!RUN_E2E_NETWORK) {
        console.log("flow: lookup OK; set RUN_E2E_NETWORK = true in run.ts to read/query. sample URL:", url);
        return;
    }
    await p.readDoc(url, {
        part: f.defaultPart,
        title: lookup.suggestedDocuments?.[0]?.title,
    });
    const hits = await p.queryContent(f.defaultQuestion, f.defaultPart, undefined, 4);
    console.log("flow: after read, query hits=", hits.length);
}

const ALL_VENDORS: VendorKey[] = ["TI", "ST"];

async function runAll(): Promise<void> {
    await runResource();
    for (const v of ALL_VENDORS) {
        await runSearch(v);
        await runLookup(v);
    }
    if (RUN_E2E_NETWORK) {
        for (const v of ALL_VENDORS) {
            await runRead(v);
            await runQuery(v);
            await runPage(v);
            await runFlow(v);
        }
    } else {
        console.log("all: E2E read/query/page skipped (RUN_E2E_NETWORK is false)");
    }
}

async function main(): Promise<void> {
    const { tool, vendor } = parseArgs();
    if (!tool) {
        console.error(
            "Usage: tsx scripts/agent-flow/run.ts --tool <resource|search|lookup|read|query|page|flow|all> [--vendor TI|ST]"
        );
        process.exit(2);
    }
    switch (tool) {
        case "resource":
            await runResource();
            break;
        case "search":
            await runSearch(vendor);
            break;
        case "lookup":
            await runLookup(vendor);
            break;
        case "read":
            await runRead(vendor);
            break;
        case "query":
            await runQuery(vendor);
            break;
        case "page":
            await runPage(vendor);
            break;
        case "flow":
            await runFlow(vendor);
            break;
        case "all":
            await runAll();
            break;
        default:
            console.error("Unknown --tool:", tool);
            process.exit(2);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
