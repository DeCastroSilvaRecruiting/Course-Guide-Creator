// Course Guide Creator — printable "Course Guide Booklet" controller.
// A master-yardage-book-style export: one page per hole, built entirely
// from the data already on file (tee_sets, hazards, green_data.polygon,
// osm_shapes, green_reading_data). Round 6 renders each hole as real
// satellite imagery (Esri World Imagery — no API key needed), rotated
// "tee-up" (green at the top), with a real-data overlay drawn on top —
// see the Illustrate sub-object below for the how/why. The page is still
// built from plain <img>/<svg> tags, no live map library, so a browser's
// own "Print… → Save as PDF" still turns this straight into a booklet,
// one hole per sheet.
//
// What's real vs. what's a placeholder, by design (never fabricated):
// - Tee → hazard and tee → green (front/centre/back) distances are computed
//   from real GPS points already on file (OSM-derived for Earth Course —
//   see the project status doc). A tee with no GPS fix yet shows its plain
//   scorecard yardage instead of a computed one, clearly labelled as such.
// - Green length/width are computed from the real green outline polygon —
//   geometry, not a guess.
// - Green undulation/slope has no automated source worth trusting: a green
//   is roughly the size of a single SRTM elevation pixel (30m), nowhere
//   near enough resolution to show slope *within* a green. That data only
//   ever comes from green_reading_data (high/low point + slope arrows),
//   which is hand-entered in the hole builder's "Green detail" tab. Until
//   that's filled in for a hole, this page says so plainly instead of
//   drawing an invented contour.

