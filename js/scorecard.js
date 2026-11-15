// Course Guide Creator — scorecard table building/rendering.
// Ports build_scorecard_data()/render_scorecard_html() from verified_course.py.

const Scorecard = {
  // All distinct tee-set names across a record, longest-first, so a
  // tee-set picker can be built once a course has any tees mapped.
  teeSetNames(record) {
    const names = new Set();
    record.holes.forEach((h) => (h.tee_sets || []).forEach((t) => names.add(t.name)));
    return Array.from(names);
  },

  build(record, teeName) {
    const holes = record.holes.slice().sort((a, b) => a.hole_number - b.hole_number);
    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);
    const sum = (arr, pick) => arr.reduce((t, h) => t + (Number(pick(h)) || 0), 0);
    return {
      front,
      back,
      frontPar: sum(front, (h) => h.par),
      backPar: sum(back, (h) => h.par),
      totalPar: sum(holes, (h) => h.par),
      frontYards: sum(front, (h) => Scorecard.bestYardage(h, teeName)),
      backYards: sum(back, (h) => Scorecard.bestYardage(h, teeName)),
      totalYards: sum(holes, (h) => Scorecard.bestYardage(h, teeName)),
    };
  },

  // Yardage for one hole from a named tee set, or the longest tee set on
  // file when no name is given/matched — real courses have multiple tee
  // sets (research into GolfLogix/Garmin/Golfshot confirmed this is
  // standard, not optional), so a single "the" yardage no longer exists.
  bestYardage(hole, teeName) {
    const tee = Store.primaryTeeSet(hole, teeName);
    return tee ? tee.yardage : null;
  },

  statusClass(hole) {
    return `row-${hole.source || "none"}`.replace("row-none", "row-empty");
  },

  statusPill(hole) {
    const map = {
      verified: ["pill-verified", "Verified"],
      official: ["pill-verified", "Official"],
      candidate: ["pill-candidate", "Candidate"],
      none: ["pill-empty", "Not started"],
    };
    const [cls, label] = map[hole.source] || map.none;
    return `<span class="pill ${cls}">${label}</span>`;
  },

  parChip(par) {
    if (!par) return "—";
    return `<span class="par-chip par-${par}">Par ${par}</span>`;
  },

  renderHalfTable(title, holes, teeName) {
    const rows = holes
      .map(
        (h) => `
        <tr class="${Scorecard.statusClass(h)}">
          <td>${h.hole_number}</td>
          <td>${Scorecard.parChip(h.par)}</td>
          <td>${h.stroke_index ?? "—"}</td>
          <td>${fmtNum(Scorecard.bestYardage(h, teeName))}</td>
          <td>${Scorecard.statusPill(h)}</td>
        </tr>`
      )
      .join("");
    const parTotal = holes.reduce((t, h) => t + (Number(h.par) || 0), 0);
    const yardTotal = holes.reduce((t, h) => t + (Number(Scorecard.bestYardage(h, teeName)) || 0), 0);
    return `
      <div>
        <div class="scorecard-half-title">${escapeHtml(title)}</div>
        <table class="data">
          <thead><tr><th>Hole</th><th>Par</th><th>S.I.</th><th>Yards</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>Total</td><td>${parTotal}</td><td></td><td>${fmtNum(yardTotal)}</td><td></td></tr></tfoot>
        </table>
      </div>`;
  },

  // teeName: which tee set's yardages to total (defaults to the longest
  // tee set on file per hole). Callers that let the golfer switch tees
  // (results page) re-render with a different teeName on selection change.
  renderHtml(record, teeName) {
    const data = Scorecard.build(record, teeName);
    const names = Scorecard.teeSetNames(record);
    const picker = names.length
      ? `<div class="field" style="max-width:260px; margin-bottom:14px;">
          <label for="scorecard-tee-picker">Tee set</label>
          <select id="scorecard-tee-picker">
            <option value="">Longest tee on file</option>
            ${names.map((n) => `<option value="${escapeHtml(n)}" ${n === teeName ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
          </select>
        </div>`
      : "";
    return `
      ${picker}
      <div class="scorecard-halves">
        ${Scorecard.renderHalfTable("Front 9", data.front, teeName)}
        ${Scorecard.renderHalfTable("Back 9", data.back, teeName)}
      </div>
      <div class="grand-total" style="margin-top:16px;">
        <div>
          <div class="grand-label">Total par</div>
          <div class="grand-value">${data.totalPar || "—"}</div>
        </div>
        <div>
          <div class="grand-label">Total yardage</div>
          <div class="grand-value">${fmtNum(data.totalYards)}</div>
        </div>
      </div>`;
  },
};
