    const state = {
      library: null,
      selectedRegions: new Set(),
      eventTypeFilter: "all",
      sortKey: "date",
      sortDir: "asc",
      activeEvent: null,
      weatherMeta: null,
      field: "temperature",
      hour: 0,
      playing: false,
      playTimer: null,
      map: null,
      mapReady: false,
      weatherOverlayLoaded: false,
      weatherStripCount: 0,
      baMasks: null,
      baExtrema: null,
      spotSeries: null,
      spotBARange: null,
      spotHoverHour: null,
      spotPlotMeta: null,
      spotChartObj: null,
      chartRenderTimeout: null,
      spotPoint: null,
      spotLngLat: null,
      spotBAProps: null,
      selectedBAAbbrev: null,
      globalExtrema: null,
      globalExtrema: null,
      chartVisibility: {
        temperature: true,
        // wind_speed: false,
        ba_min: true,
        ba_max: true,
        // surface_solar_radiation_downwards: false
      },
      pointHoverPopup: null,
      pointHoverLayers: new Set(),
      tplRegionsVisible: false,
      dataCache: new Map()
    };

    const els = {
      status: document.getElementById("status"),
      regionList: document.getElementById("regionList"),
      eventRows: document.getElementById("eventRows"),
      map: document.getElementById("map"),
      clearRegions: document.getElementById("clearRegions"),
      eventTypeFilter: document.getElementById("eventTypeFilter"),
      paneResizer: document.getElementById("paneResizer"),
      chartResizer: document.getElementById("chartResizer"),
      canvas: document.getElementById("weatherCanvas"),
      readout: document.getElementById("readout"),
      playButton: document.getElementById("playButton"),
      fieldSelect: document.getElementById("fieldSelect"),
      hourSlider: document.getElementById("hourSlider"),
      hourLabel: document.getElementById("hourLabel"),
      extremeMarkers: document.getElementById("extremeMarkers"),
      legendBar: document.getElementById("legendBar"),
      legendLabels: document.getElementById("legendLabels"),
      spotPanel: document.getElementById("spotPanel"),
      spotTitle: document.getElementById("spotTitle"),
      spotChart: document.getElementById("spotChart"),
      closeSpot: document.getElementById("closeSpot"),
      downloadSpotCsv: document.getElementById("downloadSpotCsv"),
      mapSearchInput: document.getElementById("mapSearchInput"),
      mapSearchButton: document.getElementById("mapSearchButton"),
      toggleTplRegions: document.getElementById("toggleTplRegions"),
      toggleSubstations: document.getElementById("toggleSubstations"),
      infoButton: document.getElementById("infoButton"),
      creditsDialog: document.getElementById("creditsDialog"),
      closeCredits: document.getElementById("closeCredits"),
      rowCountButton: document.getElementById("rowCountButton")
    };

    const ctx = els.canvas.getContext("2d", { willReadFrequently: false });
    const baGeojsonUrl = "data/boundaries/wecc-balancing-authorities.geojson";
    const tplRegionsUrl = "data/boundaries/tpl-008-regions.geojson?v=2026-05-19-transmission";
    const transmissionPmtilesUrl = "data/transmission/transmission.pmtiles?v=2026-05-19-transmission";
    const dataVersion = "2026-05-05-v2";
    const defaultMapBounds = [[-141, 24], [-52, 60]];
    const baLayerIds = ["ba-fill", "ba-hover-fill", "ba-outline", "ba-label"];
    const baExtremaLayerIds = ["ba-temp-global-min", "ba-temp-global-max", "ba-temp-selected", "ba-temp-min", "ba-temp-max"];
    const weatherStripRows = 6;
    const TARGET_REGIONS = new Set(["CanadaWest", "PacificNW", "GreatBasin", "RockyMtn", "California", "Southwest"]);

    function maxHour() {
      return state.weatherMeta
        ? state.weatherMeta.shape[0] - 1
        : 23;
    }

    let hoveredBAId = null;
    const verticalGuidePlugin = {
      id: "verticalGuide",
      afterDraw(chart) {
        const active = chart.tooltip?.getActiveElements?.() || [];
        if (!active.length) return;
        const { ctx, chartArea } = chart;
        const x = active[0].element.x;
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "#18202a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      }
    };
    const extremaLabelsPlugin = {
      id: "extremaLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        chart.data.datasets.forEach((dataset, datasetIndex) => {
          if (!dataset.extremaHours) return;
          const meta = chart.getDatasetMeta(datasetIndex);
          dataset.extremaHours.forEach((hour) => {
            const point = meta.data[hour];
            const value = dataset.data[hour];
            if (!point || value === null || value === undefined) return;
            ctx.fillStyle = dataset.borderColor;
            ctx.font = "11px Segoe UI, sans-serif";
            ctx.fillText(Number(value).toFixed(1), point.x + 6, point.y - 6);
          });
        });
        ctx.restore();
      }
    };
    if (window.Chart) Chart.register(verticalGuidePlugin, extremaLabelsPlugin);
    const osmStyle = {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
        }
      },
      layers: [
        {
          id: "osm",
          type: "raster",
          source: "osm"
        }
      ]
    };

    function setStatus(text) {
      document.getElementById("statusText").textContent = text;
    }

    function showLoading(text) {
      document.getElementById("logo").classList.add("spin");
      document.getElementById("loader").hidden = false;
      if (text) document.getElementById("statusText").textContent = text;
    }

    function hideLoading() {
      document.getElementById("logo").classList.remove("spin");
      document.getElementById("loader").hidden = true;
    }

    function showError(msg) {
      const banner = document.getElementById("errorBanner");
      banner.textContent = msg;
      banner.hidden = false;
      setTimeout(() => { banner.hidden = true; }, 8000);
    }

    function hideError() {
      document.getElementById("errorBanner").hidden = true;
    }

    function fieldLabel(field) {
      return {
        temperature: "Temperature",
        // wind_speed: "Wind speed",
        // surface_solar_radiation_downwards: "Solar"
      }[field] || field;
    }

    function fieldUnits(field) {
      return {
        temperature: "degF",
        // wind_speed: "m/s",
        // surface_solar_radiation_downwards: "W/m2"
      }[field] || "";
    }

    function timestampForHour(hour = state.hour) {
      const stamps = state.weatherMeta?.timestamps_utc || [];
      return stamps[hour] || `${state.activeEvent?.date || ""}T${String(hour).padStart(2, "0")}:00:00Z`;
    }

    function formatUtc(timestamp) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return "UTC --:--";
      return `UTC ${date.toISOString().slice(11, 16)}`;
    }

    function formatPacific(timestamp) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return "Pacific --:--";
      return `${new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short"
      }).format(date)}`;
    }

    function formatUtcAxis(timestamp) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return "--Z";
      return `${date.toISOString().slice(11, 16)}Z`;
    }

    function formatPacificAxis(timestamp) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return "-- PT";
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short"
      }).format(date);
    }

    function markerTitle(marker, region) {
      return `${region} ${marker.kind}: ${marker.temperature_f.toFixed(1)} degF | ${formatPacific(marker.time_utc)}`;
    }

    function findWorstDataHour(event) {
      const key = cacheKey(event.date, state.field);
      const rawData = state.dataCache.get(key);
      if (!rawData || !state.weatherMeta) return 0;

      const shape = state.weatherMeta.shape;
      const [numHours, height, width] = shape;
      const scale = state.weatherMeta.fields.temperature?.scale || 0.1;
      const fillValue = state.weatherMeta.fields.temperature?.fill_value || -32768;
      const isCold = event.Event_Type?.toLowerCase().includes("cold");

      let worstHour = 0;
      let worstValue = isCold ? Infinity : -Infinity;

      for (let h = 0; h < numHours; h++) {
        const hourOffset = h * height * width;
        let extreme = isCold ? Infinity : -Infinity;
        for (let y = 0; y < height; y++) {
          const rowOffset = hourOffset + y * width;
          for (let x = 0; x < width; x++) {
            const raw = rawData[rowOffset + x];
            if (raw === fillValue) continue;
            const temp = raw * scale;
            if (isCold ? (temp < extreme) : (temp > extreme)) {
              extreme = temp;
            }
          }
        }
        if (isCold ? (extreme < worstValue) : (extreme > worstValue)) {
          worstValue = extreme;
          worstHour = h;
        }
      }

      return worstHour;
    }

    function formatEventTemp(event) {
      const byRegion = event.event_temp_by_region || {};
      const vals = Object.values(byRegion);
      if (!vals.length) return event.Event_Temp || "";
      return vals.map((v) => Number(v).toFixed(1)).join(", ");
    }

    // Build grouped events — one row per date with merged regions/temps
    function groupedEvents() {
      if (!state.library?.events?.length) return [];
      const map = new Map();
      const rawList = state.library.events;
      for (const raw of rawList) {
        const d = raw.date;
        if (!map.has(d)) {
          map.set(d, {
            date: d,
            Event_Type: raw.Event_Type,
            regions: [...(raw.regions || [])],
            event_temp_by_region: { ...(raw.event_temp_by_region || {}) },
            event_temp_range: raw.event_temp_range ? { min: raw.event_temp_range.min, max: raw.event_temp_range.max } : null,
            weather_metadata: raw.weather_metadata,
            grib_available: !!raw.grib_available,
            plot_available: !!raw.plot_available,
            hourly_extrema: raw.hourly_extrema,
          });
        } else {
          const g = map.get(d);
          if (raw.regions) g.regions = [...new Set([...g.regions, ...raw.regions])];
          if (raw.event_temp_by_region) Object.assign(g.event_temp_by_region, raw.event_temp_by_region);
          if (raw.weather_metadata) g.weather_metadata = raw.weather_metadata;
          if (raw.grib_available) g.grib_available = true;
          if (raw.plot_available) g.plot_available = true;
          if (raw.event_temp_range) {
            if (!g.event_temp_range) g.event_temp_range = {};
            if (raw.event_temp_range.min !== undefined) g.event_temp_range.min = Math.min(g.event_temp_range.min ?? Infinity, raw.event_temp_range.min);
            if (raw.event_temp_range.max !== undefined) g.event_temp_range.max = Math.max(g.event_temp_range.max ?? -Infinity, raw.event_temp_range.max);
          }
        }
      }
      return [...map.values()];
    }

    function eventWorstHour(event) {
      const markers = event.hourly_extrema || [];
      const heat = markers
        .filter((item) => item.event_type.toLowerCase().includes("heat") && item.max)
        .map((item) => item.max);
      if (heat.length) {
        return heat.reduce((best, item) => item.temperature_f > best.temperature_f ? item : best).hour_utc;
      }

      const cold = markers
        .filter((item) => item.event_type.toLowerCase().includes("cold") && item.min)
        .map((item) => item.min);
      if (cold.length) {
        return cold.reduce((best, item) => item.temperature_f < best.temperature_f ? item : best).hour_utc;
      }

      return markers[0]?.highlight?.hour_utc ?? 0;
    }

    function setLegend(field) {
      if (field === "temperature") {
        els.legendBar.style.background = "linear-gradient(90deg, #2351a6, #fffff5, #b6202e)";
        els.legendLabels.innerHTML = "<span>-40 degF</span><span>32 degF</span><span>120 degF</span>";
      }
      // Wind/solar legend hidden for TPL-008 temperature focus.
      // else if (field === "wind_speed") {...}
      // else if (field === "surface_solar_radiation_downwards") {...}
    }

    function mix(a, b, t) {
      return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t)
      ];
    }

    function ramp(value, stops) {
      if (value <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i += 1) {
        if (value <= stops[i][0]) {
          const [leftValue, leftColor] = stops[i - 1];
          const [rightValue, rightColor] = stops[i];
          return mix(leftColor, rightColor, (value - leftValue) / (rightValue - leftValue));
        }
      }
      return stops[stops.length - 1][1];
    }

    function colorFor(field, value) {
      if (field === "temperature") {
        return ramp(value, [
          [-40, [35, 81, 166]],
          [32, [255, 255, 245]],
          [120, [182, 32, 46]]
        ]);
      }
      // Wind/solar colors hidden for TPL-008 temperature focus.
      // if (field === "wind_speed") {...}
      // if (field === "surface_solar_radiation_downwards") {...}
      return [139, 148, 158];
    }

    function filteredEvents() {
      if (!state.library) return [];
      const groups = groupedEvents();
      const rows = groups.filter((event) => {
        const selected = Array.from(state.selectedRegions);
        const regionMatch =
          selected.length === 0 ||
          selected.every((region) => event.regions.includes(region));
        const typeText = event.Event_Type.toLowerCase();
        const typeMatch =
          state.eventTypeFilter === "all" ||
          (state.eventTypeFilter === "heat" && typeText.includes("heat")) ||
          (state.eventTypeFilter === "cold" && typeText.includes("cold"));
        return regionMatch && typeMatch;
      });
      return rows.sort(compareEvents);
    }

    function sortValue(event, key) {
      if (key === "Event_Temp") {
        const isCold = event.Event_Type.toLowerCase().includes("cold");
        const value = isCold ? event.event_temp_range?.min : event.event_temp_range?.max;
        return Number.isFinite(value) ? value : -Infinity;
      }
      return event[key] || "";
    }

    function compareEvents(a, b) {
      const av = sortValue(a, state.sortKey);
      const bv = sortValue(b, state.sortKey);
      let result = 0;
      if (typeof av === "number" && typeof bv === "number") {
        result = av - bv;
      } else {
        result = String(av).localeCompare(String(bv), undefined, { numeric: true });
      }
      return state.sortDir === "asc" ? result : -result;
    }

    function tempStyle(event) {
      const byRegion = event.event_temp_by_region || {};
      const vals = Object.values(byRegion).map(Number).filter(Number.isFinite);
      if (!vals.length) return "";
      const isCold = event.Event_Type.toLowerCase().includes("cold");
      const extreme = isCold ? Math.min(...vals) : Math.max(...vals);
      const intensity = isCold
        ? Math.min(0.9, Math.max(0.2, (45 - extreme) / 70))
        : Math.min(0.9, Math.max(0.2, (extreme - 70) / 45));
      const color = isCold ? `rgba(35, 103, 182, ${intensity})` : `rgba(195, 51, 51, ${intensity})`;
      return `background:${color};color:${intensity > 0.45 ? "#fff" : "#18202a"}`;
    }

    function weatherBadge(event) {
      const wm = event.weather_metadata || "";
      if (wm.includes("3day")) {
        return `<span class="badge ready" title="${wm}">3-day pack ready</span>`;
      }
      if (event.grib_available) {
        return `<span class="badge raw" title="GRIB on disk, pack not yet built">GRIB only</span>`;
      }
      return `<span class="badge" title="No local GRIB data">Pending</span>`;
    }

    function renderRows() {
      const rows = filteredEvents();
      els.eventRows.innerHTML = rows.map((event) => {
        // Filter to only target regions for display
        const byRegion = event.event_temp_by_region || {};
        const targetRegionTemps = Object.entries(byRegion)
          .filter(([r, t]) => TARGET_REGIONS.has(r))
          .sort(([a], [b]) => a.localeCompare(b));
        
        // Region column: comma-separated list of regions
        const regionList = targetRegionTemps.map(([r]) => r).join(", ");
        
        // Event_Temp column: comma-separated temps, individual coloring
        const tempCells = targetRegionTemps.map(([r, t]) => {
          const temp = Number(t);
          const isCold = event.Event_Type.toLowerCase().includes("cold");
          // Calculate intensity for individual cell coloring
          let intensity, color, textColor;
          if (isCold) {
            intensity = Math.min(0.9, Math.max(0.2, (45 - temp) / 70));
            color = `rgba(35, 103, 182, ${intensity})`;
          } else {
            intensity = Math.min(0.9, Math.max(0.2, (temp - 70) / 45));
            color = `rgba(195, 51, 51, ${intensity})`;
          }
          textColor = intensity > 0.45 ? "#fff" : "#18202a";
          return `<span class="temp-cell" style="background:${color};color:${textColor};padding:2px 6px;border-radius:4px;margin-right:4px;">${temp.toFixed(1)}</span>`;
        }).join("");
        
        return `<tr data-date="${event.date}" class="${state.activeEvent?.date === event.date ? "selected" : ""}">
          <td class="date-cell">${event.date}</td>
          <td class="region-cell">${regionList}</td>
          <td class="event-type-cell">${event.Event_Type}</td>
          <td>${tempCells}</td>
        </tr>`;
      }).join("");
      setStatus(`${rows.length} dates shown`);
      // Update row count button
      if (els.rowCountButton) {
        els.rowCountButton.textContent = `${rows.length} dates`;
      }
      const labels = { date: "Date", Region: "Region", Event_Type: "Event_Type", Event_Temp: "Event_Temp" };
      document.querySelectorAll("th[data-sort]").forEach((th) => {
        const marker = th.dataset.sort === state.sortKey ? (state.sortDir === "asc" ? " ^" : " v") : "";
        const labelText = labels[th.dataset.sort] + marker;
        
        // Update header text while preserving existing col-resizer element
        const resizer = th.querySelector('.col-resizer');
        if (resizer) {
          // Carefully preserve resizer element to maintain event listeners
          try {
            const parent = resizer.parentNode;
            if (parent) {
              parent.removeChild(resizer);
              parent.textContent = labelText;
              parent.appendChild(resizer);
            } else {
              // Fallback if something went wrong
              th.textContent = labelText;
            }
          } catch (e) {
            // Fallback if DOM manipulation fails
            th.textContent = labelText;
          }
        } else {
          th.textContent = labelText;
        }
      });
    }

    function buildRegionFilters() {
      const groups = groupedEvents();
      const activeRegions = [...new Set(groups.flatMap((e) => e.regions || []))].sort();
      els.regionList.innerHTML = activeRegions.map((region) => {
        const checked = state.selectedRegions.has(region) ? " checked" : "";
        return `<label class="region">
          <input type="checkbox" value="${region}"${checked}>
          <span>${region}</span>
        </label>`;
      }).join("");
    }

    function cacheKey(date, field) {
      return `${date}:${field}`;
    }

    function versionedUrl(path) {
      return `${path}${path.includes("?") ? "&" : "?"}v=${dataVersion}`;
    }

