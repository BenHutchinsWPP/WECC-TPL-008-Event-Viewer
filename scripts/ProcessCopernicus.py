"""Convert local Copernicus GRIB files into lazy-loaded browser weather packs.

Now temperature-only (TPL-008 3-day rolling avg focus). Wind/solar code
kept as comments for future re-enable.
"""

from __future__ import annotations

import argparse
import json
import re
import warnings
import gzip
from pathlib import Path
from typing import Any

import numpy as np

from config import ROOT, COPERNICUS_DIR, WEATHER_DIR, EVENTS_JSON, TARGET_REGIONS, FILL_VALUE, FIELD_SPECS


RAW_DIR = COPERNICUS_DIR
OUT_DIR = WEATHER_DIR
DATE_RE = re.compile(r"_(\d{4}-\d{2}-\d{2})\.grib$", re.IGNORECASE)

warnings.filterwarnings("ignore", message="Pandas requires version", category=UserWarning)
warnings.filterwarnings("ignore", message="In a future version of xarray.*", category=FutureWarning)


def grib_date(path: Path) -> str | None:
    match = DATE_RE.search(path.name)
    return match.group(1) if match else None


def grib_files(raw_dir: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for path in sorted(raw_dir.glob("*_2m-temperature_*.grib")):
        date = grib_date(path)
        if date:
            files[date] = path
    return files


def selected_files(args: argparse.Namespace) -> list[tuple[str, Path]]:
    files = grib_files(args.raw_dir)
    if args.date:
        selected = []
        for date in args.date:
            if date not in files:
                raise SystemExit(f"No GRIB file found for {date}")
            selected.append((date, files[date]))
        return selected

    if args.all:
        return sorted(files.items())

    missing = [
        (date, path)
        for date, path in sorted(files.items(), reverse=True)
        if not (args.out_dir / f"{date}.json").exists()
    ]
    if missing:
        return [missing[0]]

    latest = sorted(files.items())[-1:]
    return latest


def as_utc_strings(times: np.ndarray) -> list[str]:
    return [np.datetime_as_string(value, unit="s") + "Z" for value in times]


def spatial_arrays(dataset: Any) -> tuple[np.ndarray, np.ndarray]:
    lats = np.asarray(dataset["latitude"].values, dtype=np.float64)
    lons = np.asarray(dataset["longitude"].values, dtype=np.float64)
    return lats, lons


def normalize_orientation(
    values: dict[str, np.ndarray],
    lats: np.ndarray,
    lons: np.ndarray,
) -> tuple[dict[str, np.ndarray], np.ndarray, np.ndarray]:
    if lats[0] < lats[-1]:
        lats = lats[::-1]
        values = {name: array[:, ::-1, :] for name, array in values.items()}
    if lons[0] > lons[-1]:
        lons = lons[::-1]
        values = {name: array[:, :, ::-1] for name, array in values.items()}
    return values, lats, lons


def pack_i16(values: np.ndarray, scale: float) -> np.ndarray:
    scaled = np.rint(values / scale)
    scaled = np.where(np.isfinite(scaled), scaled, FILL_VALUE)
    scaled = np.clip(scaled, FILL_VALUE, 32767)
    return scaled.astype("<i2", copy=False)


def write_binary(path: Path, values: np.ndarray, scale: float, overwrite: bool, gzip_compress: bool = True) -> None:
    """Write binary data, optionally gzip compressed."""
    gz_path = path.parent / f"{path.name}.gz"
    
    # Skip if gzipped version exists and not overwriting
    if gz_path.exists() and not overwrite:
        return
    if path.exists() and not gzip_compress and not overwrite:
        return
        
    path.parent.mkdir(parents=True, exist_ok=True)
    data = pack_i16(values, scale)
    
    if gzip_compress:
        with gzip.open(gz_path, 'wb', compresslevel=9) as f:
            f.write(data.tobytes())
    else:
        data.tofile(path)


def open_grib(path: Path) -> xr.Dataset:
    """Open GRIB file with xarray+cfgrib. Returns xarray Dataset."""
    try:
        import xarray as xr
    except ImportError as error:
        raise SystemExit("Install xarray first: pip install xarray") from error

    try:
        ds = xr.open_dataset(str(path), engine="cfgrib")
    except Exception as error:
        raise SystemExit(f"Failed to open {path.name}: {error}") from error

    return ds


def process_grib(date: str, grib_path: Path, out_dir: Path, overwrite: bool = False) -> Path:
    dataset = open_grib(grib_path)
    times = np.asarray(dataset["valid_time"].values).astype("datetime64[ns]")

    t2m_k = np.asarray(dataset["t2m"].values, dtype=np.float32)
    temperature_f = (t2m_k - 273.15) * 9.0 / 5.0 + 32.0

    lats, lons = spatial_arrays(dataset)
    values, lats, lons = normalize_orientation(
        {"temperature": temperature_f}, lats, lons
    )

    shape = list(values["temperature"].shape)
    metadata_path = out_dir / f"{date}.json"
    fields: dict[str, Any] = {}

    for field_name, spec in FIELD_SPECS.items():
        bin_path = out_dir / spec["folder"] / f"{date}.i16.bin"
        write_binary(bin_path, values[field_name], float(spec["scale"]), overwrite, gzip_compress=True)
        fields[field_name] = {
            "path": str(bin_path.relative_to(ROOT)).replace("\\", "/") + ".gz",
            "type": "Int16",
            "byte_order": "little-endian",
            "scale": spec["scale"],
            "units": spec["units"],
            "fill_value": FILL_VALUE,
            "stored_value": spec["stored_value"],
            "compression": "gzip",
        }

    dx = float(abs(lons[1] - lons[0])) if len(lons) > 1 else 0.0
    dy = float(abs(lats[1] - lats[0])) if len(lats) > 1 else 0.0
    metadata = {
        "date": date,
        "source_grib": str(grib_path.relative_to(ROOT)).replace("\\", "/"),
        "bounds": [float(lons.min()), float(lats.min()), float(lons.max()), float(lats.max())],
        "shape": shape,
        "timestamps_utc": as_utc_strings(times),
        "lon_min": float(lons.min()),
        "lat_max": float(lats.max()),
        "dx": dx,
        "dy": dy,
        "grid": {
            "origin": "northwest",
            "lon_min": float(lons.min()),
            "lat_max": float(lats.max()),
            "dx": dx,
            "dy": dy,
        },
        "fields": fields,
        "source": {
            "name": "ERA5 single levels hourly data",
            "url": "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels",
            "license": "CC-BY",
            "citation": "Copernicus Climate Change Service (C3S). ERA5 hourly data on single levels from 1940 to present. Copernicus Climate Data Store.",
            "attribution": "The results contain modified Copernicus Climate Change Service information. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.",
        },
        "derived_fields": {
            "temperature": "Converted from Kelvin to Fahrenheit.",
        },
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8") as file:
        json.dump(metadata, file, indent=2)
        file.write("\n")

    return metadata_path


def refresh_events() -> None:
    from BuildEventMetadata import build_metadata, write_metadata, TARGET_REGIONS

    metadata = build_metadata(output_path=EVENTS_JSON, target_regions=TARGET_REGIONS)
    write_metadata(metadata, EVENTS_JSON)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", action="append", help="Process one date, yyyy-mm-dd. May be repeated.")
    parser.add_argument("--all", action="store_true", help="Process every local GRIB date.")
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--skip-events-refresh", action="store_true")
    args = parser.parse_args()

    selected = selected_files(args)
    if not selected:
        raise SystemExit(f"No GRIB files found in {args.raw_dir}")

    print(f"Processing {len(selected)} date(s).")
    for date, path in selected:
        target = process_grib(date, path, args.out_dir, args.overwrite)
        print(f"Wrote {target}")

    if not args.skip_events_refresh:
        refresh_events()
        print(f"Refreshed {EVENTS_JSON}")


if __name__ == "__main__":
    main()
