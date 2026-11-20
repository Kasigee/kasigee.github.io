// Golden Ticket 2027 Training Hub — renders live public data.json
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CLOCK_COLORS = ['#7a4fcf', '#5d7ce6', '#d97706', '#e2525c', '#0b7a72'];

let state = {
  data: null,
  paceMode: 'armidale', // 'armidale' | 'base'
  phaseFilter: 'all',
};

function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtShortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function resolvePaces(text, paces, mode) {
  const safe = esc(text);
  return safe.replace(/\{(E|M|T|CV|5K|I|3K|R)\}/g, (_, code) => {
    const z = paces[code];
    if (!z) return code;
    const val = mode === 'armidale' ? z.armidale : z.base;
    return `<span class="pace-tok" title="${esc(z.label)} (${mode === 'armidale' ? 'Armidale ~990 m' : 'Sea-level EAP'})">${code} ${esc(val)}/km</span>`;
  });
}

function renderHero(data) {
  document.getElementById('gt-updated').textContent = data.updated_at;
  document.getElementById('kpi-days').textContent = `${data.days_to_golden_ticket} days`;
  document.getElementById('kpi-days-sub').textContent = `13–14 Mar 2027 · 42.1 km across 7 races`;

  document.getElementById('kpi-block').textContent = `${data.summary.block_km} km`;
  document.getElementById('kpi-block-sub').textContent = `${data.summary.block_runs} runs · ${data.summary.rolling_7d_km} km last 7 d`;

  document.getElementById('kpi-week').textContent = `Wk ${data.current_week} / ${data.total_weeks}`;
  document.getElementById('kpi-week-sub').textContent = `${data.summary.current_week_actual_km} / ${data.summary.current_week_planned_km} km planned`;

  document.getElementById('kpi-vdot').textContent = `${data.fitness.vdot}`;
  document.getElementById('kpi-vdot-sub').textContent = `TT1 ${data.fitness.est_5k_eap} EAP · trend ${data.fitness.vdot_trend.split(' ')[0]}`;

  // Current call dispatch
  const call = data.current_call;
  document.getElementById('dispatch-date').textContent = `Coach dispatch · ${fmtShortDate(call.date)}`;
  document.getElementById('dispatch-title').textContent = call.headline;
  const vEl = document.getElementById('dispatch-verdict');
  vEl.textContent = call.verdict;
  vEl.classList.toggle('is-adjusted', call.verdict.toLowerCase() !== 'as planned');
  document.getElementById('dispatch-summary').textContent = call.summary;

  const next3 = document.getElementById('dispatch-next3');
  next3.innerHTML = (call.next_three_days || []).map((item) => `
    <div class="gt-next-item">
      <div class="gt-next-top">
        <span>${esc(item.day)}</span>
        <span class="gt-next-badge ${item.status.toLowerCase() === 'adjusted' ? 'adj' : ''}">${esc(item.status)}</span>
      </div>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.target)}</p>
    </div>
  `).join('');
}

