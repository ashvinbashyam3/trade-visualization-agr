const XLSX = require('xlsx');

const filename = 'Checkpoint Daily Portfolio History 111825.xlsx';
console.log(`Reading ${filename}...`);

const parseExcelDate = (dateVal) => {
    if (!dateVal) return '';
    if (typeof dateVal === 'number') {
        const date = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        return date.toISOString().split('T')[0];
    }
    const date = new Date(dateVal);
    if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
    }
    return '';
};

const findCol = (row, candidates) => {
    const keys = Object.keys(row);
    for (const cand of candidates) {
        const key = keys.find(k => k.toLowerCase() === cand.toLowerCase() || k.toLowerCase().includes(cand.toLowerCase()));
        if (key) return key;
    }
    return undefined;
};

try {
    const workbook = XLSX.readFile(filename);

    // --- HISTORY PARSING ---
    const histSheetName = workbook.SheetNames.find(n =>
        n.toLowerCase().includes('itd history') ||
        n.toLowerCase().includes('daily portfolio') ||
        n.toLowerCase().includes('history portfolio')
    );

    const lastHistoryDateMap = {};
    const historyDates = new Set();

    if (histSheetName) {
        console.log(`Processing History Sheet: ${histSheetName}`);
        const histSheet = workbook.Sheets[histSheetName];
        const histJson = XLSX.utils.sheet_to_json(histSheet);

        if (histJson.length > 0) {
            const firstRow = histJson[0];
            const dateCol = findCol(firstRow, ['Date', 'As Of', 'Valuation Date']);
            const tickerCol = findCol(firstRow, ['Ticker', 'Symbol', 'Security', 'Instrument Symbol']);
            const mvCol = findCol(firstRow, ['Market Value', 'MV', 'MarketValue']);
            const qtyCol = findCol(firstRow, ['Quantity', 'Qty', 'Shares']);

            console.log(`Columns - Date: ${dateCol}, Ticker: ${tickerCol}, MV: ${mvCol}, Qty: ${qtyCol}`);

            histJson.forEach(row => {
                if (!dateCol || !row[dateCol]) return;
                const date = parseExcelDate(row[dateCol]);
                if (!date) return;

                historyDates.add(date);

                let rawTicker = '';
                if (tickerCol && row[tickerCol]) {
                    rawTicker = row[tickerCol];
                }

                // Simple ticker check for IRON
                if (rawTicker !== 'IRON') return;

                let mv = 0;
                if (mvCol) {
                    let val = row[mvCol];
                    if (typeof val === 'string') val = parseFloat(val.replace(/[$,()]/g, '')) || 0;
                    if (typeof val === 'number') mv = val;
                }

                let qty = 0;
                if (qtyCol) {
                    let val = row[qtyCol];
                    if (typeof val === 'string') val = parseFloat(val.replace(/[$,()]/g, '')) || 0;
                    if (typeof val === 'number') qty = val;
                }

                console.log(`IRON History: Date=${date}, Qty=${qty}, MV=${mv}`);

                if (Math.abs(qty) > 0.000001 || Math.abs(mv) > 0.01) {
                    const curLast = lastHistoryDateMap['IRON'] || '';
                    if (date > curLast) {
                        lastHistoryDateMap['IRON'] = date;
                    }
                }
            });
        }
    }

    console.log('Last History Date for IRON:', lastHistoryDateMap['IRON']);

    // --- TRADES PARSING (Simplified) ---
    // Just to see the last trade date
    const tradeSheetName = workbook.SheetNames.find(n =>
        n.toLowerCase().includes('trade blotter') ||
        n.toLowerCase().includes('itd trade') ||
        n.toLowerCase().includes('blotter')
    );

    let lastTradeDate = '';
    if (tradeSheetName) {
        const tradeSheet = workbook.Sheets[tradeSheetName];
        const tradeJson = XLSX.utils.sheet_to_json(tradeSheet);

        tradeJson.forEach(row => {
            const ticker = row['Ticker'];
            if (ticker === 'IRON') {
                const date = parseExcelDate(row['Trade Date']);
                if (date > lastTradeDate) lastTradeDate = date;
            }
        });
    }
    console.log('Last Trade Date for IRON:', lastTradeDate);

} catch (e) {
    console.error('Error:', e.message);
}
