// Course Guide Creator — course search (Nominatim) and feature/boundary
// lookup (Overpass/OSM). Ports search_course()/get_golf_features()/
// fetch_course_boundary() from the Replit app's main.py + course_boundary.py.

const Geocode = {
  // Returns up to 5 candidate matches (mirrors the Replit confirmation stage
  // that replaced the old "first result only" behaviour).
  async searchCandidates(courseName, location) {
    const searchText = location ? `${courseName}, ${location}` : courseName;
    const params = new URLSearchParams({
      q: searchText,
      format: "jsonv2",
      limit: "5",
      addressdetails: "1",
    });
    const res = await fetch(`${CONFIG.NOMINATIM_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Nominatim search failed (${res.status})`);
    const data = await res.json();
    return (data || []).map((d) => ({
      display_name: d.display_name,
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      osm_type: d.osm_type,
      osm_id: d.osm_id,
      type: d.type,
      class: d.class,
    }));
  },

  // Overpass query around a confirmed point: golf course way/relation plus
  // tee/green/bunker/hole features tagged under the `golf=*` scheme.
  async fetchGolfFeatures(lat, lon, radiusMeters = 1200) {
    const query = `
      [out:json][timeout:25];
      (
        way(around:${radiusMeters},${lat},${lon})["golf"];
        node(around:${radiusMeters},${lat},${lon})["golf"];
        relation(around:${radiusMeters},${lat},${lon})["leisure"="golf_course"];
        way(around:${radiusMeters},${lat},${lon})["leisure"="golf_course"];
      );
      out body geom;
    `;
    const res = await fetch(CONFIG.OVERPASS_ENDPOINT, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error(`Overpass query failed (${res.status})`);
    const data = await res.json();
    return (data && data.elements) || [];
  },

  // Boundary polygon for the overall course, if OSM has one tagged
  // leisure=golf_course with geometry; returns null when unavailable so
  // callers can fall back gracefully (same contract as the Python version).
  async fetchCourseBoundary(lat, lon) {
    try {
      const elements = await Geocode.fetchGolfFeatures(lat, lon, 1500);
      const boundaryWay = elements.find(
        (el) => el.type === "way" && el.tags && el.tags.leisure === "golf_course" && el.geometry
      );
      if (!boundaryWay) return null;
      return boundaryWay.geometry.map((p) => [p.lat, p.lon]);
    } catch (e) {
      console.warn("Boundary lookup failed, continuing without it", e);
      return null;
    }
  },

  // Buckets raw Overpass elements by golf=* tag so downstream rendering can
  // group tees / greens / bunkers / fairways per hole where numbered.
  groupFeaturesByHole(elements) {
    const byHole = {};
    for (const el of elements) {
      if (!el.tags) continue;
      const holeRef = el.tags.ref || el.tags["golf:hole"] || null;
      const key = holeRef || "unassigned";
      if (!byHole[key]) byHole[key] = [];
      byHole[key].push(el);
    }
    return byHole;
  },

  pointOfElement(el) {
    if (el.type === "node") return [el.lat, el.lon];
    if (el.geometry && el.geometry.length) {
      const mid = el.geometry[Math.floor(el.geometry.length / 2)];
      return [mid.lat, mid.lon];
    }
    if (el.center) return [el.center.lat, el.center.lon];
    return null;
  },
};
