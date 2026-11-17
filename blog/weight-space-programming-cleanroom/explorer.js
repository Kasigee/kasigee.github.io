// Multi-condition before/after trace explorer for the clean-room weight-space programming post.
// Supports side-by-side comparison of any two conditions across 2,048 (1x), 4,096 (2x / 4x-Argon),
// and 8,192 (4x Carbon) token budgets, built-in non-thinking mode, and the gentle 0.6B edit.
const root = document.getElementById('explorer');

const DOUBT = /\b(wait|hmm+|hold on|alternatively|let me (?:double[- ]?)?check|double[- ]check(?:ing)?|let me verify|let me re-?(?:calculate|check|examine|count|verify|read|think)|re-?check(?:ing)?|recalculate|is that (?:right|correct)\??)\b/gi;
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/g;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mark = (s) => esc(s).replace(DOUBT, '<mark class="doubt">$&</mark>').replace(CJK, '<span class="cjk" lang="zh">$&</span>');

const COND_LABELS = {
  base_2048: 'Base · Thinking (2,048)',
  wsp_2048: 'CleanWSP · Frozen (2,048)',
  gentle_2048: 'CleanWSP · Gentle α=2.0 (2,048)',
  nothink_2048: 'Base · No-Thinking (2,048)',
  base_4096: 'Base · Thinking (4,096 · 2×)',
  wsp_4096: 'CleanWSP · Frozen (4,096 · 2×)',
  base_8192: 'Base · Thinking (8,192 · 4×)',
  wsp_8192: 'CleanWSP · Frozen (8,192 · 4×)',
};

const COND_ORDER = [
  'base_2048',
  'wsp_2048',
  'gentle_2048',
  'nothink_2048',
  'base_4096',
  'wsp_4096',
  'base_8192',
  'wsp_8192',
];

const cache = {};
let suiteKey = 'blind';
let size = '1.7B';
let leftCond = 'base_2048';
let rightCond = 'wsp_2048';
let taskId = 'de_b01';

function availableConds() {
  const d = cache[suiteKey];
  if (!d || !d.tasks.length) return ['base_2048', 'wsp_2048'];
  const sample = d.tasks[0].runs[size] || {};
  return COND_ORDER.filter((k) => k in sample);
}

function renderBodyContent(r, isNoThink) {
  if (Array.isArray(r.turns) && r.turns.length > 0) {
    return r.turns.map((turn, idx) => {
      const tThink = (turn.think || '').trim();
      const tAns = (turn.answer || '').trim();
      const tObs = (turn.obs || '').trim();
      return `
        <div class="think"><span class="tag">Turn ${idx + 1} · &lt;think&gt;</span>${tThink ? mark(tThink) : `<span class="empty">${isNoThink ? '(non-thinking mode: &lt;think&gt; disabled by template)' : '(empty)'}</span>`}</div>
        ${turn.closed ? `<div class="answer"><span class="tag">Turn ${idx + 1} · action after &lt;/think&gt;</span>${tAns ? mark(tAns) : '<span class="empty">(nothing)</span>'}</div>` : `<p class="cut">Turn ${idx + 1} hit per-turn token cap inside &lt;think&gt; before emitting a tool action.</p>`}
        ${tObs ? `<div class="turn-obs"><span class="tag">Sandbox observation → Turn ${idx + 1}</span>${esc(tObs)}</div>` : ''}`;
    }).join('');
  }
  const think = (r.think_text || '').trim();
  const answer = (r.final_text || '').trim();
  return `
    <div class="think"><span class="tag">&lt;think&gt;</span>${think ? mark(think) : `<span class="empty">${isNoThink ? '(non-thinking mode: template pre-fills empty &lt;think&gt;&lt;/think&gt;)' : '(empty: skipped thinking)'}</span>`}</div>
    ${r.closed ? `<div class="answer"><span class="tag">after &lt;/think&gt; (strictly graded)</span>${answer ? mark(answer) : '<span class="empty">(nothing)</span>'}</div>` : ''}
    ${r.truncated ? `<p class="cut">${r.closed ? `Budget of ${r.budget.toLocaleString('en-AU')} tokens reached during the final answer.` : `Budget of ${r.budget.toLocaleString('en-AU')} tokens reached inside &lt;think&gt;: no final answer emitted.`}</p>` : ''}`;
}

