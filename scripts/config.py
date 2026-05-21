"""Shared project paths and configuration.

All scripts import from here instead of computing ROOT independently.
"""

from __future__ import annotations

from pathlib import Path


def _find_root() -> Path:
    """Locate project root: parent of scripts/ dir or cwd."""
    script_parent = Path(__file__).resolve().parents[1]
    if script_parent.joinpath("scripts").exists():
        return script_parent
    return Path.cwd()


ROOT = _find_root()

# ── Directories ──────────────────────────────────────────
SCRIPTS_DIR         = ROOT / "scripts"
DATA_DIR            = ROOT / "data"
WEATHER_DIR         = DATA_DIR / "weather"
BOUNDARIES_DIR      = DATA_DIR / "boundaries"
NERC_DIR            = ROOT / "NERC Library"
COPERNICUS_DIR      = ROOT / "Copernicus Data"
ASSETS_DIR          = ROOT / "assets"

# ── Paths ────────────────────────────────────────────────
EVENTS_JSON         = DATA_DIR / "events.json"
BAMASKS_JSON        = DATA_DIR / "wecc_ba_masks.json"
TOP20_CSV           = NERC_DIR / "Top20.csv"
HOURLY_CSV          = NERC_DIR / "Hourly.csv"
DAILY_CSV           = NERC_DIR / "Daily.csv"
TOP40_CSV           = NERC_DIR / "Top40.csv"
BOUNDARIES_GEOJSON  = BOUNDARIES_DIR / "wecc-balancing-authorities.geojson"
TPL_REGIONS_GEOJSON = BOUNDARIES_DIR / "tpl-008-regions.geojson"

# ── Processing defaults ──────────────────────────────────
TARGET_REGIONS = {"CanadaWest", "PacificNW", "GreatBasin", "RockyMtn", "California", "Southwest"}
FILL_VALUE = -32768

# ── ERA5 ─────────────────────────────────────────────────
DATASET = "reanalysis-era5-single-levels"
VARIABLES = ["2m_temperature"]
AREA = [60, -141, 30, -101]
CDS_URL = "https://cds.climate.copernicus.eu/api"
HOURS = [f"{hour:02d}:00" for hour in range(24)]

# ── Field specs (temperature-only for TPL-008) ───────────
FIELD_SPECS = {
    "temperature": {
        "folder": "t2m",
        "units": "degF",
        "scale": 0.1,
        "stored_value": "round(temperature_f * 10)",
    },
}
