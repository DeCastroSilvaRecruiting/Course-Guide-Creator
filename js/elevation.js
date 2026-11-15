// Course Guide Creator — elevation lookup via OpenTopography (SRTMGL1),
// ported from the Replit app's get_course_elevation()/render_elevation_html().
// CORS support for OpenTopography from a browser is unverified (flagged to
// the user) — this degrades gracefully to the same "unavailable" panel the
// Python version used when the API/key wasn't usable.

const Elevation = {
  // Samples a handful of points across a boundary (or a small box around a
  // single lat/lon when no boundary is known) and returns min/max/diff in
  // metres, or null if the lookup failed/was skipped.
  async getCourseElevation(lat, lon, boundary) {
    const key = Settings.opentopoKey();
    if (!key) {
      return { unavailable: true, reason: "No OpenTopography API key set in Settings." };
    }
    const bbox = Elevation._bbox(lat, lon, boundary);
    const params = new URLSearchParams({
      demtype: "SRTMGL1",
      south: bbox.south.toFixed(6),
      north: bbox.north.toFixed(6),
      west: bbox.west.toFixed(6),
      east: bbox.east.toFixed(6),
      outputFormat: "AAIGrid",
      API_Key: key,
    });
    try {
      const res = await fetch(`${CONFIG.OPENTOPOGRAPHY_ENDPOINT}?${params.toString()}`);
      if (!res.ok) {
        return { unavailable: true, reason: `OpenTopography returned ${res.status}.` };
      }
      const text = await res.text();
      const values = Elevation._parseAAIGrid(text);
      if (!values.length) {
        return { unavailable: true, reason: "No elevation values returned for this area." };
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      return {
        unavailable: false,
        min_m: min,
        max_m: max,
        diff_m: max - min,
        min_ft: min * 3.28084,
        max_ft: max * 3.28084,
        diff_ft: (max - min) * 3.28084,
      };
    } catch (e) {
      console.warn("Elevation lookup failed", e);
      return { unavailable: true, reason: "Elevation lookup failed (network or CORS)." };
    }
  },

  // Single-point elevation (small ~60m box, averaged) — used for the
  // tee-to-green "plays like" estimate in the hole builder. Returns feet,
  // or null if unavailable (no key, API failure, or no CORS support).
  async getPointElevation(lat, lon) {
    const key = Settings.opentopoKey();
    if (!key) return null;
    const pad = 0.0003; // ~30m
    const params = new URLSearchParams({
      demtype: "SRTMGL1",
      south: (lat - pad).toFixed(6),
      north: (lat + pad).toFixed(6),
      west: (lon - pad).toFixed(6),
      east: (lon + pad).toFixed(6),
      outputFormat: "AAIGrid",
      API_Key: key,
    });
    try {
      const res = await fetch(`${CONFIG.OPENTOPOGRAPHY_ENDPOINT}?${params.toString()}`);
      if (!res.ok) return null;
      const values = Elevation._parseAAIGrid(await res.text());
      if (!values.length) return null;
      const avgM = values.reduce((t, v) => t + v, 0) / values.length;
      return avgM * 3.28084;
    } catch (e) {
      console.warn("Point elevation lookup failed", e);
      return null;
    }
  },

  // Simplified, transparent "plays like" model — NOT a reproduction of any
  // vendor's (Garmin/Arccos/15th Club) proprietary algorithm, which none of
  // them publish. Research into how these tools describe themselves
  // confirmed only that elevation, wind and air density are the three
  // inputs they use and that uphill plays longer/downhill shorter; no
  // public exact multiplier exists. This uses a commonly cited rule of
  // thumb — roughly 1 yard of effective distance per 3 ft of elevation
  // change — and labels the result as an estimate everywhere it's shown.
  PLAYS_LIKE_YARDS_PER_FOOT: 0.33,

  playsLikeYards(horizontalYards, elevationChangeFt) {
    if (horizontalYards === null || elevationChangeFt === null || Number.isNaN(elevationChangeFt)) return null;
    return horizontalYards + elevationChangeFt * Elevation.PLAYS_LIKE_YARDS_PER_FOOT;
  },

  _bbox(lat, lon, boundary) {
    if (boundary && boundary.length) {
      const lats = boundary.map((p) => p[0]);
      const lons = boundary.map((p) => p[1]);
      return {
        south: Math.min(...lats) - 0.001,
        north: Math.max(...lats) + 0.001,
        west: Math.min(...lons) - 0.001,
        east: Math.max(...lons) + 0.001,
      };
    }
    const pad = 0.006; // ~650m box around a single point
    return { south: lat - pad, north: lat + pad, west: lon - pad, east: lon + pad };
  },

  // Minimal AAIGrid (ASCII Arc/Info grid) parser — header key/value lines
  // followed by rows of space-separated floats; skips the NODATA sentinel.
  _parseAAIGrid(text) {
    const lines = text.trim().split(/\r?\n/);
    let nodata = -9999;
    const values = [];
    let inBody = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!inBody) {
        const m = trimmed.match(/^NODATA_value\s+(-?\d+(\.\d+)?)/i);
        if (m) nodata = parseFloat(m[1]);
        if (/^(ncols|nrows|xllcorner|yllcorner|cellsize|nodata_value)/i.test(trimmed)) continue;
        inBody = true;
      }
      if (!trimmed) continue;
      for (const tok of trimmed.split(/\s+/)) {
        const v = parseFloat(tok);
        if (!Number.isNaN(v) && v !== nodata) values.push(v);
      }
    }
    return values;
  },

  renderHtml(result) {
    if (!result || result.unavailable) {
      const reason = result && result.reason ? escapeHtml(result.reason) : "Elevation data unavailable for this course.";
      return `<div class="panel panel-muted">${reason} Add an OpenTopography API key in Settings to enable this.</div>`;
    }
    return `
      <div class="metrics">
        <div class="metric"><span class="metric-label">Lowest point</span><span class="metric-value">${fmtNum(result.min_ft, 0)} ft</span></div>
        <div class="metric"><span class="metric-label">Highest point</span><span class="metric-value">${fmtNum(result.max_ft, 0)} ft</span></div>
        <div class="metric"><span class="metric-label">Elevation change</span><span class="metric-value">${fmtNum(result.diff_ft, 0)} ft</span></div>
        <div class="metric"><span class="metric-label">Source</span><span class="metric-value">SRTM 30m</span></div>
      </div>`;
  },
};
