
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
const path = require('path');

async function test() {
    try {
        const pdfjsPath = require.resolve('pdfjs-dist/package.json');
        const standardFontDataUrl = path.join(path.dirname(pdfjsPath), 'standard_fonts', '/');
        console.log('Font URL:', standardFontDataUrl);

        // Try to load a dummy or just verify the resolve
        console.log('Resolve successful');
    } catch (e) {
        console.error('Resolve failed:', e.message);
    }
}
test();
