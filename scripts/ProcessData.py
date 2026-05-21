"""Build the three NERC library CSV files."""

from pathlib import Path

import pandas as pd

from config import ROOT, NERC_DIR


NERC = NERC_DIR

JOBS = {
    "Top40.csv": NERC / "Top40",
    "Daily.csv": NERC / "Daily",
    "Hourly.csv": NERC / "Hourly",
}

COLUMNS = {
    "Top40.csv": [
        "Region",
        "Event_Type",
        "Year",
        "Month",
        "Date",
        "Daily_Min_Temp",
        "Daily_Avg_Temp",
        "Daily_Max_Temp",
        "3_Day_Rolling_Avg_Max_Temp",
        "3_Day_Rolling_Avg_Min_Temp",
        "Event_Temp",
    ],
    "Daily.csv": [
        "Region",
        "Date",
        "Daily_Min_Temp",
        "Daily_Avg_Temp",
        "Daily_Max_Temp",
        "3_Day_Rolling_Avg_Max_Temp",
        "3_Day_Rolling_Avg_Min_Temp",
    ],
    "Hourly.csv": [
        "Region",
        "Time_UTC",
        "T2",
        "Q2",
        "SWDOWN",
        "GLW",
        "WSPD",
        "Temperature_F",
    ],
}

SUFFIXES = (
    "_top_40_hottest_coldest_3day_average",
    "_hourly_data_filtered",
    "_daily_data",
)


def key(path):
    """Get the region key from a source file name."""
    name = path.stem
    for suffix in SUFFIXES:
        name = name.removesuffix(suffix)
    return name


def region_lookup():
    """Map source file keys to region names."""
    regions = {}
    for folder in JOBS.values():
        for path in folder.glob("*.csv"):
            df = pd.read_csv(path, nrows=1)
            if "Region" in df and not df.empty:
                regions.setdefault(key(path), df.at[0, "Region"])
    return regions


def build(name, folder, regions):
    """Join one folder of CSV files into one output CSV."""
    frames = []
    for path in sorted(folder.glob("*.csv")):
        df = pd.read_csv(path)
        # Some CSV files do not contain a "Region" column. 
        # For example: "canadawest_top_40_hottest_coldest_3day_average.csv"
        # Add the region column if it doesn't exist. Derive the Region from the filename. 
        if "Region" not in df:
            df.insert(0, "Region", regions.get(key(path), ""))
        frames.append(df)

    out = pd.concat(frames, ignore_index=True)
    out = out.reindex(columns=COLUMNS[name])
    out_folder = NERC
    out.to_csv(out_folder / name, index=False)
    print(f"{name}: {len(frames)} files, {len(out)} rows")


def top20():
    """Make Top20.csv from Top40.csv."""
    df = pd.read_csv(NERC / "Top40.csv")
    df["3_Day_Rolling_Avg_Max_Temp"] = pd.to_numeric(df["3_Day_Rolling_Avg_Max_Temp"])
    df["3_Day_Rolling_Avg_Min_Temp"] = pd.to_numeric(df["3_Day_Rolling_Avg_Min_Temp"])

    heat = df[df["Event_Type"] == "Heat Event"]
    heat = heat.sort_values(
        ["Region", "3_Day_Rolling_Avg_Max_Temp"], ascending=[True, False]
    )
    heat = heat.groupby("Region").head(20)

    cold = df[df["Event_Type"] == "Cold Event"]
    cold = cold.sort_values(
        ["Region", "3_Day_Rolling_Avg_Min_Temp"], ascending=[True, True]
    )
    cold = cold.groupby("Region").head(20)

    out = pd.concat([heat, cold], ignore_index=True)
    out.to_csv(NERC / "Top20.csv", index=False)
    print(f"Top20.csv: {len(out)} rows")


def main():
    """Build all output CSV files."""
    regions = region_lookup()
    for name, folder in JOBS.items():
        build(name, folder, regions)
    top20()


if __name__ == "__main__":
    main()
