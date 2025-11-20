import { read, utils, WorkBook } from 'xlsx';
import { Trade, Position, DashboardData, PortfolioState, PositionHistoryPoint } from '../types/trade';

const EUR_TO_USD = 1.17;

/**
 * Represents a tax lot for HIFO accounting.
 */
interface TaxLot {
    date: string;
    shares: number;
    costPerShare: number; // Includes fees/commissions allocated
    totalCost: number;
}

/**
 * Helper to parse Excel dates into YYYY-MM-DD string format.
 * Handles both Excel serial numbers and date strings.
 * @param dateVal - The raw date value from Excel.
 * @returns The formatted date string or empty string if invalid.
 */
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

/**
 * Helper to find a column name in a row object case-insensitively.
 * @param row - The row object (key-value pairs).
 * @param candidates - List of possible column names.
 * @returns The actual key found in the row, or undefined.
 */
const findCol = (row: any, candidates: string[]): string | undefined => {
    const keys = Object.keys(row);
    for (const cand of candidates) {
        const key = keys.find(k => k.toLowerCase() === cand.toLowerCase() || k.toLowerCase().includes(cand.toLowerCase()));
        if (key) return key;
    }
    return undefined;
};

/**
 * Parses a financial number from Excel which might be a number or a string with currency symbols/parentheses.
 * Handles negative values represented by parentheses (e.g., "(1,000)").
 * @param val - The raw value.
 * @returns The parsed number.
 */
const parseFinancialNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const isNegative = val.includes('(') || val.includes('-');
        const num = parseFloat(val.replace(/[$,()]/g, '')) || 0;
        return isNegative ? -Math.abs(num) : num;
    }
    return 0;
};

/**
 * Cleans and trims a ticker symbol to ensure consistency.
 * @param val - The raw ticker string.
 * @returns The cleaned ticker.
 */
const cleanTicker = (val: any): string => {
    return val ? String(val).trim() : '';
};

/**
 * Determines if an ARGX trade is for Ordinary shares (requiring EUR->USD conversion).
 * @param desc - Security description.
 * @param currency - Currency code.
 * @returns True if it's an ORD share.
 */
const isArgxOrd = (desc: string, currency: string): boolean => {
    const d = (desc || '').toUpperCase();
    const c = (currency || '').toUpperCase();
    const isOrdDesc = d.includes('ORD') && !d.includes('ADR');
    const isEur = c.includes('EUR');
    return isOrdDesc || isEur;
};

/**
 * Checks if a security is an Option based on ticker or description patterns.
 * @param ticker - The ticker symbol.
 * @param desc - The security description.
 * @returns True if identified as an option.
 */
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

/**
 * Generates a unique identifier for a security.
 * For options, uses the sanitized description to distinguish them.
 * For equities, uses the cleaned ticker.
 * @param ticker - Raw ticker.
 * @param desc - Description.
 * @returns Unique identifier string.
 */
const getUniqueTicker = (ticker: string, desc: string): string => {
    if (isOption(ticker, desc)) {
        // Clean up description to be a valid ID but readable
        return desc.trim();
    }
    return ticker.replace('_PIPE', '').trim();
};

/**
 * Parses the Trade Blotter sheet to extract raw trades.
 * Applies filtering for FX and EURUSD.
 * @param workbook - The Excel workbook.
 * @returns Array of parsed Trade objects.
 */
