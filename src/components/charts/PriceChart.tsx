import React, { useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from 'recharts';
import { Trade, PositionHistoryPoint } from '@/types/trade';

interface PriceChartProps {
    trades: Trade[];
    history: PositionHistoryPoint[];
}

const calculateMedian = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const CustomDot = (props: any) => {
    const { cx, cy, payload, medianQty } = props;
    const trade = payload as Trade;

    if (!trade || !cx || !cy || !trade.txnType) return null;

    const isBuy = trade.txnType === 'Buy' || trade.txnType === 'Cover';
    const color = isBuy ? '#22c55e' : '#ef4444';

    const qty = Math.abs(trade.quantity || 0);

    const TARGET_MEDIAN_SIZE = 5;
    const ratio = medianQty > 0 ? qty / medianQty : 1;
    const size = TARGET_MEDIAN_SIZE * Math.sqrt(ratio);
    const finalSize = Math.max(2, Math.min(30, size));

    return (
        <circle
            cx={cx}
            cy={cy}
            r={finalSize}
            fill={color}
            fillOpacity={0.5}
            stroke={color}
            strokeWidth={1}
        />
    );
};

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        const tradePayload = payload.find((p: any) => p.payload.tradeId);
        const historyPayload = payload.find((p: any) => p.dataKey === 'shares');
        const costPayload = payload.find((p: any) => p.dataKey === 'avgCostBasis');

        const data = tradePayload ? tradePayload.payload : (historyPayload ? historyPayload.payload : null);

        if (!data) return null;

        return (
            <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg z-50">
                <p className="font-bold text-gray-700">{new Date(data.date || data.tradeDate).toLocaleDateString()}</p>
                {tradePayload && (
                    <>
                        <p className="text-sm text-gray-600">
                            <span className="font-medium">Type:</span> {data.txnType}
                        </p>
                        <p className="text-sm text-gray-600">
                            <span className="font-medium">Price:</span> ${data.price.toFixed(2)}
                        </p>
                        <p className="text-sm text-gray-600">
                            <span className="font-medium">Qty:</span> {data.quantity.toLocaleString()}
                        </p>
                    </>
                )}
                {historyPayload && (
                    <p className="text-sm text-gray-600 mt-1">
                        <span className="font-medium">Shares Owned:</span> {historyPayload.value.toLocaleString()}
                    </p>
                )}
                {costPayload && (
                    <p className="text-sm text-gray-600 mt-1">
                        <span className="font-medium">Avg Cost:</span> ${costPayload.value.toFixed(2)}
                    </p>
                )}
            </div>
        );
    }
    return null;
};

export const PriceChart: React.FC<PriceChartProps> = ({ trades, history }) => {

    const chartData = useMemo(() => {
        return history.map(h => ({
            ...h,
            date: h.date,
            shares: h.shares,
            price: h.price,
            avgCostBasis: h.avgCostBasis
        }));
    }, [history]);

    const medianQty = useMemo(() => {
        const quantities = trades.map(t => Math.abs(t.quantity));
        return calculateMedian(quantities);
    }, [trades]);

    const tradeData = useMemo(() => {
        return trades.map(t => ({
            ...t,
            date: t.tradeDate,
            price: t.price,
            quantity: t.quantity
        }));
    }, [trades]);

    return (
        <div className="h-[500px] w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Price History & Position</h3>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                        dataKey="date"
                        type="category"
                        allowDuplicatedCategory={false}
                        tickFormatter={(date) => new Date(date).toLocaleDateString()}
                        stroke="#9ca3af"
                        fontSize={12}
                    />
                    <YAxis
                        yAxisId="left"
                        domain={['auto', 'auto']}
                        stroke="#3b82f6"
                        fontSize={12}
                        tickFormatter={(val) => `$${val}`}
                    />
                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#9ca3af"
                        fontSize={12}
                        tickFormatter={(val) => val.toLocaleString()}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />

                    {/* Shares Owned Line (Grey, Right Axis) */}
                    <Line
                        data={chartData}
                        yAxisId="right"
                        type="stepAfter"
                        dataKey="shares"
                        stroke="#9ca3af"
                        strokeWidth={2}
                        dot={false}
                        name="Shares Owned"
                    />

                    {/* Price Line (Blue, Left Axis) */}
                    <Line
                        data={chartData}
                        yAxisId="left"
                        type="monotone"
                        dataKey="price"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={false}
                        name="Price"
                    />

                    {/* Avg Cost Basis Line (Orange, Left Axis) */}
                    <Line
                        data={chartData}
                        yAxisId="left"
                        type="stepAfter"
                        dataKey="avgCostBasis"
                        stroke="#f97316"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="Avg Cost Basis"
                    />

                    {/* Trades (Bubbles) */}
                    <Line
                        data={tradeData}
                        yAxisId="left"
                        dataKey="price"
                        stroke="transparent"
                        dot={<CustomDot medianQty={medianQty} />}
                        activeDot={false}
                        isAnimationActive={false}
                        name="Trades"
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};
