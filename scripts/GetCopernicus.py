"""Download ERA5 GRIB data by year-month chunks to avoid rate limiting.

Strategy: Instead of one request per event day (287 requests), group by
year-month (58 requests — 80% fewer). Within each month, request only
the specific days we need (event dates ± 1 day for target regions, since
the NERC event Date is the CENTER of a 3-day window: day-before, event
day, and day-after).
After download, split the multi-day GRIB into individual day files.

This keeps ProcessCopernicus.py happy (expects one GRIB per day) while
drastically cutting API calls.
"""

from datetime import date, timedelta, datetime
from pathlib import Path
import re
import shutil
import sys
import time
import csv

from config import ROOT, COPERNICUS_DIR, TOP20_CSV, TARGET_REGIONS, DATASET, VARIABLES, AREA, CDS_URL, HOURS
sys.path.insert(0, str(ROOT))

try:
    from api_keys import copernicus_api_key
except ImportError:
    raise SystemExit(
        "api_keys.py not found. Copy .env.example to .env, set CDS_KEY, "
        "then run scripts/setup_api_keys.py (or create api_keys.py locally)."
    )


TOP20 = TOP20_CSV
DOWNLOAD_DIR = COPERNICUS_DIR


def _read_event_dates() -> set[date]:
    """Read all event dates for target regions from Top20.csv."""
    result: set[date] = set()
    with open(TOP20) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["Region"] in TARGET_REGIONS:
                result.add(datetime.strptime(row["Date"], "%m/%d/%Y").date())
    return result


def _day_range_in_month(year: int, month: int) -> list[int]:
    """Return [1, 2, ..., last_day] for the given month."""
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    this_month = date(year, month, 1)
    return list(range(1, (next_month - this_month).days + 1))


def needed_year_months() -> set[tuple[int, int]]:
    """Unique (year, month) combos covering all event dates ± 1 day.

    The NERC event Date is the CENTER of a 3-day window, so we need the
    day before, the event day, and the day after each event.
    """
    event_dates = _read_event_dates()
    expanded: set[date] = set()
    for d in event_dates:
        for offset in (-1, 0, 1):
            expanded.add(d + timedelta(days=offset))
    return {(d.year, d.month) for d in expanded}


def needed_days_for_month(year: int, month: int) -> list[int]:
    """Which days-of-month do we actually need (event ± 1 day)? Returns sorted unique ints.

    The NERC event Date is the CENTER of a 3-day window, so we need the
    day before, the event day, and the day after each event.
    """
    event_dates = _read_event_dates()
    expanded: set[date] = set()
    for d in event_dates:
        for offset in (-1, 0, 1):
            expanded.add(d + timedelta(days=offset))
    result = sorted({d.day for d in expanded if d.year == year and d.month == month})
    return result


def existing_dates() -> set[str]:
    """Set of ISO-format dates already on disk as daily GRIB files."""
    result: set[str] = set()
    for f in DOWNLOAD_DIR.glob("*_2m-temperature_*.grib"):
        m = re.search(r"_(\d{4}-\d{2}-\d{2})\.grib$", f.name)
        if m:
            result.add(m.group(1))
    return result


def missing_year_months() -> list[tuple[int, int, list[int]]]:
    """Return list of (year, month, needed_days) that still need downloading."""
    needed_ym = needed_year_months()
    present = existing_dates()

    event_dates = _read_event_dates()
    expanded: set[date] = set()
    for d in event_dates:
        for offset in (-1, 0, 1):
            expanded.add(d + timedelta(days=offset))

    result: list[tuple[int, int, list[int]]] = []
    for y, m in sorted(needed_ym):
        # Which expanded-days fall in this month?
        this_month_days = {d for d in expanded if d.year == y and d.month == m}
        missing_days = [d for d in sorted(this_month_days) if d.isoformat() not in present]
        if missing_days:
            result.append((y, m, [d.day for d in missing_days]))
    return result


def request_for_days(year: int, month: int, days: list[int]):
    """Build a CDS request for specific days in a month."""
    return {
        "product_type": ["reanalysis"],
        "variable": VARIABLES,
        "year": [f"{year}"],
        "month": [f"{month:02d}"],
        "day": [f"{d:02d}" for d in sorted(set(days))],
        "time": HOURS,
        "data_format": "grib",
        "download_format": "unarchived",
        "area": AREA,
    }


