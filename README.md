# Course Guide Creator

Build a detailed, ProVisualizer-style course guide for **any** golf course — search it, confirm the right match on a map, fill in tees, landing zones, hazards, green outlines and green-reading notes hole by hole, then use the **Play** screen to get live GPS distances from wherever you're standing during a round.

This is a static site: no server, no build step, no backend. It runs entirely in your browser and saves everything to that browser's local storage. It's also an installable PWA with offline support for everything except live map tiles and API lookups (see below).

## Live setup

1. Open `index.html` via GitHub Pages (see below), or locally.
2. Expand **Settings** and paste in:
   - A free **Mapbox public token** from [account.mapbox.com](https://account.mapbox.com/) — used for the satellite map and hole diagrams. Restrict it to your Pages domain under Mapbox's token settings once you have one, since public tokens are visible in page source (that's normal for Mapbox — restriction by domain is what keeps it safe).
   - Optionally, a free **OpenTopography API key** from [opentopography.org](https://opentopography.org/) — used for elevation data and the "plays like" estimate. Leave blank to skip; the app degrades gracefully with an "elevation unavailable" note.
3. Search for a course. If more than one place matches, you'll be asked to confirm which one before anything else runs.
4. From the results page, open the **hole builder**:
   - Add one or more **tee sets** (Championship/Blue/White/Gold/Red or custom names) — real courses have several, each with its own yardage, so there's no single "the" distance per hole.
   - Click-to-place landing zones, bunkers/hazards and the green outline. Front/centre/back-of-green distances are worked out automatically from the outline and the tee you're measuring from, instead of needing three more manual clicks.
   - Optionally hit **Estimate plays-like distance** to see an elevation-adjusted yardage (clearly marked as an estimate — see "Plays-like estimate" below).
   - Switch to **Green detail** to mark the high point, low point and any slope arrows.
5. Hit **Play this course** from the results page to get live yardages to the green and every landing zone/hazard from your phone's actual GPS position while you're out on the course.

Everything is saved as you go (per-browser, per-device — there's no account or sync).

## Offline use (PWA)

The app registers a service worker that keeps its own pages/scripts/styles available offline, and can be "installed" from your phone's browser (Add to Home Screen) like a native app. It fetches the app shell fresh over the network whenever you're online (so updates reach you immediately) and only falls back to the cached copy when there's no connection at all. Once a course is saved, reopening the app, viewing its scorecard or verification dashboard, and using the Play screen's distance math all keep working with no signal — which matters on a golf course, where cell coverage is often poor. The one thing that genuinely needs a connection is the map tiles and any new course searches/lookups, since those come from Mapbox/Nominatim/Overpass/OpenTopography live.

## Plays-like estimate

Vendors like Garmin, Arccos and 15th Club all offer "plays like" distances, but none publish their exact formula — only that elevation, wind and air density are the inputs and that uphill plays longer. This app's estimate uses a simple, transparent, publicly-documented rule of thumb (~1 yard of effective distance per 3 ft of elevation change) applied to the straight-line tee-to-green distance and each point's OpenTopography elevation. It's deliberately labelled as an estimate everywhere it appears — it ignores club, trajectory, wind and air density, and isn't a reproduction of any vendor's proprietary model.

## Enabling GitHub Pages

In this repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / root → Save**. GitHub will give you a `https://<username>.github.io/<repo>/` URL a minute or two later.

## Data sources

- **Course search & boundary**: OpenStreetMap, via the Nominatim and Overpass public APIs. OSM's `golf=*` tagging scheme ([wiki](https://wiki.openstreetmap.org/wiki/Key:golf)) covers tees, greens, fairways, bunkers and hazards, but coverage is community-contributed and inconsistent between courses — that's why the hole builder exists, to fill gaps by hand.
- **Satellite map, hole diagrams & live play view**: Mapbox GL JS (your own public token).
- **Elevation**: OpenTopography SRTM 30m data (your own API key, optional).
- **Live on-course distances**: your browser's own Geolocation API — nothing is sent anywhere; it's computed entirely client-side against the points you mapped.

No data is pulled from commercial golf GPS/simulator platforms (GOLFZON, SwingU, etc.) — that data is licensed and not something this project can legally use.

## Project structure

```
index.html          Search → confirm → results
hole-builder.html    Click-to-place tee sets, landing zones, hazards & green outline
play.html            Live on-course GPS distances
css/styles.css       Shared dark-green/amber design system
manifest.json        PWA manifest (installable, app icons)
sw.js                Service worker — offline app shell caching
icons/               PWA icons
js/config.js         Settings (API keys, stored in localStorage only)
js/storage.js        Verified-course data model (multi-tee-set schema) + localStorage persistence
js/geocode.js        Nominatim search + Overpass feature/boundary lookup
js/elevation.js      OpenTopography elevation lookup, rendering & plays-like estimate
js/maps.js           Mapbox GL JS helpers shared across pages
js/scorecard.js      Scorecard table building/rendering (per tee set)
js/verification.js   Hole-by-hole completeness/status dashboard
js/app.js            index.html page controller
js/hole-builder.js   hole-builder.html page controller
js/play.js           play.html page controller (live GPS distances)
```

## Notes / known limitations

- OpenTopography's CORS support for direct browser calls hasn't been independently verified from this project's own dev environment; if elevation lookups fail silently in your browser's console, that's the likely cause — the UI will just show "elevation unavailable" rather than breaking anything else.
- OpenStreetMap doesn't have a mapped boundary or hole-level features for every course. When it doesn't, the hole builder still works — you're just starting from a blank map centered on the course rather than pre-populated tee/green points.
- Straight-line tee-to-green distance underestimates yardage on a dogleg hole (OSM itself models the actual line of play as a bent path, not a straight line) — the yardage field next to each tee set is editable for exactly this reason; treat the computed distance as a starting point, not the final scorecard number.
- GPS accuracy on a phone is typically a few metres outdoors, shown live on the Play screen; it can be worse under trees or near buildings.
- This project started as a Replit-hosted FastAPI prototype; this GitHub Pages version ports that design and data model to a fully static, client-side app with live interactive maps and live GPS distances in place of the old server-rendered static images.