const parseTradeBlotter = (workbook: WorkBook): Trade[] => {
    const tradeSheetName = workbook.SheetNames.find(n =>
        n.toLowerCase().includes('trade blotter') ||
        n.toLowerCase().includes('itd trade') ||
        n.toLowerCase().includes('blotter')
    ) || workbook.SheetNames[0];

    const tradeSheet = workbook.Sheets[tradeSheetName];
    const tradeJson: any[] = utils.sheet_to_json(tradeSheet);

    const trades: Trade[] = [];

    tradeJson.forEach((row: any) => {
        const tradeId = row['Trade Id'];
        const rawTicker = cleanTicker(row['Ticker']);
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

        const ticker = getUniqueTicker(rawTicker, description);
        const currency = row['Price Currency'] || row['Currency'] || 'USD';
        const price = parseFloat(row['Trade Price']) || 0;
        const netProceeds = parseFinancialNumber(row['$ Trading Net Proceeds']);
        const quantity = Math.abs(parseFinancialNumber(row['Notional Quantity']));
        const fees = parseFinancialNumber(row['Fees']);
        const commissions = parseFinancialNumber(row['Gross Commissions']);
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

    return trades;
};

/**
 * Consolidates ARGX trades (ORD and ADR) into a single 'ARGX' ticker.
 * Converts EUR prices to USD for ORD shares.
 * @param trades - List of all trades.
 * @returns List of trades with ARGX consolidated.
 */
const consolidateArgxTrades = (trades: Trade[]): Trade[] => {
    const argxTrades: Trade[] = [];
    const otherTrades: Trade[] = [];

    trades.forEach(t => {
        if (t.ticker === 'ARGX') {
            if (isArgxOrd(t.description, t.currency)) {
                t.price = t.price * EUR_TO_USD;
                t.currency = 'USD';
            }
            argxTrades.push(t);
        } else {
            otherTrades.push(t);
        }
    });

    // Group ARGX by Date + Side to create weighted average trades
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

    const finalTrades = [...otherTrades, ...consolidatedArgx];
    finalTrades.sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
    return finalTrades;
};

/**
 * Parses the History Sheet to extract daily AUM, prices, and the last seen date for each ticker.
 * @param workbook - The Excel workbook.
 * @returns Object containing dailyAumMap, dailyPriceMap, lastHistoryDateMap, firstHistoryDateMap, and historyDates set.
 */
const parseHistorySheet = (workbook: WorkBook) => {
    const histSheetName = workbook.SheetNames.find(n =>
        n.toLowerCase().includes('itd history') ||
        n.toLowerCase().includes('daily portfolio') ||
        n.toLowerCase().includes('history portfolio')
    );

    const dailyAumMap: Record<string, number> = {};
    const dailyPriceMap: Record<string, Record<string, number>> = {};
    const lastHistoryDateMap: Record<string, string> = {};
    const firstHistoryDateMap: Record<string, string> = {};
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
                if (!tickerCol) return; // Ensure tickerCol is defined
                const date = parseExcelDate(row[dateCol]);
                if (!date) return;

                historyDates.add(date);

                const rawTicker = cleanTicker(row[tickerCol]);
                const description = descCol ? row[descCol] : '';

                // Filter FX
                if (rawTicker.toUpperCase().includes('FX SPOT')) return;
                if (rawTicker.toUpperCase() === 'EURUSD') return;

                const ticker = getUniqueTicker(rawTicker, description);
                const mv = mvCol ? parseFinancialNumber(row[mvCol]) : 0;
                const price = priceCol ? parseFinancialNumber(row[priceCol]) : 0;
                const qty = qtyCol ? parseFinancialNumber(row[qtyCol]) : 0;

                // Update History Dates if position exists
                if (Math.abs(qty) > 0.000001 || Math.abs(mv) > 0.01) {
                    // Update Last Date
                    const curLast = lastHistoryDateMap[ticker] || '';
                    if (date > curLast) {
                        lastHistoryDateMap[ticker] = date;
                    }
                    // Update First Date
                    const curFirst = firstHistoryDateMap[ticker];
                    if (!curFirst || date < curFirst) {
                        firstHistoryDateMap[ticker] = date;
                    }
                }

                // ARGX Special Handling
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
    return { dailyAumMap, dailyPriceMap, lastHistoryDateMap, firstHistoryDateMap, historyDates };
};

/**
 * Simulates the portfolio day-by-day to calculate holdings, P&L, and AUM.
 * Uses HIFO (Highest-In, First-Out) accounting for sales.
 */
const simulatePortfolio = (
    allDates: string[],
    trades: Trade[],
    dailyPriceMap: Record<string, Record<string, number>>,
    dailyAumMap: Record<string, number>
) => {
    const portfolioHistory: PortfolioState[] = [];
    const positionStates: Record<string, {
        shares: number;
        lots: TaxLot[];
        realizedPnL: number;
        history: PositionHistoryPoint[];
        sumSizePercentAUM: number;
        daysPresent: number;
        maxSizePercentAUM: number;
    }> = {};

    let currentCash = 0;
    const currentHoldings: Record<string, { shares: number; price: number }> = {};

    // Group trades by date for faster access
    const tradesByDate: Record<string, Trade[]> = {};
    trades.forEach(t => {
        if (!t.tradeDate) return;
        if (!tradesByDate[t.tradeDate]) tradesByDate[t.tradeDate] = [];
        tradesByDate[t.tradeDate].push(t);
    });

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

            if (Math.abs(posState.shares) > 0.00001) {
                posState.sumSizePercentAUM += sizePercent;
                posState.daysPresent += 1;
            }
        });
    });

    return { portfolioHistory, positionStates, currentHoldings };
};

/**
 * Finalizes position data, calculates final metrics, and trims history.
 * Applies the logic to extend X-axis based on History sheet presence.
 */
