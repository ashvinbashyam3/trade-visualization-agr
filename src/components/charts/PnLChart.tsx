import React from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend
} from 'recharts';
import { Position } from '@/types/trade';

interface PnLChartProps {
    position: Position;
}

export const PnLChart: React.FC<PnLChartProps> = ({ position }) => {
    const data = position.history;

    // Calculate max absolute value to determine units
    const maxValue = Math.max(
        ...data.map(d => Math.max(
            Math.abs(d.totalPnL),
            Math.abs(d.realizedPnL),
            Math.abs(d.unrealizedPnL)
        ))
    );

    const useMillions = maxValue >= 1000000;

    const formatYAxis = (val: number) => {
        if (val === 0) return '$0';
        if (useMillions) {
            return `$${(val / 1000000).toFixed(1)}M`;
        }
        return `$${(val / 1000).toFixed(0)}k`;
    };

    return (
        <div className="h-[400px] w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">P&L Over Time</h3>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                        dataKey="date"
                        tickFormatter={(date) => new Date(date).toLocaleDateString()}
                        stroke="#9ca3af"
                        fontSize={12}
                    />
                    <YAxis
                        stroke="#9ca3af"
                        fontSize={12}
                        tickFormatter={formatYAxis}
                    />
                    <Tooltip
                        content={({ active, payload, label }) => {
                            if (active && payload && payload.length && label) {
                                return (
                                    <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg">
                                        <p className="font-bold text-gray-700 mb-2">{new Date(label).toLocaleDateString()}</p>
                                        {payload.map((entry: any) => (
                                            <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
                                                <span className="font-medium">{entry.name}:</span> ${entry.value.toLocaleString()}
                                            </p>
                                        ))}
                                    </div>
                                );
                            }
                            return null;
                        }}
                    />
                    <Legend />
                    <Area
                        type="monotone"
                        dataKey="totalPnL"
                        stroke="#8884d8"
                        fill="#8884d8"
                        name="Total P&L"
                        fillOpacity={0.1}
                    />
                    <Area
                        type="monotone"
                        dataKey="realizedPnL"
                        stroke="#22c55e"
                        fill="#22c55e"
                        name="Realized P&L"
                        fillOpacity={0.1}
                    />
                    <Area
                        type="monotone"
                        dataKey="unrealizedPnL"
                        stroke="#3b82f6"
                        fill="#3b82f6"
                        name="Unrealized P&L"
                        fillOpacity={0.1}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};
