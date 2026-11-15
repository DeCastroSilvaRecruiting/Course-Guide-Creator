// Course Guide Creator — verified-course persistence (localStorage).
// Ports the Replit app's verified_course.py data model: a per-course record
// with an 18-hole array, each hole carrying tee/strategy/green/hazard data,
// a verification "source" (verified/official/candidate/none), and notes.
//
// v2 schema note: real courses almost always have 3-5 tee sets per hole with
// different yardages (research into Golfshot/Garmin/GolfLogix-style apps
// confirmed this is table-stakes, not an edge case), so `tee_data` (single
// tee) was replaced with `tee_sets` (array). `_migrateHole` upgrades any
// v1 record transparently on load so nothing written with the first build
// is lost.

// Common tee-set names/colors, offered as quick-add buttons in the builder —
// courses vary, so these are just a starting point, not an enforced list.
const TEE_SET_PRESETS = [
  { name: "Championship", color: "#1a1a1a" },
  { name: "Blue", color: "#235aa3" },
  { name: "White", color: "#8d8d8d" },
  { name: "Gold", color: "#c9a227" },
  { name: "Red (Forward)", color: "#b23926" },
];

const Store = {
  _key(slug) {
    return `${CONFIG.STORAGE_PREFIX}course:${slug}`;
  },

  blankHole(holeNum) {
    return {
      hole_number: holeNum,
      par: null,
      stroke_index: null,
      hole_name: "",
      tee_sets: [], // [{ name, color, lat, lon, yardage }]
      strategy_data: {
        ideal_tee_target_lat: null,
        ideal_tee_target_lon: null,
        landing_zones: [], // [{ name, lat, lon, carry_yards, note }]
      },
      green_data: {
        front_lat: null,
        front_lon: null,
        center_lat: null,
        center_lon: null,
        back_lat: null,
        back_lon: null,
        polygon: [], // [[lat, lon], ...]
        length_yards: null,
        width_yards: null,
      },
      hazards: [], // [{ type, lat, lon, note }]
      green_reading_data: {
        high_point: null, // [lat, lon]
        low_point: null,
        slope_arrows: [], // [{ from: [lat,lon], to: [lat,lon] }]
        contour_data: [],
        slope_confidence: "",
        slope_note: "",
        green_notes: "",
        elevation_ft: null, // point elevation sampled at the green centre
      },
      notes: "",
      calculated_distances: {},
      verified: false,
      source: "none", // verified | official | candidate | none
    };
  },

  // Upgrades a hole saved under the old single-tee (`tee_data`) schema to
  // the current `tee_sets` array, in place. Safe to call on an already
  // current-schema hole (no-op).
  _migrateHole(hole) {
    if (!hole) return hole;
    if (!hole.tee_sets) hole.tee_sets = [];
    if (hole.tee_data) {
      const t = hole.tee_data;
      if (t.tee_latitude && t.tee_longitude) {
        hole.tee_sets.push({
          name: t.tee_name || "Tee",
          color: "#4b5a52",
          lat: t.tee_latitude,
          lon: t.tee_longitude,
          yardage: t.official_scorecard_yardage ?? t.gps_tee_yardage ?? null,
        });
      }
      delete hole.tee_data;
    }
    return hole;
  },

  newRecord(courseName, meta = {}) {
    return {
      course_name: courseName,
      slug: courseFileSlug(courseName),
      location: meta.location || "",
      lat: meta.lat ?? null,
      lon: meta.lon ?? null,
      osm_type: meta.osm_type || "",
      osm_id: meta.osm_id || "",
      boundary: meta.boundary || null,
      elevation: meta.elevation || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      holes: Array.from({ length: 18 }, (_, i) => Store.blankHole(i + 1)),
    };
  },

  load(slug) {
    try {
      const raw = localStorage.getItem(Store._key(slug));
      if (!raw) return null;
      const record = JSON.parse(raw);
      (record.holes || []).forEach(Store._migrateHole);
      return record;
    } catch (e) {
      console.warn("Could not load course record", e);
      return null;
    }
  },

  save(record) {
    record.updated_at = new Date().toISOString();
    try {
      localStorage.setItem(Store._key(record.slug), JSON.stringify(record));
    } catch (e) {
      console.warn("Could not save course record", e);
    }
    return record;
  },

  loadOrCreate(courseName, meta = {}) {
    const slug = courseFileSlug(courseName);
    const existing = Store.load(slug);
    if (existing) return existing;
    return Store.newRecord(courseName, meta);
  },

  listAll() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${CONFIG.STORAGE_PREFIX}course:`)) {
        try {
          out.push(JSON.parse(localStorage.getItem(key)));
        } catch (e) {
          /* skip corrupt entry */
        }
      }
    }
    out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return out;
  },

  remove(slug) {
    localStorage.removeItem(Store._key(slug));
  },

  // Merge a hand-built hole (from the hole-builder page) into the record.
  // tee_sets/landing_zones/hazards/green polygon are whole-array replacements
  // (the builder always saves its current full set), everything else merges
  // field-by-field so an edit to one part of a hole never clobbers another.
  mergeManualHole(record, holeNum, holeData) {
    const idx = record.holes.findIndex((h) => h.hole_number === holeNum);
    const base = idx >= 0 ? record.holes[idx] : Store.blankHole(holeNum);
    const merged = {
      ...base,
      ...holeData,
      hole_number: holeNum,
      tee_sets: holeData.tee_sets !== undefined ? holeData.tee_sets : base.tee_sets,
      strategy_data: { ...base.strategy_data, ...(holeData.strategy_data || {}) },
      green_data: { ...base.green_data, ...(holeData.green_data || {}) },
      verified: true,
      source: holeData.source || "verified",
    };
    if (idx >= 0) record.holes[idx] = merged;
    else record.holes.push(merged);
    record.holes.sort((a, b) => a.hole_number - b.hole_number);
    return Store.save(record);
  },

  // Best single yardage for a hole: a named tee set if one matches
  // `preferredName`, otherwise the longest tee set on file (closest to the
  // "official scorecard" yardage golfers expect as the headline number).
  primaryTeeSet(hole, preferredName) {
    const sets = hole.tee_sets || [];
    if (!sets.length) return null;
    if (preferredName) {
      const match = sets.find((t) => t.name === preferredName);
      if (match) return match;
    }
    return sets.reduce((longest, t) => ((t.yardage || 0) > (longest.yardage || 0) ? t : longest), sets[0]);
  },

  // Merge green-detail data (center/high/low/slope) into a hole.
  mergeGreenDetail(record, holeNum, greenReadingData) {
    const idx = record.holes.findIndex((h) => h.hole_number === holeNum);
    const base = idx >= 0 ? record.holes[idx] : Store.blankHole(holeNum);
    base.green_reading_data = { ...base.green_reading_data, ...greenReadingData };
    if (base.source === "none") base.source = "candidate";
    if (idx >= 0) record.holes[idx] = base;
    else record.holes.push(base);
    record.holes.sort((a, b) => a.hole_number - b.hole_number);
    return Store.save(record);
  },

  findHole(record, holeNum) {
    return record.holes.find((h) => h.hole_number === holeNum) || Store.blankHole(holeNum);
  },
};
