# Electronics Docs MCP Server

An MCP (Model Context Protocol) server that gives LLMs direct access to **official vendor PDF documentation** (**Texas Instruments**, **STMicroelectronics**, and **Analog Devices**), with a **local SQLite full-text index** (FTS5 + BM25) so answers can be grounded in real datasheet and TRM text.

## Tools


| Tool                            | Role                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `**lookup_doc`**    | Part + question: **FTS on the local index only**; if no match, returns **`suggestedDocuments`** (links from the vendor site). Does **not** download PDFs — use **`read_doc`** next. |
| `search_docs`       | List PDF links for a part (metadata only).                                                                                      |
| `**read_doc`**      | Index a PDF by **direct URL** — use for `/lit/ds/symlink/....pdf` and any link the user already has. Optional `part` / `title`. |
| `query_doc_content`             | BM25 search; each hit includes `**docUrl`** and `**pageNum**`.                                                                  |
| `**read_doc_page**` | Full indexed text for **page** or **page range** (`docUrl` from search results).                                                |


**When to use:** `lookup` for index check + suggested URLs; `**read_doc`** to index; `**read_doc_page**` after `query_doc_content` when you need full page text. TI symlink datasheets often need **`read_doc`** directly. See `[src/resources/tool-usage-guide.md](src/resources/tool-usage-guide.md)`.

## MCP resources


| URI                                   | Content                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electronics-docs://guide/tool-usage` | Markdown guide: when to use each tool, how to phrase queries, limits. Source: `[src/resources/tool-usage-guide.md](src/resources/tool-usage-guide.md)`. |


The server advertises `**instructions**` on initialize pointing agents to this resource.

## Cursor skill (optional)

Project skills: [`electronics-docs-mcp`](.cursor/skills/electronics-docs-mcp/SKILL.md), [`electronics-docs-mcp-ti`](.cursor/skills/electronics-docs-mcp-ti/SKILL.md), [`electronics-docs-mcp-st`](.cursor/skills/electronics-docs-mcp-st/SKILL.md), [`electronics-docs-mcp-adi`](.cursor/skills/electronics-docs-mcp-adi/SKILL.md). Copy to `~/.cursor/skills/` if you want them globally.

## Supported vendors


| Vendor ID | Name               | Status    |
| --------- | ------------------ | --------- |
| `TI`      | Texas Instruments  | Supported |
| `ST`      | STMicroelectronics | Supported |
| `ADI`     | Analog Devices     | Supported |

### Recent changes (server **v2.7.x**)

- **Analog Devices (`ADI`):** New `AnalogDevicesProvider` — PDF discovery from `analog.com/en/products/<slug>.html`, slug fallbacks on 404, `lookup_doc` filters PCN and `mds.analog.com` from suggestions only; same MCP tools as TI/ST.
- **Vendor list:** Supported vendors are derived from the `vendors` map in `mcpServerFactory.ts` (including `list_indexed_documents` validation). Tool schemas list all supported IDs.
- **STMicroelectronics (`ST`):** Removed the blind “canonical datasheet” URL fallback that could suggest `st.com/.../datasheet/<slug>.pdf` for non‑ST parts. Legacy DB rows matching that synthetic pattern are skipped when merging `search_docs` results.
- **PDF download (`read_doc`):** Retries on transient errors (502/503/504, timeouts, etc.); longer default timeout for `analog.com`; `Accept-Language` on Analog PDF requests; `Referer` for native fetch chosen by host (`analog.com`, `ti.com`, `st.com`).

## Adding a new vendor (hot plug)

1. Create `src/providers/YourVendorProvider.ts` extending `VendorProvider`.
2. Implement `searchDocs`, `readDoc`, `queryContent`, and optionally override `**lookupDoc**` and `**getDocumentPageText**` for orchestrated behavior and page reads.
3. Register the provider in `[src/mcpServerFactory.ts](src/mcpServerFactory.ts)` under `vendors` (supported vendor IDs and tool descriptions follow this map automatically).
4. Rebuild: `npm run build` and restart the MCP process.