const finalizePositions = (
    positionStates: Record<string, any>,
    currentHoldings: Record<string, any>,
    trades: Trade[],
    lastHistoryDateMap: Record<string, string>,
    firstHistoryDateMap: Record<string, string>
): Position[] => {
    const positionsMap: Record<string, Position> = {};

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
        posState.lots.forEach((l: TaxLot) => {
            totalLotCost += l.totalCost;
            totalLotShares += l.shares;
        });
        pos.averageCost = totalLotShares > 0 ? totalLotCost / totalLotShares : 0;

        pos.realizedPnL = posState.realizedPnL;
        const lastPrice = currentHoldings[ticker]?.price || 0;
        pos.unrealizedPnL = (pos.shares * lastPrice) - totalLotCost;
        pos.totalPnL = pos.realizedPnL + pos.unrealizedPnL;

        pos.trades = trades.filter(t => t.ticker === ticker);

        // --- DETERMINE X-AXIS BOUNDS ---
        // 1. Find Trade Bounds
        let firstTradeDate = '';
        let lastTradeDate = '';
        if (pos.trades.length > 0) {
            firstTradeDate = pos.trades[0].tradeDate;
            lastTradeDate = pos.trades[pos.trades.length - 1].tradeDate;
        }

        // 2. Find History Bounds
        const firstHistDate = firstHistoryDateMap[ticker] || '';
        const lastHistDate = lastHistoryDateMap[ticker] || '';

        // 3. Calculate Union Bounds
        // Start: Earliest of Trade or History
        let startDate = firstTradeDate;
        if (firstHistDate && (!startDate || firstHistDate < startDate)) {
            startDate = firstHistDate;
        }

        // End: Latest of Trade or History
        let endDate = lastTradeDate;
        if (lastHistDate && (!endDate || lastHistDate > endDate)) {
            endDate = lastHistDate;
        }

        // 4. Slice History
        if (startDate && endDate) {
            const startIndex = posState.history.findIndex((h: any) => h.date === startDate);
            const endIndex = posState.history.findIndex((h: any) => h.date === endDate);

            // Apply 1-day buffer if possible (visual padding)
            const sliceStart = Math.max(0, startIndex - 1);
            const sliceEnd = Math.min(posState.history.length, endIndex + 2);

            if (startIndex >= 0 && endIndex >= 0) {
                pos.history = posState.history.slice(sliceStart, sliceEnd);
            } else {
                // Fallback if dates not found in master timeline (unlikely)
                pos.history = posState.history;
            }
        } else {
            // No data?
            pos.history = posState.history;
        }

        pos.maxSizePercentAUM = posState.maxSizePercentAUM;
        pos.avgSizePercentAUM = posState.daysPresent > 0 ? posState.sumSizePercentAUM / posState.daysPresent : 0;

        // Filtering Logic
        const isCurrentlyHeld = Math.abs(pos.shares) > 0.00001;
        const isSignificant = pos.avgSizePercentAUM >= 1.0;

        if (isSignificant || isCurrentlyHeld) {
            pos.isSmallPosition = false;
        } else {
            pos.isSmallPosition = true;
        }
    });

    return Object.values(positionsMap);
};

/**
 * Main function to parse trade data and generate dashboard data.
 * Orchestrates the parsing of Blotter, History, and the Simulation loop.
 * @param file - The Excel file uploaded by the user.
 * @returns Promise resolving to DashboardData.
 */
export const parseTradeData = async (file: File): Promise<DashboardData> => {
    const data = await file.arrayBuffer();
    const workbook = read(data);

    // 1. Parse and Consolidate Trades
    let trades = parseTradeBlotter(workbook);
    trades = consolidateArgxTrades(trades);

    // 2. Parse History Sheet
    const { dailyAumMap, dailyPriceMap, lastHistoryDateMap, firstHistoryDateMap, historyDates } = parseHistorySheet(workbook);

    // 3. Build Master Timeline
    const tradeDates = new Set(trades.map(t => t.tradeDate));
    const allDates = Array.from(new Set([...Array.from(tradeDates), ...Array.from(historyDates)]));
    allDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    // 4. Run Simulation
    const { portfolioHistory, positionStates, currentHoldings } = simulatePortfolio(
        allDates,
        trades,
        dailyPriceMap,
        dailyAumMap
    );

    // 5. Finalize Positions
    const positions = finalizePositions(positionStates, currentHoldings, trades, lastHistoryDateMap, firstHistoryDateMap);

    return {
        positions,
        portfolioHistory,
        trades
    };
};
