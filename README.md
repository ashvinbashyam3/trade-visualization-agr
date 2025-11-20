# Trade Visualization Dashboard

This is a [Next.js](https://nextjs.org) project designed to visualize portfolio trade history, performance metrics, and position details.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## System Overview

This application processes Excel-based portfolio data to generate interactive dashboards. It handles complex logic for specific assets, currency conversions, and position segregation.

### 1. Data Ingestion
The app parses two main sheets from the uploaded Excel file:

#### A. Trade Blotter
*   **Source**: Sheets named "Trade Blotter", "ITD Trade", or "Blotter".
*   **Purpose**: detailed record of all buy/sell transactions.
*   **Key Columns**:
    *   `Trade Id`: Unique identifier.
    *   `Ticker`: Asset symbol.
    *   `Description`: Asset description (crucial for identifying Options and ARGX share types).
    *   `Trade Date`: Date of transaction.
    *   `Txn Type`: Buy, Sell, Short, Cover, etc.
    *   `Notional Quantity`: Number of shares.
    *   `Trade Price`: Price per share.
    *   `Currency`: Trade currency (USD, EUR, etc.).
    *   `$ Trading Net Proceeds`: Net cash flow.
    *   `Fees`, `Gross Commissions`: Transaction costs.

#### B. Portfolio History
*   **Source**: Sheets named "ITD History", "Daily Portfolio", or "History Portfolio".
*   **Purpose**: Provides the "Source of Truth" for daily AUM and Prices. This ensures the dashboard shows a continuous timeline even on days with no trading activity.
*   **Key Columns**:
    *   `Date` / `As Of`: Valuation date.
    *   `Ticker`: Asset symbol.
    *   `Market Value`: Total value of the position on that day (Used for AUM calculation).
    *   `Market Price` / `Price`: Closing price on that day.
    *   `Quantity`: Shares held.

### 2. Core Logic & Transformations

#### A. ARGX Consolidation
The portfolio contains **Argenx (ARGX)** in two forms:
1.  **ADR (American Depositary Receipt)**: Traded in USD.
2.  **Ordinary Shares (ORD)**: Traded in EUR.

**Logic**:
*   The app identifies "ORD" trades/rows based on the Description ("ORD") or Currency ("EUR").
*   It converts ORD prices to USD using a fixed rate of **1.17 EUR/USD**.
*   It merges both ADR and ORD data into a single "ARGX" ticker.
*   **Daily Price Calculation**: `Implied Price = Total USD Market Value / Total Shares`.

#### B. Option Segregation
Options often share the same Ticker as the underlying equity in the raw data.
**Logic**:
*   The app detects options by looking for keywords in the Description (`CALL`, `PUT`, `EXP`) or regex patterns in the Ticker.
*   **Segregation**: If detected, the Option is assigned a unique Ticker ID based on its Description (e.g., "RYTM 07/18/25 C25").
*   This ensures Options are analyzed as separate securities and do not pollute the metrics of the underlying Equity.

#### C. FX Filtering
*   Positions identified as "FX SPOT", "EURUSD", or "USDEUR" are explicitly filtered out from both the Trade Blotter and History to focus solely on investment assets.

#### D. AUM & Metrics
*   **Daily AUM**: Calculated by summing the `Market Value` column from the History sheet for all positions on a given date.
*   **Position Size**: `(Position Market Value / Daily AUM) * 100`.
*   **Filtering**: By default, the dashboard shows positions that are either **Currently Held** OR have an **Average Size >= 1%** of the portfolio.

## Data Schema Reference (Excel)

Since the raw data file is not stored in the repo, here is the expected schema:

| Field Category | Expected Column Names (Case-Insensitive) |
| :--- | :--- |
| **Trade ID** | `Trade Id` |
| **Ticker** | `Ticker`, `Symbol`, `Security` |
| **Description** | `Description`, `Security Description`, `Name` |
| **Date** | `Trade Date` (Blotter), `Date`, `As Of` (History) |
| **Type** | `Txn Type`, `Action` |
| **Quantity** | `Notional Quantity`, `Quantity`, `Qty`, `Shares` |
| **Price** | `Trade Price`, `Market Price`, `Price`, `Close` |
| **Value** | `Market Value`, `MV`, `$ Trading Net Proceeds` |
| **Currency** | `Currency`, `Price Currency` |
