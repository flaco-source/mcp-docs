# Electronics Docs MCP Server

An MCP (Model Context Protocol) server that gives LLMs direct access to **official vendor PDF documentation** (**Texas Instruments** and **STMicroelectronics**), with a **local SQLite full-text index** (FTS5 + BM25) so answers can be grounded in real datasheet and TRM text.

## Tools


| Tool                            | Role                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `**lookup_electronics_doc`**    | Part + question: **FTS on the local index only**; if no match, returns **`suggestedDocuments`** (links from the vendor site). Does **not** download PDFs — use **`read_electronics_doc`** next. |
| `search_electronics_docs`       | List PDF links for a part (metadata only).                                                                                      |
| `**read_electronics_doc`**      | Index a PDF by **direct URL** — use for `/lit/ds/symlink/....pdf` and any link the user already has. Optional `part` / `title`. |
| `query_doc_content`             | BM25 search; each hit includes `**docUrl`** and `**pageNum**`.                                                                  |
| `**read_electronics_doc_page**` | Full indexed text for **page** or **page range** (`docUrl` from search results).                                                |


**When to use:** `lookup` for index check + suggested URLs; `**read_electronics_doc`** to index; `**read_electronics_doc_page**` after `query_doc_content` when you need full page text. TI symlink datasheets often need **`read_electronics_doc`** directly. See `[src/resources/tool-usage-guide.md](src/resources/tool-usage-guide.md)`.

## MCP resources


| URI                                   | Content                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electronics-docs://guide/tool-usage` | Markdown guide: when to use each tool, how to phrase queries, limits. Source: `[src/resources/tool-usage-guide.md](src/resources/tool-usage-guide.md)`. |


The server advertises `**instructions**` on initialize pointing agents to this resource.

## Cursor skill (optional)

Project skills: [`electronics-docs-mcp`](.cursor/skills/electronics-docs-mcp/SKILL.md), [`electronics-docs-mcp-ti`](.cursor/skills/electronics-docs-mcp-ti/SKILL.md), [`electronics-docs-mcp-st`](.cursor/skills/electronics-docs-mcp-st/SKILL.md). Copy to `~/.cursor/skills/` if you want them globally.

## Supported vendors


| Vendor ID | Name               | Status    |
| --------- | ------------------ | --------- |
| `TI`      | Texas Instruments  | Supported |
| `ST`      | STMicroelectronics | Supported |


## Adding a new vendor (hot plug)

1. Create `src/providers/YourVendorProvider.ts` extending `VendorProvider`.
2. Implement `searchDocs`, `readDoc`, `queryContent`, and optionally override `**lookupDoc**` and `**getDocumentPageText**` for orchestrated behavior and page reads.
3. Register the provider in `[src/index.ts](src/index.ts)` under `vendors`.
4. Rebuild: `npm run build`

## Development

```bash
npm install
npm run build   # compiles TS and copies src/resources/*.md to build/resources/
npm start       # stdio MCP server
```

### Cursor MCP config

```json
{
  "mcpServers": {
    "electronics-docs": {
      "command": "node",
      "args": ["D:/Projects Cursor/mcp-docs/build/index.js"]
    }
  }
}
```

### Claude Desktop

Same `command` / `args` in `claude_desktop_config.json` (e.g. `%APPDATA%\Claude`).

## Docker

```bash
npm run build
docker build -t electronics-docs-mcp .
docker run electronics-docs-mcp
```

The image expects `build/` to include `resources/` (run `npm run build` before `docker build`).

## Testing

```bash
npm test
# build + `run.ts all` without inheriting AGENT_E2E_READ from the shell (see run-default-smoke.cjs)
```

[`scripts/agent-flow/run.ts`](scripts/agent-flow/run.ts) covers resource, search, lookup (TI + ST), and optionally read/query/page/flow. By default **`AGENT_E2E_READ` is unset**, so PDF downloads are skipped. Set `AGENT_E2E_READ=1` for full read/query/page (network required).

```bash
npx tsx scripts/agent-flow/run.ts --tool search --vendor ST
```

## Project structure

```
src/
├── index.ts                    # MCP server: tools + resources
├── resources/
│   └── tool-usage-guide.md    # Copied to build/resources/ on build
├── cache/
│   └── DocumentCache.ts        # SQLite + FTS5
└── providers/
    ├── VendorProvider.ts
    └── TexasInstrumentsProvider.ts
```

Indexed data is stored under `**~/.electronics-docs-mcp/docs.db**`.