// Course Guide Creator — hole builder page controller.
// Click-to-place one or more tee sets, landing zones, bunkers and a green
// outline for one hole, plus a "green detail" mode for high/low points and
// slope arrows. Replaces the old Pillow-rendered static diagrams
// (hole_map_generator.py / green_detail_generator.py) with a live Mapbox
// GL map, and — per research into how real golf GPS apps are built —
// supports multiple tee sets per hole and an optional elevation-adjusted
// "plays like" estimate, rather than a single fixed yardage.

const Builder = {
  state: {
    record: null,
    holeNum: 1,
    tab: "hole", // hole | green
    mode: "landing",
    map: null,
    markers: { teeSets: [], landing: [], bunker: [], greenOutline: [], high: null, low: null, slopes: [] },
    pendingSlopeStart: null,
    pendingTeeName: "",
    pendingTeeColor: "#4b5a52",
  },

  el(id) { return document.getElementById(id); },

  init() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug");
    const hole = parseInt(params.get("hole") || "1", 10);
    if (!slug) { window.location.href = "index.html"; return; }
    const record = Store.load(slug);
    if (!record) { window.location.href = "index.html"; return; }
    Builder.state.record = record;
    Builder.state.holeNum = hole;

    Builder.el("hb-course-name").textContent = record.course_name;
    Builder.el("hb-back-link").href = "index.html";
    Builder.populateTeePresets();
    Builder.populateHoleSelect();
    Builder.wireTabs();
    Builder.wireModes();
    Builder.wireNav();
    Builder.el("hb-save").addEventListener("click", Builder.onSave);
    Builder.el("hb-clear-green-outline").addEventListener("click", Builder.onClearGreenOutline);
    Builder.el("hb-clear-slopes").addEventListener("click", Builder.onClearSlopes);
    Builder.el("hb-add-tee-mode").addEventListener("click", Builder.onArmTeeMode);

    Builder.initMap();
    Builder.loadHoleIntoForm();
  },

  populateTeePresets() {
    const sel = Builder.el("hb-tee-preset");
    TEE_SET_PRESETS.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.dataset.color = p.color;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  },

  populateHoleSelect() {
    const sel = Builder.el("hb-hole-select");
    sel.innerHTML = Array.from({ length: 18 }, (_, i) => i + 1)
      .map((n) => `<option value="${n}" ${n === Builder.state.holeNum ? "selected" : ""}>Hole ${n}</option>`)
      .join("");
    sel.addEventListener("change", () => Builder.goToHole(parseInt(sel.value, 10)));
  },

  wireNav() {
    Builder.el("hb-prev").addEventListener("click", () => Builder.goToHole(Math.max(1, Builder.state.holeNum - 1)));
    Builder.el("hb-next").addEventListener("click", () => Builder.goToHole(Math.min(18, Builder.state.holeNum + 1)));
  },

  goToHole(n) {
    Builder.onSave(null, { silent: true });
    Builder.state.holeNum = n;
    Builder.el("hb-hole-select").value = String(n);
    Builder.loadHoleIntoForm();
  },

  wireTabs() {
    document.querySelectorAll(".mode-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".mode-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        Builder.state.tab = btn.dataset.tab;
        Builder.el("hb-tab-hole").style.display = btn.dataset.tab === "hole" ? "" : "none";
        Builder.el("hb-tab-green").style.display = btn.dataset.tab === "green" ? "" : "none";
        const firstModeBtn = document.querySelector(`#hb-tab-${btn.dataset.tab} .marker-mode-btn`);
        if (firstModeBtn) Builder.setMode(firstModeBtn.dataset.mode);
      });
    });
  },

  wireModes() {
    document.querySelectorAll(".marker-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => Builder.setMode(btn.dataset.mode));
    });
  },

  setMode(mode) {
    Builder.state.mode = mode;
    Builder.state.pendingSlopeStart = null;
    document.querySelectorAll(".marker-mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    Builder.el("hb-add-tee-mode").classList.toggle("active", mode === "tee");
  },

  onArmTeeMode() {
    const sel = Builder.el("hb-tee-preset");
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.value) {
      Builder.state.pendingTeeName = opt.value;
      Builder.state.pendingTeeColor = opt.dataset.color || "#4b5a52";
    } else {
      const name = prompt("Name this tee set (e.g. 'Member', 'Senior')", "Tee");
      if (!name) return;
      Builder.state.pendingTeeName = name;
      Builder.state.pendingTeeColor = "#4b5a52";
    }
    document.querySelectorAll(".marker-mode-btn").forEach((b) => b.classList.remove("active"));
    Builder.state.mode = "tee";
    Builder.el("hb-add-tee-mode").classList.add("active");
  },

  initMap() {
    const record = Builder.state.record;
    const center = record.lat && record.lon ? [record.lat, record.lon] : [0, 0];
    const map = MapsHelper.init(Builder.el("hb-map"), { center, zoom: 17 });
    Builder.state.map = map;
    if (!map) return;
    map.on("click", (e) => Builder.onMapClick(e.lngLat.lat, e.lngLat.lng));
  },

  onMapClick(lat, lon) {
    const mode = Builder.state.mode;
    const m = Builder.state.markers;
    const map = Builder.state.map;
    if (!map) return;

    if (mode === "tee") {
      const marker = MapsHelper.marker(map, lat, lon, { color: Builder.state.pendingTeeColor, popupHtml: escapeHtml(Builder.state.pendingTeeName) });
      m.teeSets.push({ marker, name: Builder.state.pendingTeeName, color: Builder.state.pendingTeeColor, lat, lon, yardage: null });
      Builder.renderTeeList();
      Builder.setMode("landing");
    } else if (mode === "landing") {
      const carry = prompt("Carry distance from the tee (yards)? Leave blank to skip.", "");
      const name = prompt("Label for this landing zone (e.g. 'Layup', 'Driver target')", `Zone ${m.landing.length + 1}`);
      const marker = MapsHelper.marker(map, lat, lon, { color: "#916019", popupHtml: escapeHtml(name || "") });
      m.landing.push({ marker, lat, lon, name: name || "", carry_yards: carry ? Number(carry) : null });
    } else if (mode === "bunker") {
      const note = prompt("Hazard note (e.g. 'Fairway bunker, left')", "Bunker");
      const marker = MapsHelper.marker(map, lat, lon, { color: "#c9a227", popupHtml: escapeHtml(note || "") });
      m.bunker.push({ marker, lat, lon, type: "bunker", note: note || "" });
    } else if (mode === "green") {
      const marker = MapsHelper.marker(map, lat, lon, { color: "#237044" });
      m.greenOutline.push({ marker, lat, lon });
      Builder.redrawGreenOutline();
    } else if (mode === "high") {
      if (m.high) m.high.marker.remove();
      const marker = MapsHelper.marker(map, lat, lon, { color: "#b23926", popupHtml: "High point" });
      m.high = { marker, lat, lon };
    } else if (mode === "low") {
      if (m.low) m.low.marker.remove();
      const marker = MapsHelper.marker(map, lat, lon, { color: "#235aa3", popupHtml: "Low point" });
      m.low = { marker, lat, lon };
    } else if (mode === "slope") {
      if (!Builder.state.pendingSlopeStart) {
        Builder.state.pendingSlopeStart = [lat, lon];
      } else {
        const from = Builder.state.pendingSlopeStart;
        const to = [lat, lon];
        m.slopes.push({ from, to });
        MapsHelper.line(map, `slope-${m.slopes.length}`, [from, to], { color: "#b23926" });
        Builder.state.pendingSlopeStart = null;
      }
    }
    Builder.updateDistances();
  },

  redrawGreenOutline() {
    const map = Builder.state.map;
    const points = Builder.state.markers.greenOutline.map((p) => [p.lat, p.lon]);
    if (points.length >= 3) {
      MapsHelper.polygon(map, "green-outline", points, { fillColor: "#237044", opacity: 0.25, lineColor: "#237044" });
    }
  },

  onClearGreenOutline() {
    const m = Builder.state.markers;
    m.greenOutline.forEach((p) => p.marker.remove());
    m.greenOutline = [];
    const map = Builder.state.map;
    if (map && map.getLayer("green-outline-fill")) {
      map.removeLayer("green-outline-fill");
      map.removeLayer("green-outline-line");
      map.removeSource("green-outline");
    }
    Builder.updateDistances();
  },

  onClearSlopes() {
    const m = Builder.state.markers;
    const map = Builder.state.map;
    m.slopes.forEach((_, i) => {
      const id = `slope-${i + 1}-line`;
      if (map.getLayer(id)) { map.removeLayer(id); map.removeSource(`slope-${i + 1}`); }
    });
    m.slopes = [];
  },

  removeTeeSet(index) {
    const m = Builder.state.markers;
    if (m.teeSets[index].marker) m.teeSets[index].marker.remove();
    m.teeSets.splice(index, 1);
    Builder.renderTeeList();
    Builder.updateDistances();
  },

  // Green centroid — used both as the default green "center" point and as
  // the target for each tee set's distance-to-green calculation.
  greenCentroid() {
    const pts = Builder.state.markers.greenOutline;
    if (!pts.length) return null;
    return [pts.reduce((t, p) => t + p.lat, 0) / pts.length, pts.reduce((t, p) => t + p.lon, 0) / pts.length];
  },

  // Projects the green outline onto the tee->green bearing to find the
  // front and back of the green along the line of play — the classic
  // "front/centre/back" numbers golf GPS apps show, derived automatically
  // instead of needing three more manual clicks per hole.
  frontCenterBack(teeLat, teeLon) {
    const outline = Builder.state.markers.greenOutline;
    const centroid = Builder.greenCentroid();
    if (!outline.length || !centroid || teeLat === null) return null;
    const bearing = Math.atan2(centroid[1] - teeLon, centroid[0] - teeLat);
    const ux = Math.cos(bearing), uy = Math.sin(bearing);
    let minProj = Infinity, maxProj = -Infinity, frontPt = outline[0], backPt = outline[0];
    outline.forEach((p) => {
      const proj = (p.lat - teeLat) * ux + (p.lon - teeLon) * uy;
      if (proj < minProj) { minProj = proj; frontPt = p; }
      if (proj > maxProj) { maxProj = proj; backPt = p; }
    });
    return { front: [frontPt.lat, frontPt.lon], back: [backPt.lat, backPt.lon], center: centroid };
  },

  renderTeeList() {
    const wrap = Builder.el("hb-tee-list");
    const m = Builder.state.markers;
    const centroid = Builder.greenCentroid();
    wrap.innerHTML = m.teeSets
      .map((t, i) => {
        const straight = centroid ? yardsBetween(t.lat, t.lon, centroid[0], centroid[1]) : null;
        return `
        <div class="candidate" style="padding:8px 10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="swatch" style="background:${t.color}"></span>
            <strong style="font-size:13px;">${escapeHtml(t.name)}</strong>
            ${straight ? `<span style="color:#68776d; font-size:12px;">(${fmtNum(straight)} yds to green)</span>` : ""}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="number" class="hb-tee-yardage" data-idx="${i}" placeholder="${straight ? Math.round(straight) : "yards"}" value="${t.yardage ?? ""}" style="width:80px; padding:6px 8px; border:1px solid #ccd6cd; border-radius:8px;" />
            <button class="btn small secondary" data-remove-tee="${i}" type="button">Remove</button>
          </div>
        </div>`;
      })
      .join("") || `<div class="panel panel-muted" style="padding:10px;">No tee sets yet — pick a name above and click "Click map to add".</div>`;
    wrap.querySelectorAll("[data-remove-tee]").forEach((btn) =>
      btn.addEventListener("click", () => Builder.removeTeeSet(Number(btn.dataset.removeTee)))
    );
    wrap.querySelectorAll(".hb-tee-yardage").forEach((input) =>
      input.addEventListener("change", () => {
        const idx = Number(input.dataset.idx);
        m.teeSets[idx].yardage = input.value ? Number(input.value) : null;
      })
    );
  },

  updateDistances() {
    const m = Builder.state.markers;
    const lines = [];
    const centroid = Builder.greenCentroid();
    m.teeSets.forEach((t) => {
      m.landing.forEach((lz) => {
        const y = yardsBetween(t.lat, t.lon, lz.lat, lz.lon);
        lines.push(`${escapeHtml(t.name)} → ${escapeHtml(lz.name || "landing zone")}: ${fmtNum(y)} yds`);
      });
      if (centroid) {
        const fcb = Builder.frontCenterBack(t.lat, t.lon);
        if (fcb) {
          const fY = yardsBetween(t.lat, t.lon, fcb.front[0], fcb.front[1]);
          const cY = yardsBetween(t.lat, t.lon, fcb.center[0], fcb.center[1]);
          const bY = yardsBetween(t.lat, t.lon, fcb.back[0], fcb.back[1]);
          lines.push(`${escapeHtml(t.name)} → green: front ${fmtNum(fY)} / centre ${fmtNum(cY)} / back ${fmtNum(bY)} yds`);
        } else {
          const y = yardsBetween(t.lat, t.lon, centroid[0], centroid[1]);
          lines.push(`${escapeHtml(t.name)} → green centre: ${fmtNum(y)} yds`);
        }
      }
    });
    const base = lines.length
      ? lines.map((l) => `<div>${l}</div>`).join("")
      : "Add a tee set, then landing zones or a green outline, to see live distances here.";
    Builder.el("hb-distances").innerHTML = base + Builder.playsLikeControlHtml();
    const btn = Builder.el("hb-plays-like-btn");
    if (btn) btn.addEventListener("click", Builder.onEstimatePlaysLike);
  },

  playsLikeControlHtml() {
    const m = Builder.state.markers;
    if (!m.teeSets.length || !m.greenOutline.length) return "";
    return `<div style="margin-top:10px;"><button class="btn secondary small" id="hb-plays-like-btn" type="button">Estimate plays-like distance (uses elevation)</button>
      <div id="hb-plays-like-result" style="margin-top:6px; font-size:12px; color:#68776d;"></div></div>`;
  },

  async onEstimatePlaysLike() {
    const m = Builder.state.markers;
    const centroid = Builder.greenCentroid();
    const tee = Store.primaryTeeSet({ tee_sets: m.teeSets.map((t) => ({ name: t.name, lat: t.lat, lon: t.lon, yardage: t.yardage })) });
    if (!tee || !centroid) return;
    const resultEl = Builder.el("hb-plays-like-result");
    resultEl.textContent = "Looking up elevation…";
    const [teeElev, greenElev] = await Promise.all([
      Elevation.getPointElevation(tee.lat, tee.lon),
      Elevation.getPointElevation(centroid[0], centroid[1]),
    ]);
    if (teeElev === null || greenElev === null) {
      resultEl.textContent = "Elevation unavailable (add an OpenTopography key in Settings, or this area has no CORS-reachable data).";
      return;
    }
    const horizontal = yardsBetween(tee.lat, tee.lon, centroid[0], centroid[1]);
    const changeFt = greenElev - teeElev;
    const playsLike = Elevation.playsLikeYards(horizontal, changeFt);
    const direction = changeFt > 0 ? "uphill" : changeFt < 0 ? "downhill" : "flat";
    resultEl.innerHTML = `From ${escapeHtml(tee.name)}: ${fmtNum(horizontal)} yds straight-line, ${direction}
      (${fmtNum(Math.abs(changeFt))} ft) → <strong>~${fmtNum(playsLike)} yds plays-like</strong>
      <span style="display:block; color:#87938b;">Estimate only — a simplified elevation model, not a club-specific or vendor formula.</span>`;
  },

  loadHoleIntoForm() {
    Builder.clearAllMarkers();
    const hole = Store.findHole(Builder.state.record, Builder.state.holeNum);
    Builder.el("hb-par").value = hole.par ?? "";
    Builder.el("hb-si").value = hole.stroke_index ?? "";
    Builder.el("hb-name").value = hole.hole_name ?? "";
    Builder.el("hb-notes").value = hole.notes ?? "";
    Builder.el("hb-slope-confidence").value = (hole.green_reading_data && hole.green_reading_data.slope_confidence) || "";
    Builder.el("hb-green-notes").value = (hole.green_reading_data && hole.green_reading_data.green_notes) || "";
    Builder.el("hb-save-status").textContent = "";

    // Data (tee list, live distances, plays-like) always loads from the
    // saved record, whether or not a Mapbox token is set — only the visual
    // pins depend on a live map. Without a map, clicking to add new points
    // isn't possible, but everything already saved stays visible and the
    // yardage/notes fields stay fully editable.
    const map = Builder.state.map;
    const place = () => {
      const m = Builder.state.markers;
      (hole.tee_sets || []).forEach((t) => {
        const marker = map ? MapsHelper.marker(map, t.lat, t.lon, { color: t.color || "#4b5a52", popupHtml: escapeHtml(t.name || "") }) : null;
        m.teeSets.push({ marker, ...t });
      });
      Builder.renderTeeList();
      (hole.strategy_data.landing_zones || []).forEach((lz) => {
        const marker = map ? MapsHelper.marker(map, lz.lat, lz.lon, { color: "#916019", popupHtml: escapeHtml(lz.name || "") }) : null;
        m.landing.push({ marker, ...lz });
      });
      (hole.hazards || []).forEach((hz) => {
        const marker = map ? MapsHelper.marker(map, hz.lat, hz.lon, { color: "#c9a227", popupHtml: escapeHtml(hz.note || "") }) : null;
        m.bunker.push({ marker, ...hz });
      });
      (hole.green_data.polygon || []).forEach(([lat, lon]) => {
        const marker = map ? MapsHelper.marker(map, lat, lon, { color: "#237044" }) : null;
        m.greenOutline.push({ marker, lat, lon });
      });
      if (map) Builder.redrawGreenOutline();
      const gr = hole.green_reading_data || {};
      if (gr.high_point) {
        const marker = map ? MapsHelper.marker(map, gr.high_point[0], gr.high_point[1], { color: "#b23926", popupHtml: "High point" }) : null;
        m.high = { marker, lat: gr.high_point[0], lon: gr.high_point[1] };
      }
      if (gr.low_point) {
        const marker = map ? MapsHelper.marker(map, gr.low_point[0], gr.low_point[1], { color: "#235aa3", popupHtml: "Low point" }) : null;
        m.low = { marker, lat: gr.low_point[0], lon: gr.low_point[1] };
      }
      (gr.slope_arrows || []).forEach((arrow, i) => {
        if (map) MapsHelper.line(map, `slope-${i + 1}`, [arrow.from, arrow.to], { color: "#b23926" });
        m.slopes.push(arrow);
      });

      if (map) {
        // Only fit to points that actually have coordinates — a tee set or
        // landing zone can exist in the data (e.g. official scorecard yardages
        // entered before anything is mapped) with lat/lon still null, and
        // fitting to a pile of [null, null] points collapsed the map to
        // (0, 0) at a very tight zoom instead of showing the course.
        const hasLatLon = (p) => p && p[0] != null && p[1] != null && !Number.isNaN(p[0]) && !Number.isNaN(p[1]);
        const allPts = [];
        m.teeSets.forEach((t) => { if (hasLatLon([t.lat, t.lon])) allPts.push([t.lat, t.lon]); });
        hole.strategy_data.landing_zones.forEach((lz) => { if (hasLatLon([lz.lat, lz.lon])) allPts.push([lz.lat, lz.lon]); });
        hole.green_data.polygon.forEach((p) => { if (hasLatLon(p)) allPts.push(p); });
        if (allPts.length >= 2) MapsHelper.fitTo(map, allPts, 70);
        else if (Builder.state.record.lat) map.setCenter([Builder.state.record.lon, Builder.state.record.lat]);
      }

      Builder.updateDistances();
    };
    if (!map) place();
    else if (map.loaded()) place();
    else map.on("load", place);
  },

  clearAllMarkers() {
    const m = Builder.state.markers;
    m.teeSets.forEach((t) => t.marker && t.marker.remove());
    m.landing.forEach((p) => p.marker && p.marker.remove());
    m.bunker.forEach((p) => p.marker && p.marker.remove());
    m.greenOutline.forEach((p) => p.marker && p.marker.remove());
    if (m.high && m.high.marker) m.high.marker.remove();
    if (m.low && m.low.marker) m.low.marker.remove();
    const map = Builder.state.map;
    if (map) {
      if (map.getLayer("green-outline-fill")) {
        map.removeLayer("green-outline-fill"); map.removeLayer("green-outline-line"); map.removeSource("green-outline");
      }
      m.slopes.forEach((_, i) => {
        const id = `slope-${i + 1}-line`;
        if (map.getLayer(id)) { map.removeLayer(id); map.removeSource(`slope-${i + 1}`); }
      });
    }
    Builder.state.markers = { teeSets: [], landing: [], bunker: [], greenOutline: [], high: null, low: null, slopes: [] };
  },

  onSave(ev, opts = {}) {
    if (ev) ev.preventDefault();
    const m = Builder.state.markers;
    const record = Builder.state.record;
    const holeNum = Builder.state.holeNum;

    const greenPts = m.greenOutline.map((p) => [p.lat, p.lon]);
    const centroid = Builder.greenCentroid();
    const primaryTee = m.teeSets[0];
    const fcb = primaryTee && centroid ? Builder.frontCenterBack(primaryTee.lat, primaryTee.lon) : null;

    const holeData = {
      par: Builder.el("hb-par").value ? Number(Builder.el("hb-par").value) : null,
      stroke_index: Builder.el("hb-si").value ? Number(Builder.el("hb-si").value) : null,
      hole_name: Builder.el("hb-name").value,
      notes: Builder.el("hb-notes").value,
      tee_sets: m.teeSets.map((t) => ({ name: t.name, color: t.color, lat: t.lat, lon: t.lon, yardage: t.yardage })),
      strategy_data: {
        landing_zones: m.landing.map((lz) => ({ name: lz.name, lat: lz.lat, lon: lz.lon, carry_yards: lz.carry_yards, note: lz.note || "" })),
      },
      green_data: {
        polygon: greenPts,
        center_lat: centroid ? centroid[0] : null,
        center_lon: centroid ? centroid[1] : null,
        front_lat: fcb ? fcb.front[0] : null,
        front_lon: fcb ? fcb.front[1] : null,
        back_lat: fcb ? fcb.back[0] : null,
        back_lon: fcb ? fcb.back[1] : null,
      },
      hazards: m.bunker.map((hz) => ({ type: hz.type, lat: hz.lat, lon: hz.lon, note: hz.note })),
    };
    Store.mergeManualHole(record, holeNum, holeData);
    Store.mergeGreenDetail(record, holeNum, {
      high_point: m.high ? [m.high.lat, m.high.lon] : null,
      low_point: m.low ? [m.low.lat, m.low.lon] : null,
      slope_arrows: m.slopes,
      slope_confidence: Builder.el("hb-slope-confidence").value,
      green_notes: Builder.el("hb-green-notes").value,
    });
    Builder.state.record = Store.load(record.slug);
    if (!opts.silent) {
      Builder.el("hb-save-status").textContent = `Hole ${holeNum} saved.`;
      setTimeout(() => (Builder.el("hb-save-status").textContent = ""), 2000);
    }
  },
};

document.addEventListener("DOMContentLoaded", Builder.init);
