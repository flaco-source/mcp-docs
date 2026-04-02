import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const vendor = "TI";
const part = "BQ41Z50";

/** Strings that should appear in the BQ40Z50 TRM — verify FTS retrieval and BM25 ordering (best match first). */
const SEARCH_QUERIES = [
    "patented Dynamic Z Track",
];

type ToolTextBlock = { type: string; text?: string };

function getText(result: unknown): string {
    const r = result as { content?: ToolTextBlock[] };
    const blocks = r.content as ToolTextBlock[] | undefined;
    return blocks?.[0]?.text ?? "";
}

async function main() {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["build/index.js"],
    });

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await client.connect(transport);
    console.log("Connected.\n");

    // Ensure PDFs are indexed for this part (orchestrated lookup once).
    // console.log(">>> Priming index: lookup_electronics_doc (broad question)\n");
    // const prime = await client.callTool({
    //     name: "lookup_electronics_doc",
    //     arguments: {
    //         vendor,
    //         part,
    //         question: "SBS command voltage register",
    //         maxDocsToIndex: 4,
    //     },
    // });
    // console.log(getText(prime).slice(0, 800));
    // console.log("\n---\n");

    for (const query of SEARCH_QUERIES) {
        console.log(`\n========== QUERY: ${JSON.stringify(query)} ==========`);
        const res = await client.callTool({
            name: "query_doc_content",
            arguments: {
                vendor,
                part,
                query: query.trim(),
                limit: 8,
            },
        });
        const text = getText(res);
        let parsed: Array<{
            docTitle: string;
            pageNum: number;
            score: number;
            excerpt: string;
        }>;
        try {
            parsed = JSON.parse(text) as typeof parsed;
        } catch {
            console.log(text);
            continue;
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
            console.log("(no results)", text);
            continue;
        }
        console.log(`Results: ${parsed.length} (order = most relevant first per BM25)\n`);
        parsed.forEach((row, i) => {
            const excerpt = row.excerpt.replace(/<b>|<\/b>/g, "").slice(0, 220);
            console.log(
                `  #${i + 1}  score=${row.score}  page=${row.pageNum}  doc=${row.docTitle.slice(0, 50)}…`
            );
            console.log(`       ${excerpt}${row.excerpt.length > 220 ? "…" : ""}\n`);
        });
        // Monotonicity check: score field is abs(BM25); higher = more relevant per server mapping
        const scores = parsed.map((r) => r.score);
        const nonIncreasing = scores.every((s, i) => i === 0 || scores[i - 1] >= s);
        console.log(
            `  [check] scores non-increasing (rank 1 >= rank 2 >= …): ${nonIncreasing ? "OK" : "REVIEW"}`
        );
    }

    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
