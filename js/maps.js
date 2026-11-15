// Course Guide Creator — Mapbox GL JS helpers shared by the results page and
// the hole builder. Replaces the old Pillow-based static PNG generation
// (download_map / hole_map_generator / green_detail_generator) with live
// interactive maps, since a static GitHub Pages site can't render images
// server-side — and an interactive map is better UX anyway.

const MapsHelper = {
  ready() {
    return !!Settings.mapboxToken();
  },

  renderUnavailablePanel(containerEl) {
    containerEl.innerHTML = `
      <div class="panel panel-amber">
        Add a Mapbox public token in Settings to see the satellite map and hole diagrams.
        Mapbox tokens are free — restrict yours to your GitHub Pages domain once you have one.
      </div>`;
  },

  init(containerEl, { center, zoom = 16, style = "mapbox://styles/mapbox/satellite-streets-v12" } = {}) {
    if (!MapsHelper.ready()) {
      MapsHelper.renderUnavailablePanel(containerEl);
      return null;
    }
    mapboxgl.accessToken = Settings.mapboxToken();
    const map = new mapboxgl.Map({
      container: containerEl,
      style,
      center: [center[1], center[0]], // mapbox wants [lon, lat]
      zoom,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    return map;
  },

  marker(map, lat, lon, { color = "#e2a33a", label = "", popupHtml = "" } = {}) {
    const marker = new mapboxgl.Marker({ color }).setLngLat([lon, lat]).addTo(map);
    if (popupHtml) {
      marker.setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(popupHtml));
    }
    if (label) {
      const el = marker.getElement();
      el.setAttribute("title", label);
    }
    return marker;
  },

  polygon(map, id, latLonPoints, { fillColor = "#237044", opacity = 0.18, lineColor = "#237044" } = {}) {
    const coords = latLonPoints.map(([lat, lon]) => [lon, lat]);
    if (coords.length && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
      coords.push(coords[0]);
    }
    const data = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
    };
    if (map.getSource(id)) {
      map.getSource(id).setData(data);
      return;
    }
    map.addSource(id, { type: "geojson", data });
    map.addLayer({ id: `${id}-fill`, type: "fill", source: id, paint: { "fill-color": fillColor, "fill-opacity": opacity } });
    map.addLayer({ id: `${id}-line`, type: "line", source: id, paint: { "line-color": lineColor, "line-width": 2 } });
  },

  line(map, id, latLonPoints, { color = "#b23926", width = 2, dashed = false } = {}) {
    const coords = latLonPoints.map(([lat, lon]) => [lon, lat]);
    const data = { type: "Feature", geometry: { type: "LineString", coordinates: coords } };
    if (map.getSource(id)) {
      map.getSource(id).setData(data);
      return;
    }
    map.addSource(id, { type: "geojson", data });
    const paint = { "line-color": color, "line-width": width };
    if (dashed) paint["line-dasharray"] = [2, 2];
    map.addLayer({ id: `${id}-line`, type: "line", source: id, paint });
  },

  fitTo(map, latLonPoints, padding = 60) {
    if (!latLonPoints.length) return;
    let minLat = latLonPoints[0][0], maxLat = latLonPoints[0][0];
    let minLon = latLonPoints[0][1], maxLon = latLonPoints[0][1];
    for (const [lat, lon] of latLonPoints) {
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    }
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding, duration: 0 });
  },
};