## Development

```bash
npm install
npm run build   # compiles TS → build/ and copies src/resources/*.md to build/resources/
npm start       # stdio MCP server (for Cursor / Claude Desktop)
npm run start:http  # HTTP MCP server on port 3000 (for network / remote use)
```

## Transport modes

This server supports **two transports** that share identical tools and resources:

| Mode       | Entry point          | Transport                     | Use case                            |
| ---------- | -------------------- | ----------------------------- | ----------------------------------- |
| **stdio**  | `src/index.ts`       | `StdioServerTransport`        | Cursor, Claude Desktop (local)      |
| **HTTP**   | `src/server-http.ts` | `StreamableHTTPServerTransport` (stateless) | LAN testing, remote deployment, multi-client |

The shared logic lives in `src/mcpServerFactory.ts` — both entry points call `createMcpServer()`.

---

## stdio mode (local — Cursor / Claude Desktop)

### How "local" works

This server speaks **MCP over stdio**, not HTTP. The IDE spawns `node …/build/index.js` (or Docker with `-i`) and talks to the process over pipes. There is nothing to "open in the browser"; **exposure = registering the command in Cursor / Claude** so they start the binary for each session.

The SQLite index lives at **`~/.electronics-docs-mcp/docs.db`** on the host (or `/root/.electronics-docs-mcp/` inside Linux containers unless you mount a volume).

### Cursor MCP config (Node — recommended)

Use an **absolute path** to `build/index.js`. Adjust the drive/path for your machine.

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

After editing MCP settings, **reload the window** or restart the MCP server so it picks up rebuilds.

### Cursor MCP config (Docker)

Build the image first (`npm run build` is required so `build/` exists before `docker build`).

```bash
npm run build
docker build -t electronics-docs-mcp .
```

Cursor runs the container with **`-i`** so stdin stays open for the stdio protocol. Persist the index on a named volume (maps to `/root/.electronics-docs-mcp` in the image):

```json
{
  "mcpServers": {
    "electronics-docs": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "electronics-docs-mcp-data:/root/.electronics-docs-mcp",
        "electronics-docs-mcp"
      ]
    }
  }
}
```

On first run Docker creates the volume `electronics-docs-mcp-data`. To reset the index: remove the volume (`docker volume rm electronics-docs-mcp-data`) or delete `docs.db` inside it.

### Claude Desktop

Same `command` / `args` as Cursor in `claude_desktop_config.json` (e.g. `%APPDATA%\Claude` on Windows).

---

## HTTP mode (LAN / remote)

The HTTP server exposes the same MCP tools and resources over **MCP Streamable HTTP** (POST `/mcp`).  
Each request is fully independent — no session state is kept in memory.

### Quick start

```bash
# Development (tsx, auto-reload)
npm run start:http

# Production (compiled)
npm run build
npm run start:http:prod
```

Default: `http://0.0.0.0:3000/mcp`

### Environment variables

| Variable         | Default     | Description                                       |
| ---------------- | ----------- | ------------------------------------------------- |
| `PORT`           | `3000`      | TCP port to listen on                             |
| `HOST`           | `0.0.0.0`   | Interface to bind (`127.0.0.1` for local-only)    |
| `MCP_AUTH_TOKEN` | _(unset)_   | When set, all requests must carry `Authorization: Bearer <token>` |

### Health check

```bash
curl http://localhost:3000/health
# {"status":"ok","server":"electronics-docs-mcp","version":"2.7.0"}
```

### Test a tool call (curl)

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

With auth token:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mysecret" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Cursor `mcp.json` (remote Streamable HTTP)

Cursor reads MCP settings from a JSON file at the **user** level (not per-project):

| OS | Path |
| --- | --- |
| **Windows** | `%USERPROFILE%\.cursor\mcp.json` — e.g. `C:\Users\YourName\.cursor\mcp.json` |
| **macOS / Linux** | `~/.cursor/mcp.json` |

