// Course Guide Creator — index.html page controller.
// Flow: search -> multi-candidate confirmation -> full results page.
// Ports the Replit routes /search-course, /confirm-course and the shared
// render_course_results() pipeline into client-side view switching.

const App = {
  state: {
    courseName: "",
    location: "",
    record: null,
    map: null,
    teeName: null,
  },

  el(id) {
    return document.getElementById(id);
  },

  showView(name) {
    ["view-search", "view-confirm", "view-results"].forEach((id) => {
      App.el(id).style.display = id === `view-${name}` ? "" : "none";
    });
  },

  init() {
    App.loadSettingsIntoForm();
    App.el("settings-form").addEventListener("submit", App.onSaveSettings);
    App.el("search-form").addEventListener("submit", App.onSearchSubmit);
    App.el("back-to-search").addEventListener("click", () => App.showView("search"));
    App.renderMyCourses();
    App.showView("search");
  },

  loadSettingsIntoForm() {
    const s = Settings.get();
    App.el("mapbox-token").value = s.mapboxToken || "";
    App.el("opentopo-key").value = s.opentopoKey || "";
  },

  onSaveSettings(ev) {
    ev.preventDefault();
    Settings.save({
      mapboxToken: App.el("mapbox-token").value.trim(),
      opentopoKey: App.el("opentopo-key").value.trim(),
    });
    App.el("settings-status").textContent = "Saved to this browser.";
    setTimeout(() => (App.el("settings-status").textContent = ""), 2500);
  },

  renderMyCourses() {
    const list = Store.listAll();
    const wrap = App.el("my-courses");
    if (!list.length) {
      wrap.innerHTML = `<div class="panel panel-muted">No saved course guides yet — search for one below to get started.</div>`;
      return;
    }
    wrap.innerHTML = list
      .map((r) => {
        const data = Scorecard.build(r);
        return `
        <div class="candidate">
          <div>
            <h3>${escapeHtml(r.course_name)}</h3>
            <p class="coords">${escapeHtml(r.location || "")} · Par ${data.totalPar || "—"} · ${fmtNum(data.totalYards)} yds</p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn small secondary" data-open-slug="${escapeHtml(r.slug)}">Open</button>
            <button class="btn small secondary" data-delete-slug="${escapeHtml(r.slug)}">Delete</button>
          </div>
        </div>`;
      })
      .join("");
    wrap.querySelectorAll("[data-open-slug]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const record = Store.load(btn.dataset.openSlug);
        if (record) App.renderResults(record);
      })
    );
    wrap.querySelectorAll("[data-delete-slug]").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (confirm("Delete this saved course guide from this browser?")) {
          Store.remove(btn.dataset.deleteSlug);
          App.renderMyCourses();
        }
      })
    );
  },

  async onSearchSubmit(ev) {
    ev.preventDefault();
    const courseName = App.el("course-name").value.trim();
    const location = App.el("location").value.trim();
    if (!courseName) return;
    App.state.courseName = courseName;
    App.state.location = location;

    const statusEl = App.el("search-status");
    statusEl.textContent = "Searching…";
    App.el("search-submit").disabled = true;
    try {
      // Local-first: try the bundled ~5000-course worldwide index (instant,
      // no network) before falling back to live Nominatim search. Local
      // matches are only used when there's no location filter typed, since
      // the local index doesn't carry city/region text to match against.
      let candidates = [];
      let fromLocal = false;
      if (!location) {
        candidates = await CourseDB.search(courseName, 5);
        fromLocal = candidates.length > 0;
      }
      if (!candidates.length) {
        candidates = await Geocode.searchCandidates(courseName, location);
      }
      if (!candidates.length) {
        statusEl.innerHTML = `<div class="panel panel-red">No course found for "${escapeHtml(courseName)}". Try adding a city/state, or check the spelling.</div>`;
        return;
      }
      if (candidates.length === 1) {
        await App.confirmCandidate(candidates[0]);
      } else {
        App.renderConfirmation(candidates);
      }
      statusEl.textContent = fromLocal ? "Matched instantly from the built-in course index." : "";
    } catch (e) {
      console.error(e);
      statusEl.innerHTML = `<div class="panel panel-red">Search failed: ${escapeHtml(e.message)}</div>`;
    } finally {
      App.el("search-submit").disabled = false;
    }
  },

  renderConfirmation(candidates) {
    App.el("confirm-course-name").textContent = App.state.courseName;
    const wrap = App.el("confirm-candidates");
    wrap.innerHTML = candidates
      .map(
        (c, i) => `
      <div class="candidate">
        <div>
          <span class="label">Match ${i + 1}</span>
          <h3>${escapeHtml(c.display_name)}</h3>
          <p class="coords">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)} · ${escapeHtml(c.type || "")}</p>
        </div>
        <button class="btn small" data-candidate-idx="${i}">Use this course</button>
      </div>`
      )
      .join("");
    wrap.querySelectorAll("[data-candidate-idx]").forEach((btn) =>
      btn.addEventListener("click", () => App.confirmCandidate(candidates[Number(btn.dataset.candidateIdx)]))
    );
    App.showView("confirm");
  },

  async confirmCandidate(candidate) {
    const record = Store.loadOrCreate(App.state.courseName, {
      location: App.state.location,
      lat: candidate.lat,
      lon: candidate.lon,
      osm_type: candidate.osm_type,
      osm_id: candidate.osm_id,
    });
    record.lat = candidate.lat;
    record.lon = candidate.lon;
    record.osm_type = candidate.osm_type;
    record.osm_id = candidate.osm_id;

    App.showView("results");
    App.el("results-course-name").textContent = App.state.courseName;
    App.el("results-boundary-panel").innerHTML = `<div class="panel panel-muted">Looking up course boundary…</div>`;
    App.el("results-elevation-panel").innerHTML = `<div class="panel panel-muted">Checking elevation…</div>`;

    const boundary = await Geocode.fetchCourseBoundary(candidate.lat, candidate.lon);
    record.boundary = boundary;
    App.el("results-boundary-panel").innerHTML = boundary
      ? `<div class="panel panel-green">Course boundary found from OpenStreetMap (${boundary.length} points).</div>`
      : `<div class="panel panel-muted">No mapped boundary found in OpenStreetMap for this course yet — distances still work from the tee/green points you add in the hole builder.</div>`;

    const elevation = await Elevation.getCourseElevation(candidate.lat, candidate.lon, boundary);
    record.elevation = elevation;
    App.el("results-elevation-panel").innerHTML = Elevation.renderHtml(elevation);

    Store.save(record);
    App.renderResults(record);
    App.renderMyCourses();
  },

  // Re-rendered on its own (rather than the whole results view) when the
  // tee-set picker changes, since switching tees only affects yardages.
  renderScorecard(record) {
    App.el("results-scorecard").innerHTML = Scorecard.renderHtml(record, App.state.teeName);
    const teePicker = App.el("scorecard-tee-picker");
    if (teePicker) {
      teePicker.addEventListener("change", () => {
        App.state.teeName = teePicker.value || null;
        App.renderScorecard(record);
      });
    }
  },