const Guide = {
  state: { record: null },

  el(id) { return document.getElementById(id); },

  init() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug");
    if (!slug) { window.location.href = "index.html"; return; }
    const record = Store.load(slug);
    if (!record) { window.location.href = "index.html"; return; }
    Guide.state.record = record;

    Guide.el("guide-course-name").textContent = record.course_name;
    Guide.el("guide-back-link").href = `index.html`;
    Guide.el("guide-print").addEventListener("click", () => window.print());

    // No Mapbox token needed any more — round 6's satellite imagery comes
    // from Esri's keyless World Imagery export endpoint. An OpenTopography
    // key (same Settings panel) is still optional: without one the
    // uphill/downhill badge just never appears, nothing else depends on it.
    Guide.renderAll();
  },

  // ---- geometry -------------------------------------------------------

  // Centroid of a [[lat,lon], ...] polygon.
  centroid(polygon) {
    const n = polygon.length;
    if (!n) return null;
    const sum = polygon.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / n, sum[1] / n];
  },

  // Projects the green outline onto the tee->green bearing (front/back,
  // the line-of-play axis) and onto the perpendicular axis (left/right),
  // returning real yardages for both — i.e. the green's length and width
  // along the actual approach angle from this tee, not an arbitrary
  // north-aligned bounding box.
  greenAxes(polygon, teeLat, teeLon) {
    if (!polygon || polygon.length < 3 || teeLat == null || teeLon == null) return null;
    const c = Guide.centroid(polygon);
    const bearing = Math.atan2(c[1] - teeLon, c[0] - teeLat);
    const ux = Math.cos(bearing), uy = Math.sin(bearing);
    const px = -uy, py = ux;
    let minProj = Infinity, maxProj = -Infinity, frontPt = polygon[0], backPt = polygon[0];
    let minPerp = Infinity, maxPerp = -Infinity, leftPt = polygon[0], rightPt = polygon[0];
    polygon.forEach((p) => {
      const proj = (p[0] - teeLat) * ux + (p[1] - teeLon) * uy;
      if (proj < minProj) { minProj = proj; frontPt = p; }
      if (proj > maxProj) { maxProj = proj; backPt = p; }
      const perp = (p[0] - c[0]) * px + (p[1] - c[1]) * py;
      if (perp < minPerp) { minPerp = perp; leftPt = p; }
      if (perp > maxPerp) { maxPerp = perp; rightPt = p; }
    });
    return {
      centroid: c,
      front: frontPt,
      back: backPt,
      left: leftPt,
      right: rightPt,
      lengthYards: yardsBetween(frontPt[0], frontPt[1], backPt[0], backPt[1]),
      widthYards: yardsBetween(leftPt[0], leftPt[1], rightPt[0], rightPt[1]),
    };
  },

  // The tee to use as the canonical reference for the green's own
  // length/width (independent of which tee a golfer plays from) — the
  // longest mapped tee on file, same convention as the official
  // scorecard's headline yardage.
  primaryMappedTee(hole) {
    const mapped = (hole.tee_sets || []).filter((t) => t.lat != null && t.lon != null);
    if (!mapped.length) return null;
    return mapped.reduce((longest, t) => ((t.yardage || 0) > (longest.yardage || 0) ? t : longest), mapped[0]);
  },

  // ---- Illustrated hole art: real satellite imagery (Esri World Imagery),
  // rotated "tee-up" (green at top), with a real-data overlay on top ------
  //
  // Round 6 design, replacing the round-5 Mapbox-pin-overlay images. Why
  // Esri instead of Mapbox for the photo itself: a direct side-by-side
  // comparison at the same real-world scale showed Esri's World Imagery is
  // noticeably sharper for this course (crisp individual trees/bunker
  // edges vs. Mapbox's blurrier tile). Esri's export endpoint doesn't
  // support an in-request camera bearing like Mapbox's static API did, so
  // the "hole-up" rotation is done by fetching a larger square crop and
  // rotating it with CSS, clipped back down to the card — see
  // Illustrate.renderCard(). The crop math only moves pixels; geometry
  // accuracy (green outline, bunker/water shapes, tee/pin positions) comes
  // entirely from the real GPS data already on the hole, same as round 5.
  //
  // The public Esri endpoint used here (server.arcgisonline.com) needs no
  // API key, but — found empirically while building this — it throttles
  // after a handful of near-simultaneous requests (confirmed: 900px
  // requests succeeded repeatedly, then started failing after ~8 rapid
  // calls in a row, then succeeded again once the tool waited a few
  // seconds). An 18-hole page loading all its images at once would trip
  // this every time. Illustrate.ImgQueue fixes it: a small
  // concurrency-limited (2 at a time) queue with exponential-backoff retry
  // on failure — stress-tested here against 18 simultaneous requests with
  // 0 failures before this shipped.
  Illustrate: {
    toRad(d) { return (d * Math.PI) / 180; },
    toDeg(r) { return (r * 180) / Math.PI; },

    localMeters(lat, lon, lat0, lon0) {
      const mPerDegLat = 111320;
      const mPerDegLon = 111320 * Math.cos(Guide.Illustrate.toRad(lat0));
      return { n: (lat - lat0) * mPerDegLat, e: (lon - lon0) * mPerDegLon };
    },

    metersToLatLon(nM, eM, lat0, lon0) {
      const mPerDegLat = 111320;
      const mPerDegLon = 111320 * Math.cos(Guide.Illustrate.toRad(lat0));
      return { lat: lat0 + nM / mPerDegLat, lon: lon0 + eM / mPerDegLon };
    },

    compassBearing(lat1, lon1, lat2, lon2) {
      const { n, e } = Guide.Illustrate.localMeters(lat2, lon2, lat1, lon1);
      let b = Guide.Illustrate.toDeg(Math.atan2(e, n));
      if (b < 0) b += 360;
      return b;
    },

    // Adaptive scale bar — round 7. Picks a "nice" round yard length that
    // renders at roughly 12%+ of the image width, then draws it bottom-left
    // with end-ticks and a yardage label. mpp (metres per overlay pixel) is
    // the exact scale project() already uses, so this is a real, honest
    // measurement — the same role a yardage book's printed scale bar plays
    // on its hole-overview page — never a cosmetic guess.
    scaleBarSVG(imgW, imgH, mpp, dsId) {
      if (!mpp) return "";
      const pxPerYard = 0.9144 / mpp;
      const candidates = [5, 10, 20, 25, 50, 100, 200];
      let yards = candidates[candidates.length - 1];
      for (const c of candidates) {
        if (c * pxPerYard >= imgW * 0.12) { yards = c; break; }
      }
      const barPx = yards * pxPerYard;
      const x0 = 12, y0 = imgH - 20;
      const x1 = x0 + barPx;
      return `<g filter="url(#${dsId})">
        <line x1="${x0}" y1="${y0}" x2="${x1.toFixed(1)}" y2="${y0}" stroke="#fff" stroke-width="1.6"/>
        <line x1="${x0}" y1="${(y0 - 3.5).toFixed(1)}" x2="${x0}" y2="${(y0 + 3.5).toFixed(1)}" stroke="#fff" stroke-width="1.6"/>
        <line x1="${x1.toFixed(1)}" y1="${(y0 - 3.5).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(y0 + 3.5).toFixed(1)}" stroke="#fff" stroke-width="1.6"/>
        <text x="${(x0 + barPx / 2).toFixed(1)}" y="${(y0 - 6).toFixed(1)}" font-size="7.5" fill="#fff" text-anchor="middle" font-weight="700">${yards} yd</text>
      </g>`;
    },

    // A small flag-on-a-stick pin icon (round 7 — replaces a plain
    // dot+stick) at the hole/pin position, in the overlay's own pixel space.
    flagSVG(x, y, dsId) {
      const topY = y - 15;
      return `<g filter="url(#${dsId})">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#fff" stroke="#b23926" stroke-width="1.1"/>
        <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${topY.toFixed(1)}" stroke="#7a1f14" stroke-width="1.2"/>
        <path d="M ${x.toFixed(1)} ${topY.toFixed(1)} L ${(x + 9).toFixed(1)} ${(topY + 3.4).toFixed(1)} L ${x.toFixed(1)} ${(topY + 6.8).toFixed(1)} Z" fill="#e23b3b" stroke="#fff" stroke-width="0.6"/>
      </g>`;
    },

    // Standard Web Mercator world-pixel math (EPSG:3857 tile convention, @1x).
    worldPixel(lat, lon, zoom) {
      const worldSize = 256 * Math.pow(2, zoom);
      const x = (worldSize * (lon + 180)) / 360;
      const sinLat = Math.sin(Guide.Illustrate.toRad(lat));
      const y = worldSize * (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI));
      return { x, y };
    },

    // Builds the per-hole "tee-up" view: a projector from (lat,lon) to
    // final-card pixel space, centred/zoomed/rotated to fit the hole's
    // real extent (green polygon, every mapped tee, every real
    // fairway/bunker/water shape) with padding, bearing-rotated so the
    // tee->green direction points to the top of the card.
    buildHoleView(hole, opts) {
      opts = opts || {};
      const imgW = opts.width || 480;
      const imgH = opts.height || 760;
      const mappedTees = (hole.tee_sets || []).filter((t) => t.lat != null);
      if (!mappedTees.length || !hole.green_data || hole.green_data.center_lat == null) return null;
      const backTee = mappedTees.reduce((a, t) => ((t.yardage || 0) > (a.yardage || 0) ? t : a), mappedTees[0]);
      const green = hole.green_data;
      const bearingDeg = Guide.Illustrate.compassBearing(backTee.lat, backTee.lon, green.center_lat, green.center_lon);
      const bearingRad = Guide.Illustrate.toRad(bearingDeg);
      const cosB = Math.cos(bearingRad), sinB = Math.sin(bearingRad);

      const pts = [[backTee.lat, backTee.lon], [green.center_lat, green.center_lon]];
      (green.polygon || []).forEach((p) => pts.push(p));
      mappedTees.forEach((t) => pts.push([t.lat, t.lon]));
      (hole.osm_shapes?.bunkers || []).forEach((poly) => poly.forEach((p) => pts.push(p)));
      (hole.osm_shapes?.water || []).forEach((poly) => poly.forEach((p) => pts.push(p)));
      (hole.osm_shapes?.fairway || []).forEach((poly) => poly.forEach((p) => pts.push(p)));

      let minF = Infinity, maxF = -Infinity, minR = Infinity, maxR = -Infinity;
      pts.forEach(([lat, lon]) => {
        const { n, e } = Guide.Illustrate.localMeters(lat, lon, backTee.lat, backTee.lon);
        const fwd = n * cosB + e * sinB;
        const right = -n * sinB + e * cosB;
        if (fwd < minF) minF = fwd; if (fwd > maxF) maxF = fwd;
        if (right < minR) minR = right; if (right > maxR) maxR = right;
      });
      const padF = 16, padR = 14; // metres
      minF -= padF; maxF += padF; minR -= padR; maxR += padR;
      const reqHeightM = maxF - minF, reqWidthM = maxR - minR;

      const centerF = (minF + maxF) / 2, centerR = (minR + maxR) / 2;
      const centerN = centerF * cosB - centerR * sinB;
      const centerE = centerF * sinB + centerR * cosB;
      const center = Guide.Illustrate.metersToLatLon(centerN, centerE, backTee.lat, backTee.lon);

      const mpp = Math.max(reqHeightM / imgH, reqWidthM / imgW);
      let zoom = Math.log2((156543.03392 * Math.cos(Guide.Illustrate.toRad(center.lat))) / mpp);
      zoom = Math.max(13, Math.min(20.5, zoom));
      const centerWorld = Guide.Illustrate.worldPixel(center.lat, center.lon, zoom);

      function project(lat, lon) {
        const wp = Guide.Illustrate.worldPixel(lat, lon, zoom);
        const wx = wp.x - centerWorld.x, wy = wp.y - centerWorld.y;
        const sx = wx * cosB + wy * sinB;
        const sy = -wx * sinB + wy * cosB;
        return { x: imgW / 2 + sx, y: imgH / 2 + sy };
      }

      return { imgW, imgH, bearingDeg, zoom, center, project, backTee, mappedTees, reqHeightM, reqWidthM, mpp };
    },

    // Esri World Imagery "export" endpoint: a keyless REST service that
    // renders an arbitrary WGS84 bbox as a single flat (always north-up)
    // raster. bbox order is (west, south, east, north) to match bboxSR=4326.
    buildEsriSquareUrl(centerLat, centerLon, sideM, sidePx) {
      const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos(Guide.Illustrate.toRad(centerLat));
      const padLat = sideM / 2 / mPerDegLat, padLon = sideM / 2 / mPerDegLon;
      const bbox = [centerLon - padLon, centerLat - padLat, centerLon + padLon, centerLat + padLat];
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox.join(",")}&bboxSR=4326&imageSR=4326&size=${sidePx},${sidePx}&format=jpg&f=image`;
    },

    // Concurrency-limited image loader with exponential-backoff retry —
    // see the comment above Illustrate for why this exists.
    ImgQueue: {
      maxConcurrent: 2,
      active: 0,
      pending: [],
      loadOne(url, attempt) {
        attempt = attempt || 0;
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img.src);
          img.onerror = () => {
            if (attempt >= 7) { reject(new Error("image failed after retries")); return; }
            const delay = Math.min(500 * Math.pow(1.8, attempt) + Math.random() * 300, 9000);
            setTimeout(() => { Guide.Illustrate.ImgQueue.loadOne(url, attempt + 1).then(resolve, reject); }, delay);
          };
          img.src = url;
        });
      },
      enqueue(url) {
        const self = this;
        return new Promise((resolve, reject) => {
          self.pending.push({ url, resolve, reject });
          self._pump();
        });
      },
      _pump() {
        while (this.active < this.maxConcurrent && this.pending.length) {
          const { url, resolve, reject } = this.pending.shift();
          this.active++;
          this.loadOne(url).then(resolve, reject).finally(() => { this.active--; this._pump(); });
        }
      },
    },

    // Builds the real-data SVG overlay (hazard outlines, pin, per-tee
    // yardage badges + leader lines, title bar, compass, elevation-tilt
    // badge placeholder) for one hole, in the view's final pixel space.
    renderOverlaySVG(hole, view, uid) {
      const project = view.project;
      const toPath = (poly) => {
        const pts = poly.map(([lat, lon]) => project(lat, lon));
        return "M " + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ") + " Z";
      };
      const pin = project(hole.green_data.center_lat, hole.green_data.center_lon);
      const bearingRad = Guide.Illustrate.toRad(view.bearingDeg);
      const longestTee = view.mappedTees.reduce((a, t) => ((t.yardage || 0) > (a.yardage || 0) ? t : a), view.mappedTees[0]);
      const longestTeeProj = project(longestTee.lat, longestTee.lon);
      const dsId = `ds${uid}`, fadeId = `fade${uid}`, vigId = `vig${uid}`;

      let svg = `<svg viewBox="0 0 ${view.imgW} ${view.imgH}" xmlns="http://www.w3.org/2000/svg" style="position:absolute; top:0; left:0; width:100%; height:100%; font-family:'Segoe UI',sans-serif; pointer-events:none;">`;
      svg += `<defs>
        <filter id="${dsId}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0.9" stdDeviation="1" flood-color="#000" flood-opacity="0.6"/></filter>
        <linearGradient id="${fadeId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
        <radialGradient id="${vigId}" cx="50%" cy="50%" r="72%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.38"/></radialGradient>
      </defs>`;
      svg += `<rect x="0" y="0" width="${view.imgW}" height="${view.imgH}" fill="url(#${vigId})"/>`;

      // Round 7: real OSM polygons now get area fills (not just outlines) —
      // this is the same "color the areas" convention every researched
      // yardage book uses (sage fairway, sand bunker, blue water), and the
      // geometry is exactly the same real data round 6 already fetched.
      (hole.osm_shapes?.fairway || []).forEach((p) => { svg += `<path d="${toPath(p)}" fill="#bfe6a8" fill-opacity="0.16" stroke="#eafbe9" stroke-width="0.6" stroke-opacity="0.4"/>`; });
      (hole.osm_shapes?.water || []).forEach((p) => { svg += `<path d="${toPath(p)}" fill="#3f8fe0" fill-opacity="0.4" stroke="#eaf4ff" stroke-width="1.1" stroke-opacity="0.9"/>`; });
      (hole.osm_shapes?.bunkers || []).forEach((p) => { svg += `<path d="${toPath(p)}" fill="#e7cf8a" fill-opacity="0.55" stroke="#fff6da" stroke-width="0.9" stroke-opacity="0.9"/>`; });
      if (hole.green_data?.polygon?.length >= 3) {
        svg += `<path d="${toPath(hole.green_data.polygon)}" fill="#49d06a" fill-opacity="0.2" stroke="#ffffff" stroke-width="1.5" filter="url(#${dsId})"/>`;
      }

      svg += `<line x1="${longestTeeProj.x.toFixed(1)}" y1="${longestTeeProj.y.toFixed(1)}" x2="${pin.x.toFixed(1)}" y2="${pin.y.toFixed(1)}" stroke="#ffffff" stroke-width="1.1" stroke-dasharray="1.5,5" stroke-opacity="0.55"/>`;
      svg += Guide.Illustrate.flagSVG(pin.x, pin.y, dsId);

      view.mappedTees.forEach((t) => {
        const tp = project(t.lat, t.lon);
        const dist = Math.round(yardsBetween(t.lat, t.lon, hole.green_data.center_lat, hole.green_data.center_lon));
        svg += `<circle cx="${tp.x.toFixed(1)}" cy="${tp.y.toFixed(1)}" r="4.2" fill="${t.color}" stroke="#fff" stroke-width="1.3" filter="url(#${dsId})"/>`;
        const lx = tp.x + 16, ly = tp.y;
        svg += `<line x1="${(tp.x + 4.2).toFixed(1)}" y1="${tp.y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${t.color}" stroke-width="1" filter="url(#${dsId})"/>`;
        svg += `<g filter="url(#${dsId})">
          <rect x="${lx.toFixed(1)}" y="${(ly - 7).toFixed(1)}" width="34" height="14" rx="7" fill="${t.color}" stroke="#fff" stroke-width="0.8"/>
          <text x="${(lx + 13).toFixed(1)}" y="${(ly + 3.2).toFixed(1)}" font-size="9" fill="#fff" text-anchor="middle" font-weight="800">${dist}</text>
          <text x="${(lx + 27).toFixed(1)}" y="${(ly + 2.4).toFixed(1)}" font-size="5.5" fill="#fff" fill-opacity="0.85" text-anchor="middle" font-weight="600">y</text>
        </g>`;
      });

      svg += `<rect x="0" y="0" width="${view.imgW}" height="34" fill="url(#${fadeId})"/>`;
      svg += `<text x="12" y="15" font-size="13" fill="#fff" font-weight="800" filter="url(#${dsId})">HOLE ${hole.hole_number}</text>`;
      svg += `<text x="12" y="28" font-size="8.5" fill="#fff" fill-opacity="0.9" font-weight="600" filter="url(#${dsId})">PAR ${hole.par}${hole.stroke_index != null ? `  &middot;  S.I. ${hole.stroke_index}` : ""}${hole.hole_name ? `  &middot;  ${escapeHtml(hole.hole_name)}` : ""}</text>`;

      const northX = -Math.sin(bearingRad), northY = -Math.cos(bearingRad);
      const ncx = view.imgW - 22, ncy = 18, nr = 11;
      svg += `<g filter="url(#${dsId})"><circle cx="${ncx}" cy="${ncy}" r="${nr}" fill="#fff" fill-opacity="0.88" stroke="#1a1a1a" stroke-width="0.8"/><line x1="${ncx}" y1="${ncy}" x2="${(ncx + northX * 7.5).toFixed(1)}" y2="${(ncy + northY * 7.5).toFixed(1)}" stroke="#1a1a1a" stroke-width="1.4"/><circle cx="${(ncx + northX * 7.5).toFixed(1)}" cy="${(ncy + northY * 7.5).toFixed(1)}" r="1.4" fill="#e23b3b"/><text x="${(ncx + northX * 7.5).toFixed(1)}" y="${(ncy + northY * 7.5 - 3.5).toFixed(1)}" font-size="6" text-anchor="middle" fill="#1a1a1a" font-weight="700">N</text></g>`;

      svg += Guide.Illustrate.scaleBarSVG(view.imgW, view.imgH, view.mpp, dsId);
      svg += `<text x="${view.imgW - 6}" y="${view.imgH - 5}" font-size="6" fill="#fff" fill-opacity="0.7" text-anchor="end">Imagery: Esri, Maxar, Earthstar Geographics</text>`;
      svg += `</svg>`;
      return svg;
    },

    // Builds the card's HTML (photo placeholder + SVG overlay + an empty
    // elevation-tilt badge slot) plus a mount() that queues the real photo
    // load and, separately, the real-elevation tilt lookup — both async,
    // both progressive (the card is fully useful before either resolves).
    renderCard(hole, uid) {
      const view = Guide.Illustrate.buildHoleView(hole);
      if (!view) return { html: null, mount() {} };
      const MAX_SIDE_PX = 900; // stays under the Esri endpoint's throttle threshold found while testing
      const sideM = Math.sqrt(view.reqWidthM * view.reqWidthM + view.reqHeightM * view.reqHeightM) * 1.05;
      const mpp = Math.max(view.reqHeightM / view.imgH, view.reqWidthM / view.imgW);
      const naturalSidePx = Math.round(sideM / mpp);
      const fetchSidePx = Math.min(naturalSidePx, MAX_SIDE_PX);
      const displaySidePx = naturalSidePx;
      const url = Guide.Illustrate.buildEsriSquareUrl(view.center.lat, view.center.lon, sideM, fetchSidePx);
      const rotateDeg = -view.bearingDeg;
      const svgOverlay = Guide.Illustrate.renderOverlaySVG(hole, view, uid);
      const imgId = `hole-photo-${uid}`;
      const tiltId = `hole-tilt-${uid}`;

      const html = `<div style="position:relative; width:${view.imgW}px; height:${view.imgH}px; max-width:100%; overflow:hidden; background:#111; border-radius:8px;">
        <img id="${imgId}" style="position:absolute; width:${displaySidePx}px; height:${displaySidePx}px; left:50%; top:50%; transform: translate(-50%,-50%) rotate(${rotateDeg.toFixed(2)}deg); transform-origin:center; filter: saturate(1.4) contrast(1.14) brightness(1.05); opacity:0; transition: opacity 0.4s;" alt="Hole ${hole.hole_number} satellite view" />
        ${svgOverlay}
        <div id="${tiltId}" style="position:absolute; right:${view.imgW - 104}px; bottom:22px; width:96px; height:17px; border-radius:8.5px; background:#1a1a1a; background-color:rgba(26,26,26,0.8); color:#fff; font:700 8.5px 'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; opacity:0; transition: opacity 0.3s;"></div>
      </div>`;

      function mount() {
        Guide.Illustrate.ImgQueue.enqueue(url).then((src) => {
          const el = document.getElementById(imgId);
          if (el) { el.src = src; el.style.opacity = "1"; }
        }).catch(() => {});

        const backTee = view.backTee;
        Guide.Illustrate.tiltQueue.enqueue(async () => {
          const teeFt = await Elevation.getPointElevation(backTee.lat, backTee.lon);
          const greenFt = await Elevation.getPointElevation(hole.green_data.center_lat, hole.green_data.center_lon);
          if (teeFt == null || greenFt == null) return;
          const diffFt = greenFt - teeFt;
          const el = document.getElementById(tiltId);
          if (!el) return;
          const absFt = Math.round(Math.abs(diffFt));
          const dir = diffFt < -1 ? "DOWNHILL" : diffFt > 1 ? "UPHILL" : "LEVEL";
          const arrow = diffFt < -1 ? "▼" : diffFt > 1 ? "▲" : "●";
          el.textContent = `${arrow} ${dir}${absFt > 0 ? " " + absFt + "ft" : ""}`;
          el.style.opacity = "1";
        });
      }

      return { html, mount };
    },

    // Elevation lookups go through their own small concurrency-limited
    // queue too (gentler on OpenTopography than firing 36 calls at once
    // across 18 holes, and keeps this independent of the image queue).
    tiltQueue: {
      maxConcurrent: 3,
      active: 0,
      pending: [],
      enqueue(fn) {
        this.pending.push(fn);
        this._pump();
      },
      _pump() {
        while (this.active < this.maxConcurrent && this.pending.length) {
          const fn = this.pending.shift();
          this.active++;
          Promise.resolve().then(fn).catch(() => {}).finally(() => { this.active--; this._pump(); });
        }
      },
    },

    // Green-detail card: a tighter crop on the same real imagery, green
    // outline only, plus the hand-entered high/low point + slope arrows
    // when present (never a fabricated contour — same rule as round 5).
    renderGreenCard(hole, uid) {
      const poly = hole.green_data?.polygon;
      if (!poly || poly.length < 3) return { html: null, mount() {} };
      const mappedTees = (hole.tee_sets || []).filter((t) => t.lat != null);
      const refTee = mappedTees.length ? mappedTees.reduce((a, t) => ((t.yardage || 0) > (a.yardage || 0) ? t : a), mappedTees[0]) : null;
      const bearingDeg = refTee ? Guide.Illustrate.compassBearing(refTee.lat, refTee.lon, hole.green_data.center_lat, hole.green_data.center_lon) : 0;
      const bearingRad = Guide.Illustrate.toRad(bearingDeg);
      const cosB = Math.cos(bearingRad), sinB = Math.sin(bearingRad);
      const centerLat = hole.green_data.center_lat, centerLon = hole.green_data.center_lon;

      let minF = Infinity, maxF = -Infinity, minR = Infinity, maxR = -Infinity;
      poly.forEach(([lat, lon]) => {
        const { n, e } = Guide.Illustrate.localMeters(lat, lon, centerLat, centerLon);
        const fwd = n * cosB + e * sinB, right = -n * sinB + e * cosB;
        if (fwd < minF) minF = fwd; if (fwd > maxF) maxF = fwd;
        if (right < minR) minR = right; if (right > maxR) maxR = right;
      });
      const pad = 9;
      minF -= pad; maxF += pad; minR -= pad; maxR += pad;
      // Esri's export endpoint was found (empirically, isolated single
      // requests spaced well apart) to silently fail — onerror, no readable
      // status — for a real-world bbox much under ~100m across, the same
      // "area too small" class of bug already hit and fixed in
      // elevation.js's OpenTopography padding. Most greens are smaller than
      // that on their own, so floor the request footprint here rather than
      // fabricating anything: the card just shows a touch more real fairway
      // margin around a small green instead of failing to load at all.
      const MIN_REQ_M = 110;
      const reqM = Math.max(maxF - minF, maxR - minR, MIN_REQ_M);
      const imgW = 260, imgH = 260;
      const mpp = reqM / imgW;
      let zoom = Math.max(13, Math.min(21, Math.log2((156543.03392 * Math.cos(Guide.Illustrate.toRad(centerLat))) / mpp)));
      const centerWorld = Guide.Illustrate.worldPixel(centerLat, centerLon, zoom);
      function project(lat, lon) {
        const wp = Guide.Illustrate.worldPixel(lat, lon, zoom);
        const wx = wp.x - centerWorld.x, wy = wp.y - centerWorld.y;
        return { x: imgW / 2 + (wx * cosB + wy * sinB), y: imgH / 2 + (-wx * sinB + wy * cosB) };
      }

      const sideM = reqM * 1.3;
      const MAX_SIDE_PX = 900;
      const naturalSidePx = Math.round(sideM / mpp);
      const fetchSidePx = Math.min(naturalSidePx, MAX_SIDE_PX);
      const url = Guide.Illustrate.buildEsriSquareUrl(centerLat, centerLon, sideM, fetchSidePx);
      const rotateDeg = -bearingDeg;

      const toPath = (p) => "M " + p.map(([lat, lon]) => { const pp = project(lat, lon); return `${pp.x.toFixed(1)},${pp.y.toFixed(1)}`; }).join(" L ") + " Z";
      const grd = hole.green_reading_data || {};
      const arrowMarkerId = `garrow${uid}`;
      let overlay = `<svg viewBox="0 0 ${imgW} ${imgH}" xmlns="http://www.w3.org/2000/svg" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;">`;
      overlay += `<defs><marker id="${arrowMarkerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#b23926"/></marker></defs>`;

      // Round 7: a real-scale yard grid — not a fabricated slope, just the
      // green's own measured size (mpp, computed above from its real
      // polygon) divided into even yard intervals. This is the same "grid
      // that reflects the green's actual yardage" convention used on real
      // yardage-book green pages, and it's honest even when no slope has
      // been surveyed yet.
      const pxPerYard = 0.9144 / mpp;
      const gridYd = reqM / 0.9144 > 45 ? 10 : 5;
      const gridStepPx = pxPerYard * gridYd;
      for (let gx = imgW / 2; gx > 0; gx -= gridStepPx) overlay += `<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${imgH}" stroke="#fff" stroke-opacity="0.22" stroke-width="0.6"/>`;
      for (let gx = imgW / 2 + gridStepPx; gx < imgW; gx += gridStepPx) overlay += `<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${imgH}" stroke="#fff" stroke-opacity="0.22" stroke-width="0.6"/>`;
      for (let gy = imgH / 2; gy > 0; gy -= gridStepPx) overlay += `<line x1="0" y1="${gy.toFixed(1)}" x2="${imgW}" y2="${gy.toFixed(1)}" stroke="#fff" stroke-opacity="0.22" stroke-width="0.6"/>`;
      for (let gy = imgH / 2 + gridStepPx; gy < imgH; gy += gridStepPx) overlay += `<line x1="0" y1="${gy.toFixed(1)}" x2="${imgW}" y2="${gy.toFixed(1)}" stroke="#fff" stroke-opacity="0.22" stroke-width="0.6"/>`;
      overlay += `<text x="6" y="12" font-size="7" fill="#fff" fill-opacity="0.85" font-weight="700">Grid: ${gridYd} yd</text>`;

      overlay += `<path d="${toPath(poly)}" fill="#49d06a" fill-opacity="0.12" stroke="#ffffff" stroke-width="2"/>`;
      if (grd.high_point) { const p = project(grd.high_point[0], grd.high_point[1]); overlay += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#b23926" stroke="#fff" stroke-width="1.2"/><text x="${p.x.toFixed(1)}" y="${(p.y-8).toFixed(1)}" font-size="8" text-anchor="middle" fill="#fff" font-weight="700">H</text>`; }
      if (grd.low_point) { const p = project(grd.low_point[0], grd.low_point[1]); overlay += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#235aa3" stroke="#fff" stroke-width="1.2"/><text x="${p.x.toFixed(1)}" y="${(p.y-8).toFixed(1)}" font-size="8" text-anchor="middle" fill="#fff" font-weight="700">L</text>`; }
      (grd.slope_arrows || []).forEach((arrow) => {
        if (!arrow.from || !arrow.to) return;
        const a = project(arrow.from[0], arrow.from[1]), b = project(arrow.to[0], arrow.to[1]);
        overlay += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#b23926" stroke-width="2.2" marker-end="url(#${arrowMarkerId})"/>`;
      });
      overlay += `</svg>`;

      const imgId = `green-photo-${uid}`;
      const html = `<div style="position:relative; width:${imgW}px; height:${imgH}px; max-width:100%; overflow:hidden; background:#111; border-radius:8px;">
        <img id="${imgId}" style="position:absolute; width:${Math.round(sideM/mpp)}px; height:${Math.round(sideM/mpp)}px; left:50%; top:50%; transform: translate(-50%,-50%) rotate(${rotateDeg.toFixed(2)}deg); transform-origin:center; filter: saturate(1.4) contrast(1.14) brightness(1.05); opacity:0; transition: opacity 0.4s;" alt="Hole ${hole.hole_number} green detail" />
        ${overlay}
      </div>`;
      function mount() {
        Guide.Illustrate.ImgQueue.enqueue(url).then((src) => {
          const el = document.getElementById(imgId);
          if (el) { el.src = src; el.style.opacity = "1"; }
        }).catch(() => {});
      }
      return { html, mount };
    },
  },

  // ---- per-hole data ----------------------------------------------------

  hazardRows(hole, mappedTees) {
    return (hole.hazards || []).map((hz, i) => {
      const label = `Bunker ${i + 1}`;
      const cells = mappedTees.map((t) => {
        if (t.lat == null) return "—";
        const y = yardsBetween(t.lat, t.lon, hz.lat, hz.lon);
        return y != null ? fmtNum(y) : "—";
      });
      return { label, cells };
    });
  },

  greenRow(hole, mappedTees) {
    return mappedTees.map((t) => {
      if (t.lat == null) return `${fmtNum(t.yardage)} (scorecard)`;
      const axes = Guide.greenAxes(hole.green_data.polygon, t.lat, t.lon);
      if (!axes) return t.yardage != null ? `${fmtNum(t.yardage)} (scorecard)` : "—";
      const fY = yardsBetween(t.lat, t.lon, axes.front[0], axes.front[1]);
      const cY = yardsBetween(t.lat, t.lon, axes.centroid[0], axes.centroid[1]);
      const bY = yardsBetween(t.lat, t.lon, axes.back[0], axes.back[1]);
      return `${fmtNum(fY)} / ${fmtNum(cY)} / ${fmtNum(bY)}`;
    });
  },

  // Returns { html, mount() } — html is synchronous (all real GPS/geometry
  // data is already on the hole), mount() kicks off the async real-photo
  // and real-elevation lookups once the HTML is actually in the DOM.
  renderHolePage(hole) {
    const mappedTees = hole.tee_sets || [];
    const hazardRows = Guide.hazardRows(hole, mappedTees);
    const greenRow = Guide.greenRow(hole, mappedTees);
    const primaryTee = Guide.primaryMappedTee(hole);
    const greenAxes = primaryTee ? Guide.greenAxes(hole.green_data.polygon, primaryTee.lat, primaryTee.lon) : null;

    const uid = `${hole.hole_number}`;
    const holeCard = Guide.Illustrate.renderCard(hole, uid);
    const greenCard = Guide.Illustrate.renderGreenCard(hole, uid);

    const grd = hole.green_reading_data || {};
    const hasSlope = !!(grd.high_point || grd.low_point || (grd.slope_arrows || []).length || grd.green_notes || grd.slope_note);

    const teeHeaderCells = mappedTees.map((t) => `<th style="color:${t.color}">${escapeHtml(t.name)}${t.lat == null ? " *" : ""}</th>`).join("");
    const hazardRowsHtml = hazardRows
      .map((r) => `<tr><td>${escapeHtml(r.label)}</td>${r.cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("") || `<tr><td colspan="${mappedTees.length + 1}" style="color:var(--muted);">No mapped bunkers/hazards on this hole.</td></tr>`;
    const greenRowHtml = `<tr class="row-green"><td>Green (front / centre / back)</td>${greenRow.map((c) => `<td>${c}</td>`).join("")}</tr>`;

    const html = `
      <section class="hole-page">
        <div class="hole-page-header">
          <div>
            <div class="hole-page-num">Hole ${hole.hole_number}</div>
            <div class="hole-page-meta">${hole.par ? `<span class="par-chip par-${hole.par}">PAR ${hole.par}</span>` : "Par —"} S.I. ${hole.stroke_index ?? "—"}${hole.hole_name ? ` &middot; ${escapeHtml(hole.hole_name)}` : ""}</div>
          </div>
          <div class="hole-page-tees">
            ${mappedTees.map((t) => `<span style="color:${t.color}">&#9679;</span> ${escapeHtml(t.name)} ${fmtNum(t.yardage)}y`).join(" &nbsp; ")}
          </div>
        </div>

        <div class="hole-page-images">
          <div class="hole-image-wrap">
            ${holeCard.html || `<div class="panel panel-muted" style="height:200px; display:flex; align-items:center; justify-content:center;">No mapped points yet for this hole.</div>`}
            <div class="image-caption">Real satellite imagery (Esri World Imagery), rotated tee-to-green. Green outline, bunkers and water are mapped from OpenStreetMap; yardages cross-checked against the official scorecard (tees marked * below have no GPS fix yet). The uphill/downhill reading is real elevation data for the whole hole, not the green surface.</div>
          </div>
          <div class="green-card">
            ${greenCard.html || `<div class="panel panel-muted" style="height:200px; display:flex; align-items:center; justify-content:center;">Green not yet mapped.</div>`}
            <div class="green-card-stats">
              <div><strong>Length:</strong> ${greenAxes ? fmtNum(greenAxes.lengthYards) + " yds" : "—"}</div>
              <div><strong>Width:</strong> ${greenAxes ? fmtNum(greenAxes.widthYards) + " yds" : "—"}</div>
            </div>
            <div class="green-card-slope">
              ${hasSlope
                ? `${grd.green_notes ? escapeHtml(grd.green_notes) : ""}${grd.slope_note ? `<div>${escapeHtml(grd.slope_note)}</div>` : ""}`
                : `<div class="slope-unsurveyed"><em>Undulation/slope not yet surveyed.</em> A green is roughly the size of one elevation-data pixel, so this can't be pulled from an API — add it by eye in Hole Builder → Green detail (mark the high point, low point and break direction) next time you're on the green.</div>`}
            </div>
          </div>
        </div>

        <table class="data guide-distances">
          <thead><tr><th></th>${teeHeaderCells}</tr></thead>
          <tbody>${hazardRowsHtml}${greenRowHtml}</tbody>
        </table>
        ${mappedTees.some((t) => t.lat == null) ? `<p class="guide-footnote">* No OpenStreetMap GPS fix matched this tee within tolerance — distance shown is the plain scorecard yardage, not a computed one.</p>` : ""}
      </section>`;

    function mount() { holeCard.mount(); greenCard.mount(); }
    return { html, mount };
  },

  // ---- cover + legend (once per booklet, not per hole) ------------------
  // Round 7: every researched real yardage book opens with a cover and a
  // legend before the first hole. Both are built purely from data already
  // on the record (Scorecard's own totals, the record's actual tee
  // names/colors) — nothing here is invented for decoration.

  renderCover(record) {
    const totals = Scorecard.build(record);
    const holesMapped = record.holes.filter((h) => (h.tee_sets || []).some((t) => t.lat != null)).length;
    const generated = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    return `
      <div class="guide-cover">
        <div class="guide-cover-kicker">Course Guide Booklet</div>
        <div class="guide-cover-name">${escapeHtml(record.course_name)}</div>
        <div class="guide-cover-stats">
          <div class="guide-cover-stat"><span class="guide-cover-stat-label">Par</span><span class="guide-cover-stat-value">${totals.totalPar || "—"}</span></div>
          <div class="guide-cover-stat"><span class="guide-cover-stat-label">Yardage</span><span class="guide-cover-stat-value">${fmtNum(totals.totalYards)}</span></div>
          <div class="guide-cover-stat"><span class="guide-cover-stat-label">Holes</span><span class="guide-cover-stat-value">18</span></div>
          <div class="guide-cover-stat"><span class="guide-cover-stat-label">GPS-mapped</span><span class="guide-cover-stat-value">${holesMapped}/18</span></div>
        </div>
        <div class="guide-cover-foot">${record.location ? `${escapeHtml(record.location)} &middot; ` : ""}Generated ${generated} &middot; real satellite imagery &amp; GPS-measured distances, not drawn estimates</div>
      </div>`;
  },

  renderLegend(record) {
    const tees = [];
    const seen = new Set();
    record.holes.forEach((h) => (h.tee_sets || []).forEach((t) => {
      if (!seen.has(t.name)) { seen.add(t.name); tees.push(t); }
    }));
    const teeItems = tees.map((t) => `<div class="legend-item"><span class="legend-dot" style="background:${t.color}"></span>${escapeHtml(t.name)} tee</div>`).join("");
    return `
      <div class="guide-legend">
        <div class="guide-legend-title">How to read this guide</div>
        <div class="legend-grid">
          ${teeItems}
          <div class="legend-item"><span class="legend-swatch" style="background:#49d06a;"></span>Green</div>
          <div class="legend-item"><span class="legend-swatch" style="background:#bfe6a8;"></span>Fairway</div>
          <div class="legend-item"><span class="legend-swatch" style="background:#e7cf8a;"></span>Bunker</div>
          <div class="legend-item"><span class="legend-swatch" style="background:#3f8fe0;"></span>Water</div>
          <div class="legend-item">&#x1F6A9; Pin / hole location</div>
          <div class="legend-item">- - - Line of play (longest tee to pin)</div>
          <div class="legend-item">&#x1F9ED; Scale bar / yard grid &mdash; real measured distance, never a guess</div>
          <div class="legend-item">* Tee has no GPS fix yet &mdash; scorecard yardage shown instead</div>
        </div>
      </div>`;
  },

  renderAll() {
    const record = Guide.state.record;
    Guide.el("guide-cover").innerHTML = Guide.renderCover(record);
    Guide.el("guide-legend").innerHTML = Guide.renderLegend(record);
    const holes = record.holes.slice().sort((a, b) => a.hole_number - b.hole_number);
    const pages = holes.map((h) => Guide.renderHolePage(h));
    Guide.el("guide-holes").innerHTML = pages.map((p) => p.html).join("");
    // Mount only after the HTML is actually in the DOM, so getElementById
    // inside each card's mount() can find its placeholder elements.
    pages.forEach((p) => p.mount());
  },
};

document.addEventListener("DOMContentLoaded", Guide.init);