function renderVolumeChart(data) {
  const weeks = data.weeks;
  const maxKm = Math.max(80, ...weeks.map((w) => Math.max(w.planned_km, w.actual_km))) + 6;
  const W = 940;
  const H = 250;
  const padL = 38;
  const padR = 14;
  const padT = 26;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = plotW / weeks.length;
  const barW = Math.max(12, step * 0.68);
  const yOf = (km) => padT + plotH * (1 - km / maxKm);

  const gridLines = [0, 20, 40, 60, 80].filter((v) => v <= maxKm).map((v) => {
    const y = yOf(v);
    return `
      <line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--rule)" stroke-dasharray="${v === 0 ? 'none' : '3 4'}" />
      <text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-family="var(--mono)" font-size="10">${v}</text>
    `;
  }).join('');

  const bars = weeks.map((w, idx) => {
    const cx = padL + idx * step + step / 2;
    const x = cx - barW / 2;
    const yPlan = yOf(w.planned_km);
    const hPlan = Math.max(1, yOf(0) - yPlan);
    const yAct = yOf(w.actual_km);
    const hAct = Math.max(0, yOf(0) - yAct);
    const isCur = w.week === data.current_week;
    const planFill = w.down ? 'var(--signal-ab)' : 'var(--ink)';
    const planOp = w.down ? '0.16' : '0.13';
    const strokeCol = isCur ? 'var(--accent)' : (w.down ? 'var(--signal-ab)' : 'var(--rule-strong)');

    const markTag = w.mark
      ? `<g transform="translate(${cx}, ${yPlan - 10})">
           <rect x="-4" y="-4" width="8" height="8" transform="rotate(45)" fill="var(--signal-b)" />
           <text y="-8" text-anchor="middle" fill="var(--signal-b)" font-family="var(--mono)" font-size="9" font-weight="600">${esc(w.mark)}</text>
         </g>`
      : '';

    return `
      <g class="gt-bar-group" data-week="${w.week}" role="button" tabindex="0" aria-label="Week ${w.week}: ${w.actual_km} of ${w.planned_km} km">
        <title>Week ${w.week} (${w.start}): ${w.actual_km} km logged / ${w.planned_km} km planned${w.mark ? ' · ' + w.mark : ''}</title>
        <rect class="bar-plan" x="${x}" y="${yPlan}" width="${barW}" height="${hPlan}" rx="4"
              fill="${planFill}" fill-opacity="${planOp}" stroke="${strokeCol}" stroke-width="${isCur ? 1.8 : 1}"
              stroke-dasharray="${w.down ? '3 2' : 'none'}" />
        ${hAct > 0 ? `<rect x="${x + 2}" y="${yAct}" width="${barW - 4}" height="${hAct}" rx="3" fill="var(--accent)" />` : ''}
        ${markTag}
        <text x="${cx}" y="${H - 12}" text-anchor="middle" fill="${isCur ? 'var(--accent)' : 'var(--muted)'}"
              font-family="var(--mono)" font-size="10" font-weight="${isCur ? '600' : '400'}">W${w.week}</text>
      </g>
    `;
  }).join('');

  const wrap = document.getElementById('gt-volume-chart');
  wrap.innerHTML = `<svg class="gt-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly actual vs planned kilometres across ${weeks.length} weeks">${gridLines}${bars}</svg>`;

  wrap.querySelectorAll('.gt-bar-group').forEach((g) => {
    const jump = () => jumpToWeek(Number(g.dataset.week));
    g.addEventListener('click', jump);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
  });

  // Checkpoints strip
  const cpWrap = document.getElementById('gt-checkpoints');
  cpWrap.innerHTML = data.checkpoints.map((cp) => {
    const isDone = Boolean(cp.result);
    const isRace = cp.label.toLowerCase().includes('golden ticket') && !cp.label.toLowerCase().includes('sim');
    return `
      <article class="gt-cp ${isDone ? 'done' : ''} ${isRace ? 'race' : ''}">
        <time datetime="${esc(cp.date)}">${fmtShortDate(cp.date)} ${cp.date.slice(0, 4)}</time>
        <b>${esc(cp.label)}</b>
        <small>${isDone ? esc(cp.result) : esc(cp.a)}</small>
      </article>
    `;
  }).join('');
}

function renderPaces(data) {
  document.getElementById('pace-vdot').textContent = data.fitness.vdot;
  const isArm = state.paceMode === 'armidale';
  document.getElementById('pace-caption').textContent = isArm
    ? 'Showing Armidale (~990 m altitude, cool/calm flat) watch target paces — switching updates every pace token inside the 22-week schedule below.'
    : 'Showing flat, calm, cool sea-level EAP reference paces (VDOT 53.6 from TT1; recent threshold work trending ~55–56).';

  const order = ['E', 'M', 'T', 'CV', '5K', 'I', '3K', 'R'];
  document.getElementById('gt-pace-grid').innerHTML = order.map((code) => {
    const z = data.fitness.paces[code];
    return `
      <div class="gt-pace-card">
        <span class="gt-pace-code">${code}</span>
        <b class="gt-pace-val">${esc(isArm ? z.armidale : z.base)}/km</b>
        <span class="gt-pace-name">${esc(z.label)}</span>
        <span class="gt-pace-hr">${esc(z.hr)}</span>
      </div>
    `;
  }).join('');
}

