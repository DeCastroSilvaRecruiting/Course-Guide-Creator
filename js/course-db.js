// Course Guide Creator — local golf-course index for fast, offline-friendly
// name search. Ships a static, worldwide, OpenStreetMap-derived dataset of
// ~5000 named golf courses (data/golf-courses.json) so typing a course name
// can match instantly without a network round-trip. Falls back to the live
// Nominatim search (Geocode.searchCandidates) in app.js when nothing matches
// here — this module never claims to be exhaustive.
const CourseDB = {
  _data: null,
  _loading: null,

  async load() {
    if (CourseDB._data) return CourseDB._data;
    if (CourseDB._loading) return CourseDB._loading;
    CourseDB._loading = fetch("data/golf-courses.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        CourseDB._data = Array.isArray(d) ? d : [];
        return CourseDB._data;
      })
      .catch(() => {
        CourseDB._data = [];
        return CourseDB._data;
      });
    return CourseDB._loading;
  },

  // Returns up to `limit` candidates shaped like Geocode.searchCandidates'
  // output, so App.onSearchSubmit can treat either source the same way.
  async search(query, limit = 5) {
    const data = await CourseDB.load();
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const c of data) {
      const name = c.name.toLowerCase();
      let score;
      if (name === q) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if (name.includes(q)) score = 2;
      else continue;
      scored.push({ c, score, lenDiff: name.length - q.length });
    }
    scored.sort((a, b) => a.score - b.score || a.lenDiff - b.lenDiff);
    return scored.slice(0, limit).map(({ c }) => ({
      display_name: c.name,
      lat: c.lat,
      lon: c.lon,
      osm_type: "way",
      osm_id: null,
      type: "golf_course",
      class: "leisure",
      source: "local",
    }));
  },
};
