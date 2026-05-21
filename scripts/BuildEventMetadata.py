"""Build browser event metadata from the NERC Top20 event library."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import ROOT, TOP20_CSV, HOURLY_CSV, COPERNICUS_DIR, EVENTS_JSON, TARGET_REGIONS


DEFAULT_TOP20 = TOP20_CSV
DEFAULT_HOURLY = HOURLY_CSV
DEFAULT_COPERNICUS_DIR = COPERNICUS_DIR
DEFAULT_OUTPUT = EVENTS_JSON
GRIB_DATE_RE = re.compile(r"_(\d{4}-\d{2}-\d{2})\.grib$", re.IGNORECASE)


def parse_date(value: str) -> str:
    """Return an ISO yyyy-mm-dd date from the CSV's date formats."""
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"Unsupported date format: {value!r}")


def parse_datetime_utc(value: str) -> datetime:
    """Return a naive UTC datetime from the CSV's timestamp formats."""
    value = value.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%m/%d/%Y %H:%M", "%m/%d/%y %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    raise ValueError(f"Unsupported UTC timestamp format: {value!r}")


def coerce_value(value: str) -> Any:
    """Make CSV values JSON-friendly while preserving useful strings."""
    value = value.strip()
    if value == "":
        return None

    try:
        number = float(value)
    except ValueError:
        return value

    if number.is_integer():
        return int(number)
    return number


def available_grib_dates(copernicus_dir: Path) -> set[str]:
    """Find dates available in local Copernicus GRIB files."""
    dates: set[str] = set()
    if not copernicus_dir.exists():
        return dates

    for path in copernicus_dir.glob("*.grib"):
        match = GRIB_DATE_RE.search(path.name)
        if match:
            dates.add(match.group(1))
    return dates


def read_top20(top20_path: Path) -> dict[str, list[dict[str, Any]]]:
    """Read Top20.csv into date-keyed rows."""
    events_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with top20_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for raw_row in reader:
            row = {key: coerce_value(value or "") for key, value in raw_row.items()}
            date = parse_date(str(raw_row["Date"]))
            row["Date"] = date
            events_by_date[date].append(row)
    return events_by_date


def hourly_marker(kind: str, row: dict[str, str], timestamp: datetime, temperature_f: float) -> dict[str, Any]:
    """Build a compact marker for the hourly min/max temperature timestamp."""
    return {
        "kind": kind,
        "time_utc": timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hour_utc": timestamp.hour,
        "temperature_f": round(temperature_f, 1),
        "source": "NERC Library/Hourly.csv",
        "SWDOWN": coerce_value(row.get("SWDOWN", "")),
        "WSPD": coerce_value(row.get("WSPD", "")),
    }


def read_hourly_extrema(hourly_path: Path = DEFAULT_HOURLY) -> dict[tuple[str, str], dict[str, Any]]:
    """Find hourly min and max temperatures by UTC date and region."""
    extrema: dict[tuple[str, str], dict[str, Any]] = {}
    if not hourly_path.exists():
        return extrema

    with hourly_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            region = (row.get("Region") or "").strip()
            if not region:
                continue

            timestamp = parse_datetime_utc(row["Time_UTC"])
            date = timestamp.date().isoformat()
            temperature_f = float(row["Temperature_F"])
            key = (date, region)
            current = extrema.setdefault(key, {})

            if "min" not in current or temperature_f < current["min"]["temperature_f"]:
                current["min"] = hourly_marker("min", row, timestamp, temperature_f)
            if "max" not in current or temperature_f > current["max"]["temperature_f"]:
                current["max"] = hourly_marker("max", row, timestamp, temperature_f)

    return extrema


def format_temp(values: list[float]) -> str:
    """Display a single event temperature or a compact min-max range."""
    if not values:
        return ""

    unique_values = sorted({round(value, 1) for value in values})
    if len(unique_values) == 1:
        return f"{unique_values[0]:.1f}"
    return f"{unique_values[0]:.1f}-{unique_values[-1]:.1f}"


