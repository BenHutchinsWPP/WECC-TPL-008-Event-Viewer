    function fetchLocal(path, options = {}) {
      return fetch(versionedUrl(path), { cache: "no-store", ...options });
    }

    async function refreshWeatherMeta() {
      if (!state.activeEvent) return null;
      const metadataPath = state.activeEvent.weather_metadata || `data/weather/${state.activeEvent.date}.json`;
      const response = await fetchLocal(metadataPath);
      if (!response.ok) throw new Error(`Missing ${metadataPath}`);
      state.weatherMeta = await response.json();
      return state.weatherMeta;
    }

    async function loadFieldData(date, field) {
      const key = cacheKey(date, field);
      if (state.dataCache.has(key)) return state.dataCache.get(key);

      let spec = state.weatherMeta.fields[field];
      if (!spec?.path) {
        await refreshWeatherMeta();
        spec = state.weatherMeta.fields[field];
      }
      if (!spec?.path) throw new Error(`Missing metadata for ${field}`);
      
      const response = await fetchLocal(spec.path);
      if (!response.ok) throw new Error(`Missing ${spec.path}`);
      
      // Handle gzip decompression if needed
      let buffer = await response.arrayBuffer();
      if (spec.compression === "gzip") {
        const ds = new DecompressionStream("gzip");
        const decompressed = await new Response(new Blob([buffer]).stream().pipeThrough(ds)).arrayBuffer();
        buffer = decompressed;
      }
      
      const data = new Int16Array(buffer);
      state.dataCache.set(key, data);
      return data;
    }

    async function tryLoadFieldData(date, field) {
      try {
        await loadFieldData(date, field);
        return true;
      } catch (error) {
        console.warn(error);
        showError(`Failed to load ${field} data: ${error.message}`);
        return false;
      }
    }

    async function loadWeather(event) {
      state.activeEvent = event;
      state.weatherMeta = null;
      state.baExtrema = null;
      clearBAExtremaMarkers();
      state.hour = 0;
      els.hourSlider.value = "0";
      updateHourLabel();
      renderRows();

      showLoading(`Loading ${event.date}`);
      setStatus(`Loading ${event.date}`);
      try {
        const metadataPath = event.weather_metadata || `data/weather/${event.date}.json`;
        const response = await fetchLocal(metadataPath);
        if (!response.ok) {
          clearCanvas();
          hideLoading();
          els.readout.textContent = event.grib_available
            ? `${event.date}: GRIB available, browser pack not built`
            : `${event.date}: no local GRIB`;
          setStatus(`${event.date} needs conversion`);
          return;
        }

        state.weatherMeta = await response.json();
        await loadFieldData(event.date, state.field);
        els.hourSlider.max = String(maxHour());
        // Find worst hour by scanning actual temperature data
        state.hour = findWorstDataHour(event);
        els.hourSlider.value = String(state.hour);
        await computeBAExtrema();
        await computeGlobalExtrema();
        renderExtremeMarkers();
        await renderWeather();
        if (state.spotLngLat && !els.spotPanel.hidden) {
          await showSpotPlot(state.spotLngLat, state.spotBAProps);
        } else {
          updateSelectedPointOverlay();
        }
        hideLoading();
        setStatus(`${event.date} loaded`);
      } catch (err) {
        hideLoading();
        const msg = event.grib_available
          ? `${event.date}: weather pack error - rebuild needed`
          : `${event.date}: no weather data available`;
        clearCanvas();
        els.readout.textContent = msg;
        setStatus(msg);
        showError(err.message);
      }
    }