Merge the block below into the top-level `"mcpServers"` object (alongside any other servers you already use).

**Required fields for this server**

| Field | Value |
| ----- | ----- |
| `type` | `"streamableHttp"` — tells Cursor to use the Streamable HTTP MCP client (POST to `/mcp`). Without it, the client may POST to `/` and you get **`Cannot POST /`**. |
| `url` | Full URL ending in **`/mcp`** — e.g. `http://192.168.1.100:3000/mcp` or `https://your-subdomain.trycloudflare.com/mcp`. Do **not** use only the origin (`https://host/`) or Cursor will target `/` instead of `/mcp`. |
| `headers` (optional) | Only if the server was started with **`MCP_AUTH_TOKEN`**. Use **`Authorization": "Bearer YOUR_TOKEN"`** — the word **`Bearer`** plus a space before the secret is required; the server compares the token after `Bearer ` to `MCP_AUTH_TOKEN`. |

**Example — LAN (no auth on server)**

```json
{
  "mcpServers": {
    "electronics-docs-remote": {
      "type": "streamableHttp",
      "url": "http://192.168.1.100:3000/mcp"
    }
  }
}
```

**Example — LAN or tunnel with `MCP_AUTH_TOKEN`**

```json
{
  "mcpServers": {
    "electronics-docs-remote": {
      "type": "streamableHttp",
      "url": "http://192.168.1.100:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_TOKEN"
      }
    }
  }
}
```

**Example — Cloudflare quick tunnel** (`cloudflared tunnel --url http://localhost:3000`)

The printed URL must include **`/mcp`**. Quick tunnels get a **new** `*.trycloudflare.com` hostname each run — update `url` whenever you restart `cloudflared` without a named tunnel.

```json
{
  "mcpServers": {
    "electronics-docs-remote": {
      "type": "streamableHttp",
      "url": "https://random-name.trycloudflare.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_TOKEN"
      }
    }
  }
}
```

After editing `mcp.json`, **reload the Cursor window** (or restart MCP) so the config is picked up.