function renderReports(data) {
  const container = document.getElementById('gt-reports');
  container.innerHTML = data.reports.map((r) => {
    const tagClass = r.tag.toLowerCase().includes('breakthrough')
      ? 'breakthrough'
      : (r.tag.toLowerCase().includes('plan') ? 'plan' : '');

    const metricsHtml = (r.metrics || []).map((m) =>
      `<div class="gt-metric-chip"><span>${esc(m.label)}</span><b>${esc(m.value)}</b></div>`
    ).join('');

    const splitsHtml = r.splits && r.splits.length ? `
      <div class="gt-splits-wrap">
        <table class="gt-splits">
          <thead><tr><th>Rep</th><th>Time</th><th>Watch</th><th>EAP v2.0</th><th>Avg / Max HR</th><th>Power</th></tr></thead>
          <tbody>
            ${r.splits.map((s) => `
              <tr>
                <td>${esc(s.rep)}</td>
                <td>${esc(s.time)}</td>
                <td>${esc(s.watch)}</td>
                <td class="eap-col">${esc(s.eap)}</td>
                <td>${esc(s.hr)}</td>
                <td>${esc(s.power)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '';

    const adaptHtml = r.adaptation
      ? `<div class="gt-adapt-box"><strong>Plan adaptation:</strong> ${esc(r.adaptation)}</div>`
      : '';

    return `
      <article class="gt-report">
        <div class="gt-report-meta">
          <time datetime="${esc(r.date)}">${fmtShortDate(r.date)} ${r.date.slice(0, 4)}</time>
          <span>Week ${r.week}</span>
          <span class="gt-tag-pill ${tagClass}">${esc(r.tag)}</span>
        </div>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.summary)}</p>
        <div class="gt-metrics">${metricsHtml}</div>
        ${splitsHtml}
        ${adaptHtml}
      </article>
    `;
  }).join('');
}

function renderPhaseTabs(data) {
  const tabs = document.getElementById('gt-phase-tabs');
  const allBtn = `<button type="button" class="gt-phase-tab ${state.phaseFilter === 'all' ? 'active' : ''}" data-phase="all">All ${data.total_weeks} weeks</button>`;
  const phaseBtns = data.phases.map((ph) =>
    `<button type="button" class="gt-phase-tab ${state.phaseFilter === ph.id ? 'active' : ''}" data-phase="${esc(ph.id)}">${esc(ph.name)} (W${ph.weeks[0]}–${ph.weeks[ph.weeks.length - 1]})</button>`
  ).join('');
  tabs.innerHTML = allBtn + phaseBtns;

  const activePhase = data.phases.find((p) => p.id === state.phaseFilter);
  document.getElementById('gt-phase-aim').textContent = activePhase
    ? activePhase.aim
    : 'Full 22-week build from October re-entry to peak form for the Armidale Running Festival Golden Ticket (13–14 March 2027).';

  tabs.querySelectorAll('.gt-phase-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.phaseFilter = btn.dataset.phase;
      renderPhaseTabs(data);
      renderWeeks(data);
    });
  });
}