def month_path(year: int, month: int) -> Path:
    """Path for the multi-day month download file."""
    v = "_".join(v.replace("_", "-") for v in VARIABLES)
    return DOWNLOAD_DIR / f"era5_single_levels_{v}_{year}-{month:02d}.grib"


def split_to_daily(year: int, month: int, days: list[int]) -> None:
    """Split a multi-day month GRIB into individual day GRIB files using ecCodes."""
    source = month_path(year, month)
    if not source.exists():
        return

    import eccodes as ec

    v = "_".join(v.replace("_", "-") for v in VARIABLES)

    # Map (year, month, day) -> open file handles
    handles: dict[tuple[int, int, int], Path] = {}
    day_paths: dict[tuple[int, int, int], Path] = {}
    for day in sorted(set(days)):
        d = date(year, month, day)
        key = (year, month, day)
        p = DOWNLOAD_DIR / f"era5_single_levels_{v}_{d:%Y-%m-%d}.grib"
        day_paths[key] = p

    with open(source, "rb") as inf:
        while True:
            gid = ec.codes_grib_new_from_file(inf)
            if gid is None:
                break

            # Get date from this message
            msg_year = ec.codes_get(gid, "year")
            msg_month = ec.codes_get(gid, "month")
            msg_day = ec.codes_get(gid, "day")
            key = (msg_year, msg_month, msg_day)

            if key not in handles:
                if key not in day_paths:
                    # Day we didn't request — skip
                    ec.codes_release(gid)
                    continue
                if day_paths[key].exists():
                    ec.codes_release(gid)
                    continue
                # Open new output file
                tmp = day_paths[key].with_suffix(".grib.tmp")
                handles[key] = open(tmp, "wb")

            ec.codes_write(gid, handles[key])
            ec.codes_release(gid)

    # Close and rename all written files
    for key, fh in handles.items():
        fh.close()
        tmp = day_paths[key].with_suffix(".grib.tmp")
        shutil.move(str(tmp), str(day_paths[key]))
        sz = day_paths[key].stat().st_size
        print(f"  \u2514\u2500 Split {day_paths[key].name} ({sz:,} bytes)")


def main():
    try:
        import cdsapi
    except ImportError as e:
        raise SystemExit("Install cdsapi: pip install cdsapi") from e

    missing = missing_year_months()
    if not missing:
        print("✓ All needed data already on disk!")
        return

    # Summary
    total_days = sum(len(days) for _, _, days in missing)
    print(f"Need to download {len(missing)} year-month chunk(s) ({total_days} total days).")
    print(f"That's {len(missing)} API requests instead of {total_days} — "
          f"{total_days - len(missing)} fewer ({(1 - len(missing)/total_days)*100:.0f}% reduction).\n")

    client = cdsapi.Client(url=CDS_URL, key=copernicus_api_key)

    for y, m, days in missing:
        target = month_path(y, m)
        if target.exists():
            print(f"  ✓ {y}-{m:02d} already exists, splitting...")
            split_to_daily(y, m, days)
            continue

        tmp = target.with_suffix(".grib.tmp")
        print(f"  [{y}-{m:02d}] Requesting {len(days)} day(s): {days}", flush=True)

        try:
            client.retrieve(DATASET, request_for_days(y, m, days)).download(str(tmp))
            shutil.move(str(tmp), str(target))
            sz = target.stat().st_size
            print(f"  ✓ Downloaded {target.name} ({sz:,} bytes)", flush=True)

            # Split into daily GRIB files
            split_to_daily(y, m, days)

            # Remove the month file to save disk space (daily files cover our needs)
            target.unlink()
            print(f"  └─ Removed month file (extracted to individual day files)")

        except Exception as e:
            print(f"  ✗ FAILED {y}-{m:02d}: {e}", flush=True)
            if tmp.exists():
                tmp.unlink()
            # Backoff and retry once
            print("  └─ Retrying in 60 seconds...")
            time.sleep(60)
            try:
                client.retrieve(DATASET, request_for_days(y, m, days)).download(str(tmp))
                shutil.move(str(tmp), str(target))
                sz = target.stat().st_size
                print(f"  ✓ Downloaded on retry: {target.name} ({sz:,} bytes)", flush=True)
                split_to_daily(y, m, days)
                if target.exists():
                    target.unlink()
            except Exception as e2:
                print(f"  ✗ FAILED on retry: {e2}", flush=True)

        # Gentle delay between requests
        time.sleep(3)

    print(f"\n✓ Done! Downloaded {len(missing)} month chunk(s) → {total_days} daily files.")


if __name__ == "__main__":
    main()
