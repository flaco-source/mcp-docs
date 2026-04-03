/**
 * Vercel expects an Output Directory named "public" after `npm run build`.
 * Ensures `public/` exists and contains at least `index.html`.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pub = path.join(root, "public");
fs.mkdirSync(pub, { recursive: true });
const idx = path.join(pub, "index.html");
if (!fs.existsSync(idx)) {
    fs.writeFileSync(
        idx,
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Electronics Docs MCP</title>
</head>
<body>
  <h1>Electronics Docs MCP</h1>
  <p><a href="/health">GET /health</a> · MCP: <code>POST /mcp</code></p>
</body>
</html>
`
    );
}
