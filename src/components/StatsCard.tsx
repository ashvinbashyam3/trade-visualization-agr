import React from 'react';
import { clsx } from 'clsx';

interface StatsCardProps {
    title: string;
    value: string | number;
    subValue?: string;
    trend?: 'up' | 'down' | 'neutral';
    className?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({ title, value, subValue, trend, className }) => {
    return (
        <div className={clsx("bg-white p-6 rounded-xl shadow-sm border border-gray-100", className)}>
            <h3 className="text-sm font-medium text-gray-500 mb-1">{title}</h3>
            <div className="flex items-baseline">
                <span className="text-2xl font-bold text-gray-900">{value}</span>
                {subValue && (
                    <span className={clsx("ml-2 text-sm font-medium", {
                        'text-green-600': trend === 'up',
                        'text-red-600': trend === 'down',
                        'text-gray-500': trend === 'neutral' || !trend
                    })}>
                        {subValue}
                    </span>
                )}
            </div>
        </div>
    );
};
