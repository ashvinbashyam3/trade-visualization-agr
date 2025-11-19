import { read, utils } from 'xlsx';
import { Trade, Position, DashboardData, PortfolioState, PositionHistoryPoint } from '../types/trade';

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

interface TaxLot {
    date: string;
    shares: number;
    costPerShare: number; // Includes fees/commissions allocated
    totalCost: number;
}

export const parseTradeData = async (file: File): Promise<DashboardData> => {
    const data = await file.arrayBuffer();
    const workbook = read(data);
    const sheetName = workbook.SheetNames.find(n => n.includes('Trade Blotter')) || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData: any[] = utils.sheet_to_json(sheet);

    const trades: Trade[] = [];

    // 1. Parse and Normalize Trades
    jsonData.forEach((row: any) => {
        const tradeId = row['Trade Id'];
        let ticker = row['Ticker'] || '';
        const txnType = row['Txn Type'] || '';

        if (!tradeId && !ticker && !txnType) return;
        if (ticker.includes('FX SPOT')) return;

        if (ticker) {
            ticker = ticker.replace('_PIPE', '');
        }

        let currency = 'USD';
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
        // Ensure quantity is absolute for logic, direction determined by Txn Type
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
            description: row['Description'],
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

    trades.sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());

    // 2. Reconstruct Portfolio History & Calculate AUM
    const portfolioHistory: PortfolioState[] = [];
    const positionsMap: Record<string, Position> = {};

    let currentCash = 0;
    const currentHoldings: Record<string, { shares: number; price: number }> = {};

    const tradesByDate: Record<string, Trade[]> = {};
    trades.forEach(t => {
        if (!t.tradeDate) return;
        const date = t.tradeDate;
        if (!tradesByDate[date]) tradesByDate[date] = [];
        tradesByDate[date].push(t);
    });

    const sortedDates = Object.keys(tradesByDate).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    // Track state for HIFO and Metrics
    const positionStates: Record<string, {
        shares: number;
        lots: TaxLot[]; // HIFO Lots
        realizedPnL: number;
        history: PositionHistoryPoint[];
        sumSizePercentAUM: number;
        daysPresent: number;
    }> = {};

    sortedDates.forEach(date => {
        const daysTrades = tradesByDate[date];

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
                        daysPresent: 0
                    };
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
                            // Consume entire lot
                            sharesToSell -= lot.shares;
                            costOfSharesSold += lot.totalCost;
                            lot.shares = 0; // Mark as empty, remove later
                        } else {
                            // Consume partial lot
                            const partialCost = sharesToSell * lot.costPerShare;
                            costOfSharesSold += partialCost;
                            lot.shares -= sharesToSell;
                            lot.totalCost -= partialCost;
                            sharesToSell = 0;
                        }
                    }

                    // Remove empty lots
                    posState.lots = posState.lots.filter(l => l.shares > 0.000001); // Epsilon for float precision

                    const proceeds = (trade.quantity * trade.price) - Math.abs(trade.commissions) - Math.abs(trade.fees);
                    const realized = proceeds - costOfSharesSold;
                    posState.realizedPnL += realized;
                }

                if (trade.price > 0) {
                    holding.price = trade.price;
                }
            }
        });

        // Calculate AUM
        let holdingsValue = 0;
        Object.values(currentHoldings).forEach(h => {
            holdingsValue += h.shares * h.price;
        });
        const aum = holdingsValue + currentCash;

        portfolioHistory.push({
            date,
            holdings: JSON.parse(JSON.stringify(currentHoldings)),
            cash: currentCash,
            aum
        });

        // Update History & Metrics
        Object.keys(positionStates).forEach(ticker => {
            const posState = positionStates[ticker];
            const holding = currentHoldings[ticker];
            const price = holding ? holding.price : 0;

            // Calculate Avg Cost Basis from remaining lots
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

            // Update Average Size Metrics
            // Only count days where position is active (shares != 0)
            if (Math.abs(posState.shares) > 0.00001) {
                const sizePercent = aum > 0 ? (marketValue / aum) * 100 : 0;
                posState.sumSizePercentAUM += sizePercent;
                posState.daysPresent += 1;
            }
        });

        // Max Size Logic (for filtering)
        daysTrades.forEach(trade => {
            if (!trade.ticker) return;
            const holding = currentHoldings[trade.ticker];
            const positionValue = holding.shares * holding.price;
            const sizePercent = aum > 0 ? (positionValue / aum) * 100 : 0;

            if (!positionsMap[trade.ticker]) {
                positionsMap[trade.ticker] = {
                    ticker: trade.ticker,
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
            const pos = positionsMap[trade.ticker];
            if (sizePercent > pos.maxSizePercentAUM) {
                pos.maxSizePercentAUM = sizePercent;
            }
        });
    });

    // Finalize Positions
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
        pos.history = posState.history;

        pos.avgSizePercentAUM = posState.daysPresent > 0 ? posState.sumSizePercentAUM / posState.daysPresent : 0;

        if (pos.avgSizePercentAUM < 0.5) {
            pos.isSmallPosition = true;
        }
    });

    return {
        positions: Object.values(positionsMap),
        portfolioHistory,
        trades
    };
};
