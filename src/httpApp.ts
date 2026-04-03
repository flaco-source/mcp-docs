/**
 * Shared Express app for MCP Streamable HTTP (local `server-http` and Vercel `api/index`).
 */

import express, { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, SERVER_VERSION } from "./mcpServerFactory.js";

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

export function createHttpApp(): express.Express {
    const app = express();
    app.use(express.json());

    app.get("/health", (_req: Request, res: Response) => {
        res.json({ status: "ok", server: "electronics-docs-mcp", version: SERVER_VERSION });
    });

    app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
        try {
            const server = createMcpServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err: any) {
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal server error", detail: err.message });
            }
        }
    });

    app.get("/mcp", (_req: Request, res: Response) => {
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

export { SERVER_VERSION };
