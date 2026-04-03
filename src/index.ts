import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, SERVER_VERSION } from "./mcpServerFactory.js";

async function main() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(
        `Electronics Docs MCP Server v${SERVER_VERSION} running on stdio (tools + resources)`
    );
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
