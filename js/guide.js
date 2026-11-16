// Course Guide Creator — printable "Course Guide Booklet" controller.
// A master-yardage-book-style export: one page per hole, built entirely
// from the data already on file (tee_sets, hazards, green_data.polygon,
// green_reading_data) — no live interactive map needed, so this page uses
// Mapbox's Static Images API (plain <img> tags) instead of Mapbox GL JS.
// That also makes it printable: a browser's own "Print… → Save as PDF"
// turns this page straight into the booklet, one hole per sheet.
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

      const token = Settings.mapboxToken();
          if (!token) {
                  Guide.el("guide-holes").innerHTML = `<div class="panel panel-amber">Add a Mapbox public token in
                          Settings on the home page first — the booklet's hole and green images are built from it.</div>`;
                  return;
          }
          Guide.renderAll(token);
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
    // returning real yardages for both.
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
    // length/width — the longest mapped tee on file.
    primaryMappedTee(hole) {
          const mapped = (hole.tee_sets || []).filter((t) => t.lat != null && t.lon != null);
          if (!mapped.length) return null;
          return mapped.reduce((longest, t) => ((t.yardage || 0) > (longest.yardage || 0) ? t : longest), mapped[0]);
    },

    // ---- Mapbox Static Images API ---------------------------------------

    // Standard Google-encoded-polyline algorithm (precision 5).
    encodePolyline(points) {
          const factor = 1e5;
          let output = "", prevLat = 0, prevLon = 0;
          const encodeNum = (num) => {
                  num = num < 0 ? ~(num << 1) : num << 1;
                  let out = "";
                  while (num >= 0x20) {
                            out += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
                            num >>= 5;
                  }
                  out += String.fromCharCode(num + 63);
                  return out;
          };
          points.forEach(([lat, lon]) => {
                  const lat5 = Math.round(lat * factor), lon5 = Math.round(lon * factor);
                  output += encodeNum(lat5 - prevLat) + encodeNum(lon5 - prevLon);
                  prevLat = lat5; prevLon = lon5;
          });
          return output;
    },

    hexColor(c) {
          return (c || "4b5a52").replace(/^#/, "");
    },

    pinOverlay(lat, lon, color) {
          return `pin-s+${Guide.hexColor(color)}(${lon},${lat})`;
    },

    pathOverlay(polygon, { stroke = "237044", strokeOpacity = 0.9, fill = "237044", fillOpacity = 0.25, width = 3 } = {}) {
          let pts = polygon;
          if (pts.length > 60) {
                  const step = Math.ceil(pts.length / 60);
                  pts = pts.filter((_, i) => i % step === 0);
          }
          const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts : [...pts, pts[0]];
          const encoded = encodeURIComponent(Guide.encodePolyline(closed));
          return `path-${width}+${stroke}-${strokeOpacity}+${fill}-${fillOpacity}(${encoded})`;
    },

    staticImageUrl(overlays, widthPx, heightPx, token) {
          const overlayStr = overlays.length ? overlays.join(",") : "";
          const base = "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static";
          return `${base}/${overlayStr}/auto/${widthPx}x${heightPx}@2x?padding=30&access_token=${encodeURIComponent(token)}`;
    },

    holeOverviewImage(hole, token) {
          const overlays = [];
          if (hole.green_data.polygon && hole.green_data.polygon.length >= 3) {
                  overlays.push(Guide.pathOverlay(hole.green_data.polygon));
          }
          (hole.hazards || []).forEach((hz) => overlays.push(Guide.pinOverlay(hz.lat, hz.lon, "c9a227")));
          (hole.tee_sets || []).forEach((t) => { if (t.lat != null) overlays.push(Guide.pinOverlay(t.lat, t.lon, t.color)); });
          if (!overlays.length) return null;
          return Guide.staticImageUrl(overlays, 420, 280, token);
    },

    greenCardImage(hole, token) {
          const poly = hole.green_data.polygon;
          if (!poly || poly.length < 3) return null;
          const overlays = [Guide.pathOverlay(poly, { width: 4 })];
          const grd = hole.green_reading_data || {};
          if (grd.high_point) overlays.push(Guide.pinOverlay(grd.high_point[0], grd.high_point[1], "b23926"));
          if (grd.low_point) overlays.push(Guide.pinOverlay(grd.low_point[0], grd.low_point[1], "235aa3"));
          (grd.slope_arrows || []).forEach((arrow) => {
                  if (arrow.from && arrow.to) overlays.push(Guide.pathOverlay([arrow.from, arrow.to], { stroke: "b23926", fill: "b23926", fillOpacity: 0, width: 3 }));
          });
          return Guide.staticImageUrl(overlays, 300, 300, token);
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

    renderHolePage(hole, token) {
          const mappedTees = hole.tee_sets || [];
          const hazardRows = Guide.hazardRows(hole, mappedTees);
          const greenRow = Guide.greenRow(hole, mappedTees);
          const primaryTee = Guide.primaryMappedTee(hole);
          const greenAxes = primaryTee ? Guide.greenAxes(hole.green_data.polygon, primaryTee.lat, primaryTee.lon) : null;

      const holeImg = Guide.holeOverviewImage(hole, token);
          const greenImg = Guide.greenCardImage(hole, token);

      const grd = hole.green_reading_data || {};
          const hasSlope = !!(grd.high_point || grd.low_point || (grd.slope_arrows || []).length || grd.green_notes || grd.slope_note);

      const teeHeaderCells = mappedTees.map((t) => `<th style="color:${t.color}">${escapeHtml(t.name)}${t.lat == null ? " *" : ""}</th>`).join("");
          const hazardRowsHtml = hazardRows
            .map((r) => `<tr><td>${escapeHtml(r.label)}</td>${r.cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
            .join("") || `<tr><td colspan="${mappedTees.length + 1}" style="color:var(--muted);">No mapped bunkers/hazards on this hole.</td></tr>`;
          const greenRowHtml = `<tr class="row-green"><td>Green (front / centre / back)</td>${greenRow.map((c) => `<td>${c}</td>`).join("")}</tr>`;

      return `
            <section class="hole-page">
                    <div class="hole-page-header">
                              <div>
                                          <div class="hole-page-num">Hole ${hole.hole_number}</div>
                                                      <div class="hole-page-meta">Par ${hole.par ?? "—"} &middot; S.I. ${hole.stroke_index ?? "—"}${hole.hole_name ? ` &middot; ${escapeHtml(hole.hole_name)}` : ""}</div>
                                                                </div>
                                                                          <div class="hole-page-tees">
                                                                                      ${mappedTees.map((t) => `<span style="color:${t.color}">&#9679;</span> ${escapeHtml(t.name)} ${fmtNum(t.yardage)}y`).join(" &nbsp; ")}
                                                                                                </div>
                                                                                                        </div>
                                                                                                        
                                                                                                                <div class="hole-page-images">
                                                                                                                          <div class="hole-image-wrap">
                                                                                                                                      ${holeImg ? `<img src="${holeImg}" alt="Hole ${hole.hole_number} overview" width="420" height="280" />` : `<div class="panel panel-muted" style="height:200px; display:flex; align-items:center; justify-content:center;">No mapped points yet for this hole.</div>`}
                                                                                                                                                  <div class="image-caption">Tee boxes, green outline and bunkers — mapped from OpenStreetMap, cross-checked against the official scorecard yardages (tees marked * below have no GPS fix yet).</div>
                                                                                                                                                            </div>
                                                                                                                                                                      <div class="green-card">
                                                                                                                                                                                  ${greenImg ? `<img src="${greenImg}" alt="Hole ${hole.hole_number} green detail" width="300" height="300" />` : `<div class="panel panel-muted" style="height:200px; display:flex; align-items:center; justify-content:center;">Green not yet mapped.</div>`}
                                                                                                                                                                                              <div class="green-card-stats">
                                                                                                                                                                                                            <div><strong>Length:</strong> ${greenAxes ? fmtNum(greenAxes.lengthYards) + " yds" : "—"}</div>
                                                                                                                                                                                                                          <div><strong>Width:</strong> ${greenAxes ? fmtNum(greenAxes.widthYards) + " yds" : "—"}</div>
                                                                                                                                                                                                                                      </div>
                                                                                                                                                                                                                                                  <div class="green-card-slope">
                                                                                                                                                                                                                                                                ${hasSlope
                                                                                                                                                                                                                                                                                  ? `${grd.green_notes ? escapeHtml(grd.green_notes) : ""}${grd.slope_note ? `<div>${escapeHtml(grd.slope_note)}</div>` : ""}`
                                                                                                                                                                                                                                                                                  : `<em>Undulation/slope not yet surveyed.</em> A green is roughly the size of one elevation-data pixel, so this can't be pulled from an API — add it by eye in Hole Builder → Green detail (mark the high point, low point and break direction) next time you're on the green.`}
                                                                                                                                                                                                                                                                                              </div>
                                                                                                                                                                                                                                                                                                        </div>
                                                                                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                                                        <table class="data guide-distances">
                                                                                                                                                                                                                                                                                                                                  <thead><tr><th></th>${teeHeaderCells}</tr></thead>
                                                                                                                                                                                                                                                                                                                                            <tbody>${hazardRowsHtml}${greenRowHtml}</tbody>
                                                                                                                                                                                                                                                                                                                                                    </table>
                                                                                                                                                                                                                                                                                                                                                            ${mappedTees.some((t) => t.lat == null) ? `<p class="guide-footnote">* No OpenStreetMap GPS fix matched this tee within tolerance — distance shown is the plain scorecard yardage, not a computed one.</p>` : ""}
                                                                                                                                                                                                                                                                                                                                                                  </section>`;
    },

    renderAll(token) {
          const record = Guide.state.record;
          const holes = record.holes.slice().sort((a, b) => a.hole_number - b.hole_number);
          Guide.el("guide-holes").innerHTML = holes.map((h) => Guide.renderHolePage(h, token)).join("");
    },
};

document.addEventListener("DOMContentLoaded", Guide.init);
