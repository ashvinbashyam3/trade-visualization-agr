'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FileUploader } from './FileUploader';
import { PriceChart } from './charts/PriceChart';
import { PnLChart } from './charts/PnLChart';
import { StatsCard } from './StatsCard';
import { parseTradeData } from '@/utils/parser';
import { DashboardData, Position } from '@/types/trade';
import { LayoutDashboard, TrendingUp, DollarSign, PieChart, Filter } from 'lucide-react';

export default function Dashboard() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [selectedTicker, setSelectedTicker] = useState<string>('');
    const [showAllPositions, setShowAllPositions] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const handleFileUpload = async (file: File) => {
        setIsLoading(true);
        try {
            const parsedData = await parseTradeData(file);
            setData(parsedData);

            // Select largest position by default (by Avg Size % AUM)
            if (parsedData.positions.length > 0) {
                const sortedByAvgSize = [...parsedData.positions].sort((a, b) => b.avgSizePercentAUM - a.avgSizePercentAUM);
                setSelectedTicker(sortedByAvgSize[0].ticker);
            }
        } catch (error) {
            console.error("Error parsing file:", error);
            alert("Error parsing file. Please ensure it matches the expected format.");
        } finally {
            setIsLoading(false);
        }
    };

    const filteredPositions = useMemo(() => {
        if (!data) return [];

        let positions = [...data.positions];

        if (!showAllPositions) {
            positions = positions.filter(p => !p.isSmallPosition);
        }

        if (showAllPositions) {
            return positions.sort((a, b) => a.ticker.localeCompare(b.ticker));
        } else {
            return positions.sort((a, b) => b.avgSizePercentAUM - a.avgSizePercentAUM);
        }
    }, [data, showAllPositions]);

    const currentPosition = useMemo(() => {
        return data?.positions.find(p => p.ticker === selectedTicker);
    }, [data, selectedTicker]);

    // Filter history for charts: From First Trade Date to Last Trade Date + Buffer
    const chartHistory = useMemo(() => {
        if (!currentPosition || !data) return [];

        const trades = currentPosition.trades;
        if (trades.length === 0) return currentPosition.history;

        const firstTradeTime = new Date(trades[0].tradeDate).getTime();
        const lastTradeTime = new Date(trades[trades.length - 1].tradeDate).getTime();

        const duration = lastTradeTime - firstTradeTime;
        const buffer = duration * 0.01; // 1% buffer

        const startTime = firstTradeTime - buffer;
        const endTime = lastTradeTime + buffer;

        return currentPosition.history.filter(h => {
            const d = new Date(h.date).getTime();
            return d >= startTime && d <= endTime;
        });
    }, [currentPosition, data]);

    if (!data) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
                <div className="max-w-xl w-full bg-white p-8 rounded-2xl shadow-lg">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">Trade Visualization</h1>
                    <p className="text-gray-500 text-center mb-8">Upload your trade blotter to get started</p>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                            <p className="text-gray-600">Processing data...</p>
                        </div>
                    ) : (
                        <FileUploader onFileUpload={handleFileUpload} />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col fixed h-full z-10">
                <div className="p-6 border-b border-gray-100">
                    <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <LayoutDashboard className="w-6 h-6 text-blue-600" />
                        TradeViz
                    </h1>
                </div>

                <div className="p-4 flex-1 overflow-y-auto">
                    <div className="mb-4">
                        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer p-2 hover:bg-gray-50 rounded-lg transition-colors">
                            <input
                                type="checkbox"
                                checked={showAllPositions}
                                onChange={(e) => setShowAllPositions(e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>Show All Positions</span>
                        </label>
                    </div>

                    <div className="space-y-1">
                        {filteredPositions.map((pos) => (
                            <button
                                key={pos.ticker}
                                onClick={() => setSelectedTicker(pos.ticker)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedTicker === pos.ticker
                                        ? 'bg-blue-50 text-blue-700'
                                        : 'text-gray-600 hover:bg-gray-50'
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <span>{pos.ticker}</span>
                                    {!showAllPositions && (
                                        <span className="text-xs text-gray-400">{pos.avgSizePercentAUM.toFixed(2)}%</span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 md:ml-64 p-8">
                <header className="mb-8 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">{selectedTicker}</h2>
                        <p className="text-gray-500 text-sm">Position Analysis</p>
                    </div>
                </header>

                {currentPosition ? (
                    <div className="space-y-6">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <StatsCard
                                title="Shares Owned"
                                value={currentPosition.shares.toLocaleString()}
                                className="border-l-4 border-l-blue-500"
                            />
                            <StatsCard
                                title="Avg Cost Basis"
                                value={`$${currentPosition.averageCost.toFixed(2)}`}
                                className="border-l-4 border-l-purple-500"
                            />
                            <StatsCard
                                title="Realized P&L"
                                value={`$${currentPosition.realizedPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                                trend={currentPosition.realizedPnL >= 0 ? 'up' : 'down'}
                                className="border-l-4 border-l-green-500"
                            />
                            <StatsCard
                                title="Total P&L"
                                value={`$${currentPosition.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                                trend={currentPosition.totalPnL >= 0 ? 'up' : 'down'}
                                className="border-l-4 border-l-orange-500"
                            />
                        </div>

                        {/* Charts Stacked Vertically */}
                        <div className="space-y-6">
                            <div className="w-full">
                                <PriceChart trades={currentPosition.trades} history={chartHistory} />
                            </div>
                            <div className="w-full">
                                <PnLChart position={{ ...currentPosition, history: chartHistory }} />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <p className="text-gray-500">Select a position to view details</p>
                    </div>
                )}
            </main>
        </div>
    );
}
