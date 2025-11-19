export interface Trade {
  tradeId: string;
  description: string;
  ticker: string;
  tradeDate: string; // ISO Date string
  txnType: 'Buy' | 'Sell' | 'Short' | 'Cover' | 'Cash' | string;
  quantity: number;
  price: number;
  currency: string;
  netProceeds: number;
  fees: number;
  commissions: number;
}

export interface PositionHistoryPoint {
  date: string;
  price: number;
  shares: number;
  avgCostBasis: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
}

export interface Position {
  ticker: string;
  shares: number;
  averageCost: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  maxSizePercentAUM: number;
  avgSizePercentAUM: number;
  isSmallPosition: boolean;
  trades: Trade[];
  history: PositionHistoryPoint[];
}

export interface PortfolioState {
  date: string;
  holdings: Record<string, { shares: number; price: number }>; // Ticker -> { Shares, LastPrice }
  cash: number;
  aum: number;
}

export interface DashboardData {
  positions: Position[];
  portfolioHistory: PortfolioState[];
  trades: Trade[];
}
