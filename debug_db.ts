
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const DB_DIR = path.join(os.homedir(), '.electronics-docs-mcp');
const DB_PATH = path.join(DB_DIR, 'docs.db');

async function main() {
    const db = new Database(DB_PATH);
    console.log('--- FTS5 Search Test ---');

    const query = '0x00';
    const ftsQuery = `"${query}"*`;
    console.log(`Searching for: ${ftsQuery}`);

    try {
        const results = db.prepare(`
            SELECT count(*) as count 
            FROM chunks 
            WHERE chunks MATCH ?
        `).get(ftsQuery) as any;
        console.log(`FTS Match count: ${results.count}`);

        const likeResults = db.prepare('SELECT count(*) as count FROM chunks WHERE text LIKE ?').get(`%${query}%`) as any;
        console.log(`LIKE Match count: ${likeResults.count}`);

        if (likeResults.count > 0) {
            const sample = db.prepare('SELECT text FROM chunks WHERE text LIKE ? LIMIT 1').get(`%${query}%`) as any;
            console.log('Sample text with term:');
            const idx = sample.text.indexOf(query);
            console.log(JSON.stringify(sample.text.substring(Math.max(0, idx - 20), idx + 50)));
        }
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

main();
