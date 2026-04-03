/**
 * HTTP entry point for the Electronics Docs MCP Server.
 *
 * Environment variables:
 *   PORT            - TCP port to listen on (default: 3000)
 *   HOST            - Interface to bind (default: 0.0.0.0)
 *   MCP_AUTH_TOKEN  - When set, every request must include:
 *                     Authorization: Bearer <token>
 */

import { createHttpApp, SERVER_VERSION } from "./httpApp.js";

const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

const app = createHttpApp();

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
