"""Combine 3 single-day weather packs into 3-day rolling packs per event date.

For each event date in Top20.csv, merge date-1, date, and date+1 packs into
one 72-hour weather pack stored under the event date.  The NERC event Date
is the CENTER of the 3-day window: day before, event day, day after.

Usage:
    py -3.11 Combine3Day.py                        # all events
    py -3.11 Combine3Day.py --date 2020-09-06      # single event
    py -3.11 Combine3Day.py --all                   # all events
"""

from __future__ import annotations

import argparse
import gzip
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from config import ROOT, TOP20_CSV, WEATHER_DIR, TARGET_REGIONS, FILL_VALUE


TOP20 = TOP20_CSV


def load_single_pack(date_str: str) -> dict[str, Any] | None:
    """Load a single-day weather metadata and binary data, or None if missing."""
    meta_path = WEATHER_DIR / f"{date_str}.json"
    if not meta_path.exists():
        return None

    with meta_path.open("r", encoding="utf-8") as f:
        meta = json.load(f)

    field_spec = meta.get("fields", {}).get("temperature")
    if not field_spec:
        return None

    bin_path = ROOT / field_spec["path"]
    
    # Handle gzip compression - check if path ends with .gz or has compression flag
    is_gzipped = str(bin_path).endswith('.gz') or field_spec.get('compression') == 'gzip'
    
    if is_gzipped:
        # Path already includes .gz, use directly
        gz_path = bin_path
        if not gz_path.exists():
            # Fallback: try adding .gz even if path didn't end with it
            gz_path = bin_path.parent / f"{bin_path.name}.gz"
        if gz_path.exists():
            with gzip.open(gz_path, 'rb') as f:
                data = np.frombuffer(f.read(), dtype="<i2")
        else:
            return None
    elif bin_path.exists():
        data = np.fromfile(bin_path, dtype="<i2")
    else:
        return None

    scale = float(field_spec["scale"])
    shape = list(meta["shape"])
    data = data.reshape(shape)

    return {
        "meta": meta,
        "data": data,
        "scale": scale,
        "shape": shape,
    }


def build_3day_pack(event_date_str: str) -> dict[str, Any] | None:
    """Merge 3 single-day packs into one 72-hour pack for an event date."""
    dt = pd.to_datetime(event_date_str).date()
    date_strings = [
        (dt - timedelta(days=1)).isoformat(),
        dt.isoformat(),
        (dt + timedelta(days=1)).isoformat(),
    ]

    packs = []
    for ds in date_strings:
        pack = load_single_pack(ds)
        if pack is None:
            print(f"  Missing pack for {ds}, skipping {event_date_str}", flush=True)
            return None
        packs.append(pack)

    # Stack data: concatenate along hour axis
    combined_data = np.concatenate([p["data"] for p in packs], axis=0)
    combined_times = []
    for ds in date_strings:
        combined_times.extend(
            [f"{ds}T{str(h).zfill(2)}:00:00Z" for h in range(24)]
        )

    # Use first pack's metadata as template
    template = packs[0]["meta"]
    shape = list(combined_data.shape)

    # Scale check: all packs should use same scale
    scales = {p["scale"] for p in packs}
    scale = scales.pop()

    # Build new metadata
    metadata = dict(template)
    metadata["date"] = event_date_str
    metadata["shape"] = shape
    metadata["timestamps_utc"] = combined_times
    metadata["description"] = f"3-day rolling pack ({date_strings[0]} to {date_strings[2]})"

    # Update temperature field path - gzip compressed
    field_bin = WEATHER_DIR / "t2m" / f"{event_date_str}.3day.i16.bin"
    gz_path = field_bin.parent / f"{field_bin.name}.gz"
    field_bin.parent.mkdir(parents=True, exist_ok=True)
    
    # Write gzipped binary
    with gzip.open(gz_path, 'wb', compresslevel=9) as f:
        f.write(combined_data.astype("<i2").tobytes())

    metadata["fields"]["temperature"]["path"] = str(
        field_bin.relative_to(ROOT)
    ).replace("\\", "/") + ".gz"
    metadata["fields"]["temperature"]["compression"] = "gzip"

    # Write JSON
    out_path = WEATHER_DIR / f"{event_date_str}.3day.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        f.write("\n")

    print(f"  Wrote {out_path.name} ({shape[0]} timestamps, {shape[1]}x{shape[2]} grid)", flush=True)
    return metadata


def event_dates(args: argparse.Namespace) -> list[str]:
    """Get event dates from Top20.csv, filtered to TARGET_REGIONS."""
    df = pd.read_csv(TOP20, usecols=["Date", "Region"])
    df = df[df["Region"].isin(TARGET_REGIONS)]
    dates = sorted(pd.to_datetime(df["Date"]).dt.date.unique())

    if args.date:
        # Filter to requested date
        target = pd.to_datetime(args.date).date()
        if target not in dates:
            raise SystemExit(f"{args.date} not found in {TOP20} (or not in target regions)")
        return [target.isoformat()]

    return [d.isoformat() for d in dates]


def update_events_json() -> None:
    """Rebuild events.json so 3day packs are discoverable."""
    from BuildEventMetadata import build_metadata, write_metadata
    from config import TARGET_REGIONS

    ev = ROOT / "data" / "events.json"
    metadata = build_metadata(output_path=ev, target_regions=TARGET_REGIONS)
    write_metadata(metadata, ev)
    print(f"  Refreshed {ev}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="Process one event date, yyyy-mm-dd.")
    parser.add_argument("--all", action="store_true", help="Process all event dates.")
    args = parser.parse_args()

    if not args.date and not args.all:
        args.all = True

    dates = event_dates(args)
    print(f"Building 3-day packs for {len(dates)} event date(s)...", flush=True)

    count = 0
    for ed in dates:
        result = build_3day_pack(ed)
        if result:
            count += 1

    print(f"Done: {count} 3-day pack(s) built.", flush=True)

    if count:
        update_events_json()


if __name__ == "__main__":
    main()
