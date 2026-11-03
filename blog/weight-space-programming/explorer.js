// Before-and-after trace explorer for the weight-space programming post. It shows the verbatim output
// of the unedited and edited model for any of the 30 tasks, from traces.json (built from the study's
// raw result files by build/make_traces.py). Self-doubt phrases and Chinese text are highlighted.
const root = document.getElementById('explorer');

const FEATURED = {
  comp_01: 'Both unedited models spent all 1,024 tokens inside <think> (13 and 16 "wait"/"check" triggers) and never wrote code. The edited 1.7B model skipped thinking entirely and wrote a passing function in 153 tokens; the edited 0.6B model thought for 842 tokens, partly in Chinese, and also passed. Both passing solutions use os.walk, which also searches subfolders, although the prompt asked for a non-recursive search. The unit tests don\'t check this.',
  code_01: 'Both unedited models ran out of budget inside <think>, tracing intervals such as [1,3] and [2,6] by hand. The edited 1.7B model left its <think> block empty and wrote a function that passes every unit test in 139 tokens (17.0 s, measured*). The edited 0.6B model reasoned for 682 tokens, closed </think> and also passed.',
  sci_01: 'All four runs find 720 K. The unedited models then keep re-checking until the budget runs out; the 1.7B model is cut off mid-answer at "\\boxed{7". The edited 0.6B model boxes 720 in its final answer: a pass either way. The edited 1.7B model switches to Chinese while reasoning, boxes 720 at the end of <think>, closes it, then runs out of budget mid-sentence in its final answer. The harness counts that as a pass; requiring the answer after </think> does not.',
};

const DOUBT = /\b(wait|hmm+|let me (?:double[- ]?)?check|double[- ]check(?:ing)?|let me verify|let me re-?(?:calculate|check|examine|count|verify)|re-?check(?:ing)?|recalculate|is that (?:right|correct)\??)\b/gi;
const CJK = /[　-〿一-鿿＀-￯]+/g;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mark = (s) => esc(s).replace(DOUBT, '<mark class="doubt">$&</mark>').replace(CJK, '<span class="cjk" lang="zh">$&</span>');

let data = null;
let task = 'comp_01';
let size = '1.7B';

function pane(t, label, side) {
  const r = t.runs[label];
  const text = r.output.replace(/^\s*<think>\s*/, '');
  const closed = text.includes('</think>');
  const [think, answer] = closed ? [text.slice(0, text.indexOf('</think>')), text.slice(text.indexOf('</think>') + 8)] : [text, ''];
  const budget = data.budget;
  const isBoxed = t.grader.startsWith('boxed');
  const lang = r.cjk_answer ? 'Chinese in final answer' : r.cjk_think ? 'Chinese in reasoning' : 'English only';
  return `
    <div class="ex-pane">
      <div class="ex-head">
        <h4>${side} · Qwen3-${label.replace('-WSP', '')}${label.endsWith('WSP') ? '-WSP' : ''}</h4>
        <div class="badges">
          <span class="badge ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'} as graded</span>
          ${isBoxed && r.pass ? `<span class="badge ${r.strict ? 'pass' : 'fail'}">${r.strict ? 'answer after &lt;/think&gt;' : 'answer only inside &lt;think&gt;'}</span>` : ''}
          ${r.cutoff ? '<span class="badge fail">budget ran out in &lt;think&gt;</span>' : ''}
          ${r.closed && r.think === 0 ? '<span class="badge info">empty &lt;think&gt;</span>' : ''}
          ${r.cjk_think || r.cjk_answer ? `<span class="badge info">${lang}</span>` : ''}
        </div>
        <div class="tokbar" role="img" aria-label="${r.think} reasoning tokens and ${r.answer} answer tokens of a ${budget}-token budget">
          <i class="t" style="width:${(r.think / budget) * 100}%"></i><i class="a" style="width:${(r.answer / budget) * 100}%"></i>
        </div>
        <div class="tokbar-key"><span style="--c:color-mix(in srgb, var(--signal-ab) 70%, transparent)">&lt;think&gt; ${r.think}</span><span style="--c:var(--accent)">answer ${r.answer}</span><span>of ${budget.toLocaleString('en-AU')}</span></div>
        <dl class="ex-stats">
          <div><dt>Tokens</dt><dd>${r.tokens.toLocaleString('en-AU')}</dd></div>
          <div><dt>"wait"/"check" count</dt><dd>${r.waits}</dd></div>
          <div><dt>Est. time*</dt><dd>${r.est_s.toFixed(1)} s</dd></div>
          <div><dt>Language</dt><dd>${lang}</dd></div>
        </dl>
      </div>
      <div class="trace" tabindex="0" aria-label="${side} output">
        <div class="think"><span class="tag">&lt;think&gt;</span>${think.trim() ? mark(think.trim()) : '<span class="empty">(empty: the model skipped thinking)</span>'}</div>
        ${closed ? `<div class="answer"><span class="tag">after &lt;/think&gt;</span>${answer.trim() ? mark(answer.trim()) : '<span class="empty">(nothing)</span>'}</div>` : ''}
        ${r.tokens >= budget ? `<p class="cut">${closed ? 'Budget of 1,024 tokens reached during the final answer.' : 'Budget of 1,024 tokens reached inside &lt;think&gt;: no final answer.'}</p>` : ''}
      </div>
    </div>`;
}

function render() {
  const t = data.tasks.find((x) => x.id === task);
  root.querySelectorAll('[data-task]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.task === task)));
  root.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
  root.querySelector('#ex-pick').value = task;
  root.querySelector('.ex-body').innerHTML = `
    <div class="ex-task">
      <h3><code>${t.id}</code> ${esc(t.title)}</h3>
      <p>${esc(t.domain)} · graded by ${esc(t.grader.replace(/_/g, ' '))}${t.expected ? ` · expected answer ${esc(String(t.expected))}` : ''}</p>
      <details><summary>Prompt</summary><pre>${esc(t.prompt)}</pre></details>
      ${FEATURED[t.id] ? `<p class="ex-note">${esc(FEATURED[t.id])}</p>` : ''}
    </div>
    <div class="ex-panes">${pane(t, size, 'Before')}${pane(t, `${size}-WSP`, 'After')}</div>`;
}

async function init() {
  try {
    data = await (await fetch('traces.json')).json();
  } catch (err) {
    root.querySelector('.ex-body').innerHTML = '<p class="ex-loading">The traces could not be loaded.</p>';
    return;
  }
  const domains = [...new Set(data.tasks.map((t) => t.domain))];
  root.querySelector('#ex-pick').innerHTML = domains.map((d) => `<optgroup label="${esc(d)}">${data.tasks.filter((t) => t.domain === d).map((t) => `<option value="${t.id}">${t.id} · ${esc(t.title)}</option>`).join('')}</optgroup>`).join('');
  root.querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', () => { task = b.dataset.task; render(); }));
  root.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => { size = b.dataset.size; render(); }));
  root.querySelector('#ex-pick').addEventListener('change', (e) => { task = e.target.value; render(); });
  render();
}

if (root) init();
