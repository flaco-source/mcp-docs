/**
 * HTTP entry point for the Electronics Docs MCP Server.
 *
 * Exposes the same MCP tools and resources as the stdio entry point (src/index.ts)
 * but over HTTP using the MCP Streamable HTTP transport (stateless mode).
 *
 * Each POST /mcp request gets its own Server + Transport instance so no session
 * state is held in memory — safe for multi-client use.
 *
 * Environment variables:
 *   PORT            - TCP port to listen on (default: 3000)
 *   HOST            - Interface to bind (default: 0.0.0.0 — all interfaces)
 *   MCP_AUTH_TOKEN  - When set, every request must include:
 *                     Authorization: Bearer <token>
 */

import express, { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, SERVER_VERSION } from "./mcpServerFactory.js";

const app = express();
app.use(express.json());

// ── Optional Bearer token auth ──────────────────────────────────────────────
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!AUTH_TOKEN) {
        next();
        return;
    }
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== AUTH_TOKEN) {
        res.status(401).json({ error: "Unauthorized — provide a valid Bearer token." });
        return;
    }
    next();
}

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "electronics-docs-mcp", version: SERVER_VERSION });
});

// ── MCP endpoint (POST only — stateless Streamable HTTP) ────────────────────
app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
    try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless: no session tracking
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error", detail: err.message });
        }
    }
});

// ── GET /mcp — informational (stateless mode has no SSE stream) ─────────────
app.get("/mcp", (_req: Request, res: Response) => {
    res.json({
        transport: "streamable-http",
        mode: "stateless",
        endpoint: "POST /mcp",
        auth: AUTH_TOKEN ? "Bearer token required" : "none",
        docs: "https://modelcontextprotocol.io/docs/concepts/transports",
    });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

app.listen(PORT, HOST, () => {
    const authStatus = AUTH_TOKEN ? "Bearer token auth enabled" : "no auth (set MCP_AUTH_TOKEN)";
    console.log(
        `Electronics Docs MCP Server v${SERVER_VERSION} (HTTP) listening on http://${HOST}:${PORT}/mcp`
    );
    console.log(`  Health: http://${HOST}:${PORT}/health`);
    console.log(`  Auth:   ${authStatus}`);
});
