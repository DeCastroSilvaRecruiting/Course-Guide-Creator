// Course Guide Creator — configuration & small shared helpers.
// API keys are entered once in the Settings panel and kept in localStorage
// only (never committed to the repo), since this is a public GitHub Pages
// site. Mapbox public tokens are meant to be used client-side — restrict
// yours to your Pages domain in the Mapbox dashboard. OpenTopography keys
// are free/rate-limited, not secret, but we still keep them out of source.

const CONFIG = {
  NOMINATIM_ENDPOINT: "https://nominatim.openstreetmap.org/search",
  OVERPASS_ENDPOINT: "https://overpass-api.de/api/interpreter",
  OPENTOPOGRAPHY_ENDPOINT: "https://portal.opentopography.org/API/globaldem",
  STORAGE_PREFIX: "cgc:", // course-guide-creator
  SETTINGS_KEY: "cgc:settings",
};

const Settings = {
  get() {
    try {
      const raw = localStorage.getItem(CONFIG.SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  },
  save(partial) {
    const current = Settings.get();
    const next = { ...current, ...partial };
    try {
      localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("Could not save settings", e);
    }
    return next;
  },
  mapboxToken() {
    return Settings.get().mapboxToken || "";
  },
  opentopoKey() {
    return Settings.get().opentopoKey || "";
  },
};

// Mirrors the Python `course_file_slug()` helper — a filesystem/localStorage
// safe key namespaced per course so assets/records never collide.
function courseFileSlug(courseName) {
  return (courseName || "course")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "course";
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Great-circle distance in yards between two lat/lon points.
function yardsBetween(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(v))) {
    return null;
  }
  const R = 6371000; // metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const metres = R * c;
  return metres * 1.09361; // yards
}
