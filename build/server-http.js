"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const mcpServerFactory_js_1 = require("./mcpServerFactory.js");
const app = (0, express_1.default)();
app.use(express_1.default.json());
// ── Optional Bearer token auth ──────────────────────────────────────────────
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
function authMiddleware(req, res, next) {
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
app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "electronics-docs-mcp", version: mcpServerFactory_js_1.SERVER_VERSION });
});
// ── MCP endpoint (POST only — stateless Streamable HTTP) ────────────────────
app.post("/mcp", authMiddleware, async (req, res) => {
    try {
        const server = (0, mcpServerFactory_js_1.createMcpServer)();
        const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless: no session tracking
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error", detail: err.message });
        }
    }
});
// ── GET /mcp — informational (stateless mode has no SSE stream) ─────────────
app.get("/mcp", (_req, res) => {
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
    console.log(`Electronics Docs MCP Server v${mcpServerFactory_js_1.SERVER_VERSION} (HTTP) listening on http://${HOST}:${PORT}/mcp`);
    console.log(`  Health: http://${HOST}:${PORT}/health`);
    console.log(`  Auth:   ${authStatus}`);
});
