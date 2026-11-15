// Course Guide Creator — per-hole verification dashboard.
// Ports render_verification_html() from verified_course.py: a sticky-header
// table showing, per hole, how much of the data model is filled in and
// where it came from (verified / official / candidate / none).

const Verification = {
  completeness(hole) {
    let total = 0;
    let filled = 0;
    const check = (v) => {
      total += 1;
      if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) filled += 1;
    };
    check(hole.par);
    check(hole.stroke_index);
    check(Scorecard.bestYardage(hole));
    check(hole.tee_sets && hole.tee_sets.length);
    check(hole.strategy_data && hole.strategy_data.landing_zones && hole.strategy_data.landing_zones.length);
    check(hole.green_data && hole.green_data.center_lat);
    check(hole.green_data && hole.green_data.polygon);
    check(hole.green_reading_data && hole.green_reading_data.high_point);
    return Math.round((filled / total) * 100);
  },

  renderRow(hole) {
    const pct = Verification.completeness(hole);
    const cls = Scorecard.statusClass(hole);
    return `
      <tr class="${cls}">
        <td><span class="hole-number">${hole.hole_number}</span></td>
        <td>${Scorecard.parChip(hole.par)}</td>
        <td>${fmtNum(Scorecard.bestYardage(hole))}</td>
        <td>${hole.tee_sets ? hole.tee_sets.length : 0}</td>
        <td>${hole.strategy_data && hole.strategy_data.landing_zones ? hole.strategy_data.landing_zones.length : 0}</td>
        <td>${hole.green_data && hole.green_data.center_lat ? "Yes" : "No"}</td>
        <td>${hole.green_reading_data && hole.green_reading_data.high_point ? "Yes" : "No"}</td>
        <td>${pct}%</td>
        <td>${Scorecard.statusPill(hole)}</td>
        <td><a href="hole-builder.html?slug=${encodeURIComponent(hole._slug || "")}&hole=${hole.hole_number}" class="btn small secondary">Edit</a></td>
      </tr>`;
  },

  renderHtml(record) {
    const holes = record.holes
      .slice()
      .sort((a, b) => a.hole_number - b.hole_number)
      .map((h) => ({ ...h, _slug: record.slug }));
    const rows = holes.map(Verification.renderRow).join("");
    return `
      <div class="table-wrap">
        <table class="verify">
          <thead>
            <tr>
              <th>Hole</th><th>Par</th><th>Yards</th><th>Tee sets</th><th>Landing zones</th>
              <th>Green mapped</th><th>Slope mapped</th><th>Complete</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="legend-row">
        <span>${Scorecard.statusPill({ source: "verified" })} Verified by you in the hole builder</span>
        <span>${Scorecard.statusPill({ source: "candidate" })} Partial / from OSM, not yet confirmed</span>
        <span>${Scorecard.statusPill({ source: "none" })} Not started</span>
      </div>`;
  },
};
