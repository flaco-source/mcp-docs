"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTiDocumentUrl = normalizeTiDocumentUrl;
exports.findDocumentByUrl = findDocumentByUrl;
exports.getDocument = getDocument;
exports.getDocumentsByPart = getDocumentsByPart;
exports.listIndexedDocuments = listIndexedDocuments;
exports.vendorPartHasIndexedChunks = vendorPartHasIndexedChunks;
exports.updateDocumentPartIfUnknown = updateDocumentPartIfUnknown;
exports.insertDocument = insertDocument;
exports.hasChunks = hasChunks;
exports.indexChunks = indexChunks;
exports.getIndexedTextForDocPages = getIndexedTextForDocPages;
exports.searchChunks = searchChunks;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const CHUNK_SIZE = 1800; // chars per chunk (~450 tokens)
const CHUNK_OVERLAP = 200; // overlap between chunks
// Store the DB in a user-level data directory so it persists across runs.
// On Vercel/serverless, set ELECTRONICS_DOCS_DB_DIR to a writable path (e.g. /tmp/electronics-docs-mcp).
const DB_DIR = process.env.ELECTRONICS_DOCS_DB_DIR
    ? path_1.default.resolve(process.env.ELECTRONICS_DOCS_DB_DIR)
    : path_1.default.join(os_1.default.homedir(), '.electronics-docs-mcp');
