# Transmission Lines PMTiles

**File:** `transmission.pmtiles` (8.2 MB)
**Source:** `OSM to SHP/SHP_TEST/power_line_lines_processed.shp`
**Filter:** `nominal_kv >= 230` (18,835 lines)
**Clip:** `-clipsrc -141 30 -101 60` (matching config.py AREA)
**Voltage colors (MapLibre):** 500kV=red, 345kV=green, 230kV=blue
**Zoom range:** 2-12

## Regenerate

```bash
ogr2ogr -f GeoJSONSeq transmission.geojsonl \
  ../../OSM\ to\ SHP/SHP_TEST/power_line_lines_processed.shp \
  -where "nominal_kv >= 230" \
  -clipsrc -141 30 -101 60 \
  -select osm_id,name,nominal_kv,operator,cables,circuits,line_type \
  -lco COORDINATE_PRECISION=6

tippecanoe -o transmission.pmtiles -l power_lines \
  --minimum-zoom=2 --maximum-zoom=12 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --simplification=2 --maximum-tile-bytes=500000 \
  --read-parallel --force transmission.geojsonl
```
