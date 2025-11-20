const XLSX = require('xlsx');

const filename = 'Checkpoint Daily Portfolio History 111825.xlsx';
console.log(`Reading ${filename}...`);

try {
    const workbook = XLSX.readFile(filename);
    const sheetNames = workbook.SheetNames;
    console.log('Sheets:', sheetNames);

    const histSheetName = sheetNames.find(n =>
        n.toLowerCase().includes('itd history') ||
        n.toLowerCase().includes('daily portfolio') ||
        n.toLowerCase().includes('history portfolio')
    );

    if (histSheetName) {
        console.log(`Found History Sheet: ${histSheetName}`);
        const sheet = workbook.Sheets[histSheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        if (data.length > 0) {
            console.log('First row keys:', Object.keys(data[0]));

            // Find columns
            const firstRow = data[0];
            const dateCol = Object.keys(firstRow).find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('as of'));
            const tickerCol = Object.keys(firstRow).find(k => k.toLowerCase().includes('ticker') || k.toLowerCase().includes('symbol'));

            console.log(`Date Col: ${dateCol}, Ticker Col: ${tickerCol}`);

            if (dateCol && tickerCol) {
                const ironRows = data.filter(r => r[tickerCol] === 'IRON');
                console.log(`Found ${ironRows.length} rows for IRON`);

                if (ironRows.length > 0) {
                    // Sort by date
                    ironRows.sort((a, b) => a[dateCol] - b[dateCol]);

                    const first = ironRows[0];
                    const last = ironRows[ironRows.length - 1];

                    console.log('First IRON entry:', first[dateCol], parseDate(first[dateCol]));
                    console.log('Last IRON entry:', last[dateCol], parseDate(last[dateCol]));
                }

                // Check global max date
                let maxDateVal = 0;
                data.forEach(r => {
                    if (r[dateCol] > maxDateVal) maxDateVal = r[dateCol];
                });
                console.log('Global Max Date:', maxDateVal, parseDate(maxDateVal));
            }
        }
    } else {
        console.log('History sheet not found');
    }

} catch (e) {
    console.error('Error:', e.message);
}

function parseDate(excelDate) {
    if (typeof excelDate === 'number') {
        const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        return date.toISOString().split('T')[0];
    }
    return excelDate;
}
