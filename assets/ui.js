    function initMap() {
      if (!window.maplibregl) {
        els.readout.textContent = "MapLibre failed to load";
        return;
      }
      if (!window.pmtiles) {
        els.readout.textContent = "PMTiles failed to load";
        return;
      }
      if (!state.pmtilesProtocolRegistered) {
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        state.pmtilesProtocolRegistered = true;
      }

      state.map = new maplibregl.Map({
        container: els.map,
        style: osmStyle,
        center: [-101, 49],
        zoom: 3.2,
        minZoom: 2,
        maxZoom: 12
      });
      state.pointHoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      state.map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
      state.map.on("load", () => {
        state.mapReady = true;
        addBalancingAuthorities();
        addTransmissionLines();
        addTransmissionSubstations();
        if (state.weatherMeta) renderWeather();
        updateBAExtremaOverlay();
        updateSelectedPointOverlay();
      });
      state.map.on("mousemove", (event) => {
        const sample = sampleAtLngLat(event.lngLat);
        if (!sample || !state.weatherMeta) return;
        const hoverStamp = state.weatherMeta.timestamps_utc?.[state.hour] || `${state.weatherMeta.date}T${String(state.hour).padStart(2, "0")}:00:00Z`;
        els.readout.textContent =
          `${formatPacific(hoverStamp)} | ` +
          `${sample.lon.toFixed(2)}, ${sample.lat.toFixed(2)} | ` +
          `${fieldLabel(state.field)} ${sample.value.toFixed(1)} ${fieldUnits(state.field)}`;
      });
      state.map.on("click", (event) => {
        const baFeature = state.map.queryRenderedFeatures(event.point, { layers: ["ba-fill"] })[0];
        showSpotPlot(event.lngLat, baFeature?.properties || null);
      });
    }

    async function searchMap() {
      const query = els.mapSearchInput.value.trim();
      if (!query || !state.map) return;
      setStatus(`Searching ${query}`);
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      const results = await response.json();
      if (!results.length) {
        setStatus(`No result for ${query}`);
        return;
      }
      const result = results[0];
      if (result.boundingbox) {
        const [south, north, west, east] = result.boundingbox.map(Number);
        state.map.fitBounds([[west, south], [east, north]], { padding: 40, maxZoom: 10 });
      } else {
        state.map.flyTo({ center: [Number(result.lon), Number(result.lat)], zoom: 9 });
      }
      setStatus(`Mapped ${result.display_name}`);
    }

    function initPaneResizer() {
      let dragging = false;
      els.paneResizer.addEventListener("pointerdown", (event) => {
        dragging = true;
        els.paneResizer.classList.add("dragging");
        els.paneResizer.setPointerCapture(event.pointerId);
      });
      els.paneResizer.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        const rect = document.querySelector(".main").getBoundingClientRect();
        const minLeftWidth = 320;
        const minMapWidth = 360;
        const width = Math.max(minLeftWidth, Math.min(rect.width - minMapWidth, event.clientX - rect.left));
        document.querySelector(".main").style.setProperty("--left-width", `${width}px`);
        state.map?.resize();
        state.spotChartObj?.resize();
      });
      els.paneResizer.addEventListener("pointerup", (event) => {
        dragging = false;
        els.paneResizer.classList.remove("dragging");
        els.paneResizer.releasePointerCapture(event.pointerId);
        state.map?.resize();
        state.spotChartObj?.resize();
      });
    }

    function initChartResizer() {
      let dragging = false;
      els.chartResizer.addEventListener("pointerdown", (event) => {
        dragging = true;
        els.chartResizer.classList.add("dragging");
        els.chartResizer.setPointerCapture(event.pointerId);
      });
      els.chartResizer.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        const libraryRect = document.querySelector(".library").getBoundingClientRect();
        const filtersHeight = document.querySelector(".filters").getBoundingClientRect().height;
        const available = libraryRect.height - filtersHeight - 6;
        const tableHeight = Math.max(150, Math.min(available - 260, event.clientY - libraryRect.top - filtersHeight));
        const chartHeight = Math.max(260, available - tableHeight);
        document.querySelector(".library").style.setProperty("--table-height", `${tableHeight}px`);
        document.querySelector(".library").style.setProperty("--chart-height", `${chartHeight}px`);
        state.spotChartObj?.resize();
      });
      els.chartResizer.addEventListener("pointerup", (event) => {
        dragging = false;
        els.chartResizer.classList.remove("dragging");
        els.chartResizer.releasePointerCapture(event.pointerId);
      });
    }



    async function init() {
      showLoading("Loading event library\u2026");
      try {
        initMap();
        initPaneResizer();
        initChartResizer();
        const response = await fetchLocal("data/events.json");
        if (!response.ok) throw new Error("Event catalog (data/events.json) not found");
        state.library = await response.json();
        if (!state.library?.events?.length) throw new Error("Event catalog contains no events");

        buildRegionFilters();
        renderRows();

        const firstReady = groupedEvents().find((event) => event.plot_available);
        if (firstReady) {
          await loadWeather(firstReady);
        } else {
          hideLoading();
          els.readout.textContent = "Build a browser weather pack to enable plotting";
          setStatus("No weather data available");
        }
      } catch (error) {
        hideLoading();
        clearCanvas();
        els.readout.textContent = error.message;
        setStatus("Failed to load");
        showError(error.message);
      }
    }

    els.regionList.addEventListener("change", (event) => {
      if (event.target.type !== "checkbox") return;
      if (event.target.checked) {
        state.selectedRegions.add(event.target.value);
      } else {
        state.selectedRegions.delete(event.target.value);
      }
      renderRows();
    });

    els.clearRegions.addEventListener("click", () => {
      state.selectedRegions.clear();
      els.regionList.querySelectorAll("input").forEach((input) => {
        input.checked = false;
      });
      renderRows();
    });

    els.eventTypeFilter.addEventListener("change", () => {
      state.eventTypeFilter = els.eventTypeFilter.value;
      renderRows();
    });

    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = "asc";
        }
        renderRows();
      });
    });

    els.eventRows.addEventListener("click", async (event) => {
      const row = event.target.closest("tr[data-date]");
      if (!row) return;
      const groups = groupedEvents();
      const selected = groups.find((item) => item.date === row.dataset.date);
      if (selected) await loadWeather(selected);
    });

    els.fieldSelect.addEventListener("change", async () => {
      state.field = els.fieldSelect.value;
      if (state.weatherMeta) {
        await loadFieldData(state.activeEvent.date, state.field);
        await renderWeather();
      }
    });

    els.hourSlider.addEventListener("input", async () => {
      state.hour = Number(els.hourSlider.value);
      updateHourLabel();
      await renderWeather();
      // Only render chart if it exists and is visible
      if (state.spotChartObj && !els.spotPanel.hidden) {
        // Use a small delay to debounce rapid slider changes
        clearTimeout(state.chartRenderTimeout);
        state.chartRenderTimeout = setTimeout(() => {
          if (state.spotChartObj) state.spotChartObj.render();
        }, 50);
      }
    });

    els.playButton.addEventListener("click", () => {
      state.playing = !state.playing;
      els.playButton.textContent = state.playing ? "Pause" : "Play";
      if (state.playTimer) clearInterval(state.playTimer);
      if (!state.playing) return;
      state.playTimer = setInterval(async () => {
        const maxH = maxHour();
        state.hour = (state.hour + 1) > maxH ? 0 : state.hour + 1;
        els.hourSlider.value = String(state.hour);
        updateHourLabel();
        await renderWeather();
        // Only render chart if it exists and is visible
        if (state.spotChartObj && !els.spotPanel.hidden) {
          // Use a small delay to debounce rapid slider changes
          clearTimeout(state.chartRenderTimeout);
          state.chartRenderTimeout = setTimeout(() => {
            if (state.spotChartObj) state.spotChartObj.render();
          }, 50);
        }
      }, 400);
    });

    els.closeSpot.addEventListener("click", () => {
      els.spotPanel.hidden = true;
      if (state.spotChartObj) {
        state.spotChartObj.destroy();
        state.spotChartObj = null;
      }
      state.spotSeries = null;
      state.spotBARange = null;
      state.spotPoint = null;
      state.spotLngLat = null;
      state.spotBAProps = null;
      state.selectedBAAbbrev = null;
      updateBAExtremaOverlay();
    });

    els.downloadSpotCsv.addEventListener("click", downloadSpotCsv);

    els.infoButton.addEventListener("click", () => {
      els.creditsDialog.showModal();
    });

    els.closeCredits.addEventListener("click", () => {
      els.creditsDialog.close();
    });

    els.creditsDialog.addEventListener("click", (event) => {
      if (event.target === els.creditsDialog) els.creditsDialog.close();
    });

    console.log("Attaching event listeners");
    console.log("toggleTplRegions element:", els.toggleTplRegions);
    console.log("mapSearchButton element:", els.mapSearchButton);
    
    els.mapSearchButton.addEventListener("click", searchMap);
    els.mapSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") searchMap();
    });
    
    if (els.toggleTplRegions) {
      console.log("Adding toggleTplRegions event listener");
      console.log("toggleTplRegions function available:", typeof toggleTplRegions);
      console.log("window.toggleTplRegions function available:", typeof window.toggleTplRegions);
      // Try both versions to be safe
      const toggleFunction = window.toggleTplRegions || toggleTplRegions;
      if (typeof toggleFunction === "function") {
        els.toggleTplRegions.addEventListener("click", toggleFunction);
      } else {
        console.error("toggleTplRegions function not found!");
      }
    } else {
      console.error("toggleTplRegions element not found!");
    }

    if (els.toggleSubstations) {
      els.toggleSubstations.addEventListener("click", window.toggleSubstations || toggleSubstations);
    }

    init();
