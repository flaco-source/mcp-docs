/**
 * Shared PDF download and text extraction for vendor providers (TI, ST, ...).
 */
import axios from 'axios';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

export const HEADERS_HTML = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

export const HEADERS_PDF = {
    'User-Agent': HEADERS_HTML['User-Agent'],
    Accept: 'application/pdf,application/octet-stream,*/*;q=0.8',
};

export function isPdfBuffer(buf: Buffer): boolean {
    if (buf.length < 5) return false;
    const head = buf.slice(0, 5).toString('binary');
    return head.startsWith('%PDF');
}

/**
 * Try URL variants; verify PDF magic bytes.
 */
export async function fetchPdfBuffer(url: string): Promise<Buffer> {
    const trimmed = url.trim();
    const noQuery = trimmed.split('?')[0];
    const candidates = Array.from(new Set([trimmed, noQuery].filter(Boolean)));
    let lastMessage = 'Unknown error';

    for (const u of candidates) {
        try {
            const response = await axios.get(u, {
                responseType: 'arraybuffer',
                headers: HEADERS_PDF,
                timeout: 90000,
                maxRedirects: 5,
                validateStatus: (s) => s >= 200 && s < 400,
            });
            if (response.status === 404) {
                lastMessage = `HTTP 404 for ${u}`;
                continue;
            }
            if (response.status !== 200 || !response.data) {
                lastMessage = `HTTP ${response.status} for ${u}`;
                continue;
            }
            const buf = Buffer.from(response.data as ArrayBuffer);
            if (isPdfBuffer(buf)) {
                return buf;
            }
            lastMessage = `Response at ${u} is not a PDF (wrong content type or HTML error page)`;
        } catch (e: any) {
            const status = e?.response?.status;
            lastMessage = status ? `HTTP ${status} for ${u}` : (e?.message ?? String(e));
        }
    }

    throw new Error(`Failed to download PDF from ${url}: ${lastMessage}`);
}

export async function extractPdfPages(pdfBuffer: Buffer): Promise<Array<{ page: number; text: string }>> {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
    const pdfDoc = await loadingTask.promise;
    const pages: Array<{ page: number; text: string }> = [];

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((item: any) => item.str).join(' ');
        pages.push({ page: i, text: text.trim() });
    }

    return pages;
}
