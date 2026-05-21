"""Build WECC balancing authority grid masks for browser-side extrema overlays."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from shapely import contains_xy
from shapely.geometry import shape

from config import ROOT, BOUNDARIES_GEOJSON, WEATHER_DIR, BAMASKS_JSON as DEFAULT_OUTPUT


DEFAULT_GEOJSON = BOUNDARIES_GEOJSON
DEFAULT_WEATHER_DIR = WEATHER_DIR


def first_weather_metadata(weather_dir: Path) -> dict[str, Any]:
    for path in sorted(weather_dir.glob("*.json")):
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    raise SystemExit(f"No weather metadata JSON files found in {weather_dir}")


def build_masks(geojson_path: Path, weather_dir: Path) -> dict[str, Any]:
    metadata = first_weather_metadata(weather_dir)
    _, ny, nx = metadata["shape"]
    lon_min = float(metadata["lon_min"])
    lat_max = float(metadata["lat_max"])
    dx = float(metadata["dx"])
    dy = float(metadata["dy"])

    lons = lon_min + np.arange(nx) * dx
    lats = lat_max - np.arange(ny) * dy

    with geojson_path.open("r", encoding="utf-8") as file:
        geojson = json.load(file)

    authorities = []
    for feature in geojson["features"]:
        props = feature.get("properties", {})
        geom = shape(feature["geometry"])
        minx, miny, maxx, maxy = geom.bounds

        x_idx = np.where((lons >= minx) & (lons <= maxx))[0]
        y_idx = np.where((lats >= miny) & (lats <= maxy))[0]
        if not len(x_idx) or not len(y_idx):
            continue

        lon_grid, lat_grid = np.meshgrid(lons[x_idx], lats[y_idx])
        inside = contains_xy(geom, lon_grid, lat_grid)
        yy, xx = np.where(inside)
        indices = ((y_idx[yy] * nx) + x_idx[xx]).astype(np.int32)

        authorities.append(
            {
                "abbrev": props.get("BA_Abrev"),
                "name": props.get("BA_Name"),
                "indices": indices.tolist(),
            }
        )

    return {
        "generated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": str(geojson_path.relative_to(ROOT)).replace("\\", "/"),
        "grid": {
            "shape": [ny, nx],
            "lon_min": lon_min,
            "lat_max": lat_max,
            "dx": dx,
            "dy": dy,
        },
        "authorities": authorities,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geojson", type=Path, default=DEFAULT_GEOJSON)
    parser.add_argument("--weather-dir", type=Path, default=DEFAULT_WEATHER_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    masks = build_masks(args.geojson, args.weather_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as file:
        json.dump(masks, file, separators=(",", ":"))
        file.write("\n")

    cells = sum(len(item["indices"]) for item in masks["authorities"])
    print(f"Wrote {args.output} with {len(masks['authorities'])} BAs and {cells:,} grid cells.")


if __name__ == "__main__":
    main()
