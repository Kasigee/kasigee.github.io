/* Course coordinator suggestions can be distributed as a JSON file or in the site catalogue. */
(function (global) {
  "use strict";

  const FORMAT = "une-coordinator-pathway/v1";
  const MAX_BYTES = 2 * 1024 * 1024;
  const terms = [1, 2, 3];
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  function textField(value, label, limit, required) {
    const text = typeof value === "string" ? value.trim() : "";
    check(!required || text, `Enter a ${label}.`);
    check(text.length <= limit, `The ${label} exceeds ${limit} characters.`);
    return text;
  }

  function checkAreas(plan, course, data) {
    const mode = course.structureConfig.aosMode;
    const structures = { bsc: ["1m", "1m1n", "2m"], bit01: ["1m", "2m"],
      bcomp: ["opt1", "opt2", "opt3"], bbiosc: ["listed", "minor"] };
    check((structures[mode] || [mode]).includes(plan.aosStructure),
      "This course does not offer the pathway’s selected study structure.");
    const engine = global.UNEPlannerEngine;
    const options = engine.getAvailableAOSOptions(course, plan, data);
    const groups = mode === "dynamic" ? engine.getDynamicAOSGroups(course, plan, data) : [];
    const selected = plan.selectedMajors.filter(Boolean);
    const maxMajors = ["2m", "opt3"].includes(plan.aosStructure) ? 2 :
      ["bsc", "bcomp", "bit01", "single_major"].includes(mode) ? 1 : 0;
    const minorOptions = ["mnsc_pathway", "dscnce"].includes(mode) ? options.pathways :
      ["1m1n", "opt2", "minor"].includes(plan.aosStructure) ? options.minors : [];
    const matches = (code, allowed) => allowed.some(option => option.code === code);
    check(selected.length <= maxMajors && new Set(selected).size === selected.length &&
      plan.selectedMajors.every((code, index) => !code || index < maxMajors && matches(code, options.majors)),
      "Check the selected majors. Each major must belong to this course, study structure and admission rule.");
    check(!plan.selectedMinor || matches(plan.selectedMinor, minorOptions),
      "Check the selected minor or stream against this course, study structure and admission rule.");
    for (const [group, code] of Object.entries(plan.dynamicAosSelections)) {
      check(!code || groups.some(g => g.id === group && matches(code, g.items)),
        "An area of study falls outside the available options for this course and admission rule.");
    }
  }

  function readPathway(raw, api) {
    const { course, data, sanitize } = api;
    check(raw && raw.format === FORMAT, "Choose a coordinator pathway JSON file. Personal plan backups belong in Export / Save.");
    check(raw.handbookYear === data.meta.year, `This pathway uses a different Handbook year. Open a ${data.meta.year} pathway.`);
    const source = raw.plan;
    check(data.courses.some(c => c.code === source?.courseCode), "The file does not identify a course in this Handbook.");
    check(source.courseCode === course.code, `This pathway is for ${source.courseCode}. Open that course before loading this file.`);
    const title = textField(raw.title, "pathway title", 100, true);
    const author = textField(raw.author, "coordinator name or course team", 100, true);
    const audience = textField(raw.audience, "description of the intended cohort", 400, false);
    const fingerprint = raw.datasetSha256;
    check(fingerprint === undefined || typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint),
      "The pathway has an invalid Handbook snapshot identifier.");
    const assembled = raw.datasetAssembledAt;
    check(assembled === undefined || typeof assembled === "string" && /^\d{4}-\d{2}-\d{2}T/.test(assembled) &&
      Number.isFinite(Date.parse(assembled)), "The pathway has an invalid Handbook snapshot date.");
    check(typeof raw.preparedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.preparedOn) &&
      Number.isFinite(Date.parse(raw.preparedOn)) && new Date(raw.preparedOn).toISOString().startsWith(raw.preparedOn),
      "This pathway needs a valid preparation date.");

    check(Array.isArray(source.years) && source.years.length && source.years.length <= 20, "The pathway has an invalid study timeline.");
    let slotCount = 0;
    const creditChanges = new Set();
    const years = source.years.map((year, index) => {
      const yearNum = index + 1;
      check(Number.isInteger(year?.year) && year.year >= 2020 && year.year <= 2100 && year.trimesters,
        `Check the calendar year and trimesters for Year ${yearNum}.`);
      const trimesters = {};
      for (const term of terms) {
        const entries = year.trimesters[term];
        check(Array.isArray(entries), `Missing trimester list in Year ${yearNum}, T${term}.`);
        slotCount += entries.length;
        check(slotCount <= 1000, "The pathway exceeds the maximum of 1,000 unit and choice slots.");
        trimesters[term] = entries.map((slot, slotIndex) => {
          check(slot && (slot.type === "unit" || slot.type === "placeholder"), `Unrecognised slot in Year ${yearNum}, T${term}.`);
          if (slot.type === "unit") {
            check(typeof slot.code === "string" && Object.hasOwn(data.units, slot.code),
              `Unit ${String(slot.code || "(missing)").slice(0, 40)} is outside this Handbook. Use a listed unit or an open choice.`);
            // The engine uses the unit record's CP ahead of a study-map slot's CP, including zero-CP units.
            const handbookCp = data.units[slot.code].cp;
            if (handbookCp != null && slot.cp != null && slot.cp !== handbookCp) {
              creditChanges.add(`${slot.code} (${handbookCp} CP)`);
              return { id: `path-${yearNum}-${term}-${slotIndex + 1}`, type: "unit", code: slot.code, cp: handbookCp };
            }
          }
          return { ...slot, id: `path-${yearNum}-${term}-${slotIndex + 1}` };
        });
      }
      return { year: year.year, yearNum, id: `path-year-${yearNum}`, name: `Year ${yearNum} (${year.year})`, trimesters };
    });
    check(slotCount, "Add units or choice slots to your plan before sharing a pathway.");
    check(!source.admissionRule || course.structureConfig.admissionRules.includes(source.admissionRule),
      "This admission rule is absent from the current Handbook data. Ask the coordinator for an updated pathway.");
    const plan = sanitize({ ...source, customUnits: {}, t3Analysis: null, hasUserEdits: true, years }, course.code);
    check(plan, "The pathway contains invalid plan settings.");
    checkAreas(plan, course, data);
    // Include only the portable course configuration and board. Local plan names, custom unit
    // records and previous auto-plan analysis are intentionally absent from distributed files.
    const {
      courseCode, admissionRule, aosStructure, selectedMajors, selectedMinor, dynamicAosSelections,
      commencingTrimester, studyLoad, preferredMode, t3Strategy,
    } = plan;
    const portable = {
      courseCode, admissionRule, aosStructure, selectedMajors, selectedMinor, dynamicAosSelections,
      commencingTrimester, studyLoad, preferredMode, t3Strategy, years: plan.years,
    };
    const file = { format: FORMAT, handbookYear: data.meta.year, title, author, audience, preparedOn: raw.preparedOn, plan: portable };
    if (fingerprint) file.datasetSha256 = fingerprint;
    if (assembled) file.datasetAssembledAt = new Date(assembled).toISOString();
    return { file, plan, creditChanges, report: global.UNEPlannerEngine.validatePlan(course, plan, data) };
  }

  function scheduleHtml(plan, data) {
    const years = plan.years.map(year => {
      const rows = terms.filter(t => year.trimesters[t].length).map(t => {
        const labels = year.trimesters[t].map(slot => slot.type === "unit"
          ? `${slot.code} ${data.units[slot.code].title}`
          : `Choice — ${slot.label} (${slot.cp} CP)`);
        return `<p><strong>T${t}</strong> · ${labels.map(escape).join(" · ")}</p>`;
      });
      return rows.length ? `<section class="pathway-year"><h4>${escape(year.name)}</h4>${rows.join("")}</section>` : "";
    });
    return years.join("");
  }

  function ruleChecks(plan, report) {
    const issues = new Set(report.globalIssues.map(issue => issue.text));
    for (const year of plan.years) {
      for (const t of terms) {
        for (const slot of year.trimesters[t]) {
          const diagnostic = report.slotDiagnostics[slot.id];
          if (!diagnostic) continue;
          const items = [...diagnostic.errors, ...diagnostic.warnings,
            ...(diagnostic.intensiveClashes || []), ...(diagnostic.intensiveAlerts || [])];
          for (const message of items) issues.add(`${year.year} T${t} · ${slot.code || slot.label} — ${message}`);
        }
      }
    }
    const count = issues.size;
    return `<p>${escape(report.totalPlannedCp)} of ${escape(report.targetCp)} CP planned, including ${escape(report.placeholderCp)} CP in open choices and ${escape(report.advancedStandingCp)} CP of advanced standing.</p>` +
      (count ? `<details><summary>Planner checks (${count})</summary><ul>${[...issues].map(message => `<li>${escape(message)}</li>`).join("")}</ul></details>` : "");
  }

  function open(api) {
    const { course, data } = api;
    const catalogue = (global.UNE_COORDINATOR_PATHWAYS || []).filter(item =>
      item?.plan?.courseCode === course.code && item.handbookYear === data.meta.year);
    function dialog(title, body, mount) {
      api.openModal(`<h2 id="pathway-heading" style="margin:0;font-size:1rem">${escape(title)}</h2>`,
        `<div class="pathway-dialog">${body}</div>`, modal => {
          const panel = modal.querySelector('[role="dialog"]');
          panel.setAttribute("aria-labelledby", "pathway-heading");
          const heading = modal.querySelector("#pathway-heading");
          heading.tabIndex = -1;
          heading.focus();
          mount(modal);
        });
    }

    function library() {
      const cards = catalogue.map((item, i) => `<button type="button" class="btn pathway-card" data-pathway-index="${i}">
        <strong>${escape(item.title)}</strong><span>${escape(item.author)} · Prepared ${escape(item.preparedOn)}</span>
      </button>`).join("");
      dialog("Coordinator pathways", `
        <section><h3>${escape(course.code)} · ${escape(course.title)}</h3>
          ${cards || "<p>No coordinator pathways have been published here for this course yet.</p>"}
        </section>
        <section><h3>Open a shared pathway</h3>
          <label for="pathway-file">Choose the JSON file supplied by your coordinator</label>
          <input id="pathway-file" type="file" accept=".json,application/json">
          <p class="pathway-error" role="alert" id="pathway-error"></p>
        </section>
        <section><h3>For course coordinators</h3><p>Share the units, open choices and settings from your current ${escape(course.code)} plan.</p>
          <div class="pathway-actions"><button type="button" id="pathway-create" class="btn">Create a pathway file</button></div>
        </section>`, modal => {
        const error = modal.querySelector("#pathway-error");
        function inspect(raw, fromFile) {
          try { preview(readPathway(raw, api), fromFile); }
          catch (err) { error.textContent = err.message; }
        }
        modal.querySelectorAll("[data-pathway-index]").forEach(button => {
          button.onclick = () => inspect(catalogue[Number(button.dataset.pathwayIndex)], false);
        });
        const input = modal.querySelector("#pathway-file");
        input.onchange = async () => {
          const file = input.files[0];
          input.value = "";
          if (!file) return;
          const isOpen = () => input.isConnected && !modal.classList.contains("hidden");
          try {
            check(file.size <= MAX_BYTES, "Choose a pathway file smaller than 2 MB.");
            const contents = await file.text();
            if (isOpen()) inspect(JSON.parse(contents), true);
          } catch (err) {
            if (isOpen()) error.textContent = err instanceof SyntaxError ? "This file does not contain valid JSON." : err.message;
          }
        };
        modal.querySelector("#pathway-create").onclick = author;
      });
    }

    function preview({file, plan, creditChanges, report}, fromFile) {
      const areas = [...new Set([...plan.selectedMajors, plan.selectedMinor, ...Object.values(plan.dynamicAosSelections)].filter(Boolean))];
      const missingAreas = areas.filter(code => !Object.hasOwn(data.aos, code));
      const handbookUrl = `https://handbook.une.edu.au/courses/${data.meta.year}/${encodeURIComponent(course.code)}?year=${data.meta.year}`;
      const currentHash = global.UNE_HANDBOOK_SNAPSHOT?.datasetSha256;
      const snapshotChanged = file.datasetSha256 && currentHash && file.datasetSha256 !== currentHash;
      dialog(file.title, `
        <section class="pathway-source"><strong>${fromFile ? "Shared pathway file" : "Published coordinator suggestion"}</strong>
          <p>${fromFile ? "Author named in the file" : "Suggested by"} · ${escape(file.author)} · Prepared ${escape(file.preparedOn)}</p>
          ${fromFile ? "<p>Check that you received this file from your course coordinator.</p>" : ""}
          ${file.datasetAssembledAt ? `<p>Source snapshot assembled ${escape(file.datasetAssembledAt.slice(0, 10))}.</p>` : ""}
          ${!file.datasetSha256 ? "<p>The source snapshot is unspecified. Review the schedule against the current Handbook.</p>" : ""}
          ${snapshotChanged ? "<p><strong>The planner data has changed since this pathway was prepared.</strong> Review the current rules and trimester offerings before applying it.</p>" : ""}
          ${creditChanges.size ? `<p>Unit credit updated using the current Handbook data · ${[...creditChanges].map(escape).join(", ")}.</p>` : ""}
        </section>
        <section><h3>${escape(course.code)} · ${escape(course.title)}</h3>
          <p>${data.meta.year} Handbook · T${plan.commencingTrimester} commencement · ${escape(plan.studyLoad)} · ${escape(plan.preferredMode)}</p>
          ${plan.admissionRule ? `<p>Admission rule · ${escape(plan.admissionRule)}</p>` : ""}
          ${areas.length ? `<p>Areas of study · ${areas.map(code => escape(data.aos[code]?.title || code)).join(", ")}</p>` : ""}
          ${missingAreas.length ? `<p>The course lists ${missingAreas.map(escape).join(", ")}, but the snapshot lacks its detailed requirements. Check the Handbook for the required units.</p>` : ""}
          ${file.audience ? `<p class="pathway-note">${escape(file.audience)}</p>` : ""}
          <p>Check this suggested sequence against the <a href="${escape(handbookUrl)}" target="_blank" rel="noopener">${data.meta.year} course Handbook entry ↗</a>.</p>
        </section>
        ${ruleChecks(plan, report)}
        ${scheduleHtml(plan, data)}
        <div class="pathway-actions"><button type="button" class="btn btn-primary" id="pathway-use">Use this pathway…</button>
          <button type="button" class="btn" id="pathway-back">Back to pathways</button></div>`, modal => {
        modal.querySelector("#pathway-back").onclick = library;
        modal.querySelector("#pathway-use").onclick = async () => {
          const ok = await api.confirm({
            title: `Replace your ${course.code} plan?`, sub: `“${file.title}” will replace the units, choices and settings for this course.`,
            bodyHtml: "<p>You can restore your previous plan with <strong>Undo</strong> straight after applying the pathway.</p>",
            confirmLabel: "Replace with pathway", tone: "warning",
          });
          if (ok) api.apply(plan);
        };
      });
    }

    function author() {
      dialog("Create a pathway file", `
        <p>Students can preview this copy of your ${escape(course.code)} plan before applying it. Share the downloaded file through your course channel.</p>
        <form id="pathway-form">
          <label>Pathway title<input name="title" required maxlength="100" placeholder="e.g. Part-time study from Trimester 2"></label>
          <label>Coordinator or course team<input name="author" required maxlength="100" autocomplete="off"></label>
          <label>Who is this for? (optional)<textarea name="audience" maxlength="400" placeholder="Include entry requirements or assumptions about prior study."></textarea></label>
          <p class="pathway-error" role="alert" id="pathway-error"></p>
          <p role="status" id="pathway-status"></p>
          <div class="pathway-actions"><button type="submit" class="btn btn-primary">Download pathway</button>
            <button type="button" class="btn" id="pathway-back">Back to pathways</button></div>
        </form>`, modal => {
        modal.querySelector("#pathway-back").onclick = library;
        const form = modal.querySelector("#pathway-form");
        form.onsubmit = event => {
          event.preventDefault();
          const message = modal.querySelector("#pathway-error");
          const status = modal.querySelector("#pathway-status");
          message.textContent = "";
          status.textContent = "";
          try {
            const fields = new FormData(form);
            const {file, creditChanges} = readPathway({
              format: FORMAT, handbookYear: data.meta.year, datasetSha256: global.UNE_HANDBOOK_SNAPSHOT?.datasetSha256,
              datasetAssembledAt: global.UNE_HANDBOOK_SNAPSHOT?.assembledAt,
              preparedOn: new Date().toLocaleDateString("sv-SE"),
              title: fields.get("title"), author: fields.get("author"), audience: fields.get("audience"), plan: api.plan,
            }, api);
            const slug = file.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);
            const json = JSON.stringify(file, null, 2);
            check(new Blob([json]).size <= MAX_BYTES, "This pathway file exceeds the 2 MB sharing limit.");
            api.download(`${course.code}-${slug || "suggested"}-pathway.json`, json, "application/json");
            status.textContent = "Pathway file prepared. Share it with your students.";
            if (creditChanges.size) status.textContent += ` Unit credit updated from current Handbook data for ${[...creditChanges].join(", ")}.`;
          } catch (err) { message.textContent = err.message; }
        };
      });
    }
    library();
  }

  global.UNECoordinatorPathways = { open, readPathway };
})(typeof window !== "undefined" ? window : globalThis);