const DB_PATH = path_1.default.join(DB_DIR, 'docs.db');
function getDb() {
    fs_1.default.mkdirSync(DB_DIR, { recursive: true });
    const db = new better_sqlite3_1.default(DB_PATH);
    // Enable WAL for better concurrent read performance
    db.pragma('journal_mode = WAL');
    db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor     TEXT    NOT NULL,
      part       TEXT    NOT NULL,
      title      TEXT    NOT NULL,
      doc_type   TEXT    NOT NULL,
      url        TEXT    UNIQUE NOT NULL,
      indexed_at TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_docs_vendor_part ON documents(vendor, part);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
      doc_id   UNINDEXED,
      page_num UNINDEXED,
      text,
      tokenize = 'porter unicode61'
    );
  `);
    migrateBrokenTiProductPageUrls(db);
    return db;
}
// TI scraper used to join protocol-relative hrefs incorrectly (double https://www.ti.com/...).
function migrateBrokenTiProductPageUrls(db) {
    const rows = db
        .prepare(`SELECT id, url FROM documents WHERE url LIKE 'https://www.ti.com//www.ti.com/%'`)
        .all();
    if (rows.length === 0)
        return;
    const upd = db.prepare('UPDATE documents SET url = ? WHERE id = ?');
    const byUrl = db.prepare('SELECT id FROM documents WHERE url = ?');
    for (const r of rows) {
        const fixed = r.url.replace(/^https:\/\/www\.ti\.com\/\/+www\.ti\.com\//i, 'https://www.ti.com/');
        if (fixed === r.url)
            continue;
        const other = byUrl.get(fixed);
        if (other && other.id !== r.id) {
            continue;
        }
        try {
            upd.run(fixed, r.id);
        }
        catch {
            // ignore UNIQUE clashes
        }
    }
}
// Lazy singleton instance
let _db = null;
function db() {
    if (!_db)
        _db = getDb();
    return _db;
}
// ──────────────────────────────────────────────
// Document metadata operations
// ──────────────────────────────────────────────
/** Fix legacy bad joins like https://www.ti.com//www.ti.com/lit/... */
function normalizeTiDocumentUrl(url) {
    return url
        .trim()
        .replace(/^https:\/\/www\.ti\.com\/\/+www\.ti\.com\//i, 'https://www.ti.com/');
}
/**
 * Resolve a document row by URL with common variants (query string, normalized host).
 */
function findDocumentByUrl(url) {
    const raw = url.trim();
    const n = normalizeTiDocumentUrl(raw);
    const rawNoQ = raw.split('?')[0];
    const nNoQ = n.split('?')[0];
    return getDocument(raw) ?? getDocument(n) ?? getDocument(rawNoQ) ?? getDocument(nNoQ) ?? null;
}
function getDocument(url) {
    const row = db().prepare('SELECT * FROM documents WHERE url = ?').get(url);
    if (!row)
        return null;
    return {
        id: row.id,
        vendor: row.vendor,
        part: row.part,
        title: row.title,
        docType: row.doc_type,
        url: row.url,
        indexedAt: row.indexed_at,
    };
}
function getDocumentsByPart(vendor, part) {
    const rows = db()
        .prepare('SELECT * FROM documents WHERE vendor = ? AND part = ? ORDER BY doc_type')
        .all(vendor, part);
    return rows.map(r => ({
        id: r.id, vendor: r.vendor, part: r.part,
        title: r.title, docType: r.doc_type, url: r.url, indexedAt: r.indexed_at,
    }));
}
/**
 * List indexed document metadata for a vendor, optionally filtered by exact part (normalized uppercase).
 */
function listIndexedDocuments(vendor, part) {
    const v = vendor.trim().toUpperCase();
    if (part !== undefined && part.trim() !== '') {
        const p = part.trim().toUpperCase().replace(/\s+/g, '');
        return getDocumentsByPart(v, p);
    }
    const rows = db()
        .prepare('SELECT * FROM documents WHERE vendor = ? ORDER BY part, doc_type, title')
        .all(v);
    return rows.map((r) => ({
        id: r.id,
        vendor: r.vendor,
        part: r.part,
        title: r.title,
        docType: r.doc_type,
        url: r.url,
        indexedAt: r.indexed_at,
    }));
}
/**
 * True if at least one indexed chunk exists for this vendor and part (any variant: exact or base revision).
 */
function vendorPartHasIndexedChunks(vendor, part) {
    const upper = part.trim().toUpperCase();
    const revMatch = upper.match(/^(.+?)(-R?\d+)$/);
    const variants = revMatch ? [upper, revMatch[1]] : [upper];
    const placeholders = variants.map(() => '?').join(', ');
    const row = db()
        .prepare(`SELECT 1 AS ok FROM chunks c
       JOIN documents d ON d.id = c.doc_id
       WHERE d.vendor = ? AND d.part IN (${placeholders})
       LIMIT 1`)
        .get(vendor, ...variants);
    return row !== undefined;
}
/**
 * Fix documents indexed with UNKNOWN part so query_doc_content filters work.
 */
function updateDocumentPartIfUnknown(url, part) {
    const upper = part.trim().toUpperCase();
    db().prepare(`UPDATE documents SET part = ? WHERE url = ? AND part = 'UNKNOWN'`).run(upper, url);
}
function insertDocument(vendor, part, title, docType, url) {
    const stmt = db().prepare(`
    INSERT INTO documents (vendor, part, title, doc_type, url, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title      = excluded.title,
      doc_type   = excluded.doc_type,
      part       = CASE WHEN documents.part = 'UNKNOWN' THEN excluded.part ELSE documents.part END,
      indexed_at = excluded.indexed_at
  `);
    const result = stmt.run(vendor, part, title, docType, url, new Date().toISOString());
    // Return the rowid (either new or existing)
    if (result.lastInsertRowid)
        return result.lastInsertRowid;
    return db().prepare('SELECT id FROM documents WHERE url = ?').get(url).id;
}
// ──────────────────────────────────────────────
// Chunk operations
// ──────────────────────────────────────────────
function hasChunks(docId) {
    const row = db().prepare('SELECT doc_id FROM chunks WHERE doc_id = ? LIMIT 1').get(docId);
    return row !== undefined;
}
/**
 * Split a long text into overlapping chunks and index them with FTS5.
 */
function indexChunks(docId, pages) {
    // Delete existing chunks for this doc first (re-indexing)
    db().prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId);
    const insertChunk = db().prepare('INSERT INTO chunks (doc_id, page_num, text) VALUES (?, ?, ?)');
    const insertMany = db().transaction((chunks) => {
        for (const [docId, page, text] of chunks) {
            insertChunk.run(docId, page, text);
        }
    });
    const allChunks = [];
    for (const { page, text } of pages) {
        // Split the page text into overlapping chunks
        let start = 0;
        while (start < text.length) {
            const end = Math.min(start + CHUNK_SIZE, text.length);
            const chunk = text.slice(start, end).trim();
            if (chunk.length > 50) { // skip tiny remnants
                allChunks.push([docId, page, chunk]);
            }
            if (end >= text.length)
                break;
            start += CHUNK_SIZE - CHUNK_OVERLAP;
        }
    }
    insertMany(allChunks);
}
/**
 * Concatenate all indexed chunk rows for each PDF page in [pageFrom, pageTo] (inclusive).
 * Long pages may be split into multiple FTS rows; they are joined in rowid order.
 */
function getIndexedTextForDocPages(docId, pageFrom, pageTo, maxChars) {
    const lo = Math.min(pageFrom, pageTo);
    const hi = Math.max(pageFrom, pageTo);
    if (lo < 1) {
        throw new Error('page numbers must be >= 1');
    }
    let out = '';
    let truncated = false;
    for (let p = lo; p <= hi; p++) {
        const rows = db()
            .prepare(`SELECT text FROM chunks WHERE doc_id = ? AND page_num = ? ORDER BY rowid`)
            .all(docId, p);
        if (rows.length === 0) {
            continue;
        }
        const pageText = rows.map((r) => r.text).join('\n\n');
        const sep = out.length > 0 ? `\n\n--- Page ${p} ---\n\n` : '';
        const addition = sep + pageText;
        if (out.length + addition.length > maxChars) {
            const room = maxChars - out.length;
            if (room > 0) {
                out += addition.slice(0, room);
            }
            truncated = true;
            break;
        }
        out += addition;
    }
    return {
        text: out.trim(),
        truncated,
        pageFrom: lo,
        pageTo: hi,
    };
}
// ──────────────────────────────────────────────
// Full-Text Search
// ──────────────────────────────────────────────
/**
 * Search within indexed chunks using FTS5.
 * Optionally filter by vendor, part, or docType.
 * Returns results ordered by BM25 relevance (lower bm25 = more relevant).
 */
function searchChunks(query, options = {}) {
    const { vendor, part, docType, limit = 10 } = options;
    // Sanitize query for FTS5 (escape special chars, wrap in quotes for phrase match if multi-word)
    const ftsQuery = sanitizeFtsQuery(query);
    // In FTS5, the bm25() function returns a NEGATIVE value.
    // The closer to negative infinity, the more relevant the match.
    // So ordering by 'score ASC' gives the most relevant results first.
    let sql = `
    SELECT
      c.doc_id,
      d.title   AS doc_title,
      d.doc_type,
      d.url     AS doc_url,
      d.part,
      d.vendor,
      c.page_num,
      snippet(chunks, 2, '<b>', '</b>', '...', 32) AS excerpt,
      bm25(chunks)                                 AS raw_score
    FROM chunks c
    JOIN documents d ON d.id = c.doc_id
    WHERE chunks MATCH ?
  `;
    const params = [ftsQuery];
    if (vendor) {
        sql += ' AND d.vendor = ?';
        params.push(vendor);
    }
    if (part) {
        sql += ' AND d.part   = ?';
        params.push(part.toUpperCase());
    }
    if (docType) {
        sql += ' AND d.doc_type = ?';
        params.push(docType);
    }
    sql += ' ORDER BY raw_score ASC LIMIT ?';
    params.push(limit);
    try {
        const rows = db().prepare(sql).all(...params);
        return rows.map(r => ({
            docId: r.doc_id,
            docTitle: r.doc_title,
            docType: r.doc_type,
            docUrl: r.doc_url,
            part: r.part,
            pageNum: r.page_num,
            excerpt: r.excerpt,
            // Convert SQLite's negative FTS5 BM25 score into a positive number
            // (Lower negative = higher relevance) -> (Higher positive = higher relevance)
            score: Math.round(Math.abs(r.raw_score) * 100) / 100,
        }));
    }
    catch (e) {
        // If FTS query is invalid (e.g., user typed something weird), fall back to plain search
        console.error('FTS query error:', e.message, '— query was:', ftsQuery);
        return [];
    }
}
/**
 * Sanitize a user query into a valid FTS5 MATCH expression.
 * Escapes quotes; wraps multi-word queries in phrase match if they look exact.
 */
function sanitizeFtsQuery(query) {
    // Remove FTS5 special operators the user might have typed accidentally
    const clean = query.replace(/['"*^()]/g, ' ').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return '""';
    // Use prefix match on each word for flexible partial matching
    return words.map(w => `"${w}"*`).join(' ');
}
