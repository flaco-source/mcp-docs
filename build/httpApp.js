"use strict";
/**
 * Shared Express app for MCP Streamable HTTP (local `server-http` and Vercel `api/index`).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_VERSION = void 0;
exports.createHttpApp = createHttpApp;
const express_1 = __importDefault(require("express"));
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const mcpServerFactory_js_1 = require("./mcpServerFactory.js");
Object.defineProperty(exports, "SERVER_VERSION", { enumerable: true, get: function () { return mcpServerFactory_js_1.SERVER_VERSION; } });
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
function createHttpApp() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", server: "electronics-docs-mcp", version: mcpServerFactory_js_1.SERVER_VERSION });
    });
    app.post("/mcp", authMiddleware, async (req, res) => {
        try {
            const server = (0, mcpServerFactory_js_1.createMcpServer)();
            const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
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
    app.get("/mcp", (_req, res) => {
        res.json({
            transport: "streamable-http",
            mode: "stateless",
            endpoint: "POST /mcp",
            auth: AUTH_TOKEN ? "Bearer token required" : "none",
            docs: "https://modelcontextprotocol.io/docs/concepts/transports",
        });
    });
    return app;
}
