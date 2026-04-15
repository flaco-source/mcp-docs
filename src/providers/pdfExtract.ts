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

export interface FetchPdfOptions {
    /** Use native fetch instead of axios (required for CDNs that block axios TLS fingerprint, e.g. Akamai on st.com). */
    useNativeFetch?: boolean;
    timeoutMs?: number;
}

async function fetchUrlWithAxios(u: string, timeoutMs: number): Promise<{ buf: Buffer | null; message: string }> {
    try {
        const response = await axios.get(u, {
            responseType: 'arraybuffer',
            headers: HEADERS_PDF,
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
        const buf = Buffer.from(response.data as ArrayBuffer);
        if (isPdfBuffer(buf)) {
            return { buf, message: '' };
        }
        return { buf: null, message: `Response at ${u} is not a PDF (wrong content type or HTML error page)` };
    } catch (e: any) {
        const status = e?.response?.status;
        return { buf: null, message: status ? `HTTP ${status} for ${u}` : (e?.message ?? String(e)) };
    }
}

function refererForPdfUrl(u: string): string {
    try {
        const h = new URL(u).hostname.toLowerCase();
        if (h.endsWith('analog.com')) return 'https://www.analog.com/';
        if (h.endsWith('ti.com')) return 'https://www.ti.com/';
        if (h.endsWith('st.com')) return 'https://www.st.com/';
    } catch {
        /* ignore */
    }
    return 'https://www.st.com/';
}

async function fetchUrlWithNativeFetch(u: string, timeoutMs: number): Promise<{ buf: Buffer | null; message: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(u, {
            signal: ctrl.signal,
            headers: { ...HEADERS_PDF, Referer: refererForPdfUrl(u) },
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
    } catch (e: any) {
        clearTimeout(timer);
        return { buf: null, message: e?.message ?? String(e) };
    }
}

/**
 * Try URL variants; verify PDF magic bytes.
 * Pass `useNativeFetch: true` for hosts that block axios (Akamai TLS fingerprinting).
 */
export async function fetchPdfBuffer(url: string, options?: FetchPdfOptions): Promise<Buffer> {
    const trimmed = url.trim();
    const noQuery = trimmed.split('?')[0];
    const candidates = Array.from(new Set([trimmed, noQuery].filter(Boolean)));
    const timeoutMs = options?.timeoutMs ?? 90_000;
    const fetcher = options?.useNativeFetch ? fetchUrlWithNativeFetch : fetchUrlWithAxios;
    let lastMessage = 'Unknown error';

    for (const u of candidates) {
        const { buf, message } = await fetcher(u, timeoutMs);
        if (buf) return buf;
        lastMessage = message;
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