function pane(t, modelSize, condKey, roleLabel) {
  const r = t.runs?.[modelSize]?.[condKey];
  if (!r) {
    return `<div class="ex-pane"><div class="ex-head"><h4>${esc(roleLabel)}</h4><p class="empty">Not run for this combination.</p></div></div>`;
  }
  const budget = r.budget || 2048;
  const isNoThink = condKey === 'nothink_2048';
  const lang = r.cjk_answer ? 'Chinese in final answer' : r.cjk_think ? 'Chinese in <think>' : 'English only';
  const thinkPct = Math.min(100, (r.think_tokens / budget) * 100);
  const ansPct = Math.min(100 - thinkPct, (r.answer_tokens / budget) * 100);
  return `
    <div class="ex-pane">
      <div class="ex-head">
        <h4>${esc(roleLabel)} · Qwen3-${esc(modelSize)} · ${esc(COND_LABELS[condKey] || condKey)}</h4>
        <div class="badges">
          <span class="badge ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'PASS' : 'FAIL'} (post-&lt;/think&gt;)</span>
          ${r.score > 0 && r.score < 1 ? `<span class="badge info">partial ${r.score.toFixed(2)}</span>` : ''}
          ${r.truncated ? `<span class="badge fail">hit ${budget.toLocaleString('en-AU')}-tok cap</span>` : ''}
          ${!isNoThink && r.closed && r.think_tokens === 0 ? '<span class="badge info">empty &lt;think&gt;</span>' : ''}
          ${r.cjk_think || r.cjk_answer ? `<span class="badge info">${esc(lang)}</span>` : ''}
          ${r.turns ? `<span class="badge info">${r.turns.length} sandbox turn${r.turns.length === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div class="tokbar" role="img" aria-label="${r.think_tokens} reasoning tokens and ${r.answer_tokens} final answer tokens against a ${budget}-token scale">
          <i class="t" style="width:${thinkPct.toFixed(1)}%"></i><i class="a" style="width:${ansPct.toFixed(1)}%"></i>
        </div>
        <div class="tokbar-key"><span style="--c:color-mix(in srgb, var(--signal-ab) 70%, transparent)">&lt;think&gt; ${r.think_tokens.toLocaleString('en-AU')}</span><span style="--c:var(--accent)">after &lt;/think&gt; ${r.answer_tokens.toLocaleString('en-AU')}</span><span>cap ${budget.toLocaleString('en-AU')}</span></div>
        <dl class="ex-stats">
          <div><dt>Total tokens</dt><dd>${r.tokens.toLocaleString('en-AU')}</dd></div>
          <div><dt>Self-doubt triggers</dt><dd>${r.waits}</dd></div>
          <div><dt>Grader detail</dt><dd>${esc(r.detail || (r.passed ? 'ok' : 'failed'))}</dd></div>
          <div><dt>Language</dt><dd>${esc(lang)}</dd></div>
        </dl>
      </div>
      <div class="trace" tabindex="0" aria-label="${esc(roleLabel)} output">
        ${renderBodyContent(r, isNoThink)}
      </div>
    </div>`;
}

function syncCondSelects() {
  const conds = availableConds();
  if (!conds.includes(leftCond)) leftCond = 'base_2048';
  if (!conds.includes(rightCond)) rightCond = 'wsp_2048';
  const leftSel = root.querySelector('#ex-left');
  const rightSel = root.querySelector('#ex-right');
  const optsHtml = conds.map((c) => `<option value="${c}">${esc(COND_LABELS[c] || c)}</option>`).join('');
  if (leftSel) {
    leftSel.innerHTML = optsHtml;
    leftSel.value = leftCond;
  }
  if (rightSel) {
    rightSel.innerHTML = optsHtml;
    rightSel.value = rightCond;
  }
}

function populateSelect() {
  const d = cache[suiteKey];
  const domains = [...new Set(d.tasks.map((t) => t.domain))];
  const sel = root.querySelector('#ex-pick');
  sel.innerHTML = domains.map((dom) => `<optgroup label="${esc(dom)}">${d.tasks.filter((t) => t.domain === dom).map((t) => `<option value="${t.id}">${esc(t.id)} · ${esc(t.title)}</option>`).join('')}</optgroup>`).join('');
  if (!d.tasks.some((t) => t.id === taskId)) {
    taskId = d.tasks[0].id;
  }
  sel.value = taskId;
}

function render() {
  const d = cache[suiteKey];
  if (!d) return;
  syncCondSelects();
  const t = d.tasks.find((x) => x.id === taskId) || d.tasks[0];
  taskId = t.id;
  root.querySelectorAll('[data-suite]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.suite === suiteKey)));
  root.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
  root.querySelectorAll('[data-preset]').forEach((b) => {
    const active = b.dataset.left === leftCond && b.dataset.right === rightCond;
    b.setAttribute('aria-pressed', String(active));
  });
  root.querySelectorAll('[data-task]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.task === taskId)));
  const sel = root.querySelector('#ex-pick');
  if (sel && sel.value !== taskId) sel.value = taskId;
  const note = d.featured?.[t.id] || '';
  root.querySelector('.ex-body').innerHTML = `
    <div class="ex-task">
      <h3><code>${esc(t.id)}</code> ${esc(t.title)}</h3>
      <p>${esc(t.domain)} · ${suiteKey === 'blind' ? 'Single-shot post-lock blind suite (n=32)' : 'Held-out paired suite (n=64)'} · strict post-&lt;/think&gt; grader (${esc(t.grader)})</p>
      <details><summary>Prompt</summary><pre>${esc(t.prompt)}</pre></details>
      ${note ? `<p class="ex-note">${esc(note)}</p>` : ''}
    </div>
    <div class="ex-panes">${pane(t, size, leftCond, 'Left pane')}${pane(t, size, rightCond, 'Right pane')}</div>`;
}

async function loadSuite(key) {
  if (cache[key]) return true;
  const file = key === 'blind' ? 'traces.json' : 'traces_paired.json';
  root.querySelector('.ex-body').innerHTML = `<p class="ex-loading">Loading ${key === 'blind' ? '32 blind' : '64 paired'} held-out traces…</p>`;
  try {
    cache[key] = await (await fetch(file)).json();
    return true;
  } catch {
    root.querySelector('.ex-body').innerHTML = `<p class="ex-loading">Could not load <code>${esc(file)}</code>.</p>`;
    return false;
  }
}

async function init() {
  if (!(await loadSuite('blind'))) return;
  populateSelect();
  root.querySelectorAll('[data-suite]').forEach((b) => b.addEventListener('click', async () => {
    const next = b.dataset.suite;
    if (next === suiteKey) return;
    if (await loadSuite(next)) {
      suiteKey = next;
      populateSelect();
      render();
    }
  }));
  root.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
    size = b.dataset.size;
    render();
  }));
  root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    leftCond = b.dataset.left;
    rightCond = b.dataset.right;
    render();
  }));
  root.querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', async () => {
    const targetSuite = b.dataset.targetSuite || 'blind';
    if (targetSuite !== suiteKey && (await loadSuite(targetSuite))) {
      suiteKey = targetSuite;
      populateSelect();
    }
    taskId = b.dataset.task;
    if (b.dataset.left) leftCond = b.dataset.left;
    if (b.dataset.right) rightCond = b.dataset.right;
    if (b.dataset.targetSize) size = b.dataset.targetSize;
    render();
  }));
  root.querySelector('#ex-pick')?.addEventListener('change', (e) => {
    taskId = e.target.value;
    render();
  });
  root.querySelector('#ex-left')?.addEventListener('change', (e) => {
    leftCond = e.target.value;
    render();
  });
  root.querySelector('#ex-right')?.addEventListener('change', (e) => {
    rightCond = e.target.value;
    render();
  });
  render();
}

if (root) init();
