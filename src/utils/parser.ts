import { read, utils } from 'xlsx';
import { Trade, Position, DashboardData, PortfolioState, PositionHistoryPoint } from '../types/trade';

const EUR_TO_USD = 1.17;

// Helper to parse Excel dates
const parseExcelDate = (dateVal: any): string => {
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

// Helper to find column name case-insensitively
const findCol = (row: any, candidates: string[]): string | undefined => {
    const keys = Object.keys(row);
    for (const cand of candidates) {
        const key = keys.find(k => k.toLowerCase() === cand.toLowerCase() || k.toLowerCase().includes(cand.toLowerCase()));
        if (key) return key;
    }
    return undefined;
};

interface TaxLot {
    date: string;
    shares: number;
    costPerShare: number; // Includes fees/commissions allocated
    totalCost: number;
}

// --- ARGX Helpers ---
const isArgxOrd = (desc: string, currency: string): boolean => {
    const d = (desc || '').toUpperCase();
    const c = (currency || '').toUpperCase();
    const isOrdDesc = d.includes('ORD') && !d.includes('ADR');
    const isEur = c.includes('EUR');
    return isOrdDesc || isEur;
};

// --- Option Helpers ---
const isOption = (ticker: string, desc: string): boolean => {
    const t = (ticker || '').toUpperCase();
    const d = (desc || '').toUpperCase();

    // Regex patterns adapted from Python script
    const optOccRe = /^[A-Z]{1,7}\s*\d{6}[CP]\d{8}$/;
    const callPutWordRe = /\b(CALL|PUT|OPTION|OPTN)\b/i;
    const strikeCpRe = /\b\d+(\.\d+)?\s*[CP]\b/i;

    if (optOccRe.test(t)) return true;
    if (callPutWordRe.test(d)) return true;
    if (strikeCpRe.test(d)) return true;

    // Additional checks
    if (d.includes(' EXP ') || d.includes(' EXPIRE ')) return true;

    return false;
};

const getUniqueTicker = (ticker: string, desc: string): string => {
    // If it's an option, use the Description as the unique ID (sanitized)
    // Otherwise use the Ticker
    if (isOption(ticker, desc)) {
        // Clean up description to be a valid ID but readable
        // e.g. "RYTM US 07/18/25 C25" -> "RYTM 07/18/25 C25"
        return desc.trim();
    }
    return ticker.replace('_PIPE', '');
};

export const parseTradeData = async (file: File): Promise<DashboardData> => {
    const data = await file.arrayBuffer();
    const workbook = read(data);

    // --- 1. Parse Trade Blotter ---
    const tradeSheetName = workbook.SheetNames.find(n =>
        n.toLowerCase().includes('trade blotter') ||
        n.toLowerCase().includes('itd trade') ||
        n.toLowerCase().includes('blotter')
    ) || workbook.SheetNames[0];

    const tradeSheet = workbook.Sheets[tradeSheetName];
    const tradeJson: any[] = utils.sheet_to_json(tradeSheet);

    let trades: Trade[] = [];

    tradeJson.forEach((row: any) => {
        const tradeId = row['Trade Id'];
        let rawTicker = row['Ticker'] || '';
        const txnType = row['Txn Type'] || '';
        const description = row['Description'] || '';

        if (!tradeId && !rawTicker && !txnType) return;

        // --- ROBUST FX FILTERING ---
        const tickerUpper = rawTicker.toUpperCase();
        const descUpper = description.toString().toUpperCase();

        if (tickerUpper.includes('FX SPOT')) return;
        if (descUpper.includes('FX SPOT')) return;
        if (tickerUpper === 'EURUSD') return;
        if (tickerUpper === 'USDEUR') return;

        // Determine Unique Ticker (Segregating Options)
        const ticker = getUniqueTicker(rawTicker, description);

        let currency = row['Price Currency'] || row['Currency'] || 'USD';
        let price = parseFloat(row['Trade Price']) || 0;

        let netProceedsStr = row['$ Trading Net Proceeds'];
        let netProceeds = 0;
        if (typeof netProceedsStr === 'number') {
            netProceeds = netProceedsStr;
        } else if (typeof netProceedsStr === 'string') {
            const isNegative = netProceedsStr.includes('(') || netProceedsStr.includes('-');
            netProceeds = parseFloat(netProceedsStr.replace(/[$,()]/g, '')) || 0;
            if (isNegative) netProceeds = -Math.abs(netProceeds);
        }

        let quantityStr = row['Notional Quantity'];
        let quantity = 0;
        if (typeof quantityStr === 'number') {
            quantity = quantityStr;
        } else if (typeof quantityStr === 'string') {
            quantity = parseFloat(quantityStr.replace(/,/g, '')) || 0;
        }
        quantity = Math.abs(quantity);

        let feesStr = row['Fees'];
        let fees = 0;
        if (typeof feesStr === 'number') fees = feesStr;
        else if (typeof feesStr === 'string') {
            fees = parseFloat(feesStr.replace(/[$,()]/g, '')) || 0;
            if (feesStr.includes('(')) fees = -Math.abs(fees);
        }

        let commStr = row['Gross Commissions'];
        let commissions = 0;
        if (typeof commStr === 'number') commissions = commStr;
        else if (typeof commStr === 'string') {
            commissions = parseFloat(commStr.replace(/[$,()]/g, '')) || 0;
            if (commStr.includes('(')) commissions = -Math.abs(commissions);
        }

        const tradeDate = parseExcelDate(row['Trade Date']);

        trades.push({
            tradeId: row['Trade Id']?.toString() || Math.random().toString(),
            description,
            ticker,
            tradeDate,
            txnType,
            quantity,
            price,
            currency,
            netProceeds,
            fees,
            commissions,
        });
    });

    // --- 1.5 Consolidate ARGX Trades ---
    const argxTrades: Trade[] = [];
    const otherTrades: Trade[] = [];

    trades.forEach(t => {
        if (t.ticker === 'ARGX') {
            // Convert Price to USD if ORD
            if (isArgxOrd(t.description, t.currency)) {
                t.price = t.price * EUR_TO_USD;
                t.currency = 'USD';
            }
            argxTrades.push(t);
        } else {
            otherTrades.push(t);
        }
    });

    // Group ARGX by Date + Side
    const argxGrouped: Record<string, {
        shares: number;
        cashFlowUsd: number;
        trades: Trade[];
    }> = {};

    argxTrades.forEach(t => {
        const key = `${t.tradeDate}|${t.txnType}`;
        if (!argxGrouped[key]) {
            argxGrouped[key] = { shares: 0, cashFlowUsd: 0, trades: [] };
        }
        const grp = argxGrouped[key];
        grp.shares += t.quantity;
        grp.cashFlowUsd += (t.quantity * t.price);
        grp.trades.push(t);
    });

    const consolidatedArgx: Trade[] = [];
    Object.keys(argxGrouped).forEach(key => {
        const [date, txnType] = key.split('|');
        const grp = argxGrouped[key];

        if (grp.shares > 0) {
            const weightedPrice = grp.cashFlowUsd / grp.shares;

            const baseTrade = grp.trades[0];
            consolidatedArgx.push({
                ...baseTrade,
                tradeId: `ARGX-CONS-${date}-${txnType}`,
                description: 'ARGX ADR (merged USD)',
                ticker: 'ARGX',
                quantity: grp.shares,
                price: weightedPrice,
                currency: 'USD',
                netProceeds: grp.trades.reduce((sum, t) => sum + t.netProceeds, 0),
                fees: grp.trades.reduce((sum, t) => sum + t.fees, 0),
                commissions: grp.trades.reduce((sum, t) => sum + t.commissions, 0),
            });
        }
    });

    trades = [...otherTrades, ...consolidatedArgx];
    trades.sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());


    // --- 2. Parse History Sheet (for AUM and Prices) ---
    const histSheetName = workbook.SheetNames.find(n =>
        n.toLowerCase().includes('itd history') ||
        n.toLowerCase().includes('daily portfolio') ||
        n.toLowerCase().includes('history portfolio')
    );

    const dailyAumMap: Record<string, number> = {};
    const dailyPriceMap: Record<string, Record<string, number>> = {}; // Date -> Ticker -> Price
    const lastHistoryDateMap: Record<string, string> = {}; // Ticker -> Last Date seen in History
    const historyDates = new Set<string>();

    if (histSheetName) {
        const histSheet = workbook.Sheets[histSheetName];
        const histJson: any[] = utils.sheet_to_json(histSheet);

        if (histJson.length > 0) {
            const firstRow = histJson[0];
            const dateCol = findCol(firstRow, ['Date', 'As Of', 'Valuation Date']);
            const tickerCol = findCol(firstRow, ['Ticker', 'Symbol', 'Security', 'Instrument Symbol']);
            const priceCol = findCol(firstRow, ['Market Price', 'Price', 'Close', 'PX_LAST']);
            const mvCol = findCol(firstRow, ['Market Value', 'MV', 'MarketValue']);
            const descCol = findCol(firstRow, ['Description', 'Security Description', 'Name']);
            const qtyCol = findCol(firstRow, ['Quantity', 'Qty', 'Shares']);

            // Temporary store for ARGX daily aggregation
            const argxDaily: Record<string, { totQty: number; totMvUsd: number; adrPx: number; ordPx: number }> = {};

            histJson.forEach(row => {
                if (!dateCol || !row[dateCol]) return;
                const date = parseExcelDate(row[dateCol]);
                if (!date) return;

                historyDates.add(date);

                let rawTicker = '';
                if (tickerCol && row[tickerCol]) {
                    rawTicker = row[tickerCol];
                }
                const description = descCol ? row[descCol] : '';

                // Filter FX from History too
                if (rawTicker.toUpperCase().includes('FX SPOT')) return;
                if (rawTicker.toUpperCase() === 'EURUSD') return;

                // Determine Unique Ticker (Segregating Options)
                const ticker = getUniqueTicker(rawTicker, description);

                let mv = 0;
                if (mvCol) {
                    let val = row[mvCol];
                    if (typeof val === 'string') val = parseFloat(val.replace(/[$,()]/g, '')) || 0;
                    if (typeof val === 'number') mv = val;
                }

                let price = 0;
                if (priceCol) {
                    let val = row[priceCol];
                    if (typeof val === 'string') val = parseFloat(val.replace(/[$,()]/g, '')) || 0;
                    if (typeof val === 'number') price = val;
                }

                let qty = 0;
                if (qtyCol) {
                    let val = row[qtyCol];
                    if (typeof val === 'string') val = parseFloat(val.replace(/[$,()]/g, '')) || 0;
                    if (typeof val === 'number') qty = val;
                }

                // Update Last History Date if position exists
                if (Math.abs(qty) > 0.000001 || Math.abs(mv) > 0.01) {
                    const curLast = lastHistoryDateMap[ticker] || '';
                    if (date > curLast) {
                        lastHistoryDateMap[ticker] = date;
                    }
                }

                // --- ARGX Special Handling ---
                if (ticker === 'ARGX') {
                    const isOrd = isArgxOrd(description, '');

                    let pxUsd = price;
                    if (isOrd) pxUsd = price * EUR_TO_USD;

                    const mvUsd = Math.abs(qty) * pxUsd;

                    if (!argxDaily[date]) {
                        argxDaily[date] = { totQty: 0, totMvUsd: 0, adrPx: 0, ordPx: 0 };
                    }
                    const agg = argxDaily[date];
                    agg.totQty += qty;
                    agg.totMvUsd += mvUsd;
                    if (isOrd) agg.ordPx = pxUsd;
                    else agg.adrPx = pxUsd;

                    dailyAumMap[date] = (dailyAumMap[date] || 0) + mvUsd;

                } else {
                    // Normal Ticker (or Option)
                    if (mvCol) {
                        dailyAumMap[date] = (dailyAumMap[date] || 0) + mv;
                    }

                    if (ticker && price > 0) {
                        if (!dailyPriceMap[date]) dailyPriceMap[date] = {};
                        dailyPriceMap[date][ticker] = price;
                    }
                }
            });

            // Finalize ARGX Daily Prices
            Object.keys(argxDaily).forEach(date => {
                const agg = argxDaily[date];
                let finalPrice = 0;

                if (agg.totQty > 0 && agg.totMvUsd > 0) {
                    finalPrice = agg.totMvUsd / agg.totQty;
                } else if (agg.adrPx > 0) {
                    finalPrice = agg.adrPx;
                } else if (agg.ordPx > 0) {
                    finalPrice = agg.ordPx;
                }

                if (finalPrice > 0) {
                    if (!dailyPriceMap[date]) dailyPriceMap[date] = {};
                    dailyPriceMap[date]['ARGX'] = finalPrice;
                }
            });
        }
    }

    // --- 3. Build Master Timeline ---
    const tradeDates = new Set(trades.map(t => t.tradeDate));
    const allDates = Array.from(new Set([...Array.from(tradeDates), ...Array.from(historyDates)]));
    allDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    // --- 4. Simulation Loop ---
    const portfolioHistory: PortfolioState[] = [];
    const positionsMap: Record<string, Position> = {};

    let currentCash = 0;
    const currentHoldings: Record<string, { shares: number; price: number }> = {};

    const tradesByDate: Record<string, Trade[]> = {};
    trades.forEach(t => {
        if (!t.tradeDate) return;
        if (!tradesByDate[t.tradeDate]) tradesByDate[t.tradeDate] = [];
        tradesByDate[t.tradeDate].push(t);
    });

    // Track state for HIFO and Metrics
    const positionStates: Record<string, {
        shares: number;
        lots: TaxLot[];
        realizedPnL: number;
        history: PositionHistoryPoint[];
        sumSizePercentAUM: number;
        daysPresent: number;
        maxSizePercentAUM: number;
    }> = {};

    allDates.forEach((date, dateIdx) => {
        // A. Process Trades for this date
        const daysTrades = tradesByDate[date] || [];

        daysTrades.forEach(trade => {
            currentCash += trade.netProceeds;

            if (trade.ticker) {
                if (!currentHoldings[trade.ticker]) {
                    currentHoldings[trade.ticker] = { shares: 0, price: 0 };
                }
                if (!positionStates[trade.ticker]) {
                    positionStates[trade.ticker] = {
                        shares: 0,
                        lots: [],
                        realizedPnL: 0,
                        history: [],
                        sumSizePercentAUM: 0,
                        daysPresent: 0,
                        maxSizePercentAUM: 0
                    };

                    // --- ADD START BUFFER ---
                    // Add a data point for the day BEFORE the first trade, if possible.
                    if (dateIdx > 0) {
                        const prevDate = allDates[dateIdx - 1];
                        let startPrice = trade.price;
                        // Try to get historical price for the buffer day to avoid scaling issues
                        if (dailyPriceMap[prevDate] && dailyPriceMap[prevDate][trade.ticker]) {
                            startPrice = dailyPriceMap[prevDate][trade.ticker];
                        }

                        positionStates[trade.ticker].history.push({
                            date: prevDate,
                            price: startPrice,
                            shares: 0,
                            avgCostBasis: 0,
                            realizedPnL: 0,
                            unrealizedPnL: 0,
                            totalPnL: 0
                        });
                    }
                }

                const holding = currentHoldings[trade.ticker];
                const posState = positionStates[trade.ticker];

                if (['Buy', 'Cover', 'Stock Dividend', 'Pair-off'].includes(trade.txnType)) {
                    holding.shares += trade.quantity;
                    posState.shares += trade.quantity;

                    // Add Lot
                    const totalCost = (trade.quantity * trade.price) + Math.abs(trade.commissions) + Math.abs(trade.fees);
                    posState.lots.push({
                        date: trade.tradeDate,
                        shares: trade.quantity,
                        costPerShare: totalCost / trade.quantity,
                        totalCost: totalCost
                    });

                } else if (['Sell', 'Short'].includes(trade.txnType)) {
                    holding.shares -= trade.quantity;
                    posState.shares -= trade.quantity;

                    // HIFO Logic: Sort lots by costPerShare DESC
                    posState.lots.sort((a, b) => b.costPerShare - a.costPerShare);

                    let sharesToSell = trade.quantity;
                    let costOfSharesSold = 0;

                    // Consume lots
                    for (let i = 0; i < posState.lots.length; i++) {
                        if (sharesToSell <= 0) break;

                        const lot = posState.lots[i];
                        if (lot.shares <= sharesToSell) {
                            sharesToSell -= lot.shares;
                            costOfSharesSold += lot.totalCost;
                            lot.shares = 0;
                        } else {
                            const partialCost = sharesToSell * lot.costPerShare;
                            costOfSharesSold += partialCost;
                            lot.shares -= sharesToSell;
                            lot.totalCost -= partialCost;
                            sharesToSell = 0;
                        }
                    }

                    // Remove empty lots
                    posState.lots = posState.lots.filter(l => l.shares > 0.000001);

                    const proceeds = (trade.quantity * trade.price) - Math.abs(trade.commissions) - Math.abs(trade.fees);
                    const realized = proceeds - costOfSharesSold;
                    posState.realizedPnL += realized;
                }

                if (trade.price > 0) {
                    holding.price = trade.price;
                }
            }
        });

        // B. Update Prices from History (if available)
        if (dailyPriceMap[date]) {
            Object.keys(dailyPriceMap[date]).forEach(ticker => {
                if (currentHoldings[ticker]) {
                    currentHoldings[ticker].price = dailyPriceMap[date][ticker];
                }
            });
        }

        // C. Determine AUM
        // Prefer History AUM, fallback to calculated
        let aum = dailyAumMap[date];
        if (!aum) {
            let holdingsValue = 0;
            Object.values(currentHoldings).forEach(h => {
                holdingsValue += h.shares * h.price;
            });
            aum = holdingsValue + currentCash;
        }

        portfolioHistory.push({
            date,
            holdings: JSON.parse(JSON.stringify(currentHoldings)),
            cash: currentCash,
            aum
        });

        // D. Update History & Metrics for each position
        Object.keys(positionStates).forEach(ticker => {
            const posState = positionStates[ticker];
            const holding = currentHoldings[ticker];
            const price = holding ? holding.price : 0;

            // Calculate Avg Cost Basis
            let totalLotCost = 0;
            let totalLotShares = 0;
            posState.lots.forEach(l => {
                totalLotCost += l.totalCost;
                totalLotShares += l.shares;
            });
            const avgCostBasis = totalLotShares > 0 ? totalLotCost / totalLotShares : 0;

            const marketValue = posState.shares * price;
            const unrealizedPnL = marketValue - totalLotCost;

            posState.history.push({
                date,
                price,
                shares: posState.shares,
                avgCostBasis,
                realizedPnL: posState.realizedPnL,
                unrealizedPnL: unrealizedPnL,
                totalPnL: posState.realizedPnL + unrealizedPnL
            });

            // Update Size Metrics
            const sizePercent = aum > 0 ? (marketValue / aum) * 100 : 0;

            if (sizePercent > posState.maxSizePercentAUM) {
                posState.maxSizePercentAUM = sizePercent;
            }

            // Only count days where position is active
            if (Math.abs(posState.shares) > 0.00001) {
                posState.sumSizePercentAUM += sizePercent;
                posState.daysPresent += 1;
            }
        });
    });

    // --- 5. Finalize Positions ---
    const lastDate = allDates[allDates.length - 1];

    Object.keys(positionStates).forEach(ticker => {
        const posState = positionStates[ticker];

        if (!positionsMap[ticker]) {
            positionsMap[ticker] = {
                ticker,
                shares: 0,
                averageCost: 0,
                realizedPnL: 0,
                unrealizedPnL: 0,
                totalPnL: 0,
                maxSizePercentAUM: 0,
                avgSizePercentAUM: 0,
                isSmallPosition: false,
                trades: [],
                history: []
            };
        }
        const pos = positionsMap[ticker];
        pos.shares = posState.shares;

        // Final Avg Cost
        let totalLotCost = 0;
        let totalLotShares = 0;
        posState.lots.forEach(l => {
            totalLotCost += l.totalCost;
            totalLotShares += l.shares;
        });
        pos.averageCost = totalLotShares > 0 ? totalLotCost / totalLotShares : 0;

        pos.realizedPnL = posState.realizedPnL;
        const lastPrice = currentHoldings[ticker]?.price || 0;
        pos.unrealizedPnL = (pos.shares * lastPrice) - totalLotCost;
        pos.totalPnL = pos.realizedPnL + pos.unrealizedPnL;

        pos.trades = trades.filter(t => t.ticker === ticker);

        // --- TRIM HISTORY ---
        // Find the last index where shares != 0
        let lastActiveIndex = -1;
        for (let i = posState.history.length - 1; i >= 0; i--) {
            if (Math.abs(posState.history[i].shares) > 0.000001) {
                lastActiveIndex = i;
                break;
            }
        }

        // Also check Last History Date (from History Sheet)
        // If the History sheet says we held it on date X, we must include date X.
        let lastHistoryIndex = -1;
        const lastHistDate = lastHistoryDateMap[ticker];
        if (lastHistDate) {
            lastHistoryIndex = posState.history.findIndex(h => h.date === lastHistDate);
        }

        // The cut-off should be the MAX of (Last Active Trade-based Index) and (Last History-based Index)
        const finalIndex = Math.max(lastActiveIndex, lastHistoryIndex);

        if (finalIndex >= 0) {
            const sliceEnd = Math.min(posState.history.length, finalIndex + 2);
            pos.history = posState.history.slice(0, sliceEnd);
        } else {
            // If never active and no history?
            pos.history = posState.history;
        }

        pos.maxSizePercentAUM = posState.maxSizePercentAUM;
        pos.avgSizePercentAUM = posState.daysPresent > 0 ? posState.sumSizePercentAUM / posState.daysPresent : 0;

        // Filtering Logic:
        // Include if: Avg Size >= 1% OR Currently Held
        const isCurrentlyHeld = Math.abs(pos.shares) > 0.00001;
        const isSignificant = pos.avgSizePercentAUM >= 1.0;

        // isSmallPosition = TRUE means it will be HIDDEN by default
        // So if it matches criteria, isSmallPosition should be FALSE
        if (isSignificant || isCurrentlyHeld) {
            pos.isSmallPosition = false;
        } else {
            pos.isSmallPosition = true;
        }
    });

    return {
        positions: Object.values(positionsMap),
        portfolioHistory,
        trades
    };
};
