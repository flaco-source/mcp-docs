/**
 * Probe Analog search results HTML for PDF links.
 * Usage: node scripts/probe-adi-search.mjs "query"
 */
const q = process.argv[2] ?? "ADAU1701";
const url = `https://www.analog.com/en/search.html?q=${encodeURIComponent(q)}`;
const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.analog.com/",
};

async function main() {
  console.error("GET", url);
  const res = await fetch(url, { headers, redirect: "follow" });
  console.error("status", res.status);
  const html = await res.text();
  console.error("html length", html.length);
  const pdfHref = new Set();
  const reAbs = /https?:\/\/[^"'>\s]+\.pdf/gi;
  let m;
  while ((m = reAbs.exec(html)) !== null) pdfHref.add(m[0].split("?")[0]);
  const list = [...pdfHref].sort();
  const productHrefs = new Set();
  const reProd = /href="(\/en\/products\/[^"]+\.html)"/gi;
  while ((m = reProd.exec(html)) !== null) productHrefs.add(m[1]);
  const products = [...productHrefs].sort().slice(0, 30);
  console.log(
    JSON.stringify(
      { query: q, pdfCount: list.length, pdfs: list.slice(0, 40), productLinkCount: products.length, productLinks: products },
      null,
      2
    )
  );
}

main().catch(console.error);
