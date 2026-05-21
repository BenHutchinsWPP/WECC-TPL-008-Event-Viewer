# NERC TPL-008 Extreme Weather Event Library Viewer

Start browsing events [Here](https://benhutchinswpp.github.io/WECC-TPL-008-Event-Viewer/)

Static browser viewer for NERC TPL-008 benchmark temperature events. The app shows event dates, temperature overlays, WECC balancing authority boundaries, daily min/max BA temperature points, and clicked-point temperature/wind charts. 

Warranty: None! Use at your own risk. Everything displayed is estimated and intended to help utilities better understand weather in their own footprints, including how weather may have progressed across their footprint for historical events. All engineering decisions should be backed by real measurement data, not the estimated data from this map! 

## Project Layout

- `index.html` - GitHub Pages entry point and application code.
- `assets/` - static image assets used by the page.
- `data/` - browser-served metadata, boundary layers, boundary masks, and weather packs.
- `NERC Library/` - source NERC benchmark event CSV/PDF files used by build scripts.
- `scripts/` - local build/download/process scripts.

## License

This project is licensed under [CC BY 4.0](LICENSE.md). See [LICENSE.md](LICENSE.md) for full attribution requirements and data source acknowledgements.

## Data And Credits

- NERC: [TPL-008-1 Reliability Standard](https://www.nerc.com/globalassets/standards/reliability-standards/tpl/tpl-008-1.pdf) and [TPL-008-1 Benchmark Temperature Events, April 2025](https://www.nerc.com/globalassets/standards/reliability-standards/tpl/tpl-008-1_benchmark_temperature_events_april_2025.pdf).
- Copernicus Climate Data Store: [ERA5 hourly data on single levels from 1940 to present](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels), DOI `10.24381/cds.adbb2d47`, CC-BY. This project contains modified Copernicus Climate Change Service information.
- WECC: [WECC Balancing Authorities](https://www.arcgis.com/home/item.html?id=83f3a587c78a4d0cbbf10f6586b5e2b1) boundary data.
- Map: [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) with [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles and contributors.
- Search: [OpenStreetMap Nominatim](https://operations.osmfoundation.org/policies/nominatim/).
- Charts: [Chart.js](https://www.chartjs.org/).

## Weather Fields

Available estimated weather data from ERA5:

- `2m_temperature`, converted to degrees F.
<!-- - `10m_u_component_of_wind` and `10m_v_component_of_wind`, converted to wind speed in m/s. -->
<!-- - `surface_solar_radiation_downwards`, converted to solar radiation in W/m^2. -->

## Local Build Scripts

- `scripts/ProcessData.py` builds combined NERC CSVs and `Top20.csv`.
- `scripts/GetCopernicus.py` downloads ERA5 GRIB files for selected event dates. Do not run unless you intend to fetch new Copernicus data. It requires using your own API key. 
- `scripts/ProcessCopernicus.py` converts local GRIB files into browser weather packs.
- `scripts/BuildEventMetadata.py` builds `data/events.json`.
- `scripts/BuildBAMasks.py` builds `data/wecc_ba_masks.json`.

