import axios from 'axios';
const cheerio = require('cheerio');

async function probe() {
    const r = await axios.get('https://www.ti.com/product/BQ40Z50', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(r.data);

    // Look at rows in the table or links
    const results: any[] = [];
    $('a[href*="/lit/"]').each((_: any, el: any) => {
        const title = $(el).text().trim().replace(/\s+/g, ' ');
        const href = $(el).attr('href');
        // Let's get parent context to see if there's a doc type
        const row = $(el).closest('tr');
        const docType = row.find('td').first().text().trim() || 'unknown';

        if (title && href) {
            results.push({ title, href, docType });
        }
    });

    console.log(JSON.stringify(results.slice(0, 10), null, 2));
}

probe().catch(console.error);
