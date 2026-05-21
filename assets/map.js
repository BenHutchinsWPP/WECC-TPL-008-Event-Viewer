    const tplRegionLayerIds = ["tpl-regions-fill", "tpl-regions-line", "tpl-regions-label"];

    function addBalancingAuthorities() {
      if (!state.map || state.map.getSource("wecc-ba")) return;
      state.map.addSource("wecc-ba", {
        type: "geojson",
        data: baGeojsonUrl,
        promoteId: "FID"
      });
      state.map.addLayer({
        id: "ba-fill",
        type: "fill",
        source: "wecc-ba",
        paint: {
          "fill-color": "#ffffff",
          "fill-opacity": 0.08
        }
      });
      state.map.addLayer({
        id: "ba-hover-fill",
        type: "fill",
        source: "wecc-ba",
        paint: {
          "fill-color": "#f5b642",
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.22, 0]
        }
      });
      state.map.addLayer({
        id: "ba-outline",
        type: "line",
        source: "wecc-ba",
        paint: {
          "line-color": "#111827",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 7, 1.6, 10, 2.4],
          "line-opacity": 0.85
        }
      });
      state.map.addLayer({
        id: "ba-label",
        type: "symbol",
        source: "wecc-ba",
        layout: {
          "text-field": ["get", "BA_Abrev"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 7, 14, 10, 18],
          "text-allow-overlap": false,
          "text-ignore-placement": false
        },
        paint: {
          "text-color": "#111827",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5
        }
      });

      state.map.on("mouseenter", "ba-fill", () => {
        state.map.getCanvas().style.cursor = "pointer";
      });
      state.map.on("mousemove", "ba-fill", (event) => {
        const feature = event.features && event.features[0];
        if (!feature) return;
        if (hoveredBAId !== null && hoveredBAId !== feature.id) {
          state.map.setFeatureState({ source: "wecc-ba", id: hoveredBAId }, { hover: false });
        }
        hoveredBAId = feature.id;
        state.map.setFeatureState({ source: "wecc-ba", id: hoveredBAId }, { hover: true });
      });
      state.map.on("mouseleave", "ba-fill", () => {
        state.map.getCanvas().style.cursor = "";
        if (hoveredBAId !== null) {
          state.map.setFeatureState({ source: "wecc-ba", id: hoveredBAId }, { hover: false });
        }
        hoveredBAId = null;
      });
    }

    function toggleTplRegions() {
      console.log("toggleTplRegions called");
      if (!state.map || !state.mapReady) {
        console.log("Map not ready or not available");
        return;
      }
      state.tplRegionsVisible = !state.tplRegionsVisible;
      console.log("TPL regions visible:", state.tplRegionsVisible);
      els.toggleTplRegions.classList.toggle("primary", state.tplRegionsVisible);

      if (!state.tplRegionsVisible) {
        console.log("Removing TPL region layers");
        for (const layerId of tplRegionLayerIds) {
          if (state.map.getLayer(layerId)) state.map.removeLayer(layerId);
        }
        if (state.map.getSource("tpl-regions")) state.map.removeSource("tpl-regions");
        return;
      }

      console.log("Adding TPL region layers");
      state.map.addSource("tpl-regions", {
        type: "geojson",
        data: tplRegionsUrl
      });
      state.map.addLayer({
        id: "tpl-regions-fill",
        type: "fill",
        source: "tpl-regions",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.12
        }
      });
      state.map.addLayer({
        id: "tpl-regions-line",
        type: "line",
        source: "tpl-regions",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.2
        }
      });
      state.map.addLayer({
        id: "tpl-regions-label",
        type: "symbol",
        source: "tpl-regions",
        layout: {
          "text-field": ["get", "Name"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 14
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5
        }
      });
      // Push TPL region layers above BA/weather overlays
      for (const layerId of tplRegionLayerIds) {
        if (state.map.getLayer(layerId)) state.map.moveLayer(layerId);
      }
      keepBalancingAuthoritiesOnTop();
      console.log("TPL region layers added");
    }

    function addTransmissionLines() {
      if (!state.map || state.map.getSource("transmission")) return;

      state.map.addSource("transmission", {
        type: "vector",
        url: "pmtiles://" + transmissionPmtilesUrl
      });

      state.map.addLayer({
        id: "transmission-lines",
        type: "line",
        source: "transmission",
        "source-layer": "power_lines",
        paint: {
          "line-color": [
            "case",
            [">=", ["coalesce", ["get", "nominal_kv"], 0], 500], "#ff1a1a",
            [">=", ["coalesce", ["get", "nominal_kv"], 0], 345], "#33ff33",
            [">=", ["coalesce", ["get", "nominal_kv"], 0], 230], "#4488ff",
            "#cccccc"
          ],
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            2, 0.6,
            5, 1.2,
            8, 2.5,
            12, 4.0
          ],
          "line-opacity": 1.0
        }
      }, "ba-label");
    }

    let substationPopup = null;

    function addTransmissionSubstations() {
      if (!state.map || state.map.getSource("substations")) return;

      state.map.addSource("substations", {
        type: "geojson",
        data: "data/transmission/substations.geojson?v=2026-05-19-transmission"
      });

      state.map.addLayer({
        id: "substations",
        type: "circle",
        source: "substations",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            2, 4,
            6, 6,
            10, 8,
            12, 10
          ],
          "circle-color": [
            "case",
            [">=", ["coalesce", ["get", "nominal_kv"], -1], 500], "#ff1a1a",
            [">=", ["coalesce", ["get", "nominal_kv"], -1], 345], "#33ff33",
            [">=", ["coalesce", ["get", "nominal_kv"], -1], 230], "#4488ff",
            ["==", ["get", "nominal_kv"], null], "#666666",
            "#666666"
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2
        }
      });
      state.substationsVisible = false;
      state.map.setLayoutProperty("substations", "visibility", "none");

      state.map.on("mouseenter", "substations", (event) => {
        state.map.getCanvas().style.cursor = "pointer";
      });

      state.map.on("mouseleave", "substations", () => {
        state.map.getCanvas().style.cursor = "";
        if (substationPopup) substationPopup.remove();
      });

      state.map.on("mousemove", "substations", (event) => {
        const feature = event.features && event.features[0];
        if (!feature) return;

        const props = feature.properties;
        const name = props.name || "Unnamed substation";
        const kv = props.nominal_kv && props.nominal_kv > 0 ? props.nominal_kv + " kV" : "";
        const op = props.operator || "";
        const ref = props.ref || "";

        let html = `<b>${name}</b>`;
        if (kv) html += `<br>${kv}`;
        if (op) html += `<br>Operator: ${op}`;
        if (ref) html += `<br>Ref: ${ref}`;

        if (substationPopup) substationPopup.remove();
        substationPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false
        })
          .setLngLat(event.lngLat)
          .setHTML(html)
          .addTo(state.map);
      });
    }

    // Export function to global scope
    window.toggleTplRegions = toggleTplRegions;

    function toggleSubstations() {
      if (!state.map || !state.map.getSource("substations")) return;
      state.substationsVisible = !state.substationsVisible;
      els.toggleSubstations.classList.toggle("primary", state.substationsVisible);
      state.map.setLayoutProperty("substations", "visibility",
        state.substationsVisible ? "visible" : "none");
    }
    window.toggleSubstations = toggleSubstations;

    async function loadBAMasks() {
      if (state.baMasks) return state.baMasks;
      const response = await fetchLocal("data/wecc_ba_masks.json");
      if (!response.ok) throw new Error("data/wecc_ba_masks.json not found");
      state.baMasks = await response.json();
      return state.baMasks;
    }

    function indexToLngLat(index) {
      const meta = state.weatherMeta;
      const [, , nx] = meta.shape;
      const x = index % nx;
      const y = Math.floor(index / nx);
      return {
        lng: meta.lon_min + x * meta.dx,
        lat: meta.lat_max - y * meta.dy
      };
    }

    async function computeBAExtrema() {
      if (!state.weatherMeta || !state.activeEvent) return;
      const masks = await loadBAMasks();
      const spec = state.weatherMeta.fields.temperature;
      const data = await loadFieldData(state.activeEvent.date, "temperature");
      const [hours, ny, nx] = state.weatherMeta.shape;

      state.baExtrema = {
        date: state.activeEvent.date,
        authorities: masks.authorities.map((ba) => {
          const min = [];
          const max = [];
          let dailyMin = null;
          let dailyMax = null;
          for (let hour = 0; hour < hours; hour += 1) {
            const offset = hour * ny * nx;
            let minValue = Infinity;
            let maxValue = -Infinity;
            let minIndex = null;
            let maxIndex = null;

            for (const index of ba.indices) {
              const raw = data[offset + index];
              if (raw === spec.fill_value) continue;
              const value = raw * spec.scale;
              if (value < minValue) {
                minValue = value;
                minIndex = index;
              }
              if (value > maxValue) {
                maxValue = value;
                maxIndex = index;
              }
            }

            const minPoint = minIndex === null ? null : { value: minValue, index: minIndex, hour, ...indexToLngLat(minIndex) };
            const maxPoint = maxIndex === null ? null : { value: maxValue, index: maxIndex, hour, ...indexToLngLat(maxIndex) };
            min.push(minPoint);
            max.push(maxPoint);
            if (minPoint && (!dailyMin || minPoint.value < dailyMin.value)) dailyMin = minPoint;
            if (maxPoint && (!dailyMax || maxPoint.value > dailyMax.value)) dailyMax = maxPoint;
          }

          return {
            abbrev: ba.abbrev,
            name: ba.name,
            min,
            max,
            dailyMin,
            dailyMax
          };
        })
      };
      updateBAExtremaOverlay();
    }

    function baExtremaFeatures() {
      const features = [];

      // Selected BA daily min/max
      if (state.selectedBAAbbrev) {
        for (const ba of state.baExtrema?.authorities || []) {
          if (ba.abbrev !== state.selectedBAAbbrev) continue;
          for (const [kind, point] of [["min", ba.dailyMin], ["max", ba.dailyMax]]) {
            if (!point) continue;
            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [point.lng, point.lat] },
              properties: {
                ba: ba.abbrev,
                name: ba.name,
                kind,
                value: point.value,
                hour: point.hour,
                lat: point.lat,
                lng: point.lng,
                selected: true
              }
            });
          }
        }
      }

      // Global extrema (coldest / hottest grid cell across all hours)
      if (state.globalExtrema) {
        if (state.globalExtrema.min) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [state.globalExtrema.min.lng, state.globalExtrema.min.lat] },
            properties: {
              kind: "global-min",
              value: state.globalExtrema.min.value,
              hour: state.globalExtrema.min.hour,
              lat: state.globalExtrema.min.lat,
              lng: state.globalExtrema.min.lng
            }
          });
        }
        if (state.globalExtrema.max) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [state.globalExtrema.max.lng, state.globalExtrema.max.lat] },
            properties: {
              kind: "global-max",
              value: state.globalExtrema.max.value,
              hour: state.globalExtrema.max.hour,
              lat: state.globalExtrema.max.lat,
              lng: state.globalExtrema.max.lng
            }
          });
        }
      }

      // Selected click point
      const lngLat = state.spotLngLat || (state.spotPoint ? { lng: state.spotPoint.lon, lat: state.spotPoint.lat } : null);
      if (lngLat) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lngLat.lng, lngLat.lat] },
          properties: {
            kind: "selected",
            lat: lngLat.lat,
            lng: lngLat.lng
          }
        });
      }

      return { type: "FeatureCollection", features };
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    }

    function pointPopupHtml(properties) {
      const lat = Number(properties.lat);
      const lng = Number(properties.lng);
      const coords = `${Number.isFinite(lat) ? lat.toFixed(3) : "--"}, ${Number.isFinite(lng) ? lng.toFixed(3) : "--"}`;
      const value = Number(properties.value);
      const hour = Number(properties.hour);
      const time = Number.isFinite(hour) ? formatPacific(timestampForHour(hour)) : "";

      switch (properties.kind) {
        case "selected":
          return `<strong>Selected point</strong><br>${coords}`;
        case "global-min":
          return `<strong style="color:#1565c0">Coldest grid cell</strong><br>${Number.isFinite(value) ? value.toFixed(1) : "--"} degF<br>${coords}<br>${time}`;
        case "global-max":
          return `<strong style="color:#d32f2f">Hottest grid cell</strong><br>${Number.isFinite(value) ? value.toFixed(1) : "--"} degF<br>${coords}<br>${time}`;
        default:
          const label = properties.kind === "min" ? "72h min" : "72h max";
          return `<strong>${escapeHtml(properties.ba)} ${label}</strong><br>${Number.isFinite(value) ? value.toFixed(1) : "--"} degF<br>${coords}<br>${time}`;
      }
    }

    function ensurePointHover(layerId) {
      if (!state.map || state.pointHoverLayers.has(layerId)) return;
      state.pointHoverLayers.add(layerId);
      state.map.on("mouseenter", layerId, () => {
        state.map.getCanvas().style.cursor = "pointer";
      });
      state.map.on("mousemove", layerId, (event) => {
        const feature = event.features && event.features[0];
        if (!feature) return;
        state.pointHoverPopup
          .setLngLat(event.lngLat)
          .setHTML(pointPopupHtml(feature.properties || {}))
          .addTo(state.map);
      });
      state.map.on("mouseleave", layerId, () => {
        state.map.getCanvas().style.cursor = "";
        state.pointHoverPopup.remove();
      });
    }

    function removeBAExtremaLayers() {
      if (!state.map || !state.mapReady) return;
      for (const layerId of baExtremaLayerIds) {
        if (state.map.getLayer(layerId)) state.map.removeLayer(layerId);
      }
      if (state.map.getSource("ba-temp-extrema")) state.map.removeSource("ba-temp-extrema");
    }

    function clearBAExtremaMarkers() {
      removeBAExtremaLayers();
    }

    function ensureBAExtremaLayers(data) {
      if (!state.map || !state.mapReady) return;
      const source = state.map.getSource("ba-temp-extrema");
      if (source) {
        source.setData(data);
      } else {
        state.map.addSource("ba-temp-extrema", {
          type: "geojson",
          data
        });
      }

      const layerConfigs = [
        { id: "ba-temp-global-min", kind: "global-min", color: "#1565c0", radius: 10 },
        { id: "ba-temp-global-max", kind: "global-max", color: "#d32f2f", radius: 10 },
        { id: "ba-temp-selected", kind: "selected", color: "#6b7280", radius: 8 },
        { id: "ba-temp-min", kind: "min", color: "#2367b6", radius: 8 },
        { id: "ba-temp-max", kind: "max", color: "#c33333", radius: 8 }
      ];
      for (const config of layerConfigs) {
        if (state.map.getLayer(config.id)) continue;
        state.map.addLayer({
          id: config.id,
          type: "circle",
          source: "ba-temp-extrema",
          filter: ["==", "kind", config.kind],
          paint: {
            "circle-radius": config.radius,
            "circle-color": config.color,
            "circle-opacity": 1,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
            "circle-stroke-opacity": 1
          }
        });
        ensurePointHover(config.id);
      }
      keepBalancingAuthoritiesOnTop();
    }

    function updateBAExtremaOverlay(force = false) {
      if (!state.map || !state.mapReady || !state.baExtrema) return;
      const data = baExtremaFeatures();
      ensureBAExtremaLayers(data);
    }

    function removeBAExtremaOverlay() {
      clearBAExtremaMarkers();
    }

    function updateSelectedPointOverlay() {
      // Merged into shared ba-temp-extrema source — just refresh
      if (state.baExtrema) updateBAExtremaOverlay(true);
    }

    function gridPointAtLngLat(lngLat) {
      if (!state.weatherMeta || !state.activeEvent) return null;
      const meta = state.weatherMeta;
      const [, ny, nx] = meta.shape;
      const x = (lngLat.lng - meta.lon_min) / meta.dx;
      const y = (meta.lat_max - lngLat.lat) / meta.dy;
      if (x < -0.5 || y < -0.5 || x > nx - 0.5 || y > ny - 0.5) return null;

      return {
        x,
        y,
        xi: Math.max(0, Math.min(Math.round(x), nx - 1)),
        yi: Math.max(0, Math.min(Math.round(y), ny - 1)),
        lon: meta.lon_min + x * meta.dx,
        lat: meta.lat_max - y * meta.dy
      };
    }

    function valueAtGrid(field, hour, point) {
      const meta = state.weatherMeta;
      const [, ny, nx] = meta.shape;
      const spec = meta.fields[field];
      const data = state.dataCache.get(cacheKey(state.activeEvent.date, field));
      if (!data) return null;
      const raw = data[(hour * ny * nx) + (point.yi * nx) + point.xi];
      if (raw === spec.fill_value) return null;
      return raw * spec.scale;
    }

    function sampleAtLngLat(lngLat) {
      const point = gridPointAtLngLat(lngLat);
      if (!point) return null;

      const value = valueAtGrid(state.field, state.hour, point);
      if (value === null) return null;

      return {
        lon: point.lon,
        lat: point.lat,
        value
      };
    }

    async function computeGlobalExtrema() {
      if (!state.weatherMeta || !state.activeEvent) return;
      state.globalExtrema = null;
      clearBAExtremaMarkers();
      const spec = state.weatherMeta.fields.temperature;
      const data = await loadFieldData(state.activeEvent.date, "temperature");
      const [hours, ny, nx] = state.weatherMeta.shape;

      let minVal = Infinity;
      let maxVal = -Infinity;
      let minIdx = null;
      let maxIdx = null;
      let minHour = null;
      let maxHour = null;

      for (let h = 0; h < hours; h++) {
        const offset = h * ny * nx;
        for (let y = 0; y < ny; y++) {
          const rowOff = offset + y * nx;
          for (let x = 0; x < nx; x++) {
            const raw = data[rowOff + x];
            if (raw === spec.fill_value) continue;
            const val = raw * spec.scale;
            const idx = y * nx + x;
            if (val < minVal) { minVal = val; minIdx = idx; minHour = h; }
            if (val > maxVal) { maxVal = val; maxIdx = idx; maxHour = h; }
          }
        }
      }

      const minLngLat = minIdx !== null ? indexToLngLat(minIdx) : null;
      const maxLngLat = maxIdx !== null ? indexToLngLat(maxIdx) : null;

      state.globalExtrema = {
        min: minIdx !== null
          ? { value: minVal, index: minIdx, hour: minHour, lng: minLngLat.lng, lat: minLngLat.lat }
          : null,
        max: maxIdx !== null
          ? { value: maxVal, index: maxIdx, hour: maxHour, lng: maxLngLat.lng, lat: maxLngLat.lat }
          : null
      };

      updateBAExtremaOverlay(true);
    }

    function removeGlobalExtremaOverlay() {
      state.globalExtrema = null;
      updateBAExtremaOverlay(true);
    }

