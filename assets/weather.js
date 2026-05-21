
    function clearCanvas() {
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      removeWeatherOverlay();
      removeBAExtremaOverlay();
      state.globalExtrema = null;
    }

    function updateHourLabel() {
      const timestamp = timestampForHour();
      els.hourLabel.textContent = formatPacific(timestamp);
    }

    function eventWorstHour(event) {
      // Find the highlight hour from hourly_extrema
      if (!event?.hourly_extrema?.length) return 0;
      const markers = event.hourly_extrema;
      return markers[0]?.highlight?.hour_utc ?? 0;
    }

    function renderExtremeMarkers() {
      els.extremeMarkers.innerHTML = "";
      const nHours = state.weatherMeta?.shape?.[0] || 0;
      if (!nHours) return;
      const range = nHours - 1;

      // Always show both hot (red) and cold (blue) markers from globalExtrema
      if (state.globalExtrema) {
        const stamps = state.weatherMeta?.timestamps_utc || [];

        if (state.globalExtrema.min) {
          const minNode = document.createElement("div");
          minNode.className = "extreme-marker min";
          minNode.style.left = `${(state.globalExtrema.min.hour / range) * 100}%`;
          minNode.title = `Coldest: ${state.globalExtrema.min.value.toFixed(1)} degF hour ${state.globalExtrema.min.hour} | ${formatPacific(stamps[state.globalExtrema.min.hour] || "")}`;
          els.extremeMarkers.appendChild(minNode);
        }

        if (state.globalExtrema.max) {
          const maxNode = document.createElement("div");
          maxNode.className = "extreme-marker max";
          maxNode.style.left = `${(state.globalExtrema.max.hour / range) * 100}%`;
          maxNode.title = `Hottest: ${state.globalExtrema.max.value.toFixed(1)} degF hour ${state.globalExtrema.max.hour} | ${formatPacific(stamps[state.globalExtrema.max.hour] || "")}`;
          els.extremeMarkers.appendChild(maxNode);
        }

        return;
      }

      // Fallback: single marker at current hour when no globalExtrema yet
      const isCold = state.activeEvent?.Event_Type?.toLowerCase().includes("cold");
      const node = document.createElement("div");
      node.className = `extreme-marker ${isCold ? "min" : "max"}`;
      node.style.left = `${(state.hour / range) * 100}%`;
      node.title = `Worst hour: ${state.hour} / ${formatPacific(state.weatherMeta?.timestamps_utc?.[state.hour] || "")}`;
      els.extremeMarkers.appendChild(node);
    }

    async function renderWeather() {
      if (!state.weatherMeta || !state.activeEvent) return;
      const meta = state.weatherMeta;
      const [hours, ny, nx] = meta.shape;
      const field = state.field;
      const spec = meta.fields[field];
      const data = await loadFieldData(state.activeEvent.date, field);
      const hour = Math.min(state.hour, hours - 1);
      updateWeatherOverlay(meta, buildWeatherStrips(meta, data, spec, hour, field));
      updateBAExtremaOverlay();
      setLegend(field);
      updateHourLabel();
      const stamp = meta.timestamps_utc[hour] || `${String(hour).padStart(2, "0")}:00Z`;
      els.readout.textContent = `${formatPacific(stamp)} | ${fieldLabel(field)}`;
    }

    function overlayCoordinates(meta, yStart = 0, yEnd = meta.shape[1]) {
      const [, ny, nx] = meta.shape;
      const west = meta.lon_min - (meta.dx / 2);
      const east = meta.lon_min + ((nx - 1) * meta.dx) + (meta.dx / 2);
      const north = meta.lat_max - (yStart * meta.dy);
      const south = meta.lat_max - (yEnd * meta.dy);
      return [
        [west, north],
        [east, north],
        [east, south],
        [west, south]
      ];
    }

    function buildWeatherStrips(meta, data, spec, hour, field) {
      const [, ny, nx] = meta.shape;
      const offset = hour * ny * nx;
      const strips = [];

      for (let yStart = 0; yStart < ny; yStart += weatherStripRows) {
        const yEnd = Math.min(ny, yStart + weatherStripRows);
        const height = yEnd - yStart;
        const stripCanvas = document.createElement("canvas");
        stripCanvas.width = nx;
        stripCanvas.height = height;
        const stripCtx = stripCanvas.getContext("2d");
        const image = stripCtx.createImageData(nx, height);

        for (let y = yStart; y < yEnd; y += 1) {
          for (let x = 0; x < nx; x += 1) {
            const sourceIndex = offset + (y * nx) + x;
            const targetIndex = ((y - yStart) * nx) + x;
            const raw = data[sourceIndex];
            const px = targetIndex * 4;
            if (raw === spec.fill_value) {
              image.data[px + 3] = 0;
              continue;
            }
            const value = raw * spec.scale;
            const [r, g, b] = colorFor(field, value);
            image.data[px] = r;
            image.data[px + 1] = g;
            image.data[px + 2] = b;
            image.data[px + 3] = 238;
          }
        }

        stripCtx.putImageData(image, 0, 0);
        strips.push({
          id: `weather-overlay-${strips.length}`,
          url: stripCanvas.toDataURL("image/png"),
          coordinates: overlayCoordinates(meta, yStart, yEnd)
        });
      }

      return strips;
    }

    function updateWeatherOverlay(meta, strips) {
      if (!state.map || !state.mapReady) return;
      if (state.map.getLayer("weather-overlay")) state.map.removeLayer("weather-overlay");
      if (state.map.getSource("weather-overlay")) state.map.removeSource("weather-overlay");

      for (const strip of strips) {
        const source = state.map.getSource(strip.id);
        if (source) {
          source.updateImage({ url: strip.url, coordinates: strip.coordinates });
        } else {
          state.map.addSource(strip.id, {
            type: "image",
            url: strip.url,
            coordinates: strip.coordinates
          });
          state.map.addLayer({
            id: strip.id,
            type: "raster",
            source: strip.id,
            paint: {
              "raster-opacity": 0.62,
              "raster-resampling": "nearest",
              "raster-fade-duration": 0
            }
          });
        }
      }

      for (let index = strips.length; index < state.weatherStripCount; index += 1) {
        const id = `weather-overlay-${index}`;
        if (state.map.getLayer(id)) state.map.removeLayer(id);
        if (state.map.getSource(id)) state.map.removeSource(id);
      }
      state.weatherStripCount = strips.length;
      keepBalancingAuthoritiesOnTop();

      if (!state.weatherOverlayLoaded) {
        state.weatherOverlayLoaded = true;
        state.map.fitBounds(defaultMapBounds, {
          padding: 24,
          duration: 0
        });
      }
    }

    function removeWeatherOverlay() {
      if (!state.map || !state.mapReady) return;
      if (state.map.getLayer("weather-overlay")) state.map.removeLayer("weather-overlay");
      if (state.map.getSource("weather-overlay")) state.map.removeSource("weather-overlay");
      for (let index = 0; index < state.weatherStripCount; index += 1) {
        const id = `weather-overlay-${index}`;
        if (state.map.getLayer(id)) state.map.removeLayer(id);
        if (state.map.getSource(id)) state.map.removeSource(id);
      }
      state.weatherStripCount = 0;
      state.weatherOverlayLoaded = false;
    }

    function keepBalancingAuthoritiesOnTop() {
      if (!state.map || !state.mapReady) return;
      for (const layerId of baLayerIds) {
        if (state.map.getLayer(layerId)) state.map.moveLayer(layerId);
      }
      for (const layerId of baExtremaLayerIds) {
        if (state.map.getLayer(layerId)) state.map.moveLayer(layerId);
      }
    }

