/**
 * One-off probe: fetch Analog product page and list PDF-like URLs from HTML.
 * Run: node scripts/probe-adi-fetch.mjs [partOrUrl]
 */
const arg = process.argv[2] ?? "adau1701";
const url = arg.startsWith("http")
  ? arg
  : `https://www.analog.com/en/products/${String(arg).toLowerCase()}.html`;

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.analog.com/",
};

async function main() {
  console.error("GET", url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 35000);
  let res;
  try {
    res = await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
  } catch (e) {
    clearTimeout(t);
    console.error("fetch error:", e?.message ?? e);
    process.exit(1);
  }
  clearTimeout(t);
  console.error("status", res.status, res.headers.get("content-type"));
  const html = await res.text();
  console.error("html length", html.length);

  const pdfHref = new Set();
  const reAbs = /https?:\/\/[^"'>\s]+\.pdf/gi;
  let m;
  while ((m = reAbs.exec(html)) !== null) pdfHref.add(m[0].split("?")[0]);

  const reRel = /\/[^"'>\s]+\.pdf/gi;
  while ((m = reRel.exec(html)) !== null) {
    try {
      pdfHref.add(new URL(m[0], "https://www.analog.com").href.split("?")[0]);
    } catch {
      /* ignore */
    }
  }

  const list = [...pdfHref].sort();
  console.log(JSON.stringify({ url, status: res.status, pdfCount: list.length, pdfs: list }, null, 2));

  // Heuristic: JSON-LD or common doc link patterns
  const docSnippets = [];
  for (const needle of ["datasheet", "Data Sheet", "documentation", "/media/", "design-resources"]) {
    const idx = html.toLowerCase().indexOf(needle.toLowerCase());
    if (idx >= 0) docSnippets.push({ needle, at: idx });
  }
  console.error("keyword hits", docSnippets);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