**Claude Desktop** uses its own file (e.g. `claude_desktop_config.json` on Windows under `%APPDATA%\Claude\`) — same `url` / `headers` ideas apply if the client supports HTTP MCP.

---

## Exposing to the internet

### Option A — ngrok (fastest, for short-term testing)

```bash
npm install -g ngrok
ngrok http 3000
# → https://abc123.ngrok.io  (public HTTPS tunnel to localhost:3000)
```

Set in Cursor (`~/.cursor/mcp.json` or `%USERPROFILE%\.cursor\mcp.json` on Windows):

```json
{
  "mcpServers": {
    "electronics-docs-remote": {
      "type": "streamableHttp",
      "url": "https://abc123.ngrok.io/mcp",
      "headers": { "Authorization": "Bearer mysecret" }
    }
  }
}
```

### Option B — Cloudflare Tunnel (free, stable, no open port)

```bash
# Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
cloudflared tunnel --url http://localhost:3000
# → https://some-name.trycloudflare.com
```

### Option C — Docker + VPS / cloud (permanent deployment)

Build a production image that starts the HTTP server:

```dockerfile
# Add to Dockerfile (replace the existing CMD)
CMD ["node", "build/server-http.js"]
```

Deploy on any Node-capable platform:

```bash
# Railway / Fly.io / Render — set env vars in dashboard:
#   PORT=3000  (usually auto-set by platform)
#   MCP_AUTH_TOKEN=<your-secret>

# Fly.io example
fly launch --name electronics-docs-mcp
fly secrets set MCP_AUTH_TOKEN=mysecret
fly deploy
```

### Option D — Docker Compose (self-hosted server)

```yaml
# docker-compose.yml
services:
  mcp-http:
    build: .
    command: node build/server-http.js
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - MCP_AUTH_TOKEN=mysecret
    volumes:
      - mcp-data:/root/.electronics-docs-mcp
    restart: unless-stopped

volumes:
  mcp-data:
```

```bash
npm run build
docker compose up -d
```

### Option E — Vercel (serverless)

The repo includes `api/index.ts` and `vercel.json` so the HTTP MCP runs as a Vercel Node function. The build runs `npm run build` (TypeScript → `build/`, resources copied, then `scripts/ensure-public-dir.cjs` so a **`public/`** directory exists). `vercel.json` sets **`outputDirectory`: `public`** so Vercel does not fail with “No Output Directory named public”. If the dashboard overrides this, set **Output Directory** to `public` or leave it empty and rely on `vercel.json`.

1. Install the CLI: `npm i -g vercel`
2. From the project root: `vercel` (link the project) then `vercel --prod` for production.
3. In the [Vercel dashboard](https://vercel.com) → your project → **Settings → Environment Variables**, add:

| Name | Value | Environments |
|------|--------|--------------|
| `MCP_AUTH_TOKEN` | Your secret (same value you use in `Authorization: Bearer …`) | Production, Preview |
| `ELECTRONICS_DOCS_DB_DIR` | `/tmp/electronics-docs-mcp` | Production, Preview |

Redeploy after changing env vars.

**URLs after deploy**

- MCP (Streamable HTTP): `https://<your-project>.vercel.app/mcp` — rewrites in `vercel.json` map `/mcp` → `/api/mcp`.
- Health: `https://<your-project>.vercel.app/health`
- Direct function path (same behavior): `https://<your-project>.vercel.app/api/mcp`

**Cursor `mcp.json`**

```json
{
  "mcpServers": {
    "electronics-docs-vercel": {
      "type": "streamableHttp",
      "url": "https://YOUR_PROJECT.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

**Caveats**

- **Serverless timeouts:** Default Hobby limit is **10s** per invocation; long PDF indexing may hit it. **Pro** allows longer functions (see `vercel.json` `maxDuration`). Prefer indexing heavy PDFs locally or on a long-running host.
- **SQLite:** The index lives under `ELECTRONICS_DOCS_DB_DIR` (e.g. `/tmp`). On serverless, storage is **ephemeral** — the DB may reset when the function cold-starts or scales. For a durable index, use self-hosted Option D or a VM.
- **`better-sqlite3`:** Native module; if the build fails on Vercel, check Node version in Project Settings and build logs.
- **Secrets:** Never commit tokens to git. Set `MCP_AUTH_TOKEN` only in the Vercel UI or `vercel env add`.

---

## Project structure

```
api/
└── index.ts                    # Vercel serverless: Express app → /api/mcp, /api/health
src/
├── index.ts                    # stdio entry point  (Cursor / Claude Desktop)
├── httpApp.ts                  # Express app factory (shared: local HTTP + Vercel)
├── server-http.ts              # HTTP entry point   (LAN / remote / cloud)
├── mcpServerFactory.ts         # shared MCP server logic (tools + resources)
├── resources/
│   └── tool-usage-guide.md    # Copied to build/resources/ on build
├── cache/
│   └── DocumentCache.ts        # SQLite + FTS5
└── providers/
    ├── VendorProvider.ts
    ├── TexasInstrumentsProvider.ts
    └── StMicroelectronicsProvider.ts
```

Indexed data is stored under **`~/.electronics-docs-mcp/docs.db`**.

## Testing

```bash
npm test
# build + run.ts all (see run-default-smoke.cjs)
```

[`scripts/agent-flow/run.ts`](scripts/agent-flow/run.ts) covers resource, search, lookup (TI + ST), and optionally read/query/page/flow. By default **`RUN_E2E_NETWORK` is `false`** in that script, so PDF downloads are skipped. Set **`RUN_E2E_NETWORK = true`** in `run.ts` for full read/query/page (network required).

```bash
npx tsx scripts/agent-flow/run.ts --tool search --vendor ST
```
