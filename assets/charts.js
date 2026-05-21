    const playheadLinePlugin = {
      id: "playheadLine",
      afterDraw(chart) {
        try {
          if (!state.spotSeries || !chart.data?.labels?.length) return;
          const hour = state.hour;
          if (hour == null || hour < 0) return;
          
          // Find the temperature dataset specifically instead of assuming it's the first one
          const datasets = chart.data.datasets;
          let tempDatasetIndex = -1;
          for (let i = 0; i < datasets.length; i++) {
            if (datasets[i].fieldKey === "temperature") {
              tempDatasetIndex = i;
              break;
            }
          }
          
          // Fallback to first dataset if temperature dataset not found
          if (tempDatasetIndex === -1 && datasets.length > 0) {
            tempDatasetIndex = 0;
          }
          
          if (tempDatasetIndex === -1) return;
          
          const meta = chart.getDatasetMeta(tempDatasetIndex);
          if (!meta || !meta.data || !meta.data[hour]) return;
          
          const point = meta.data[hour];
          if (!point) return;
          
          const { ctx, chartArea } = chart;
          ctx.save();
          ctx.strokeStyle = "#cbd5e1";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(point.x, chartArea.top);
          ctx.lineTo(point.x, chartArea.bottom);
          ctx.stroke();
          ctx.restore();
        } catch (error) {
          // Silently fail to avoid breaking the chart
          console.warn("Failed to draw playhead line:", error);
        }
      }
    };

    function baExtremaForAbbrev(abbrev) {
      if (!abbrev || !state.baExtrema) return null;
      return state.baExtrema.authorities.find((ba) => ba.abbrev === abbrev) || null;
    }

    async function showSpotPlot(lngLat, baProps = null) {
      const point = gridPointAtLngLat(lngLat);
      if (!point || !state.activeEvent || !state.weatherMeta) return;

      state.spotPoint = point;
      state.spotLngLat = { lng: lngLat.lng, lat: lngLat.lat };
      state.spotBAProps = baProps;
      state.selectedBAAbbrev = baProps?.BA_Abrev || null;
      state.spotHoverHour = null;
      updateBAExtremaOverlay();
      updateSelectedPointOverlay();
      els.spotTitle.textContent = `${point.lon.toFixed(2)}, ${point.lat.toFixed(2)} | ${baProps?.BA_Abrev || "No BA"} | ${state.activeEvent.date}`;
      els.spotPanel.hidden = false;

      const fields = [
        "temperature",
        // "wind_speed",
        // "surface_solar_radiation_downwards"
      ];
      const loadResults = await Promise.all(fields.map(async (field) => ({
        field,
        loaded: await tryLoadFieldData(state.activeEvent.date, field)
      })));
      const loadedFields = loadResults.filter((item) => item.loaded).map((item) => item.field);
      if (!loadedFields.includes("temperature")) {
        setStatus(`${state.activeEvent.date} needs temperature pack`);
        return;
      }
      const series = loadedFields.map((field) => ({
        field,
        values: Array.from({ length: state.weatherMeta.shape[0] }, (_, hour) => valueAtGrid(field, hour, point))
      }));
      const baRange = baExtremaForAbbrev(baProps?.BA_Abrev);

      state.spotSeries = series;
      state.spotBARange = baRange;
      updateBAExtremaOverlay();
      updateSelectedPointOverlay();
      drawSpotChart();
    }

    function rememberChartVisibility() {
      if (!state.spotChartObj) return;
      state.spotChartObj.data.datasets.forEach((dataset, index) => {
        if (!dataset.fieldKey) return;
        state.chartVisibility[dataset.fieldKey] = state.spotChartObj.isDatasetVisible(index);
      });
    }

    function drawSpotChart() {
      if (!window.Chart || !state.spotSeries) return;
      rememberChartVisibility();
      const nHours = state.weatherMeta.shape[0];
      const labels = Array.from({ length: nHours }, (_, hour) => formatPacificAxis(timestampForHour(hour)));
      const colors = {
        temperature: "#111827",
        wind_speed: "#2367b6",
        ba_min: "#2367b6",
        ba_max: "#c33333",
        surface_solar_radiation_downwards: "#b77700"
      };

      function extremaSet(values) {
        const usable = values
          .map((value, hour) => ({ value, hour }))
          .filter((item) => item.value !== null && item.value !== undefined);
        if (!usable.length) return new Set();
        const low = usable.reduce((best, item) => item.value < best.value ? item : best);
        const high = usable.reduce((best, item) => item.value > best.value ? item : best);
        return new Set([low.hour, high.hour]);
      }

      function lineDataset(label, values, color, yAxisID, dashed = false, fieldKey = label) {
        const marked = extremaSet(values);
        return {
          label,
          fieldKey,
          data: values,
          extremaHours: marked,
          yAxisID,
          hidden: state.chartVisibility[fieldKey] === false,
          borderColor: color,
          backgroundColor: color,
          borderDash: dashed ? [6, 4] : [],
          borderWidth: dashed ? 2 : 2.5,
          tension: 0.15,
          spanGaps: true,
          pointRadius: (ctx) => marked.has(ctx.dataIndex) ? 5 : 2,
          pointHoverRadius: 6,
          pointBackgroundColor: (ctx) => marked.has(ctx.dataIndex) ? "#ffffff" : color,
          pointBorderColor: color,
          pointBorderWidth: (ctx) => marked.has(ctx.dataIndex) ? 2 : 1
        };
      }

      const seriesByField = Object.fromEntries(state.spotSeries.map((item) => [item.field, item.values]));
      const datasets = [];
      if (seriesByField.temperature) {
        datasets.push(lineDataset("Selected temp (degF)", seriesByField.temperature, colors.temperature, "yTemp", false, "temperature"));
      }
      // Wind/solar chart series hidden for TPL-008 temperature focus.
      // if (seriesByField.surface_solar_radiation_downwards) {...}
      // if (seriesByField.wind_speed) {...}

      if (state.spotBARange) {
        datasets.push(
          lineDataset(`${state.spotBARange.abbrev} temp min`, state.spotBARange.min.map((point) => point?.value ?? null), colors.ba_min, "yTemp", true, "ba_min"),
          lineDataset(`${state.spotBARange.abbrev} temp max`, state.spotBARange.max.map((point) => point?.value ?? null), colors.ba_max, "yTemp", true, "ba_max")
        );
      }

      if (state.spotChartObj) state.spotChartObj.destroy();
      state.spotChartObj = new Chart(els.spotChart, {
        type: "line",
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              position: "top",
              labels: { boxWidth: 14 },
              onClick(event, legendItem, legend) {
                Chart.defaults.plugins.legend.onClick.call(this, event, legendItem, legend);
                const dataset = legend.chart.data.datasets[legendItem.datasetIndex];
                if (dataset?.fieldKey) {
                  state.chartVisibility[dataset.fieldKey] = legend.chart.isDatasetVisible(legendItem.datasetIndex);
                }
              }
            },
            tooltip: {
              callbacks: {
                title(items) {
                  const hour = items[0].dataIndex;
                  const ts = timestampForHour(hour);
                  return formatPacific(ts);
                },
                label(item) {
                  const value = item.parsed.y;
                  return `${item.dataset.label}: ${value === null ? "" : value.toFixed(1)}`;
                }
              }
            }
          },
          scales: {
            x: {
              type: "category",
              title: { display: true, text: "Pacific Time" }
            },
            yTemp: {
              type: "linear",
              position: "left",
              title: { display: true, text: "degF" }
            },
            // ySolar: { ... removed for TPL-008 temp focus },
            // yWind: { ... removed for TPL-008 temp focus }
          }
        }
      });
    }

    function downloadSpotCsv() {
      if (!state.spotSeries || !state.weatherMeta) return;
      const baRange = state.spotBARange;
      const nHours = state.weatherMeta.shape[0];
      const rows = [
        [
          "hour_utc",
          "timestamp_utc",
          "timestamp_pacific",
          "temperature_degF",
          "ba_temperature_min_degF",
          "ba_temperature_max_degF"
        ]
      ];
      for (let hour = 0; hour < nHours; hour += 1) {
        const timestamp = timestampForHour(hour);
        const valueByField = Object.fromEntries(state.spotSeries.map((item) => [item.field, item.values[hour]]));
        rows.push([
          hour,
          timestamp,
          formatPacific(timestamp).replace("Pacific ", ""),
          valueByField.temperature ?? "",
          baRange?.min[hour]?.value ?? "",
          baRange?.max[hour]?.value ?? ""
        ]);
      }
      rows.push([]);
      rows.push([]);
      rows.push(["detail", "value"]);
      rows.push(["event_date", state.activeEvent?.date || ""]);
      rows.push(["selected_point_lat", state.spotPoint?.lat ?? ""]);
      rows.push(["selected_point_lon", state.spotPoint?.lon ?? ""]);
      rows.push(["balancing_authority", state.spotBAProps?.BA_Abrev || ""]);
      rows.push(["balancing_authority_name", state.spotBAProps?.BA_Name || ""]);
      rows.push(["ba_daily_min_temperature_degF", baRange?.dailyMin?.value ?? ""]);
      rows.push(["ba_daily_min_hour_utc", baRange?.dailyMin?.hour ?? ""]);
      rows.push(["ba_daily_min_lat", baRange?.dailyMin?.lat ?? ""]);
      rows.push(["ba_daily_min_lon", baRange?.dailyMin?.lng ?? ""]);
      rows.push(["ba_daily_max_temperature_degF", baRange?.dailyMax?.value ?? ""]);
      rows.push(["ba_daily_max_hour_utc", baRange?.dailyMax?.hour ?? ""]);
      rows.push(["ba_daily_max_lat", baRange?.dailyMax?.lat ?? ""]);
      rows.push(["ba_daily_max_lon", baRange?.dailyMax?.lng ?? ""]);
      rows.push(["era5_dataset", "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels"]);
      rows.push(["ba_boundary_source", "https://wecc-spdp-weccgeo.hub.arcgis.com/datasets/83f3a587c78a4d0cbbf10f6586b5e2b1/explore"]);
      rows.push(["caution", "ALL DATA IS ESTIMATED - USE AT YOUR OWN RISK! USE REAL MEASUREMENTS FOR ENGINEERING DECISIONS FROM ANOTHER SOURCE."]);
      const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${state.activeEvent?.date || "weather"}_selected_point.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }

    // Register the playhead line plugin with Chart.js
    if (window.Chart) {
      Chart.register(playheadLinePlugin);
    }