async maybeRefreshElevation(record) {
  const key = Settings.opentopoKey();
  if (!key) return;
  const staleNoKey =
    !record.elevation || (record.elevation.unavailable && /API key/i.test(record.elevation.reason || ""));
  if (!staleNoKey) return;
  App.el("results-elevation-panel").innerHTML = `<div class="panel panel-muted">Checking elevation…</div>`;
  const elevation = await Elevation.getCourseElevation(record.lat, record.lon, record.boundary);
  record.elevation = elevation;
  Store.save(record);
  if (App.state.record === record) {
    App.el("results-elevation-panel").innerHTML = Elevation.renderHtml(elevation);
  }
},
  
  renderResults(record) {
    App.state.record = record;
    App.el("results-course-name").textContent = record.course_name;
    App.el("results-location").textContent = record.location || "";
    App.el("results-boundary-panel").innerHTML = record.boundary
      ? `<div class="panel panel-green">Course boundary found from OpenStreetMap (${record.boundary.length} points).</div>`
      : `<div class="panel panel-muted">No mapped boundary found in OpenStreetMap yet.</div>`;
    App.el("results-elevation-panel").innerHTML = Elevation.renderHtml(record.elevation);
    App.maybeRefreshElevation(record);
    App.renderScorecard(record);
    App.el("results-verification").innerHTML = Verification.renderHtml(record);
    App.el("results-builder-link").href = `hole-builder.html?slug=${encodeURIComponent(record.slug)}&hole=1`;
        App.el("results-guide-link").href = `guide.html?slug=${encodeURIComponent(record.slug)}`;
    App.el("results-play-link").href = `play.html?slug=${encodeURIComponent(record.slug)}`;

    const mapEl = App.el("results-map");
    if (record.lat && record.lon) {
      const map = MapsHelper.init(mapEl, { center: [record.lat, record.lon], zoom: 15 });
      if (map) {
        map.on("load", () => {
          MapsHelper.marker(map, record.lat, record.lon, { color: "#173d2b", popupHtml: `<strong>${escapeHtml(record.course_name)}</strong>` });
          if (record.boundary) {
            MapsHelper.polygon(map, "course-boundary", record.boundary);
            MapsHelper.fitTo(map, record.boundary);
          }
          record.holes.forEach((h) => {
            (h.tee_sets || []).forEach((t) => {
              if (t.lat && t.lon) {
                MapsHelper.marker(map, t.lat, t.lon, {
                  color: t.color || "#4b5a52",
                  popupHtml: `Hole ${h.hole_number} — ${escapeHtml(t.name || "tee")}`,
                });
              }
            });
            const g = h.green_data;
            if (g && g.center_lat && g.center_lon) {
              MapsHelper.marker(map, g.center_lat, g.center_lon, {
                color: "#237044",
                popupHtml: `Hole ${h.hole_number} green`,
              });
            }
          });
        });
      }
    } else {
      mapEl.innerHTML = `<div class="panel panel-muted">No coordinates on file yet for this course.</div>`;
    }

    App.showView("results");
    window.scrollTo({ top: 0, behavior: "smooth" });
  },
};

document.addEventListener("DOMContentLoaded", App.init);
