"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEADERS_PDF = exports.HEADERS_HTML = void 0;
exports.isPdfBuffer = isPdfBuffer;
exports.fetchPdfBuffer = fetchPdfBuffer;
exports.extractPdfPages = extractPdfPages;
/**
 * Shared PDF download and text extraction for vendor providers (TI, ST, ...).
 */
const axios_1 = __importDefault(require("axios"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
exports.HEADERS_HTML = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
exports.HEADERS_PDF = {
    'User-Agent': exports.HEADERS_HTML['User-Agent'],
    Accept: 'application/pdf,application/octet-stream,*/*;q=0.8',
};
function isPdfBuffer(buf) {
    if (buf.length < 5)
        return false;
    const head = buf.slice(0, 5).toString('binary');
    return head.startsWith('%PDF');
}
async function fetchUrlWithAxios(u, timeoutMs) {
    try {
        const response = await axios_1.default.get(u, {
            responseType: 'arraybuffer',
            headers: exports.HEADERS_PDF,
            timeout: timeoutMs,
            maxRedirects: 5,
            validateStatus: (s) => s >= 200 && s < 400,
        });
        if (response.status === 404) {
            return { buf: null, message: `HTTP 404 for ${u}` };
        }
        if (response.status !== 200 || !response.data) {
            return { buf: null, message: `HTTP ${response.status} for ${u}` };
        }
        const buf = Buffer.from(response.data);
        if (isPdfBuffer(buf)) {
            return { buf, message: '' };
        }
        return { buf: null, message: `Response at ${u} is not a PDF (wrong content type or HTML error page)` };
    }
    catch (e) {
        const status = e?.response?.status;
        return { buf: null, message: status ? `HTTP ${status} for ${u}` : (e?.message ?? String(e)) };
    }
}
async function fetchUrlWithNativeFetch(u, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(u, {
            signal: ctrl.signal,
            headers: { ...exports.HEADERS_PDF, Referer: 'https://www.st.com/' },
            redirect: 'follow',
        });
        clearTimeout(timer);
        if (!res.ok) {
            return { buf: null, message: `HTTP ${res.status} for ${u}` };
        }
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        if (isPdfBuffer(buf)) {
            return { buf, message: '' };
        }
        return { buf: null, message: `Response at ${u} is not a PDF (wrong content type or HTML error page)` };
    }
    catch (e) {
        clearTimeout(timer);
        return { buf: null, message: e?.message ?? String(e) };
    }
}
/**
 * Try URL variants; verify PDF magic bytes.
 * Pass `useNativeFetch: true` for hosts that block axios (Akamai TLS fingerprinting).
 */
async function fetchPdfBuffer(url, options) {
    const trimmed = url.trim();
    const noQuery = trimmed.split('?')[0];
    const candidates = Array.from(new Set([trimmed, noQuery].filter(Boolean)));
    const timeoutMs = options?.timeoutMs ?? 90_000;
    const fetcher = options?.useNativeFetch ? fetchUrlWithNativeFetch : fetchUrlWithAxios;
    let lastMessage = 'Unknown error';
    for (const u of candidates) {
        const { buf, message } = await fetcher(u, timeoutMs);
        if (buf)
            return buf;
        lastMessage = message;
    }
    throw new Error(`Failed to download PDF from ${url}: ${lastMessage}`);
}
async function extractPdfPages(pdfBuffer) {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
    const pdfDoc = await loadingTask.promise;
    const pages = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str).join(' ');
        pages.push({ page: i, text: text.trim() });
    }
    return pages;
}
