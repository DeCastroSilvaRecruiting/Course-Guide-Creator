// Course Guide Creator — "Play" page controller.
// The on-course live-distance view: uses the browser's own Geolocation API
// (navigator.geolocation.watchPosition) to show real-time yardages from
// wherever the golfer is standing to the green (front/centre/back) and each
// landing zone/hazard on the current hole. This is the feature that turns
// the app from a course-building tool into something usable during a round
// — functionally the core of every golf GPS/rangefinder app researched
// (Golfshot, GolfLogix, Garmin, Golf Pad): a live position compared against
// mapped green/hazard points. Position never leaves the browser tab.

const Play = {
  state: {
    record: null,
    holeNum: 1,
    map: null,
    userMarker: null,
    watchId: null,
    featureMarkers: [],
  },

  el(id) { return document.getElementById(id); },

  init() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug");
    if (!slug) { window.location.href = "index.html"; return; }
    const record = Store.load(slug);
    if (!record) { window.location.href = "index.html"; return; }
    Play.state.record = record;
    Play.state.holeNum = parseInt(params.get("hole") || "1", 10);

    Play.el("play-course-name").textContent = record.course_name;
    Play.populateHoleSelect();
    Play.el("play-prev").addEventListener("click", () => Play.goToHole(Math.max(1, Play.state.holeNum - 1)));
    Play.el("play-next").addEventListener("click", () => Play.goToHole(Math.min(18, Play.state.holeNum + 1)));
    Play.el("play-track-btn").addEventListener("click", Play.toggleTracking);

    const center = record.lat && record.lon ? [record.lat, record.lon] : [0, 0];
    Play.state.map = MapsHelper.init(Play.el("play-map"), { center, zoom: 17 });
    Play.renderHole();
  },

  populateHoleSelect() {
    const sel = Play.el("play-hole-select");
    sel.innerHTML = Array.from({ length: 18 }, (_, i) => i + 1)
      .map((n) => `<option value="${n}" ${n === Play.state.holeNum ? "selected" : ""}>Hole ${n}</option>`)
      .join("");
    sel.addEventListener("change", () => Play.goToHole(parseInt(sel.value, 10)));
  },

  goToHole(n) {
    Play.state.holeNum = n;
    Play.el("play-hole-select").value = String(n);
    Play.renderHole();
  },

  clearFeatureMarkers() {
    Play.state.featureMarkers.forEach((m) => m.remove());
    Play.state.featureMarkers = [];
  },

  renderHole() {
    const hole = Store.findHole(Play.state.record, Play.state.holeNum);
    const map = Play.state.map;
    Play.clearFeatureMarkers();

    const teeLine = (hole.tee_sets || [])
      .map((t) => `${escapeHtml(t.name)}${t.yardage ? ` — ${fmtNum(t.yardage)} yds` : ""}`)
      .join(" · ");
    Play.el("play-hole-summary").innerHTML = `
      <div class="metrics">
        <div class="metric"><span class="metric-label">Hole</span><span class="metric-value">${hole.hole_number}</span></div>
        <div class="metric"><span class="metric-label">Par</span><span class="metric-value">${hole.par ?? "—"}</span></div>
        <div class="metric"><span class="metric-label">S.I.</span><span class="metric-value">${hole.stroke_index ?? "—"}</span></div>
        <div class="metric"><span class="metric-label">Tee sets</span><span class="metric-value" style="font-size:12px;">${teeLine || "Not mapped yet"}</span></div>
      </div>`;

    if (map) {
      const place = () => {
        const allPts = [];
        (hole.tee_sets || []).forEach((t) => {
          if (t.lat && t.lon) {
            Play.state.featureMarkers.push(MapsHelper.marker(map, t.lat, t.lon, { color: t.color || "#4b5a52", popupHtml: escapeHtml(t.name) }));
            allPts.push([t.lat, t.lon]);
          }
        });
        (hole.strategy_data.landing_zones || []).forEach((lz) => {
          Play.state.featureMarkers.push(MapsHelper.marker(map, lz.lat, lz.lon, { color: "#916019", popupHtml: escapeHtml(lz.name || "") }));
          allPts.push([lz.lat, lz.lon]);
        });
        (hole.hazards || []).forEach((hz) => {
          Play.state.featureMarkers.push(MapsHelper.marker(map, hz.lat, hz.lon, { color: "#c9a227", popupHtml: escapeHtml(hz.note || "") }));
          allPts.push([hz.lat, hz.lon]);
        });
        if (hole.green_data && hole.green_data.polygon && hole.green_data.polygon.length >= 3) {
          MapsHelper.polygon(map, "play-green", hole.green_data.polygon, { fillColor: "#237044", opacity: 0.25 });
          hole.green_data.polygon.forEach((p) => allPts.push(p));
        } else if (hole.green_data && hole.green_data.center_lat) {
          Play.state.featureMarkers.push(MapsHelper.marker(map, hole.green_data.center_lat, hole.green_data.center_lon, { color: "#237044", popupHtml: "Green" }));
          allPts.push([hole.green_data.center_lat, hole.green_data.center_lon]);
        }
        if (allPts.length >= 2) MapsHelper.fitTo(map, allPts, 70);
      };
      if (map.loaded()) place(); else map.on("load", place);
    }

    Play.updateDistances();
  },

  toggleTracking() {
    if (Play.state.watchId !== null) {
      navigator.geolocation.clearWatch(Play.state.watchId);
      Play.state.watchId = null;
      Play.el("play-track-btn").textContent = "Start tracking my position";
      Play.el("play-track-status").textContent = "Stopped.";
      return;
    }
    if (!("geolocation" in navigator)) {
      Play.el("play-track-status").textContent = "Your browser doesn't support geolocation.";
      return;
    }
    Play.el("play-track-status").textContent = "Requesting location permission…";
    Play.state.watchId = navigator.geolocation.watchPosition(Play.onPosition, Play.onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });
    Play.el("play-track-btn").textContent = "Stop tracking";
  },

  onPositionError(err) {
    Play.el("play-track-status").textContent = `Location error: ${err.message}. Check your browser/location permissions.`;
  },

  onPosition(position) {
    const { latitude, longitude, accuracy } = position.coords;
    Play.el("play-track-status").textContent = `Tracking — accuracy ~${fmtNum(accuracy)} m`;
    const map = Play.state.map;
    if (map) {
      if (Play.state.userMarker) {
        Play.state.userMarker.setLngLat([longitude, latitude]);
      } else {
        Play.state.userMarker = MapsHelper.marker(map, latitude, longitude, { color: "#b23926", popupHtml: "You" });
      }
    }
    Play.renderDistancesFrom(latitude, longitude);
  },

  updateDistances() {
    Play.el("play-distances").innerHTML = `<div class="panel panel-muted">Start tracking to see live distances to the green and landing zones from wherever you're standing.</div>`;
  },

  renderDistancesFrom(lat, lon) {
    const hole = Store.findHole(Play.state.record, Play.state.holeNum);
    const lines = [];
    const g = hole.green_data || {};
    if (g.front_lat) lines.push(["Front of green", yardsBetween(lat, lon, g.front_lat, g.front_lon)]);
    if (g.center_lat) lines.push(["Centre of green", yardsBetween(lat, lon, g.center_lat, g.center_lon)]);
    if (g.back_lat) lines.push(["Back of green", yardsBetween(lat, lon, g.back_lat, g.back_lon)]);
    (hole.strategy_data.landing_zones || []).forEach((lz) => {
      lines.push([lz.name || "Landing zone", yardsBetween(lat, lon, lz.lat, lz.lon)]);
    });
    (hole.hazards || []).forEach((hz) => {
      lines.push([hz.note || "Hazard", yardsBetween(lat, lon, hz.lat, hz.lon)]);
    });

    if (!lines.length) {
      Play.el("play-distances").innerHTML = `<div class="panel panel-muted">This hole doesn't have a green or landing zones mapped yet — add them in the hole builder.</div>`;
      return;
    }
    Play.el("play-distances").innerHTML = `
      <div class="metrics">
        ${lines
          .map(
            ([label, yards]) => `
          <div class="metric">
            <span class="metric-label">${escapeHtml(label)}</span>
            <span class="metric-value">${yards === null ? "—" : `${fmtNum(yards)} yds`}</span>
          </div>`
          )
          .join("")}
      </div>`;
  },
};

document.addEventListener("DOMContentLoaded", Play.init);