function renderWeeks(data) {
  const phaseNames = Object.fromEntries(data.phases.map((p) => [p.id, p.name]));
  const filtered = state.phaseFilter === 'all'
    ? data.weeks
    : data.weeks.filter((w) => w.phase === state.phaseFilter);

  const container = document.getElementById('gt-weeks');
  container.innerHTML = filtered.map((w) => {
    const isCur = w.week === data.current_week;
    const endDate = w.days.length ? w.days[w.days.length - 1].date : w.start;
    const badges = [
      w.mark ? `<span class="gt-week-badge">${esc(w.mark)}</span>` : '',
      w.down ? `<span class="gt-week-badge down">Down wk</span>` : '',
    ].join('');

    const daysHtml = w.days.map((d) => {
      const isToday = d.date === data.today;
      const actualHtml = d.actual_runs && d.actual_runs.length
        ? `<div class="gt-day-actual">✓ ${d.actual_runs.map((ar) =>
            `${ar.km} km · ${ar.pace}${ar.avg_hr ? ` · ${ar.avg_hr} bpm` : ''}`
          ).join('<br>✓ ')}</div>`
        : '';
      const extrasHtml = (d.extras || []).map((ex) =>
        `<div class="gt-day-extra">+ ${esc(ex.text)}</div>`
      ).join('');

      return `
        <article class="gt-day type-${esc(d.type)} ${isToday ? 'is-today' : ''}">
          <div class="gt-day-head">
            <span>${DOW_LABELS[d.dow]} ${fmtShortDate(d.date)}</span>
            <span>${d.planned_km > 0 ? `${d.planned_km} km` : 'Rest'}</span>
          </div>
          <h4>${esc(d.title)}</h4>
          <p>${resolvePaces(d.detail, data.fitness.paces, state.paceMode)}</p>
          ${extrasHtml}
          ${actualHtml}
        </article>
      `;
    }).join('');

    return `
      <details class="gt-week ${isCur ? 'is-current' : ''}" id="week-${w.week}" ${isCur ? 'open' : ''}>
        <summary>
          <span class="gt-week-num">W${String(w.week).padStart(2, '0')}</span>
          <div class="gt-week-info">
            <b>${esc(phaseNames[w.phase] || w.phase)}</b>
            <span>${fmtShortDate(w.start)} – ${fmtShortDate(endDate)}</span>
            ${badges}
          </div>
          <div class="gt-week-km">
            ${w.actual_km > 0 ? `${w.actual_km} / ` : ''}${w.planned_km} km
            <small>${w.actual_km > 0 ? 'logged / planned' : 'planned base'}</small>
          </div>
        </summary>
        <div class="gt-days">${daysHtml}</div>
      </details>
    `;
  }).join('');
}

function renderRaceWeekend(data) {
  const rw = data.race_weekend;
  document.getElementById('gt-clock-bar').innerHTML = rw.races.map((r, i) => `
    <div class="gt-clock-seg" style="width:${r.clock_pct}%; background:${CLOCK_COLORS[i % CLOCK_COLORS.length]}" title="${esc(r.event)}: ~${r.clock_pct}% of cumulative time">
      ${r.clock_pct >= 10 ? `${esc(r.event)} (${r.clock_pct}%)` : `${r.clock_pct}%`}
    </div>
  `).join('');

  document.querySelector('#gt-rw-table tbody').innerHTML = rw.races.map((r) => `
    <tr class="${r.km >= 20 ? 'is-hm' : ''}">
      <td>${esc(r.day)}</td>
      <td><strong>${esc(r.event)}</strong> (${r.km} km)</td>
      <td>~${r.clock_pct}%</td>
      <td>${esc(r.effort)}</td>
      <td>${esc(r.note)}</td>
    </tr>
  `).join('');
}

function jumpToWeek(weekNum) {
  if (!state.data) return;
  if (state.phaseFilter !== 'all') {
    state.phaseFilter = 'all';
    renderPhaseTabs(state.data);
    renderWeeks(state.data);
  }
  const el = document.getElementById(`week-${weekNum}`);
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.data = data;

    renderHero(data);
    renderVolumeChart(data);
    renderPaces(data);
    renderReports(data);
    renderPhaseTabs(data);
    renderWeeks(data);
    renderRaceWeekend(data);

    document.querySelectorAll('.gt-pace-toggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.paceMode = btn.dataset.paceMode;
        document.querySelectorAll('.gt-pace-toggle button').forEach((b) => {
          const active = b.dataset.paceMode === state.paceMode;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        renderPaces(data);
        renderWeeks(data);
      });
    });

    document.getElementById('gt-jump-current')?.addEventListener('click', () => jumpToWeek(data.current_week));
  } catch (err) {
    document.getElementById('dispatch-title').textContent = 'Could not load training data';
    document.getElementById('dispatch-summary').textContent = `Check that data.json is present alongside index.html (${err.message}).`;
  }
}

init();