def build_metadata(
    top20_path: Path = DEFAULT_TOP20,
    hourly_path: Path = DEFAULT_HOURLY,
    copernicus_dir: Path = DEFAULT_COPERNICUS_DIR,
    output_path: Path = DEFAULT_OUTPUT,
    target_regions: set[str] | None = None,
) -> dict[str, Any]:
    """Build the metadata object served to the web view.
    
    Args:
        target_regions: If provided, only include events from these regions.
    """
    events_by_date_raw = read_top20(top20_path)
    
    # Filter to target regions if specified
    if target_regions:
        events_by_date = {}
        for date_str, rows in events_by_date_raw.items():
            filtered = [r for r in rows if r.get("Region") in target_regions]
            if filtered:
                events_by_date[date_str] = filtered
    else:
        events_by_date = events_by_date_raw
    
    hourly_extrema_by_date_region = read_hourly_extrema(hourly_path)
    grib_dates = available_grib_dates(copernicus_dir)
    weather_dir = output_path.parent / "weather"
    all_regions = sorted(
        {
            str(row["Region"])
            for rows in events_by_date.values()
            for row in rows
            if row.get("Region")
        }
    )

    events: list[dict[str, Any]] = []
    for date in sorted(events_by_date):
        rows = sorted(events_by_date[date], key=lambda row: str(row.get("Region", "")))
        regions = sorted({str(row["Region"]) for row in rows if row.get("Region")})
        event_types = sorted({str(row["Event_Type"]) for row in rows if row.get("Event_Type")})
        temps = [
            float(row["Event_Temp"])
            for row in rows
            if isinstance(row.get("Event_Temp"), (int, float))
        ]
        weather_metadata_3day = weather_dir / f"{date}.3day.json"
        weather_metadata_single = weather_dir / f"{date}.json"
        grib_available = date in grib_dates
        # Prefer 3-day rolling pack; fall back to single-day
        if weather_metadata_3day.exists():
            weather_metadata = weather_metadata_3day
            weather_available = True
        else:
            weather_metadata = weather_metadata_single
            weather_available = weather_metadata.exists()
        hourly_extrema = []
        for row in rows:
            region = str(row.get("Region", ""))
            extrema = hourly_extrema_by_date_region.get((date, region))
            if not extrema:
                continue

            event_type = str(row.get("Event_Type", ""))
            highlight_kind = "max" if "heat" in event_type.lower() else "min"
            hourly_extrema.append(
                {
                    "region": region,
                    "event_type": event_type,
                    "highlight_kind": highlight_kind,
                    "highlight": extrema.get(highlight_kind),
                    "min": extrema.get("min"),
                    "max": extrema.get("max"),
                }
            )

        events.append(
            {
                "date": date,
                "Region": ", ".join(regions),
                "Event_Type": ", ".join(event_types),
                "Event_Temp": format_temp(temps),
                "regions": regions,
                "event_types": event_types,
                "event_temp_by_region": {
                    str(row["Region"]): row.get("Event_Temp")
                    for row in rows
                    if row.get("Region")
                },
                "event_temp_range": {
                    "min": min(temps) if temps else None,
                    "max": max(temps) if temps else None,
                },
                "grib_available": grib_available,
                "plot_available": weather_available,
                "weather_metadata": (
                    f"data/weather/{date}.3day.json"
                    if (weather_dir / f"{date}.3day.json").exists()
                    else f"data/weather/{date}.json"
                ) if weather_available else None,
                "grib_file": (
                    str(next(copernicus_dir.glob(f"*_{date}.grib")).relative_to(ROOT)).replace("\\", "/")
                    if grib_available
                    else None
                ),
                "hourly_extrema": hourly_extrema,
                "rows": rows,
            }
        )

    return {
        "generated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": str(top20_path.relative_to(ROOT)).replace("\\", "/"),
        "hourly_source": str(hourly_path.relative_to(ROOT)).replace("\\", "/"),
        "weather_metadata_template": "data/weather/{date}.json",
        "regions": all_regions,
        "events": events,
        "counts": {
            "rows": sum(len(rows) for rows in events_by_date.values()),
            "unique_dates": len(events),
            "grib_available": sum(1 for event in events if event["grib_available"]),
            "plot_available": sum(1 for event in events if event["plot_available"]),
        },
    }


def write_metadata(metadata: dict[str, Any], output_path: Path) -> None:
    """Write event metadata JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(metadata, file, indent=2)
        file.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top20", type=Path, default=DEFAULT_TOP20)
    parser.add_argument("--hourly", type=Path, default=DEFAULT_HOURLY)
    parser.add_argument("--copernicus-dir", type=Path, default=DEFAULT_COPERNICUS_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--all-regions", action="store_true", help="Include all regions (disable filtering)")
    args = parser.parse_args()

    target_regions = None if args.all_regions else TARGET_REGIONS
    metadata = build_metadata(args.top20, args.hourly, args.copernicus_dir, args.output, target_regions)
    write_metadata(metadata, args.output)
    counts = metadata["counts"]
    print(
        "Wrote "
        f"{args.output} with {counts['unique_dates']} dates, "
        f"{counts['grib_available']} GRIB-available, "
        f"{counts['plot_available']} plot-ready."
    )


if __name__ == "__main__":
    main()
