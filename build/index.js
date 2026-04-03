"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const mcpServerFactory_js_1 = require("./mcpServerFactory.js");
async function main() {
    const server = (0, mcpServerFactory_js_1.createMcpServer)();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error(`Electronics Docs MCP Server v${mcpServerFactory_js_1.SERVER_VERSION} running on stdio (tools + resources)`);
}
main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
