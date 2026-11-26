/* Mount the Handbook lookup into an empty container with UNEOfferings.mount(container, DATA). */
(() => {
  "use strict";

  const pageSize = 20;
  const Engine = window.UNEPlannerEngine;

  function normalise(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function handbookLink(unit) {
    try {
      const url = new URL(unit.url);
      return url.origin === "https://handbook.une.edu.au" ? url.href : null;
    } catch {
      return null;
    }
  }

  function unitRow(record, year) {
    const { unit, periods } = record;
    const row = document.createElement("li");
    const title = document.createElement("div");
    title.className = "offering-heading";
    const url = handbookLink(unit);
    const code = document.createElement(url ? "a" : "strong");
    code.textContent = unit.code;
    if (url) {
      code.href = url;
      code.target = "_blank";
      code.rel = "noopener";
      code.setAttribute("aria-label", `${unit.code} in the UNE Handbook (opens in a new tab)`);
    }
    const name = document.createElement("span");
    name.textContent = unit.title;
    title.append(code, name);
    row.append(title);

    if (periods.length) {
      const offerings = document.createElement("ul");
      offerings.className = "offering-periods";
      for (const { label, modes } of periods) {
        const item = document.createElement("li");
        const periodName = document.createElement("strong");
        periodName.textContent = label;
        item.append(periodName);
        if (modes?.length) {
          const mode = document.createElement("span");
          mode.textContent = modes.join(" / ");
          item.append(mode);
        }
        offerings.append(item);
      }
      row.append(offerings);
    }

    const notes = [];
    if (!periods.length) {
      notes.push(`${Engine.getNoOfferingLabel(unit, year)}.`);
      if (unit.rollingStartYear) {
        const terms = (unit.indicativeTrimesters || []).map(t => `T${t}`).join(", ");
        notes.push(`Indicative from ${unit.rollingStartYear}${terms ? ` (${terms})` : ""}.`);
      }
    }
    const cycle = { even: "Even-numbered years.", odd: "Odd-numbered years.", alternate: "Offered in alternate years." };
    if (cycle[unit.offeringCycle]) notes.push(cycle[unit.offeringCycle]);
    if (notes.length) {
      const note = document.createElement("p");
      note.className = "offering-note";
      note.textContent = notes.join(" ");
      row.append(note);
    }
    return row;
  }

  function mount(container, data) {
    const year = data.meta.year;
    const records = Object.values(data.units).map(unit => ({
      unit,
      code: normalise(unit.code),
      text: normalise(`${unit.code} ${unit.title}`),
      periods: Engine.getUnitOfferingPeriods(unit)
    })).sort((a, b) => a.code.localeCompare(b.code));

    container.classList.add("offerings-lookup");
    container.innerHTML = `
      <div class="offerings-controls">
        <label>Unit code or title
          <input type="search" class="select-input" placeholder="e.g. CHEM110 or chemistry" autocomplete="off" />
        </label>
        <label>Teaching period
          <select class="select-input">
            <option value="all">All periods</option>
            <option value="1">Trimester 1</option>
            <option value="2">Trimester 2</option>
            <option value="3">Trimester 3</option>
            <option value="other">Other teaching periods</option>
          </select>
        </label>
      </div>
      <p class="offerings-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <ul class="offerings-results" aria-label="Unit offerings"></ul>
      <button type="button" class="btn btn-sm btn-soft" hidden>Show more units</button>`;

    const search = container.querySelector("input");
    const filter = container.querySelector("select");
    const status = container.querySelector(".offerings-status");
    const results = container.querySelector(".offerings-results");
    const more = container.querySelector("button");
    let matches = [];
    let shown = 0;

    function showNextPage(restoreFocus = false) {
      const fragment = document.createDocumentFragment();
      const start = shown;
      const end = Math.min(start + pageSize, matches.length);
      for (; shown < end; shown++) fragment.append(unitRow(matches[shown], year));
      results.append(fragment);
      more.hidden = shown >= matches.length;
      status.textContent = matches.length
        ? `${year} Handbook · ${matches.length.toLocaleString("en-AU")} matching unit${matches.length === 1 ? "" : "s"}${more.hidden ? "" : ` · Showing ${shown}`}`
        : `No matching units for these ${year} Handbook filters. Try another code, title or teaching period.`;
      if (restoreFocus) results.children[start]?.querySelector("a")?.focus();
    }

    function update() {
      const query = normalise(search.value);
      const words = query.split(/\s+/).filter(Boolean);
      const codeQuery = words.join("");
      matches = records.filter(record => {
        if (filter.value !== "all" && !record.periods.some(p =>
          p.trimester === (filter.value === "other" ? null : Number(filter.value))
        )) return false;
        return record.code.startsWith(codeQuery) || words.every(word => record.text.includes(word));
      });
      if (query) {
        const rank = record => record.code === codeQuery ? 0 : record.code.startsWith(codeQuery) ? 1 : 2;
        matches.sort((a, b) => rank(a) - rank(b));
      }
      shown = 0;
      results.replaceChildren();
      showNextPage();
    }

    search.addEventListener("input", update);
    filter.addEventListener("change", update);
    more.addEventListener("click", () => showNextPage(true));
    update();
    search.focus();
  }

  window.UNEOfferings = { mount };
})();
