import pandas as pd
import os

file_path = 'Checkpoint Daily Portfolio History 111825.xlsx'

if not os.path.exists(file_path):
    print(f"File not found: {file_path}")
    exit()

xl = pd.ExcelFile(file_path)
print(f"Sheet names: {xl.sheet_names}")

# Find history sheet
hist_sheet = next((s for s in xl.sheet_names if 'history' in s.lower() or 'daily' in s.lower()), None)

if hist_sheet:
    print(f"Reading sheet: {hist_sheet}")
    df = pd.read_excel(file_path, sheet_name=hist_sheet)
    print("Columns:", df.columns.tolist())
    
    # Check for Date column
    date_col = next((c for c in df.columns if 'date' in str(c).lower() or 'as of' in str(c).lower()), None)
    ticker_col = next((c for c in df.columns if 'ticker' in str(c).lower() or 'symbol' in str(c).lower()), None)
    
    if date_col and ticker_col:
        print(f"Date Column: {date_col}")
        print(f"Ticker Column: {ticker_col}")
        
        # Check IRON entries
        iron_df = df[df[ticker_col] == 'IRON']
        if not iron_df.empty:
            print(f"Found {len(iron_df)} rows for IRON")
            print("First 5 rows:")
            print(iron_df.head())
            print("Last 5 rows:")
            print(iron_df.tail())
            
            # Check max date
            print(f"Max Date in File: {df[date_col].max()}")
            print(f"Max Date for IRON: {iron_df[date_col].max()}")
        else:
            print("No entries found for IRON")
    else:
        print("Could not identify Date or Ticker columns")
else:
    print("History sheet not found")
