/**
 * University of New England (UNE) — 2027 Interactive Course & Unit Planner
 * Whole-University Course Finder (233 courses / 11 Schools) + Responsive Mobile/Tablet/Desktop Planner
 */
window.initUNEPlannerApp = function () {
  "use strict";

  const DATA = window.UNE_SST_DATA;
  const Engine = window.UNEPlannerEngine;
  const STORAGE_KEY = "une_all_2027_plans_v2";
  const LEGACY_STORAGE_KEY = "une_sst_2027_plans_v1";
  const THEME_KEY = "une_sst_theme";

  const CAT_LABELS = {
    core: "Core",
    major1: "Major 1",
    major2: "Major 2",
    minor: "Minor / Stream",
    capstone: "Capstone / Research",
    listed: "Listed",
    elective: "Elective",
  };

  const CAT_COLORS = {
    core: "var(--cat-core)",
    major1: "var(--cat-major1)",
    major2: "var(--cat-major2)",
    minor: "var(--cat-minor)",
    capstone: "var(--cat-capstone)",
    listed: "var(--cat-listed)",
    elective: "var(--cat-elective)",
  };

  const BSC_PRESETS = [
    { label: "Data Science + Statistics (2 Majors)", structure: "2m", majors: ["DATASC003", "STATSM007"], minor: "" },
    { label: "Zoology (Single Major)", structure: "1m", majors: ["ZOOLOM002"], minor: "" },
    { label: "Neuroscience + Business Minor", structure: "1m1n", majors: ["NEUROSC001"], minor: "BUS001" },
    { label: "Medicinal Chemistry", structure: "1m", majors: ["MEDCHEM001"], minor: "" },
    { label: "Renewable Energy Physics", structure: "1m", majors: ["RNWENPH001"], minor: "" },
  ];

  const FINDER_TOPICS = [
    { label: "Science & Tech", school: "School of Science and Technology", query: "" },
    { label: "Data, AI & Computing", school: "ALL", query: "data computer ai cyber" },
    { label: "Double Degrees (17)", school: "ALL", studyLevel: "Double", query: "" },
    { label: "Health & Medicine", faculty: "Faculty of Medicine and Health", query: "" },
    { label: "Law & Criminology", school: "School of Law", query: "" },
    { label: "Business & MBA", school: "UNE Business School", query: "" },
    { label: "Education & Teaching", school: "School of Education", query: "" },
    { label: "Agriculture & Rural", school: "School of Environmental and Rural Science", query: "" },
    { label: "Arts & Humanities", school: "School of Humanities, Arts and Social Sciences", query: "" },
    { label: "Psychology", school: "School of Psychology", query: "" },
  ];

  const state = {
    view: "finder", // 'finder' | 'planner'
    savedPlansByCourse: {},
    currentCourseCode: "BSC",

    // Course Finder state
    finderQuery: "",
    finderLevel: "ALL",
    finderSchool: "ALL",
    finderFaculty: "ALL",
    finderMode: "ALL",
    finderIntake: "ALL",
    finderAtar: "ALL",
    finderSort: "relevance",
    finderLimit: 48,
    finderActiveTopic: -1,
    finderFacetsOpenMobile: false,
    finderInstantDismissed: false,

    // Planner sidebar & slot picker state
    sidebarTab: "requirements", // 'slot' | 'requirements' | 'catalog'
    collapsedBuckets: {},
    catalogQuery: "",
    catalogLevel: "all",
    catalogTri: "all",
    catalogPrefix: "all",
    catalogShowIneligible: false,

    targetSlot: null,
    slotQuery: "",
    slotPoolFilter: "all",
    slotLevelFilter: "all",
    slotShowIneligible: false,
    slotForceElectives: false,

    // Responsive UI state
    mobilePane: "plan", // 'plan' | 'units'
    mobileConfigOpen: false,
    mobileTriFilter: "all", // 'all' | '1' | '2' | '3'
    tabletDrawerOpen: false,

    dragging: null,
  };

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isMobileViewport() {
    return window.innerWidth < 768;
  }

  function isTabletViewport() {
    return window.innerWidth >= 768 && window.innerWidth < 1100;
  }

  function getCourse(code) {
    return DATA.courses.find((c) => c.code === code) || DATA.courses[0];
  }

  function getCurrentCourse() {
    return getCourse(state.currentCourseCode);
  }

  function getCurrentPlan() {
    const c = getCurrentCourse();
    if (!state.savedPlansByCourse[c.code]) {
      state.savedPlansByCourse[c.code] = Engine.createDefaultPlan(c, DATA);
    }
    return state.savedPlansByCourse[c.code];
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          currentCourseCode: state.currentCourseCode,
          savedPlansByCourse: state.savedPlansByCourse,
        })
      );
    } catch (_) {}
  }

  function loadState() {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "dark") document.documentElement.classList.add("dark");

      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      let hasSaved = false;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.savedPlansByCourse && Object.keys(parsed.savedPlansByCourse).length > 0) {
          state.savedPlansByCourse = parsed.savedPlansByCourse;
          hasSaved = true;
        }
        if (parsed.currentCourseCode && DATA.courses.some((c) => c.code === parsed.currentCourseCode)) {
          state.currentCourseCode = parsed.currentCourseCode;
        }
      }

      const params = new URLSearchParams(window.location.search);
      const qCourse = (params.get("course") || window.location.hash.replace("#", "")).toUpperCase();
      const qBrowse = params.get("browse") || params.get("find");

      if (qBrowse) {
        state.view = "finder";
      } else if (qCourse && DATA.courses.some((c) => c.code === qCourse)) {
        state.currentCourseCode = qCourse;
        state.view = "planner";
      } else if (hasSaved) {
        // Returning user with saved work opens right into their active plan, with Find Course 1 click away!
        state.view = "planner";
      } else {
        // Fresh user starts at the brilliant Whole-University Course Finder before unit selection!
        state.view = "finder";
      }
    } catch (_) {
      state.view = "finder";
    }
  }

  function openCourseInPlanner(courseCode, matchedAosEntry) {
    if (!DATA.courses.some((c) => c.code === courseCode)) return;
    state.currentCourseCode = courseCode;
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    if (matchedAosEntry) {
      Engine.preselectAOS(course, plan, matchedAosEntry, DATA);
    }
    exitSlotPicker();
    state.view = "planner";
    state.mobilePane = "plan";
    state.tabletDrawerOpen = false;
    state.mobileConfigOpen = false;
    saveState();
    renderAll({ resetSidebarScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    if (matchedAosEntry) {
      showToast(`Opened ${course.code} with ${matchedAosEntry.title} pre-selected!`);
    }
  }

  function isUnitPlanned(code, plan) {
    for (const yr of plan.years || []) {
      for (const t of [1, 2, 3]) {
        for (const s of yr.trimesters[t] || []) {
          if (s.type === "unit" && s.code === code) return `Y${yr.yearNum} · T${t}`;
        }
      }
    }
    return null;
  }

  function findOpenPlaceholders(plan) {
    const list = [];
    (plan.years || []).forEach((yr, yIdx) => {
      for (const tNum of [1, 2, 3]) {
        for (const s of yr.trimesters[tNum] || []) {
          if (s.type === "placeholder") {
            list.push({
              yearIdx: yIdx,
              yearNum: yr.yearNum || yIdx + 1,
              triNum: tNum,
              replaceSlotId: s.id,
              label: s.label || "Listed or Elective Unit",
              slotKind: s.slotKind || "",
              hintCodes: s.hintCodes || [],
            });
          }
        }
      }
    });
    return list;
  }

  function activateSlotPicker(slotTarget, openUiPane) {
    state.targetSlot = slotTarget;
    state.sidebarTab = "slot";
    state.slotQuery = "";
    state.slotPoolFilter = "all";
    state.slotLevelFilter = "all";
    state.slotShowIneligible = false;
    state.slotForceElectives = false;
    if (openUiPane !== false) {
      if (isMobileViewport()) state.mobilePane = "units";
      else if (isTabletViewport()) state.tabletDrawerOpen = true;
    }
  }

  function exitSlotPicker() {
    state.targetSlot = null;
    if (state.sidebarTab === "slot") {
      state.sidebarTab = "requirements";
    }
  }

  function syncResponsiveClasses() {
    document.body.classList.toggle("drawer-open", state.tabletDrawerOpen && state.view === "planner");
    document.body.classList.toggle("mobile-pane-units", state.view === "planner" && state.mobilePane === "units");
    document.body.classList.toggle("mobile-pane-plan", state.view === "planner" && state.mobilePane !== "units");
  }

  function addUnitToPlan(code) {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const u = Engine.getUnit(code, DATA, plan.customUnits);
    if (!u) return;

    const existingLoc = isUnitPlanned(code, plan);
    if (existingLoc) {
      showToast(`${code} is already in your plan (${existingLoc}).`);
      return;
    }

    if (state.targetSlot) {
      const { yearIdx, triNum, replaceSlotId } = state.targetSlot;
      const yr = plan.years[yearIdx];
      if (yr && yr.trimesters[triNum]) {
        const newSlot = { id: Engine.uid("u"), type: "unit", code };
        if (replaceSlotId) {
          const idx = yr.trimesters[triNum].findIndex((s) => s.id === replaceSlotId);
          if (idx !== -1) yr.trimesters[triNum][idx] = newSlot;
          else yr.trimesters[triNum].push(newSlot);

          const remaining = findOpenPlaceholders(plan);
          if (state.sidebarTab === "slot" && remaining.length > 0) {
            activateSlotPicker(remaining[0], false);
            saveState();
            renderAll({ resetSidebarScroll: true });
            showToast(`Placed ${code} in Y${yr.yearNum} T${triNum}! Next open slot: Y${remaining[0].yearNum} T${remaining[0].triNum} (${remaining.length} left).`);
            return;
          } else {
            exitSlotPicker();
            if (isMobileViewport()) state.mobilePane = "plan";
            if (isTabletViewport()) state.tabletDrawerOpen = false;
            saveState();
            renderAll({ resetSidebarScroll: false });
            showToast(
              remaining.length === 0
                ? `Placed ${code} in Y${yr.yearNum} T${triNum} — all open placeholder slots filled!`
                : `Placed ${code} in Y${yr.yearNum} T${triNum}.`
            );
            return;
          }
        } else {
          yr.trimesters[triNum].push(newSlot);
          const newLoadCp = yr.trimesters[triNum].reduce((s, x) => {
            const xu = x.type === "unit" ? Engine.getUnit(x.code, DATA, plan.customUnits) : null;
            return s + (xu ? xu.cp : (x.cp || 6));
          }, 0);
          if (newLoadCp >= (plan.studyLoad === "Part-time" ? 12 : 24)) {
            exitSlotPicker();
            if (isMobileViewport()) state.mobilePane = "plan";
            if (isTabletViewport()) state.tabletDrawerOpen = false;
          }
          saveState();
          renderAll({ resetSidebarScroll: false });
          showToast(`Added ${code} to Y${yr.yearNum} · T${triNum}.`);
          return;
        }
      }
    }

    // Smart earliest valid placement preserving left sidebar scroll
    const maxPerTri = plan.studyLoad === "Part-time" ? 12 : 24;
    const placements = Engine.getPlannedPlacements(plan, DATA);
    const advCp = Engine.getAdvancedStandingCp(course, plan.admissionRule);

    let best = null;
    plan.years.forEach((yr, yIdx) => {
      for (const tNum of [1, 2, 3]) {
        if (yIdx === 0 && tNum < (plan.commencingTrimester || 1)) continue;
        const offeredOk = !u.trimesters || u.trimesters.length === 0 || u.trimesters.includes(tNum);
        if (!offeredOk) continue;
        if (
          tNum === 3 &&
          (!plan.t3Strategy || plan.t3Strategy === "none") &&
          !(u.trimesters && u.trimesters.length === 1 && u.trimesters[0] === 3)
        ) {
          continue;
        }
        const slots = yr.trimesters[tNum] || [];
        const curCp = slots.reduce((sum, s) => {
          const su = s.type === "unit" ? Engine.getUnit(s.code, DATA, plan.customUnits) : null;
          return sum + (su ? su.cp : (s.cp || 6));
        }, 0);
        if (curCp + u.cp > maxPerTri) continue;

        const chrono = yIdx * 3 + (tNum - 1);
        const priorSet = new Set(placements.filter((p) => p.type === "unit" && p.chrono < chrono).map((p) => p.code));
        const priorCp = advCp + placements.filter((p) => p.chrono < chrono).reduce((s, p) => s + p.cp, 0);
        const pm = u.prereqMeta;
        let prereqOk = true;
        if (pm && !(pm.pgWaiver && course.studyLevel === "Postgraduate")) {
          if (pm.minCp > 0 && priorCp < pm.minCp) prereqOk = false;
          if (pm.tokens && pm.tokens.length > 0 && !Engine.evalPrereqTokens(pm.tokens, priorSet)) prereqOk = false;
        }
        const score = (prereqOk ? 0 : 100) + chrono;
        if (!best || score < best.score) best = { yIdx, tNum, score };
      }
    });

    let placedLabel = "";
    if (!best) {
      const fallbackTri = (u.trimesters && u.trimesters[0]) || 1;
      let placed = false;
      for (let yIdx = 0; yIdx < plan.years.length; yIdx++) {
        const slots = plan.years[yIdx].trimesters[fallbackTri] || [];
        if (slots.length * 6 < 24) {
          slots.push({ id: Engine.uid("u"), type: "unit", code });
          placedLabel = `Y${plan.years[yIdx].yearNum} · T${fallbackTri}`;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const newYNum = plan.years.length + 1;
        const newYr = {
          id: Engine.uid("yr"),
          yearNum: newYNum,
          name: `Year ${newYNum} (${2026 + newYNum})`,
          trimesters: { 1: [], 2: [], 3: [] },
        };
        newYr.trimesters[fallbackTri].push({ id: Engine.uid("u"), type: "unit", code });
        plan.years.push(newYr);
        placedLabel = `Y${newYNum} · T${fallbackTri}`;
      }
    } else {
      plan.years[best.yIdx].trimesters[best.tNum].push({ id: Engine.uid("u"), type: "unit", code });
      placedLabel = `Y${plan.years[best.yIdx].yearNum} · T${best.tNum}`;
    }

    saveState();
    renderAll({ resetSidebarScroll: false });
    showToast(`Added ${code} → ${placedLabel}`);
  }

  function removeSlot(yearIdx, triNum, slotId) {
    const plan = getCurrentPlan();
    const yr = plan.years[yearIdx];
    if (!yr) return;
    yr.trimesters[triNum] = (yr.trimesters[triNum] || []).filter((s) => s.id !== slotId);
    if (state.targetSlot && state.targetSlot.replaceSlotId === slotId) exitSlotPicker();
    saveState();
    renderAll({ resetSidebarScroll: false });
  }

  function moveSlotStep(yearIdx, triNum, slotId, delta) {
    const plan = getCurrentPlan();
    const yr = plan.years[yearIdx];
    if (!yr) return;
    const idx = yr.trimesters[triNum].findIndex((s) => s.id === slotId);
    if (idx === -1) return;
    const [slot] = yr.trimesters[triNum].splice(idx, 1);

    let flatIdx = yearIdx * 3 + (triNum - 1) + delta;
    if (flatIdx < 0) flatIdx = 0;
    const newY = Math.floor(flatIdx / 3);
    const newT = (flatIdx % 3) + 1;
    while (plan.years.length <= newY) {
      const n = plan.years.length + 1;
      plan.years.push({
        id: Engine.uid("yr"),
        yearNum: n,
        name: `Year ${n} (${2026 + n})`,
        trimesters: { 1: [], 2: [], 3: [] },
      });
    }
    plan.years[newY].trimesters[newT].push(slot);
    saveState();
    renderAll({ resetSidebarScroll: false });
  }

  let toastTimer = null;
  function showToast(msg) {
    let el = document.getElementById("planner-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "planner-toast";
      el.className = "planner-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, 3000);
  }

  /* ==========================================================================
     1. UNE HEADER BAR
     ========================================================================== */
  function renderHeader(course, plan) {
    const hdr = document.getElementById("app-header");
    const isPlanner = state.view === "planner";
    const studyPlans = isPlanner ? Engine.getAvailableStudyPlans(course, plan, DATA) : [];
    const openPhCount = isPlanner ? findOpenPlaceholders(plan).length : 0;

    hdr.innerHTML = `
      <div class="brand-group">
        <button class="une-brand-btn" id="btn-brand-home" title="Browse all ${DATA.meta.counts.courses} UNE 2027 Courses">
          <div class="une-crest" aria-hidden="true">
            <span class="une-crest-letters">une</span>
            <span class="une-crest-bar"></span>
          </div>
          <div class="une-brand-text">
            <span class="une-brand-name">University of New England</span>
            <span class="une-brand-sub">2027 Course &amp; Unit Planner</span>
          </div>
        </button>

        ${
          isPlanner
            ? `
              <div class="header-divider"></div>
              <button class="course-switcher-btn" id="btn-open-finder" title="Search & switch across all ${DATA.meta.counts.courses} UNE courses">
                <span class="course-code-pill">${esc(course.code)}</span>
                <div class="course-title-block">
                  <div class="course-title-main">${esc(course.title)} <span style="color:var(--une-lime);">▾</span></div>
                  <div class="course-subtitle-meta">
                    <span>${course.totalCp} CP</span> ·
                    <span>${esc(course.school.replace(/^School of /, ""))}</span> ·
                    <span style="color:var(--une-lime);font-weight:700;">All ${DATA.meta.counts.courses} Courses</span>
                  </div>
                </div>
              </button>
            `
            : ""
        }
      </div>

      <div class="header-actions">
        ${
          isPlanner
            ? `
              <button class="btn btn-hdr tablet-drawer-trigger" id="btn-tablet-drawer">
                <span>📚 Units${openPhCount ? ` (${openPhCount})` : ""}</span>
              </button>
              ${
                studyPlans.length > 0
                  ? `<button class="btn btn-hdr hdr-hide-mobile" id="btn-open-studyplans" title="Load an official UNE Trimester Progression Map">
                      <span>📋 Plans (${studyPlans.length})</span>
                    </button>`
                  : ""
              }
              <button class="btn btn-hdr-lime" id="btn-auto-plan" title="Automatically schedule required units into valid 2027 trimesters">
                <span>✨ <span class="auto-plan-full">Auto-Plan</span><span class="auto-plan-short">Auto</span></span>
              </button>
              <button class="btn btn-hdr hdr-hide-tablet hdr-hide-mobile" id="btn-course-info" title="Course Rules, Outcomes & Handbook">
                <span>📖 Info</span>
              </button>
              <button class="btn btn-hdr hdr-hide-mobile" id="btn-export-menu" title="Print, Export CSV/JSON or Reset">
                <span>⬇ Export</span>
              </button>
            `
            : `
              <button class="btn btn-hdr-lime" id="btn-back-to-active">
                <span>📅 Open Planner (${esc(course.code)}) →</span>
              </button>
            `
        }
        <button class="btn btn-hdr btn-icon" id="btn-theme-toggle" title="Toggle Light / Dark Theme" aria-label="Toggle Theme">
          <span>${document.documentElement.classList.contains("dark") ? "☀️" : "🌙"}</span>
        </button>
      </div>
    `;

    document.getElementById("btn-brand-home").onclick = () => {
      state.view = "finder";
      state.tabletDrawerOpen = false;
      renderAll({ resetSidebarScroll: false });
      window.scrollTo({ top: 0, behavior: "instant" });
    };

    const openFinderBtn = document.getElementById("btn-open-finder");
    if (openFinderBtn) {
      openFinderBtn.onclick = () => {
        state.view = "finder";
        state.tabletDrawerOpen = false;
        renderAll({ resetSidebarScroll: false });
        window.scrollTo({ top: 0, behavior: "instant" });
      };
    }

    const backActiveBtn = document.getElementById("btn-back-to-active");
    if (backActiveBtn) {
      backActiveBtn.onclick = () => {
        state.view = "planner";
        renderAll({ resetSidebarScroll: false });
      };
    }

    const drawerBtn = document.getElementById("btn-tablet-drawer");
    if (drawerBtn) {
      drawerBtn.onclick = () => {
        state.tabletDrawerOpen = !state.tabletDrawerOpen;
        syncResponsiveClasses();
      };
    }

    const spBtn = document.getElementById("btn-open-studyplans");
    if (spBtn) spBtn.onclick = openStudyPlansModal;

    const autoBtn = document.getElementById("btn-auto-plan");
    if (autoBtn) {
      autoBtn.onclick = runSmartAutoPlan;
    }

    const infoBtn = document.getElementById("btn-course-info");
    if (infoBtn) infoBtn.onclick = openCourseInfoModal;

    const expBtn = document.getElementById("btn-export-menu");
    if (expBtn) expBtn.onclick = openExportModal;

    document.getElementById("btn-theme-toggle").onclick = () => {
      document.documentElement.classList.toggle("dark");
      localStorage.setItem(THEME_KEY, document.documentElement.classList.contains("dark") ? "dark" : "light");
      renderAll({ resetSidebarScroll: false });
    };
  }

  function runSmartAutoPlan() {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const generated = Engine.autoSchedulePlan(course, plan, DATA);
    state.savedPlansByCourse[course.code] = generated;
    const openPh = findOpenPlaceholders(generated);
    if (openPh.length > 0 && !isMobileViewport()) {
      activateSlotPicker(openPh[0], !isTabletViewport());
    } else {
      exitSlotPicker();
    }
    saveState();
    renderAll({ resetSidebarScroll: true });
    showToast(
      openPh.length > 0
        ? `Generated ${course.code} schedule! ${openPh.length} open slot(s) ready to choose.`
        : `Generated complete 2027 schedule for ${course.code}!`
    );
  }

  /* ==========================================================================
     2. WHOLE-UNIVERSITY COURSE FINDER (ALL 233 COURSES / 11 SCHOOLS)
     ========================================================================== */
  function renderCourseFinder(resultsOnly) {
    const fv = document.getElementById("finder-view");
    const activeSavedCodes = Object.keys(state.savedPlansByCourse).filter((code) => {
      const p = state.savedPlansByCourse[code];
      return p && Engine.getPlannedPlacements(p, DATA).length > 0;
    });

    const levelCounts = {
      ALL: DATA.courses.length,
      Undergraduate: DATA.courses.filter((c) => c.studyLevel === "Undergraduate").length,
      Double: DATA.courses.filter((c) => c.isDoubleDegree).length,
      "Bachelor Honours": DATA.courses.filter((c) => c.studyLevel === "Bachelor Honours").length,
      Postgraduate: DATA.courses.filter((c) => c.studyLevel === "Postgraduate").length,
      "Postgraduate Research": DATA.courses.filter((c) => c.studyLevel === "Postgraduate Research").length,
      Pathway: DATA.courses.filter((c) => ["Pathway Programs", "Other"].includes(c.studyLevel)).length,
    };

    const resumeHtml =
      activeSavedCodes.length > 0
        ? `
          <div class="resume-strip">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:700;font-size:12.5px;color:#fff;">📌 Resume your saved plan${activeSavedCodes.length > 1 ? "s" : ""}:</span>
              ${activeSavedCodes
                .slice(0, 4)
                .map((code) => {
                  const c = getCourse(code);
                  const rep = Engine.validatePlan(c, state.savedPlansByCourse[code], DATA);
                  return `<button class="btn btn-sm btn-hdr-lime" data-resume-course="${esc(code)}">${esc(code)} (${rep.totalPlannedCp}/${rep.targetCp} CP) →</button>`;
                })
                .join("")}
            </div>
          </div>
        `
        : "";

    // Mount the Finder shell once (or when full refresh requested) so typing never destroys #inp-finder-search on mobile keyboards!
    const existingSearch = document.getElementById("inp-finder-search");
    if (!resultsOnly || !existingSearch) {
      fv.innerHTML = `
        <div class="finder-hero">
          <div class="finder-hero-inner">
            <div class="finder-kicker">
              <span>2027 UNE Course Handbook</span>
              <span>·</span>
              <span>${DATA.meta.counts.courses} Courses</span>
              <span>·</span>
              <span>${DATA.meta.counts.schools} Schools</span>
              <span>·</span>
              <span>${DATA.meta.counts.units.toLocaleString()} Units</span>
            </div>
            <h1 class="finder-h1">Find your UNE degree, then plan every trimester</h1>
            <p class="finder-lead">
              Search by degree name, <strong>Major or Minor</strong> (e.g. <em>Zoology, Medicinal Chemistry, Criminology</em>), career field (<em>vet, AI, teaching, law, MBA</em>), or even a <strong>unit code</strong> (<em>CHEM110, COSC110</em>).
            </p>

            <div class="finder-search-wrap">
              <form class="finder-search-form" id="form-finder-search" action="javascript:void(0)" role="search">
                <div class="finder-search-field">
                  <span class="finder-search-icon" aria-hidden="true">🔍</span>
                  <input
                    type="search"
                    id="inp-finder-search"
                    class="finder-search-input"
                    placeholder="Search degrees, majors, careers, or units (e.g. BEXSS, Zoology, Law)…"
                    value="${esc(state.finderQuery)}"
                    autocomplete="off"
                    autocorrect="off"
                    spellcheck="false"
                    enterkeyhint="search"
                  />
                  <button class="finder-clear-btn ${state.finderQuery ? "" : "hidden"}" id="btn-clear-finder-q" title="Clear search" type="button">✕</button>
                </div>
                <button class="finder-submit-btn" id="btn-submit-finder-q" type="submit">Search</button>
              </form>
              <div id="finder-instant-box" class="finder-instant-box hidden"></div>
            </div>

            <div class="finder-topic-chips" id="finder-topic-chips">
              ${FINDER_TOPICS.map(
                (t, idx) =>
                  `<button class="topic-chip ${state.finderActiveTopic === idx ? "active" : ""}" data-topic-idx="${idx}" type="button">${esc(t.label)}</button>`
              ).join("")}
            </div>

            ${resumeHtml}
          </div>
        </div>

        <div class="finder-body">
          <div class="finder-levels-row" id="finder-levels-row">
            ${[
              ["ALL", `All Degrees (${levelCounts.ALL})`],
              ["Undergraduate", `Undergraduate (${levelCounts.Undergraduate})`],
              ["Double", `Double / Combined (${levelCounts.Double})`],
              ["Bachelor Honours", `Honours (${levelCounts["Bachelor Honours"]})`],
              ["Postgraduate", `Postgraduate (${levelCounts.Postgraduate})`],
              ["Postgraduate Research", `Research (${levelCounts["Postgraduate Research"]})`],
              ["Pathway", `Pathways & Other (${levelCounts.Pathway})`],
            ]
              .map(
                ([val, lbl]) =>
                  `<button class="level-pill-btn ${state.finderLevel === val ? "active" : ""}" data-flvl="${val}" type="button">${lbl}</button>`
              )
              .join("")}
          </div>

          <button class="finder-facets-toggle-mobile" id="btn-finder-facets-mobile" type="button">
            <span id="finder-facets-toggle-lbl">⚙ Filter &amp; Sort (School, Mode, ATAR)</span>
            <span id="finder-facets-toggle-arrow" style="color:var(--primary);">${state.finderFacetsOpenMobile ? "Hide ▴" : "Show ▾"}</span>
          </button>

          <div class="finder-facets-bar ${state.finderFacetsOpenMobile ? "open-mobile" : ""}" id="finder-facets-bar">
            <select class="select-input finder-school-sel" id="sel-finder-school" aria-label="Filter by School">
              <option value="ALL">All 11 UNE Schools</option>
              ${DATA.meta.schools
                .map(
                  ([sName, sCount]) =>
                    `<option value="${esc(sName)}" ${state.finderSchool === sName ? "selected" : ""}>${esc(sName)} (${sCount})</option>`
                )
                .join("")}
            </select>

            <select class="select-input" id="sel-finder-mode" aria-label="Delivery Mode">
              <option value="ALL">Any Mode</option>
              <option value="Online" ${state.finderMode === "Online" ? "selected" : ""}>Online Available</option>
              <option value="On Campus" ${state.finderMode === "On Campus" ? "selected" : ""}>On Campus (Armidale)</option>
            </select>

            <select class="select-input" id="sel-finder-intake" aria-label="Intake Trimester">
              <option value="ALL">Any Intake</option>
              <option value="1" ${state.finderIntake === "1" ? "selected" : ""}>Trimester 1</option>
              <option value="2" ${state.finderIntake === "2" ? "selected" : ""}>Trimester 2</option>
              <option value="3" ${state.finderIntake === "3" ? "selected" : ""}>Trimester 3</option>
            </select>

            <select class="select-input" id="sel-finder-atar" aria-label="Maximum ATAR">
              <option value="ALL">Any ATAR</option>
              <option value="65" ${state.finderAtar === "65" ? "selected" : ""}>ATAR ≤ 65</option>
              <option value="75" ${state.finderAtar === "75" ? "selected" : ""}>ATAR ≤ 75</option>
              <option value="85" ${state.finderAtar === "85" ? "selected" : ""}>ATAR ≤ 85</option>
            </select>

            <select class="select-input" id="sel-finder-sort" aria-label="Sort Courses">
              <option value="relevance" ${state.finderSort === "relevance" ? "selected" : ""}>Sort: Best Match</option>
              <option value="az" ${state.finderSort === "az" ? "selected" : ""}>Sort: A – Z</option>
              <option value="cp_asc" ${state.finderSort === "cp_asc" ? "selected" : ""}>Sort: Shortest (CP)</option>
              <option value="cp_desc" ${state.finderSort === "cp_desc" ? "selected" : ""}>Sort: Longest (CP)</option>
              <option value="atar" ${state.finderSort === "atar" ? "selected" : ""}>Sort: Lowest ATAR</option>
            </select>

            <button class="btn btn-sm hidden" id="btn-reset-finder" type="button">Reset Filters</button>
          </div>

          <div id="finder-results-area"></div>
        </div>

        <footer class="finder-footer">
          <span>
            <strong>University of New England (UNE)</strong> · 2027 Course &amp; Unit Planner Prototype (Armidale, Sydney &amp; Online).
          </span>
          <span>
            Source data compiled from the official <a href="https://handbook.une.edu.au" target="_blank" rel="noopener">2027 UNE Handbook ↗</a>.
          </span>
        </footer>
      `;

      // Bind persistent shell controls once
      const searchForm = document.getElementById("form-finder-search");
      const searchInp = document.getElementById("inp-finder-search");

      function handleSearchTextChange() {
        const val = searchInp.value;
        // If user previously clicked a Topic chip (which locked School/Faculty), clear that lock when typing a new query!
        if (state.finderActiveTopic !== -1) {
          state.finderActiveTopic = -1;
          state.finderSchool = "ALL";
          state.finderFaculty = "ALL";
          state.finderLevel = "ALL";
        }
        state.finderQuery = val;
        state.finderLimit = 48;
        state.finderInstantDismissed = false;
        renderCourseFinder(true);
      }

      searchInp.addEventListener("input", handleSearchTextChange);
      searchInp.addEventListener("search", handleSearchTextChange);
      searchInp.addEventListener("change", handleSearchTextChange);
      searchInp.addEventListener("compositionend", handleSearchTextChange);

      searchForm.onsubmit = (e) => {
        e.preventDefault();
        state.finderQuery = searchInp.value;
        state.finderInstantDismissed = true;
        searchInp.blur(); // Dismiss mobile keyboard so results take full screen!
        renderCourseFinder(true);
        const resEl = document.getElementById("finder-results-area");
        if (resEl) {
          resEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };

      document.getElementById("btn-clear-finder-q").onclick = () => {
        state.finderQuery = "";
        state.finderActiveTopic = -1;
        state.finderInstantDismissed = false;
        searchInp.value = "";
        renderCourseFinder(true);
        searchInp.focus();
      };

      document.getElementById("btn-finder-facets-mobile").onclick = () => {
        state.finderFacetsOpenMobile = !state.finderFacetsOpenMobile;
        const bar = document.getElementById("finder-facets-bar");
        const arr = document.getElementById("finder-facets-toggle-arrow");
        if (bar) bar.classList.toggle("open-mobile", state.finderFacetsOpenMobile);
        if (arr) arr.textContent = state.finderFacetsOpenMobile ? "Hide ▴" : "Show ▾";
      };

      fv.querySelectorAll("[data-topic-idx]").forEach((btn) => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.topicIdx, 10);
          if (state.finderActiveTopic === idx) {
            state.finderActiveTopic = -1;
            state.finderSchool = "ALL";
            state.finderFaculty = "ALL";
            state.finderLevel = "ALL";
            state.finderQuery = "";
          } else {
            const t = FINDER_TOPICS[idx];
            state.finderActiveTopic = idx;
            state.finderSchool = t.school || "ALL";
            state.finderFaculty = t.faculty || "ALL";
            state.finderLevel = t.studyLevel || "ALL";
            state.finderQuery = t.query || "";
          }
          state.finderLimit = 48;
          state.finderInstantDismissed = true;
          searchInp.value = state.finderQuery;
          renderCourseFinder(true);
        };
      });

      fv.querySelectorAll("[data-flvl]").forEach((btn) => {
        btn.onclick = () => {
          state.finderLevel = btn.dataset.flvl;
          state.finderLimit = 48;
          renderCourseFinder(true);
        };
      });

      fv.querySelectorAll("[data-resume-course]").forEach((btn) => {
        btn.onclick = () => openCourseInPlanner(btn.dataset.resumeCourse);
      });

      document.getElementById("sel-finder-school").onchange = (e) => {
        state.finderSchool = e.target.value;
        state.finderFaculty = "ALL";
        state.finderActiveTopic = -1;
        state.finderLimit = 48;
        renderCourseFinder(true);
      };
      document.getElementById("sel-finder-mode").onchange = (e) => {
        state.finderMode = e.target.value;
        renderCourseFinder(true);
      };
      document.getElementById("sel-finder-intake").onchange = (e) => {
        state.finderIntake = e.target.value;
        renderCourseFinder(true);
      };
      document.getElementById("sel-finder-atar").onchange = (e) => {
        state.finderAtar = e.target.value;
        renderCourseFinder(true);
      };
      document.getElementById("sel-finder-sort").onchange = (e) => {
        state.finderSort = e.target.value;
        renderCourseFinder(true);
      };
      document.getElementById("btn-reset-finder").onclick = resetFinderFilters;
    }

    // Sync controls & active chips without disturbing keyboard focus
    const clearBtn = document.getElementById("btn-clear-finder-q");
    if (clearBtn) clearBtn.classList.toggle("hidden", !state.finderQuery);

    const hasActiveFilters =
      Boolean(state.finderQuery) ||
      state.finderLevel !== "ALL" ||
      state.finderSchool !== "ALL" ||
      state.finderFaculty !== "ALL" ||
      state.finderMode !== "ALL" ||
      state.finderIntake !== "ALL" ||
      state.finderAtar !== "ALL";
    const resetBtn = document.getElementById("btn-reset-finder");
    if (resetBtn) resetBtn.classList.toggle("hidden", !hasActiveFilters);

    const schSel = document.getElementById("sel-finder-school");
    if (schSel && schSel.value !== state.finderSchool) schSel.value = state.finderSchool;
    const modSel = document.getElementById("sel-finder-mode");
    if (modSel && modSel.value !== state.finderMode) modSel.value = state.finderMode;
    const intSel = document.getElementById("sel-finder-intake");
    if (intSel && intSel.value !== state.finderIntake) intSel.value = state.finderIntake;
    const atarSel = document.getElementById("sel-finder-atar");
    if (atarSel && atarSel.value !== state.finderAtar) atarSel.value = state.finderAtar;
    const sortSel = document.getElementById("sel-finder-sort");
    if (sortSel && sortSel.value !== state.finderSort) sortSel.value = state.finderSort;

    fv.querySelectorAll("[data-topic-idx]").forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.topicIdx, 10) === state.finderActiveTopic);
    });
    fv.querySelectorAll("[data-flvl]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.flvl === state.finderLevel);
    });

    const activeFacetCount = [
      state.finderSchool !== "ALL",
      state.finderMode !== "ALL",
      state.finderIntake !== "ALL",
      state.finderAtar !== "ALL",
      state.finderSort !== "relevance",
    ].filter(Boolean).length;
    const facetLbl = document.getElementById("finder-facets-toggle-lbl");
    if (facetLbl) {
      facetLbl.textContent = activeFacetCount
        ? `⚙ Filter & Sort (${activeFacetCount} active)`
        : "⚙ Filter & Sort (School, Mode, ATAR)";
    }

    // Compute and render matching course cards into #finder-results-area
    const results = Engine.searchCourses(
      state.finderQuery,
      {
        studyLevel: state.finderLevel,
        school: state.finderSchool,
        faculty: state.finderFaculty,
        mode: state.finderMode,
        intake: state.finderIntake,
        maxAtar: state.finderAtar,
        sortBy: state.finderSort,
      },
      DATA
    );

    // Live Instant Matches Dropdown directly underneath search bar (so mobile users see matches immediately above keyboard!)
    const instantBox = document.getElementById("finder-instant-box");
    const qTrim = state.finderQuery.trim();
    if (instantBox) {
      if (qTrim.length >= 2 && !state.finderInstantDismissed) {
        instantBox.classList.remove("hidden");
        if (results.length === 0) {
          instantBox.innerHTML = `
            <div class="finder-instant-hdr">
              <span>No matches for "${esc(qTrim)}"${hasActiveFilters ? " with current filters" : ""}</span>
              <button class="btn btn-sm" id="btn-instant-reset" type="button">Reset Filters</button>
            </div>
          `;
          instantBox.querySelector("#btn-instant-reset").onclick = resetFinderFilters;
        } else {
          const topInstant = results.slice(0, 5);
          instantBox.innerHTML = `
            <div class="finder-instant-hdr">
              <span>✨ ${results.length} matching UNE degree${results.length === 1 ? "" : "s"} for "${esc(qTrim)}"</span>
              <button class="btn btn-sm" id="btn-instant-hide" type="button" style="min-height:24px;padding:1px 7px;font-size:11px;">Hide ✕</button>
            </div>
            ${topInstant
              .map((r) => {
                const c = r.course;
                const m0 = r.matchedMajors && r.matchedMajors[0];
                const subBits = [
                  c.school.replace(/^School of /, ""),
                  `${c.totalCp} CP`,
                  r.matchedUnit ? `Includes ${r.matchedUnit}` : "",
                  m0 ? `${m0.isMinor ? "Minor" : "Major"}: ${m0.title}` : "",
                ].filter(Boolean);
                const launchAttr = m0
                  ? `data-instant-aos="${esc(c.code)}||${esc(m0.code)}||${esc(m0.title)}||${esc(m0.containerTitle || "")}"`
                  : `data-instant-course="${esc(c.code)}"`;
                return `
                  <button class="finder-instant-row" type="button" ${launchAttr}>
                    <span class="course-code-pill teal">${esc(c.code)}</span>
                    <div class="finder-instant-main">
                      <div class="finder-instant-title">${esc(c.title)}</div>
                      <div class="finder-instant-sub">${esc(subBits.join(" · "))}</div>
                    </div>
                    <span style="color:var(--primary);font-weight:800;font-size:12px;flex-shrink:0;">Plan →</span>
                  </button>
                `;
              })
              .join("")}
            <button class="finder-instant-footer" id="btn-instant-jump-all" type="button">
              View all ${results.length} matching course card${results.length === 1 ? "" : "s"} ↓
            </button>
          `;

          instantBox.querySelector("#btn-instant-hide").onclick = () => {
            state.finderInstantDismissed = true;
            instantBox.classList.add("hidden");
          };
          instantBox.querySelector("#btn-instant-jump-all").onclick = () => {
            state.finderInstantDismissed = true;
            instantBox.classList.add("hidden");
            document.getElementById("inp-finder-search")?.blur();
            document.getElementById("finder-results-area")?.scrollIntoView({ behavior: "smooth", block: "start" });
          };
          instantBox.querySelectorAll("[data-instant-course]").forEach((btn) => {
            btn.onclick = () => {
              state.finderInstantDismissed = true;
              openCourseInPlanner(btn.dataset.instantCourse);
            };
          });
          instantBox.querySelectorAll("[data-instant-aos]").forEach((btn) => {
            btn.onclick = () => {
              state.finderInstantDismissed = true;
              const [cCode, aosCode, aosTitle, containerTitle] = btn.dataset.instantAos.split("||");
              openCourseInPlanner(cCode, { code: aosCode, title: aosTitle, containerTitle });
            };
          });
        }
      } else {
        instantBox.classList.add("hidden");
      }
    }

    const resArea = document.getElementById("finder-results-area");
    resArea.innerHTML = `
      <div class="finder-results-meta" style="margin-bottom:12px;">
        <span>
          Showing <strong>${Math.min(results.length, state.finderLimit)}</strong> of <strong>${results.length}</strong> matching UNE 2027 course${results.length === 1 ? "" : "s"}
          ${state.finderQuery ? `for "<strong>${esc(state.finderQuery)}</strong>"` : ""}
          ${state.finderFaculty !== "ALL" ? `in <strong>${esc(state.finderFaculty)}</strong>` : ""}
        </span>
        <span style="font-size:12px;">Preview details or click <strong>Plan Degree →</strong> to start scheduling</span>
      </div>

      ${
        results.length === 0
          ? `<div style="background:var(--surface);border:1px dashed var(--border-strong);border-radius:var(--radius-lg);padding:32px;text-align:center;">
              <div style="font-size:16px;font-weight:700;">No 2027 UNE courses matched those filters</div>
              <div style="font-size:13px;color:var(--text-subtle);margin:6px 0 14px;">Try a broader search term (like "Science", "Law", "Health", "AI", or "Data") or reset filters.</div>
              <button class="btn btn-primary" id="btn-empty-reset-finder" type="button">Show All ${DATA.meta.counts.courses} Courses</button>
            </div>`
          : `
            <div class="finder-grid">
              ${results
                .slice(0, state.finderLimit)
                .map((r) => renderFinderCourseCard(r))
                .join("")}
            </div>
            ${
              results.length > state.finderLimit
                ? `<div style="display:flex;justify-content:center;padding-top:14px;">
                    <button class="btn btn-soft" id="btn-finder-more" type="button">Show More Courses (${results.length - state.finderLimit} remaining)</button>
                  </div>`
                : ""
            }
          `
      }
    `;

    const emptyReset = document.getElementById("btn-empty-reset-finder");
    if (emptyReset) emptyReset.onclick = resetFinderFilters;

    const moreBtn = document.getElementById("btn-finder-more");
    if (moreBtn) {
      moreBtn.onclick = () => {
        state.finderLimit += 60;
        renderCourseFinder(true);
      };
    }

    resArea.querySelectorAll("[data-launch-course]").forEach((btn) => {
      btn.onclick = () => openCourseInPlanner(btn.dataset.launchCourse);
    });

    resArea.querySelectorAll("[data-preview-course]").forEach((btn) => {
      btn.onclick = () => openCourseInfoModal(btn.dataset.previewCourse);
    });

    resArea.querySelectorAll("[data-launch-with-aos]").forEach((btn) => {
      btn.onclick = () => {
        const [cCode, aosCode, aosTitle, containerTitle] = btn.dataset.launchWithAos.split("||");
        openCourseInPlanner(cCode, { code: aosCode, title: aosTitle, containerTitle });
      };
    });
  }

  function resetFinderFilters() {
    state.finderQuery = "";
    state.finderLevel = "ALL";
    state.finderSchool = "ALL";
    state.finderFaculty = "ALL";
    state.finderMode = "ALL";
    state.finderIntake = "ALL";
    state.finderAtar = "ALL";
    state.finderActiveTopic = -1;
    state.finderLimit = 48;
    state.finderInstantDismissed = false;
    const inp = document.getElementById("inp-finder-search");
    if (inp) inp.value = "";
    renderCourseFinder(true);
  }

  function renderFinderCourseCard(res) {
    const c = res.course;
    const isSaved = !!state.savedPlansByCourse[c.code] && Engine.getPlannedPlacements(state.savedPlansByCourse[c.code], DATA).length > 0;
    const cardTone = c.isDoubleDegree ? "double-card" : c.studyLevel.includes("Postgraduate") ? "pg-card" : "";
    const majorTitles = (c.majorTitles || []).filter((t) => !/listed unit/i.test(t));
    const majorCount = majorTitles.length;
    const minorCount = (c.minorTitles || []).length;
    const topMatchAos = res.matchedMajors && res.matchedMajors[0];

    const majorsPreviewHtml =
      majorCount > 0 && !(res.matchedMajors && res.matchedMajors.length > 0)
        ? `<div class="finder-majors-preview">
             <strong>Majors:</strong> ${esc(majorTitles.slice(0, 4).join(", "))}${
               majorCount > 4 ? ` <em>+${majorCount - 4} more</em>` : ""
             }
           </div>`
        : "";

    return `
      <article class="finder-card ${cardTone}">
        <div class="finder-card-top">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span class="course-code-pill teal">${esc(c.code)}</span>
            <span class="meta-chip">${esc(c.studyLevel)}</span>
            ${c.isDoubleDegree ? `<span class="meta-chip" style="color:var(--une-blue);border-color:var(--info-border);background:var(--info-bg);">Double Degree</span>` : ""}
          </div>
          <span style="font-weight:800;font-size:12.5px;color:var(--primary);font-variant-numeric:tabular-nums;">${c.totalCp} CP</span>
        </div>

        <div class="finder-card-title">${esc(c.title)}</div>
        <div class="finder-card-school">${esc(c.school)}</div>

        ${
          c.overview
            ? `<div style="font-size:12px;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(c.overview)}</div>`
            : ""
        }

        ${majorsPreviewHtml}

        <div class="finder-card-meta">
          ${c.modes?.length ? `<span class="meta-chip">${esc(c.modes.join(" / "))}</span>` : ""}
          ${c.atar ? `<span class="meta-chip">ATAR ${esc(c.atar)}</span>` : ""}
          ${majorCount ? `<span class="meta-chip">${majorCount} Major${majorCount > 1 ? "s" : ""}</span>` : ""}
          ${minorCount ? `<span class="meta-chip">${minorCount} Minor${minorCount > 1 ? "s" : ""}</span>` : ""}
          ${c.studyPlanIds?.length ? `<span class="meta-chip">${c.studyPlanIds.length} Official Plan${c.studyPlanIds.length > 1 ? "s" : ""}</span>` : ""}
          ${res.matchedUnit ? `<span class="meta-chip match-hit">✓ Includes ${esc(res.matchedUnit)}</span>` : ""}
          ${(res.matchedMajors || [])
            .slice(0, 2)
            .map((m) => `<span class="meta-chip match-hit">✓ ${m.isMinor ? "Minor" : "Major"}: ${esc(m.title)}</span>`)
            .join("")}
        </div>

        <div class="finder-card-actions">
          <span style="font-size:11.5px;color:${isSaved ? "var(--ok)" : "var(--text-subtle)"};font-weight:${isSaved ? "700" : "500"};">
            ${isSaved ? "● Saved plan in progress" : esc(c.duration || c.courseType || "2027 Intake")}
          </span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm" data-preview-course="${esc(c.code)}" title="Preview ATAR, careers, rules & handbook" type="button">📖 Details</button>
            ${
              topMatchAos
                ? `<button class="btn btn-sm btn-soft" data-launch-with-aos="${esc(c.code)}||${esc(topMatchAos.code)}||${esc(topMatchAos.title)}||${esc(topMatchAos.containerTitle || "")}" type="button">
                    Plan w/ ${esc(topMatchAos.title.slice(0, 16))}${topMatchAos.title.length > 16 ? "…" : ""} →
                  </button>`
                : ""
            }
            <button class="btn btn-sm btn-primary" data-launch-course="${esc(c.code)}" type="button">
              ${isSaved ? "Resume Plan →" : "Plan Degree →"}
            </button>
          </div>
        </div>
      </article>
    `;
  }

  /* ==========================================================================
     3. PLANNER CONFIG RIBBON (INCLUDING DYNAMIC AOS FOR ALL 233 COURSES!)
     ========================================================================== */
  function renderConfigRibbon(course, plan, report) {
    const cfg = course.structureConfig;
    const opts = report.resolved.aosOptions;
    const ribbon = document.getElementById("config-ribbon");
    const mobToggle = document.getElementById("btn-mobile-config-toggle");
    const parts = [];

    // Summary line for mobile collapsible config button
    const summaryPieces = [];
    if (cfg.hasAdmissionRules && plan.admissionRule) summaryPieces.push(plan.admissionRule);
    if (plan.selectedMajors?.length) {
      summaryPieces.push(
        plan.selectedMajors
          .map((mc) => (DATA.aos[mc]?.title || mc).replace(/^[A-Z0-9]+\s*-\s*/, "").replace(/\s*\((Major|Minor)\)\s*$/i, ""))
          .join(" + ")
      );
    } else if (cfg.aosMode === "dynamic") {
      const selVals = Object.values(plan.dynamicAosSelections || {}).filter(Boolean);
      if (selVals.length) {
        summaryPieces.push(
          selVals
            .slice(0, 2)
            .map((ac) => (DATA.aos[ac]?.title || ac).replace(/^[A-Z0-9]+\s*-\s*/, "").replace(/\s*\((Major|Minor)\)\s*$/i, ""))
            .join(" + ")
        );
      }
    }
    summaryPieces.push(`T${plan.commencingTrimester} · ${plan.studyLoad} · ${plan.preferredMode}`);
    mobToggle.innerHTML = `
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⚙ Configure: ${esc(summaryPieces.join(" · "))}</span>
      <span style="flex-shrink:0;margin-left:8px;color:var(--primary);">${state.mobileConfigOpen ? "Hide ▴" : "Edit ▾"}</span>
    `;
    mobToggle.onclick = () => {
      state.mobileConfigOpen = !state.mobileConfigOpen;
      ribbon.classList.toggle("open-mobile", state.mobileConfigOpen);
      mobToggle.querySelector("span:last-child").textContent = state.mobileConfigOpen ? "Hide ▴" : "Edit ▾";
    };
    ribbon.classList.toggle("open-mobile", state.mobileConfigOpen);

    // 1. Admission Rule / Schedule Selector
    if (cfg.hasAdmissionRules) {
      parts.push(`
        <div class="config-group">
          <span class="config-label">Pathway / Rule</span>
          <select class="select-input" id="sel-admission-rule">
            ${cfg.admissionRules
              .map((r) => {
                const adv = Engine.getAdvancedStandingCp(course, r);
                return `<option value="${esc(r)}" ${plan.admissionRule === r ? "selected" : ""}>${esc(r)}${
                  adv ? ` (${adv} CP Adv. Standing)` : ""
                }</option>`;
              })
              .join("")}
          </select>
        </div>
      `);
    }

    // 2. Specialized AOS structure selectors (BSC, BCOMP, BIT01, BBIOSC)
    if (cfg.aosMode === "bsc") {
      parts.push(`
        <div class="config-group">
          <span class="config-label">Structure</span>
          <div class="seg-group">
            <button class="seg-btn ${plan.aosStructure === "1m" ? "active" : ""}" data-struct="1m">1 Major</button>
            <button class="seg-btn ${plan.aosStructure === "1m1n" ? "active" : ""}" data-struct="1m1n">Major + Minor</button>
            <button class="seg-btn ${plan.aosStructure === "2m" ? "active" : ""}" data-struct="2m">2 Majors</button>
          </div>
        </div>
      `);
    } else if (cfg.aosMode === "bcomp") {
      parts.push(`
        <div class="config-group">
          <span class="config-label">Option</span>
          <div class="seg-group">
            <button class="seg-btn ${plan.aosStructure === "opt1" ? "active" : ""}" data-struct="opt1">1 Major</button>
            <button class="seg-btn ${plan.aosStructure === "opt2" ? "active" : ""}" data-struct="opt2">Major + Minor</button>
            <button class="seg-btn ${plan.aosStructure === "opt3" ? "active" : ""}" data-struct="opt3">2 Majors</button>
          </div>
        </div>
      `);
    } else if (cfg.aosMode === "bit01") {
      parts.push(`
        <div class="config-group">
          <span class="config-label">Majors</span>
          <div class="seg-group">
            <button class="seg-btn ${plan.aosStructure === "1m" ? "active" : ""}" data-struct="1m">1 Major</button>
            <button class="seg-btn ${plan.aosStructure === "2m" ? "active" : ""}" data-struct="2m">2 Majors</button>
          </div>
        </div>
      `);
    } else if (cfg.aosMode === "bbiosc") {
      parts.push(`
        <div class="config-group">
          <span class="config-label">Stream</span>
          <div class="seg-group">
            <button class="seg-btn ${plan.aosStructure === "listed" ? "active" : ""}" data-struct="listed">30 CP Listed</button>
            <button class="seg-btn ${plan.aosStructure === "minor" ? "active" : ""}" data-struct="minor">Specialist Minor</button>
          </div>
        </div>
      `);
    }

    // 3. Dynamic Whole-University AOS Selectors (BA, BBus, BASC, BSCLAW, BED*, BAGR, etc.)
    if (cfg.aosMode === "dynamic") {
      const dynGroups = Engine.getDynamicAOSGroups(course, plan, DATA).filter((g) => !g.isMandatorySingle);
      const dynSel = plan.dynamicAosSelections || {};
      dynGroups.slice(0, 4).forEach((grp, idx) => {
        parts.push(`
          <div class="config-group">
            <span class="config-label">${esc(grp.title.slice(0, 26))}</span>
            <select class="select-input" data-dyn-aos="${esc(grp.id)}" id="sel-dyn-${idx}">
              <option value="">— Select ${esc(grp.isMinor ? "Minor / Optional" : "Option")} (${grp.items.length}) —</option>
              ${grp.items
                .map((it) => {
                  const cleanT = (it.title || it.code).replace(/^[A-Z0-9]+\s*-\s*/, "").replace(/\s*\((Major|Minor)\)\s*$/i, "");
                  return `<option value="${esc(it.code)}" ${dynSel[grp.id] === it.code ? "selected" : ""}>${esc(cleanT)}${
                    it.cp ? ` (${it.cp} CP)` : ""
                  }</option>`;
                })
                .join("")}
            </select>
          </div>
        `);
      });
    } else {
      const needMajors =
        (cfg.aosMode === "bsc" && plan.aosStructure === "2m") ||
        (cfg.aosMode === "bcomp" && plan.aosStructure === "opt3") ||
        (cfg.aosMode === "bit01" && plan.aosStructure === "2m")
          ? 2
          : ["bsc", "bcomp", "bit01", "single_major"].includes(cfg.aosMode)
          ? 1
          : 0;

      if (needMajors >= 1 && opts.majors.length) {
        parts.push(`
          <div class="config-group">
            <span class="config-label">${needMajors === 2 ? "Major 1" : "Major"}</span>
            <select class="select-input" id="sel-major-1">
              <option value="">— Select Major —</option>
              ${opts.majors
                .map(
                  (m) =>
                    `<option value="${esc(m.code)}" ${plan.selectedMajors[0] === m.code ? "selected" : ""}>${esc(m.title)} (${
                      m.cp || DATA.aos[m.code]?.totalCp || 42
                    } CP)</option>`
                )
                .join("")}
            </select>
          </div>
        `);
      }
      if (needMajors === 2 && opts.majors.length) {
        parts.push(`
          <div class="config-group">
            <span class="config-label">Major 2</span>
            <select class="select-input" id="sel-major-2">
              <option value="">— Select 2nd Major —</option>
              ${opts.majors
                .filter((m) => m.code !== plan.selectedMajors[0])
                .map(
                  (m) =>
                    `<option value="${esc(m.code)}" ${plan.selectedMajors[1] === m.code ? "selected" : ""}>${esc(m.title)} (${
                      m.cp || DATA.aos[m.code]?.totalCp || 42
                    } CP)</option>`
                )
                .join("")}
            </select>
          </div>
        `);
      }

      const showMinor =
        (cfg.aosMode === "bsc" && plan.aosStructure === "1m1n") ||
        (cfg.aosMode === "bcomp" && plan.aosStructure === "opt2") ||
        (cfg.aosMode === "bbiosc" && plan.aosStructure === "minor");
      if (showMinor && opts.minors.length) {
        parts.push(`
          <div class="config-group">
            <span class="config-label">Minor</span>
            <select class="select-input" id="sel-minor">
              <option value="">— Select Minor —</option>
              ${opts.minors
                .map(
                  (m) =>
                    `<option value="${esc(m.code)}" ${plan.selectedMinor === m.code ? "selected" : ""}>${esc(m.title)} (${m.cp || 24} CP)</option>`
                )
                .join("")}
            </select>
          </div>
        `);
      }

      if ((cfg.aosMode === "dscnce" || cfg.aosMode === "mnsc_pathway") && opts.pathways.length) {
        parts.push(`
          <div class="config-group">
            <span class="config-label">${cfg.aosMode === "mnsc_pathway" ? "Pathway" : "Stream / Minor"}</span>
            <select class="select-input" id="sel-minor">
              <option value="">— Select ${cfg.aosMode === "mnsc_pathway" ? "Pathway" : "Option"} —</option>
              ${opts.pathways
                .map(
                  (p) =>
                    `<option value="${esc(p.code)}" ${plan.selectedMinor === p.code ? "selected" : ""}>${
                      p.groupLabel ? `${esc(p.groupLabel)}: ` : ""
                    }${esc(p.title)}</option>`
                )
                .join("")}
            </select>
          </div>
        `);
      }
    }

    // 4. Intake, Load, Mode & Honest T3 Strategy (clean 2x2 grid on mobile, inline flex on desktop)
    parts.push(`
      <div class="config-meta-grid">
        <div class="config-pair">
          <span class="config-label">Start</span>
          <select class="select-input" id="sel-commence">
            <option value="1" ${plan.commencingTrimester === 1 ? "selected" : ""}>Trimester 1</option>
            <option value="2" ${plan.commencingTrimester === 2 ? "selected" : ""}>Trimester 2</option>
            <option value="3" ${plan.commencingTrimester === 3 ? "selected" : ""}>Trimester 3</option>
          </select>
        </div>

        <div class="config-pair">
          <span class="config-label">Load</span>
          <select class="select-input" id="sel-load">
            <option value="Full-time" ${plan.studyLoad === "Full-time" ? "selected" : ""}>Full-time</option>
            <option value="Part-time" ${plan.studyLoad === "Part-time" ? "selected" : ""}>Part-time</option>
          </select>
        </div>

        <div class="config-pair">
          <span class="config-label">Mode</span>
          <select class="select-input" id="sel-mode">
            <option value="Online" ${plan.preferredMode === "Online" ? "selected" : ""}>Online</option>
            <option value="On Campus" ${plan.preferredMode === "On Campus" ? "selected" : ""}>On Campus</option>
          </select>
        </div>

        <div class="config-pair">
          <span class="config-label" title="Standard T1/T2 vs Lighter 3+3+2 Load-Spreading vs Fast-Track Check">T3</span>
          <select class="select-input" id="sel-t3-strategy">
            <option value="none" ${!plan.t3Strategy || plan.t3Strategy === "none" ? "selected" : ""}>Off (T1 &amp; T2)</option>
            <option value="spread" ${plan.t3Strategy === "spread" ? "selected" : ""}>Spread Load (3+3+2)</option>
            <option value="accelerate" ${plan.t3Strategy === "accelerate" ? "selected" : ""}>Fast-Track (If Possible)</option>
          </select>
        </div>
      </div>
    `);

    ribbon.innerHTML = parts.join("");

    // Bind config handlers
    const ruleEl = document.getElementById("sel-admission-rule");
    if (ruleEl) {
      ruleEl.onchange = (e) => {
        plan.admissionRule = e.target.value;
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    }

    ribbon.querySelectorAll("[data-struct]").forEach((btn) => {
      btn.onclick = () => {
        plan.aosStructure = btn.dataset.struct;
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    });

    ribbon.querySelectorAll("[data-dyn-aos]").forEach((sel) => {
      sel.onchange = (e) => {
        plan.dynamicAosSelections = plan.dynamicAosSelections || {};
        plan.dynamicAosSelections[sel.dataset.dynAos] = e.target.value;
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    });

    const m1El = document.getElementById("sel-major-1");
    if (m1El) {
      m1El.onchange = (e) => {
        const v = e.target.value;
        plan.selectedMajors = v ? [v, ...(plan.selectedMajors.slice(1).filter((x) => x !== v))] : [];
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    }
    const m2El = document.getElementById("sel-major-2");
    if (m2El) {
      m2El.onchange = (e) => {
        const v = e.target.value;
        const first = plan.selectedMajors[0] || "";
        plan.selectedMajors = v ? [first, v].filter(Boolean) : [first].filter(Boolean);
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    }
    const minEl = document.getElementById("sel-minor");
    if (minEl) {
      minEl.onchange = (e) => {
        plan.selectedMinor = e.target.value;
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    }
    document.getElementById("sel-commence").onchange = (e) => {
      plan.commencingTrimester = parseInt(e.target.value, 10);
      saveState();
      renderAll({ resetSidebarScroll: false });
    };
    document.getElementById("sel-load").onchange = (e) => {
      plan.studyLoad = e.target.value;
      saveState();
      renderAll({ resetSidebarScroll: false });
    };
    document.getElementById("sel-mode").onchange = (e) => {
      plan.preferredMode = e.target.value;
      saveState();
      renderAll({ resetSidebarScroll: false });
    };
    document.getElementById("sel-t3-strategy").onchange = (e) => {
      plan.t3Strategy = e.target.value;
      plan.includeT3InAuto = e.target.value !== "none";
      if (Engine.getPlannedPlacements(plan, DATA).length > 0) {
        const updated = Engine.autoSchedulePlan(course, plan, DATA);
        state.savedPlansByCourse[course.code] = updated;
        const openPh = findOpenPlaceholders(updated);
        if (openPh.length > 0 && state.sidebarTab === "slot") activateSlotPicker(openPh[0], false);
      }
      saveState();
      renderAll({ resetSidebarScroll: false });
    };

    const presetBar = document.getElementById("preset-bar");
    if (course.code === "BSC") {
      presetBar.style.display = "flex";
      presetBar.innerHTML = `
        <span style="font-weight:700;color:var(--primary);white-space:nowrap;">⚡ BSc Presets:</span>
        ${BSC_PRESETS.map((p, i) => `<button class="preset-chip" data-preset="${i}">${esc(p.label)}</button>`).join("")}
      `;
      presetBar.querySelectorAll("[data-preset]").forEach((btn) => {
        btn.onclick = () => {
          const pr = BSC_PRESETS[parseInt(btn.dataset.preset, 10)];
          plan.aosStructure = pr.structure;
          plan.selectedMajors = [...pr.majors];
          plan.selectedMinor = pr.minor;
          const generated = Engine.autoSchedulePlan(course, plan, DATA);
          state.savedPlansByCourse[course.code] = generated;
          const openPh = findOpenPlaceholders(generated);
          if (openPh.length > 0 && !isMobileViewport()) activateSlotPicker(openPh[0], !isTabletViewport());
          else exitSlotPicker();
          saveState();
          renderAll({ resetSidebarScroll: true });
          showToast(`Loaded BSc preset: ${pr.label}`);
        };
      });
    } else {
      presetBar.style.display = "none";
    }
  }

  /* ==========================================================================
     4. SIDEBAR (SLOT OPTIONS | REQUIREMENTS | ALL 1,720 UNITS) + SCROLL LOCK
     ========================================================================== */
  function renderSidebar(course, plan, report, opts) {
    const sb = document.getElementById("sidebar");
    const prevBodyEl = document.getElementById("sidebar-body-scroll");
    const savedInnerScroll = opts?.resetScroll ? 0 : prevBodyEl ? prevBodyEl.scrollTop : 0;
    const savedOuterScroll = opts?.resetScroll ? 0 : sb.scrollTop;

    if (state.sidebarTab === "slot" && !state.targetSlot) state.sidebarTab = "requirements";

    const { buckets, majorCoreHints } = report.resolved;
    let slotEval = null;
    const slotIneligMap = new Map();
    if (state.targetSlot) {
      slotEval = Engine.resolveSlotCandidates(state.targetSlot, course, plan, DATA, {
        forceIncludeElectives: state.slotForceElectives,
      });
      slotEval.ineligible.forEach((i) => slotIneligMap.set(i.code, i.reasons));
    }

    let targetBanner = "";
    if (state.targetSlot && state.sidebarTab !== "slot") {
      const yr = plan.years[state.targetSlot.yearIdx];
      targetBanner = `
        <div class="target-slot-banner">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">
            🎯 Target: <strong>Y${yr?.yearNum || state.targetSlot.yearIdx + 1} · T${state.targetSlot.triNum}</strong>
            ${state.targetSlot.label ? `(${esc(state.targetSlot.label)})` : ""}
          </span>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-sm btn-soft" id="btn-return-slot-tab">Slot View</button>
            <button class="btn btn-sm" id="btn-cancel-target">✕</button>
          </div>
        </div>
      `;
    }

    let bodyHtml = "";

    if (state.sidebarTab === "slot" && state.targetSlot && slotEval) {
      const yr = plan.years[state.targetSlot.yearIdx];
      const q = state.slotQuery.trim().toLowerCase();
      const hasBothPools =
        slotEval.spec.allowsElectives && slotEval.spec.coursePoolMap && slotEval.spec.coursePoolMap.size > 0;

      const filterFn = (item) => {
        if (state.slotLevelFilter !== "all" && String(item.unit.level) !== state.slotLevelFilter) return false;
        if (hasBothPools) {
          if (state.slotPoolFilter === "course" && !item.inCoursePool) return false;
          if (state.slotPoolFilter === "elective" && item.inCoursePool) return false;
        }
        if (q && !`${item.code} ${item.unit.title} ${item.poolLabel} ${item.unit.school}`.toLowerCase().includes(q)) return false;
        return true;
      };

      const filteredEligible = slotEval.eligible.filter(filterFn);
      const filteredIneligible = slotEval.ineligible.filter(filterFn);
      const autoExpandInelig = state.slotShowIneligible || filteredEligible.length === 0 || q.length > 0;
      const courseEligCount = slotEval.eligible.filter((x) => x.inCoursePool).length;
      const elecEligCount = slotEval.eligible.filter((x) => !x.inCoursePool).length;

      bodyHtml = `
        <div class="slot-context-box">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-weight:800;font-size:13px;color:var(--info);">
                🎯 Filling Year ${yr?.yearNum || state.targetSlot.yearIdx + 1} · Trimester ${state.targetSlot.triNum}
              </div>
              <div style="font-weight:700;font-size:12px;color:var(--text);margin-top:1px;">${esc(slotEval.spec.title)}</div>
              <div style="font-size:11px;color:var(--text-subtle);">${esc(slotEval.spec.subtitle)}</div>
            </div>
            <button class="btn btn-sm" id="btn-exit-slot">✕ Exit</button>
          </div>

          ${
            slotEval.eligible.length + slotEval.ineligible.length > 4 || q || state.slotLevelFilter !== "all"
              ? `<div style="display:flex;gap:6px;margin-top:2px;">
                  <input type="search" class="text-input" id="inp-slot-search" placeholder="Filter units or check why ineligible…" value="${esc(
                    state.slotQuery
                  )}" style="flex:1;min-width:0;background:var(--surface);" />
                  <select class="select-input" id="sel-slot-level" style="background:var(--surface);">
                    <option value="all">Levels</option>
                    ${[100, 200, 300, 400, 500]
                      .map((l) => `<option value="${l}" ${state.slotLevelFilter === String(l) ? "selected" : ""}>L${l}</option>`)
                      .join("")}
                  </select>
                </div>`
              : ""
          }

          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            ${
              hasBothPools
                ? `<div class="seg-group" style="background:var(--surface);">
                    <button class="seg-btn ${state.slotPoolFilter === "all" ? "active" : ""}" data-spool="all">All (${slotEval.eligible.length})</button>
                    <button class="seg-btn ${state.slotPoolFilter === "course" ? "active" : ""}" data-spool="course">Course (${courseEligCount})</button>
                    <button class="seg-btn ${state.slotPoolFilter === "elective" ? "active" : ""}" data-spool="elective">Electives (${elecEligCount})</button>
                  </div>`
                : !slotEval.spec.allowsElectives && slotEval.spec.hints.length === 0
                ? `<label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted);cursor:pointer;">
                    <input type="checkbox" id="chk-slot-force-elec" ${state.slotForceElectives ? "checked" : ""} />
                    Include open electives
                  </label>`
                : `<span></span>`
            }
            ${
              slotEval.spec.allowsElectives || state.slotForceElectives
                ? `<button class="btn btn-sm" id="btn-slot-custom" style="background:var(--surface);">+ Custom</button>`
                : ""
            }
          </div>
        </div>

        <div id="slot-results-wrap" style="display:flex;flex-direction:column;gap:8px;">
          ${renderSlotListInner(slotEval, filteredEligible, filteredIneligible, autoExpandInelig)}
        </div>
      `;
    } else if (state.sidebarTab === "requirements") {
      bodyHtml = buckets
        .map((b) => {
          const isCollapsed = !!state.collapsedBuckets[b.id];
          const cpLabel =
            b.cpMin && b.cpMax && b.cpMin !== b.cpMax
              ? `${b.plannedCp} / ${b.cpMin}–${b.cpMax} CP`
              : b.cpMin
              ? `${b.plannedCp} / ${b.cpMin} CP`
              : b.cpMax !== null && b.cpMax !== undefined
              ? `${b.plannedCp} / ≤${b.cpMax} CP`
              : `${b.plannedCp} CP`;

          const baseUnits = [...b.units].sort((x, y) => {
            const xReq = majorCoreHints.mandatory[x] ? 0 : 1;
            const yReq = majorCoreHints.mandatory[y] ? 0 : 1;
            if (xReq !== yReq) return xReq - yReq;
            return x.localeCompare(y);
          });

          let bucketCardsHtml = "";
          if (b.units.length === 0 && b.category === "elective") {
            bucketCardsHtml = `
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-soft" id="btn-jump-catalog">🔍 Browse All ${DATA.meta.counts.units.toLocaleString()} Units</button>
                <button class="btn btn-sm" id="btn-open-custom-unit">+ Custom Elective</button>
              </div>
            `;
          } else if (state.targetSlot) {
            const eligInBucket = [];
            const plannedInBucket = [];
            const ineligInBucket = [];
            for (const uCode of baseUnits) {
              if (isUnitPlanned(uCode, plan)) plannedInBucket.push(uCode);
              else if (slotIneligMap.has(uCode)) ineligInBucket.push(uCode);
              else eligInBucket.push(uCode);
            }
            bucketCardsHtml = [
              ...eligInBucket.map((uCode) => renderPoolUnitCard(uCode, plan, majorCoreHints)),
              ...plannedInBucket.map((uCode) => renderPoolUnitCard(uCode, plan, majorCoreHints)),
              ...(ineligInBucket.length
                ? [
                    `<div style="font-size:10.5px;font-weight:700;color:var(--warn);margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);">
                      Not eligible for Y${plan.years[state.targetSlot.yearIdx]?.yearNum || 1} · T${state.targetSlot.triNum} (${ineligInBucket.length}):
                    </div>`,
                    ...ineligInBucket.map((uCode) =>
                      renderIneligibleUnitCard(
                        uCode,
                        Engine.getUnit(uCode, DATA, plan.customUnits),
                        slotIneligMap.get(uCode) || [],
                        null,
                        false
                      )
                    ),
                  ]
                : []),
            ].join("");
          } else {
            bucketCardsHtml = baseUnits.map((uCode) => renderPoolUnitCard(uCode, plan, majorCoreHints)).join("");
          }

          return `
            <div class="bucket-card">
              <button class="bucket-header" data-toggle-bucket="${esc(b.id)}">
                <div class="bucket-title-row">
                  <span class="cat-dot" style="background:${CAT_COLORS[b.category] || "var(--primary)"};"></span>
                  <span style="overflow:hidden;text-overflow:ellipsis;">${esc(b.title)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="bucket-cp-pill ${b.status}">${esc(cpLabel)}</span>
                  <span style="font-size:11px;color:var(--text-subtle);">${isCollapsed ? "▸" : "▾"}</span>
                </div>
              </button>
              ${
                isCollapsed
                  ? ""
                  : `<div class="bucket-body">
                      ${b.description ? `<div class="bucket-desc">${esc(b.description)}</div>` : ""}
                      ${bucketCardsHtml}
                    </div>`
              }
            </div>
          `;
        })
        .join("");
    } else {
      const prefixes = Array.from(new Set(Object.values(DATA.units).map((u) => u.prefix).filter(Boolean))).sort();
      const q = state.catalogQuery.trim().toLowerCase();

      const allUnitsList = [
        ...Object.values(DATA.units),
        ...Object.values(plan.customUnits || {}).filter((cu) => !DATA.units[cu.code]),
      ].filter((u) => {
        if (state.catalogLevel !== "all" && String(u.level) !== state.catalogLevel) return false;
        if (state.catalogTri !== "all" && !(u.trimesters || []).includes(parseInt(state.catalogTri, 10))) return false;
        if (state.catalogPrefix !== "all" && u.prefix !== state.catalogPrefix) return false;
        if (q && !`${u.code} ${u.title} ${u.school}`.toLowerCase().includes(q)) return false;
        return true;
      });

      const topUnits = [];
      const bottomInelig = [];

      for (const u of allUnitsList) {
        if (state.targetSlot) {
          if (isUnitPlanned(u.code, plan)) topUnits.push(u);
          else if (slotIneligMap.has(u.code)) bottomInelig.push({ unit: u, reasons: slotIneligMap.get(u.code) });
          else topUnits.push(u);
        } else {
          const reasons = [];
          if (u.offered2027 === false) reasons.push("Not offered in 2027 (archived unit)");
          const pm = u.prereqMeta;
          if (course.studyLevel === "Undergraduate" && u.level >= 500) {
            reasons.push(`Restricted to Postgraduate candidature (${u.level}-level)`);
          } else if (pm?.pgOnly && course.studyLevel !== "Postgraduate") {
            reasons.push("Restricted to Postgraduate candidature");
          } else if (pm?.honoursOnly && course.studyLevel !== "Bachelor Honours") {
            reasons.push("Restricted to Honours candidature");
          } else if (pm?.courseRestricted) {
            reasons.push(`Restricted candidature (${pm.courseRestricted})`);
          }
          if (reasons.length > 0) bottomInelig.push({ unit: u, reasons });
          else topUnits.push(u);
        }
      }

      topUnits.sort((a, b) => a.code.localeCompare(b.code));
      bottomInelig.sort((a, b) => a.unit.code.localeCompare(b.unit.code));
      const showCatInelig = state.catalogShowIneligible || topUnits.length === 0 || q.length > 0;

      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:8px;position:sticky;top:0;background:var(--surface);padding-bottom:8px;z-index:5;border-bottom:1px solid var(--border);flex-shrink:0;">
          <input type="search" class="text-input" id="inp-catalog-search" placeholder="Search ${DATA.meta.counts.units.toLocaleString()} UNE units by code, title, school…" value="${esc(
            state.catalogQuery
          )}" style="width:100%;" />
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
            <select class="select-input" id="sel-cat-level">
              <option value="all">All Levels</option>
              ${[100, 200, 300, 400, 500]
                .map((l) => `<option value="${l}" ${state.catalogLevel === String(l) ? "selected" : ""}>L${l}</option>`)
                .join("")}
            </select>
            <select class="select-input" id="sel-cat-tri">
              <option value="all">Any Tri</option>
              <option value="1" ${state.catalogTri === "1" ? "selected" : ""}>T1</option>
              <option value="2" ${state.catalogTri === "2" ? "selected" : ""}>T2</option>
              <option value="3" ${state.catalogTri === "3" ? "selected" : ""}>T3</option>
            </select>
            <select class="select-input" id="sel-cat-prefix">
              <option value="all">All Prefixes</option>
              ${prefixes.map((p) => `<option value="${esc(p)}" ${state.catalogPrefix === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
            </select>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;color:var(--text-subtle);">
            <span id="cat-count-lbl">${topUnits.length} eligible${bottomInelig.length ? ` · ${bottomInelig.length} restricted below` : ""}</span>
            <button class="btn btn-sm" id="btn-open-custom-unit-2">+ Custom Unit</button>
          </div>
        </div>

        <div id="catalog-results-wrap" style="display:flex;flex-direction:column;gap:8px;">
          ${renderCatalogListInner(topUnits, bottomInelig, showCatInelig, course, plan, majorCoreHints)}
        </div>
      `;
    }

    sb.innerHTML = `
      <div class="sidebar-drawer-bar">
        <span style="font-weight:700;font-size:13px;">📚 ${esc(course.code)} Units &amp; Requirements</span>
        <button class="btn btn-sm btn-hdr" id="btn-close-tablet-drawer">Done ✕</button>
      </div>
      <div class="sidebar-tabs">
        ${
          state.targetSlot
            ? `<button class="sidebar-tab slot-tab ${state.sidebarTab === "slot" ? "active" : ""}" data-stab="slot">🎯 Slot Options</button>`
            : ""
        }
        <button class="sidebar-tab ${state.sidebarTab === "requirements" ? "active" : ""}" data-stab="requirements">📚 Requirements</button>
        <button class="sidebar-tab ${state.sidebarTab === "catalog" ? "active" : ""}" data-stab="catalog">🔍 All (${DATA.meta.counts.units.toLocaleString()})</button>
      </div>
      ${targetBanner}
      <div class="sidebar-body" id="sidebar-body-scroll">${bodyHtml}</div>
    `;

    // Restore exact scroll position synchronously before paint!
    const nextBodyEl = document.getElementById("sidebar-body-scroll");
    if (nextBodyEl) nextBodyEl.scrollTop = savedInnerScroll;
    sb.scrollTop = savedOuterScroll;

    const closeDrw = document.getElementById("btn-close-tablet-drawer");
    if (closeDrw) {
      closeDrw.onclick = () => {
        state.tabletDrawerOpen = false;
        syncResponsiveClasses();
      };
    }

    sb.querySelectorAll("[data-stab]").forEach((btn) => {
      btn.onclick = () => {
        const nextTab = btn.dataset.stab;
        const changed = state.sidebarTab !== nextTab;
        state.sidebarTab = nextTab;
        renderSidebar(course, plan, report, { resetScroll: changed });
      };
    });

    const retSlotBtn = document.getElementById("btn-return-slot-tab");
    if (retSlotBtn) {
      retSlotBtn.onclick = () => {
        state.sidebarTab = "slot";
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }

    const cancelTargetBtn = document.getElementById("btn-cancel-target");
    if (cancelTargetBtn) {
      cancelTargetBtn.onclick = () => {
        exitSlotPicker();
        renderAll({ resetSidebarScroll: false });
      };
    }

    const exitSlotBtn = document.getElementById("btn-exit-slot");
    if (exitSlotBtn) {
      exitSlotBtn.onclick = () => {
        exitSlotPicker();
        if (isMobileViewport()) state.mobilePane = "plan";
        if (isTabletViewport()) state.tabletDrawerOpen = false;
        renderAll({ resetSidebarScroll: true });
      };
    }

    const slotSearchInp = document.getElementById("inp-slot-search");
    if (slotSearchInp && slotEval) {
      const updateSlotInPlace = () => {
        state.slotQuery = slotSearchInp.value;
        const wrap = document.getElementById("slot-results-wrap");
        if (!wrap) return;
        const q2 = state.slotQuery.trim().toLowerCase();
        const hasBoth2 = slotEval.spec.allowsElectives && slotEval.spec.coursePoolMap && slotEval.spec.coursePoolMap.size > 0;
        const filter2 = (item) => {
          if (state.slotLevelFilter !== "all" && String(item.unit.level) !== state.slotLevelFilter) return false;
          if (hasBoth2) {
            if (state.slotPoolFilter === "course" && !item.inCoursePool) return false;
            if (state.slotPoolFilter === "elective" && item.inCoursePool) return false;
          }
          if (q2 && !`${item.code} ${item.unit.title} ${item.poolLabel} ${item.unit.school}`.toLowerCase().includes(q2)) return false;
          return true;
        };
        const fe = slotEval.eligible.filter(filter2);
        const fi = slotEval.ineligible.filter(filter2);
        const autoExp = state.slotShowIneligible || fe.length === 0 || q2.length > 0;
        wrap.innerHTML = renderSlotListInner(slotEval, fe, fi, autoExp);
        const tBtn = document.getElementById("btn-toggle-slot-inelig");
        if (tBtn) {
          tBtn.onclick = () => {
            state.slotShowIneligible = !state.slotShowIneligible;
            updateSlotInPlace();
          };
        }
        bindUnitTriggers(wrap, plan);
      };
      slotSearchInp.addEventListener("input", updateSlotInPlace);
      slotSearchInp.addEventListener("search", updateSlotInPlace);
      slotSearchInp.addEventListener("compositionend", updateSlotInPlace);
    }
    const slotLvlSel = document.getElementById("sel-slot-level");
    if (slotLvlSel) {
      slotLvlSel.onchange = (e) => {
        state.slotLevelFilter = e.target.value;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }
    sb.querySelectorAll("[data-spool]").forEach((btn) => {
      btn.onclick = () => {
        state.slotPoolFilter = btn.dataset.spool;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    });
    const forceElecChk = document.getElementById("chk-slot-force-elec");
    if (forceElecChk) {
      forceElecChk.onchange = (e) => {
        state.slotForceElectives = e.target.checked;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }
    const toggleSlotInelig = document.getElementById("btn-toggle-slot-inelig");
    if (toggleSlotInelig) {
      toggleSlotInelig.onclick = () => {
        state.slotShowIneligible = !state.slotShowIneligible;
        renderSidebar(course, plan, report, { resetScroll: false });
      };
    }
    const toggleCatInelig = document.getElementById("btn-toggle-cat-inelig");
    if (toggleCatInelig) {
      toggleCatInelig.onclick = () => {
        state.catalogShowIneligible = !state.catalogShowIneligible;
        renderSidebar(course, plan, report, { resetScroll: false });
      };
    }

    sb.querySelectorAll("[data-toggle-bucket]").forEach((btn) => {
      btn.onclick = () => {
        const bid = btn.dataset.toggleBucket;
        state.collapsedBuckets[bid] = !state.collapsedBuckets[bid];
        renderSidebar(course, plan, report, { resetScroll: false });
      };
    });

    const jumpBtn = document.getElementById("btn-jump-catalog");
    if (jumpBtn) {
      jumpBtn.onclick = () => {
        state.sidebarTab = "catalog";
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }

    ["btn-open-custom-unit", "btn-open-custom-unit-2", "btn-slot-custom"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.onclick = openCustomUnitModal;
    });

    const searchInp = document.getElementById("inp-catalog-search");
    if (searchInp) {
      const updateCatInPlace = () => {
        state.catalogQuery = searchInp.value;
        const wrap = document.getElementById("catalog-results-wrap");
        if (!wrap) return;
        const q2 = state.catalogQuery.trim().toLowerCase();
        const allList2 = [
          ...Object.values(DATA.units),
          ...Object.values(plan.customUnits || {}).filter((cu) => !DATA.units[cu.code]),
        ].filter((u) => {
          if (state.catalogLevel !== "all" && String(u.level) !== state.catalogLevel) return false;
          if (state.catalogTri !== "all" && !(u.trimesters || []).includes(parseInt(state.catalogTri, 10))) return false;
          if (state.catalogPrefix !== "all" && u.prefix !== state.catalogPrefix) return false;
          if (q2 && !`${u.code} ${u.title} ${u.school}`.toLowerCase().includes(q2)) return false;
          return true;
        });
        const top2 = [];
        const bot2 = [];
        for (const u of allList2) {
          if (state.targetSlot) {
            if (isUnitPlanned(u.code, plan)) top2.push(u);
            else if (slotIneligMap.has(u.code)) bot2.push({ unit: u, reasons: slotIneligMap.get(u.code) });
            else top2.push(u);
          } else {
            const reasons = [];
            if (u.offered2027 === false) reasons.push("Not offered in 2027 (archived unit)");
            const pm = u.prereqMeta;
            if (course.studyLevel === "Undergraduate" && u.level >= 500) reasons.push(`Restricted to Postgraduate candidature (${u.level}-level)`);
            else if (pm?.pgOnly && course.studyLevel !== "Postgraduate") reasons.push("Restricted to Postgraduate candidature");
            else if (pm?.honoursOnly && course.studyLevel !== "Bachelor Honours") reasons.push("Restricted to Honours candidature");
            else if (pm?.courseRestricted) reasons.push(`Restricted candidature (${pm.courseRestricted})`);
            if (reasons.length > 0) bot2.push({ unit: u, reasons });
            else top2.push(u);
          }
        }
        top2.sort((a, b) => a.code.localeCompare(b.code));
        bot2.sort((a, b) => a.unit.code.localeCompare(b.unit.code));
        const showIn = state.catalogShowIneligible || top2.length === 0 || q2.length > 0;
        const cLbl = document.getElementById("cat-count-lbl");
        if (cLbl) cLbl.textContent = `${top2.length} eligible${bot2.length ? ` · ${bot2.length} restricted below` : ""}`;
        wrap.innerHTML = renderCatalogListInner(top2, bot2, showIn, course, plan, majorCoreHints);
        const tBtn = document.getElementById("btn-toggle-cat-inelig");
        if (tBtn) {
          tBtn.onclick = () => {
            state.catalogShowIneligible = !state.catalogShowIneligible;
            updateCatInPlace();
          };
        }
        bindUnitTriggers(wrap, plan);
      };
      searchInp.addEventListener("input", updateCatInPlace);
      searchInp.addEventListener("search", updateCatInPlace);
      searchInp.addEventListener("compositionend", updateCatInPlace);
    }
    const lvlSel = document.getElementById("sel-cat-level");
    if (lvlSel) {
      lvlSel.onchange = (e) => {
        state.catalogLevel = e.target.value;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }
    const triSel = document.getElementById("sel-cat-tri");
    if (triSel) {
      triSel.onchange = (e) => {
        state.catalogTri = e.target.value;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }
    const prefSel = document.getElementById("sel-cat-prefix");
    if (prefSel) {
      prefSel.onchange = (e) => {
        state.catalogPrefix = e.target.value;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }

    bindUnitTriggers(sb, plan);
  }

  function renderSlotListInner(slotEval, filteredEligible, filteredIneligible, autoExpandInelig) {
    return `
      <div class="elig-category-hdr">
        <span>✅ Eligible for Y${slotEval.yearNum} · T${slotEval.triNum}</span>
        <span>${filteredEligible.length} unit${filteredEligible.length === 1 ? "" : "s"}</span>
      </div>

      ${
        filteredEligible.length === 0
          ? `<div style="padding:12px;border:1px dashed var(--border-strong);border-radius:8px;font-size:12px;color:var(--text-subtle);text-align:center;">
              No eligible units match for Y${slotEval.yearNum} · T${slotEval.triNum}. See reasons in the Ineligible section below.
            </div>`
          : filteredEligible.slice(0, 100).map((item) => renderSlotEligibleCard(item)).join("")
      }

      ${
        filteredIneligible.length > 0
          ? `
            <button class="inelig-category-toggle" id="btn-toggle-slot-inelig">
              <span>🚫 Ineligible for Y${slotEval.yearNum} · T${slotEval.triNum} (${filteredIneligible.length})</span>
              <span style="font-size:11px;">${autoExpandInelig ? "Hide ▴" : "Show why ▾"}</span>
            </button>
            ${
              autoExpandInelig
                ? filteredIneligible
                    .slice(0, 80)
                    .map((item) => renderIneligibleUnitCard(item.code, item.unit, item.reasons, item.poolLabel, true))
                    .join("")
                : ""
            }
          `
          : ""
      }
    `;
  }

  function renderCatalogListInner(topUnits, bottomInelig, showCatInelig, course, plan, majorCoreHints) {
    return `
      ${topUnits.slice(0, 80).map((u) => renderPoolUnitCard(u.code, plan, majorCoreHints)).join("")}

      ${
        bottomInelig.length > 0
          ? `
            <button class="inelig-category-toggle" id="btn-toggle-cat-inelig">
              <span>🚫 ${
                state.targetSlot
                  ? `Ineligible for Y${plan.years[state.targetSlot.yearIdx]?.yearNum || 1} · T${state.targetSlot.triNum}`
                  : `Restricted / Not Eligible for ${course.code}`
              } (${bottomInelig.length})</span>
              <span style="font-size:11px;">${showCatInelig ? "Hide ▴" : "Show reasons ▾"}</span>
            </button>
            ${
              showCatInelig
                ? bottomInelig
                    .slice(0, 60)
                    .map((it) => renderIneligibleUnitCard(it.unit.code, it.unit, it.reasons, null, false))
                    .join("")
                : ""
            }
          `
          : ""
      }
    `;
  }

  function renderSlotEligibleCard(item) {
    const u = item.unit;
    return `
      <div class="pool-unit ${item.majorRequiredBy ? "major-req" : ""}" draggable="true" data-drag-pool-code="${esc(item.code)}">
        <div class="pool-unit-top">
          <button class="unit-code-link" data-inspect-unit="${esc(item.code)}">${esc(item.code)} · ${u.cp} CP</button>
          <button class="btn btn-sm btn-primary" data-add-unit="${esc(item.code)}">Select →</button>
        </div>
        <div class="pool-unit-title">${esc(u.title)}</div>
        <div class="pool-unit-meta">
          <div class="tri-pills">
            <span class="badge-mini" style="${
              item.inCoursePool
                ? "background:var(--primary-soft);color:var(--primary);border:1px solid var(--primary-border);"
                : "background:var(--surface-alt);color:var(--text-subtle);border:1px solid var(--border);"
            }">${esc(item.poolLabel)}</span>
            ${item.helpsLevelMin ? `<span class="badge-mini" style="background:var(--cat-major1-bg);color:var(--cat-major1);border:1px solid var(--cat-major1);">L${u.level} Target</span>` : ""}
            ${u.intensive === "Mandatory" ? `<span class="badge-mini badge-intensive">Intensive</span>` : ""}
            ${item.modeWarning ? `<span class="badge-mini badge-intensive">${esc(item.modeWarning)}</span>` : ""}
          </div>
          <div class="tri-pills">${(u.trimesters || []).map((t) => `<span class="tri-pill active-tri">T${t}</span>`).join("")}</div>
        </div>
      </div>
    `;
  }

  function renderIneligibleUnitCard(code, u, reasons, poolLabel, allowOverride) {
    if (!u) return "";
    return `
      <div class="pool-unit ineligible-card">
        <div class="pool-unit-top">
          <button class="unit-code-link" data-inspect-unit="${esc(code)}">${esc(code)} · ${u.cp} CP</button>
          <div style="display:flex;align-items:center;gap:4px;">
            ${poolLabel ? `<span style="font-size:10px;color:var(--text-subtle);">${esc(poolLabel)}</span>` : ""}
            ${
              allowOverride && u.offered2027 !== false
                ? `<button class="btn btn-sm" style="padding:1px 6px;font-size:10.5px;min-height:24px;color:var(--text-subtle);" data-add-unit="${esc(code)}" title="Add with manual override">Override</button>`
                : ""
            }
          </div>
        </div>
        <div class="pool-unit-title">${esc(u.title)}</div>
        <div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
          ${reasons
            .map(
              (r) =>
                `<div class="inelig-reason-pill ${
                  r.startsWith("Pre-requisite") || r.startsWith("Requires") || r.startsWith("Co-requisite") ? "soft" : ""
                }">${
                  r.startsWith("Not offered") || r.startsWith("Restricted") || r.startsWith("Incompatible") || r.startsWith("Cannot") || r.startsWith("Exceeds")
                    ? "⛔"
                    : "⚠"
                } ${esc(r)}</div>`
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderPoolUnitCard(code, plan, majorCoreHints) {
    const u = Engine.getUnit(code, DATA, plan.customUnits);
    if (!u) return "";
    const plannedLoc = isUnitPlanned(code, plan);
    const reqByMajors = majorCoreHints.mandatory[code] || null;
    const choiceMajors = majorCoreHints.choiceGroups
      .filter((g) => g.codes.includes(code))
      .map((g) => `${g.majorTitle} (${g.codes.join("/")})`);

    return `
      <div class="pool-unit ${plannedLoc ? "planned" : ""} ${reqByMajors ? "major-req" : ""}"
           draggable="${!plannedLoc && u.offered2027 !== false}"
           data-drag-pool-code="${esc(code)}">
        <div class="pool-unit-top">
          <button class="unit-code-link" data-inspect-unit="${esc(code)}">${esc(code)} · ${u.cp} CP</button>
          ${
            plannedLoc
              ? `<span class="badge-mini" style="background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-border);">✓ ${esc(plannedLoc)}</span>`
              : u.offered2027 === false
              ? `<span class="badge-mini badge-archived">Not offered 2027</span>`
              : `<button class="btn btn-sm btn-soft" data-add-unit="${esc(code)}">+ Add</button>`
          }
        </div>
        <div class="pool-unit-title">${esc(u.title)}</div>
        <div class="pool-unit-meta">
          <div class="tri-pills">
            ${[1, 2, 3]
              .map((t) =>
                (u.trimesters || []).includes(t)
                  ? `<span class="tri-pill active-tri">T${t}</span>`
                  : `<span class="tri-pill" style="opacity:0.35;">T${t}</span>`
              )
              .join("")}
            ${u.intensive === "Mandatory" ? `<span class="badge-mini badge-intensive">Intensive</span>` : ""}
            ${reqByMajors ? `<span class="badge-mini badge-major-req">Req: ${esc(reqByMajors.join(", "))}</span>` : ""}
            ${!reqByMajors && choiceMajors.length ? `<span class="badge-mini badge-major-req">Choice: ${esc(choiceMajors[0])}</span>` : ""}
          </div>
          ${u.prereqText ? `<span style="font-size:10.5px;color:var(--text-subtle);" title="Prerequisite: ${esc(u.prereqText)}">Prereq ⓘ</span>` : ""}
        </div>
      </div>
    `;
  }

  /* ==========================================================================
     5. TRIMESTER BOARD + MOBILE TRIMESTER FILTER
     ========================================================================== */
  function renderBoard(course, plan, report) {
    const board = document.getElementById("board-area");
    const { buckets, attributedBucketByCode } = report.resolved;
    const bucketMap = Object.fromEntries(buckets.map((b) => [b.id, b]));
    const openPlaceholders = findOpenPlaceholders(plan);

    const pctUnits = Math.min(100, (report.unitCp / report.targetCp) * 100);
    const pctAdv = Math.min(100 - pctUnits, (report.advancedStandingCp / report.targetCp) * 100);
    const pctPh = Math.min(100 - pctUnits - pctAdv, (report.placeholderCp / report.targetCp) * 100);

    let statusBadge = `<span class="status-pill progress">In Progress (${report.totalPlannedCp} / ${report.targetCp} CP)</span>`;
    if (report.isAwardReady) {
      statusBadge = `<span class="status-pill ready">✓ Award Requirements Met (${report.targetCp} CP)</span>`;
    } else if (report.unitErrorCount > 0 || report.resolved.incompatiblePairWarning) {
      statusBadge = `<span class="status-pill attention" style="background:var(--err-bg);color:var(--err);border-color:var(--err-border);">⚠ ${
        report.unitErrorCount + (report.resolved.incompatiblePairWarning ? 1 : 0)
      } Enrolment Issue(s)</span>`;
    } else if (openPlaceholders.length > 0) {
      statusBadge = `<button class="btn btn-sm btn-soft" id="btn-jump-next-placeholder">🎯 Fill Open Slots (${openPlaceholders.length} left) →</button>`;
    }

    const levelRulesHtml = report.levelChecks
      .map(
        (lc) => `
        <span class="rule-check-pill ${lc.passed ? "ok" : "fail"}">
          <span>${lc.passed ? "✓" : "•"}</span>
          <span>${esc(lc.label)}: <strong>${esc(lc.targetText)}</strong></span>
        </span>
      `
      )
      .join("");

    const allDiagnostics = [...report.globalIssues];
    const progressHtml = `
      <div class="progress-card">
        <div class="progress-top">
          <div class="cp-headline">
            <span class="cp-big">${report.totalPlannedCp} / ${report.targetCp} CP</span>
            <span style="font-size:12px;color:var(--text-subtle);">
              (${report.unitCp} CP units${report.advancedStandingCp ? ` + ${report.advancedStandingCp} CP Adv. Standing` : ""}${
      report.placeholderCp ? ` + ${report.placeholderCp} CP open slots` : ""
    })
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            ${statusBadge}
            <a href="${esc(course.url)}" target="_blank" rel="noopener" class="btn btn-sm no-print">Handbook ↗</a>
          </div>
        </div>

        <div class="progress-bar-track">
          <div class="progress-seg" style="width:${pctAdv}%;background:var(--cat-minor);"></div>
          <div class="progress-seg" style="width:${pctUnits}%;background:var(--primary);"></div>
          <div class="progress-seg" style="width:${pctPh}%;background:var(--border-strong);"></div>
        </div>

        <div class="rules-pills-row">
          ${levelRulesHtml}
          <span class="rule-check-pill">
            <span>Levels:</span>
            ${Object.entries(report.cpByLevel)
              .filter(([, v]) => v > 0)
              .map(([lvl, v]) => `<span>L${lvl}: <strong>${v}</strong></span>`)
              .join(" · ") || "<span>0 CP</span>"}
          </span>
        </div>

        ${
          allDiagnostics.length > 0
            ? `<div class="diagnostics-box">
                ${allDiagnostics
                  .map(
                    (iss) => `
                  <div class="diag-item ${iss.severity}">
                    <span>${iss.severity === "error" ? "⛔" : iss.severity === "warning" ? "⚠️" : "ℹ️"} ${esc(iss.text)}</span>
                    ${
                      iss.actionUnit && !isUnitPlanned(iss.actionUnit, plan)
                        ? `<button class="btn btn-sm" data-add-unit="${esc(iss.actionUnit)}">+ Add ${esc(iss.actionUnit)}</button>`
                        : iss.actionT3Spread
                        ? `<button class="btn btn-sm btn-soft" id="btn-switch-t3-spread">🌿 Use Spread Load (3+3+2)</button>`
                        : ""
                    }
                  </div>
                `
                  )
                  .join("")}
              </div>`
            : ""
        }
      </div>
    `;

    const isBoardCompletelyEmpty = report.totalPlannedCp - report.advancedStandingCp === 0;
    const emptyWelcome = isBoardCompletelyEmpty
      ? `
      <div class="no-print" style="background:var(--surface);border:1.5px dashed var(--primary);border-radius:var(--radius-lg);padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:14px;">Ready to plan <strong>${esc(course.title)}</strong> (${esc(course.code)})?</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            Choose your Major/Rule above and click <strong>Auto-Plan</strong>, load an <strong>Official UNE Plan</strong>, or pick units directly into any Trimester below.
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="btn-empty-auto">✨ Smart Auto-Plan</button>
          ${
            Engine.getAvailableStudyPlans(course, plan, DATA).length
              ? `<button class="btn" id="btn-empty-templates">📋 Official Plans</button>`
              : ""
          }
        </div>
      </div>
    `
      : "";

    const mobileTriBar = `
      <div class="mobile-tri-filter no-print">
        <span class="config-label">Show Trimester</span>
        <div class="seg-group">
          ${[
            ["all", "All"],
            ["1", "T1"],
            ["2", "T2"],
            ["3", "T3"],
          ]
            .map(
              ([val, lbl]) =>
                `<button class="seg-btn ${state.mobileTriFilter === val ? "active" : ""}" data-mtri="${val}">${lbl}</button>`
            )
            .join("")}
        </div>
      </div>
    `;

    const yearsHtml = (plan.years || [])
      .map((yr, yIdx) => {
        const yrTotalCp = [1, 2, 3].reduce((s, t) => s + (report.trimesterLoads[`${yIdx}_${t}`]?.cp || 0), 0);
        return `
          <div class="year-card">
            <div class="year-header">
              <div class="year-title">
                <span>📅 ${esc(yr.name)}</span>
                <span class="tri-load-badge">${yrTotalCp} CP</span>
              </div>
              <div class="no-print" style="display:flex;gap:6px;">
                ${plan.years.length > 1 ? `<button class="btn btn-sm" data-remove-year="${yIdx}">Remove</button>` : ""}
              </div>
            </div>
            <div class="trimester-grid">
              ${[1, 2, 3]
                .map((tNum) => {
                  const slots = yr.trimesters[tNum] || [];
                  const tLoad = report.trimesterLoads[`${yIdx}_${tNum}`] || { cp: 0, intensives: 0 };
                  const isTarget =
                    state.targetSlot &&
                    state.targetSlot.yearIdx === yIdx &&
                    state.targetSlot.triNum === tNum &&
                    !state.targetSlot.replaceSlotId;
                  const mobHidden = state.mobileTriFilter !== "all" && state.mobileTriFilter !== String(tNum);

                  return `
                    <div class="tri-col ${isTarget ? "target-active" : ""} ${mobHidden ? "mobile-hidden-tri" : ""}"
                         data-drop-year="${yIdx}"
                         data-drop-tri="${tNum}">
                      <div class="tri-col-header">
                        <div>
                          <span class="tri-name">Trimester ${tNum}</span>
                          ${
                            tLoad.intensives > 0
                              ? `<span class="badge-mini badge-intensive" style="margin-left:4px;">${tLoad.intensives} Intensive</span>`
                              : ""
                          }
                        </div>
                        <span class="tri-load-badge ${tLoad.cp > 24 ? "overload" : ""}">${tLoad.cp} CP</span>
                      </div>
                      <div class="tri-slots">
                        ${slots
                          .map((slot) => renderBoardSlot(slot, yIdx, tNum, plan, report, bucketMap, attributedBucketByCode))
                          .join("")}
                        <div class="tri-empty-drop no-print" data-pick-target="${yIdx}_${tNum}">
                          ${isTarget ? "🎯 Picking unit…" : "+ Tap to pick eligible unit"}
                        </div>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");

    const footerControls = `
      <div class="no-print" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <button class="btn" id="btn-add-year">+ Add Year ${(plan.years?.length || 0) + 1}</button>
        <button class="btn" id="btn-clear-board" style="color:var(--err);">🗑 Clear Board</button>
      </div>
    `;

    board.innerHTML = progressHtml + emptyWelcome + mobileTriBar + yearsHtml + footerControls;

    const jumpNextPh = document.getElementById("btn-jump-next-placeholder");
    if (jumpNextPh && openPlaceholders.length > 0) {
      jumpNextPh.onclick = () => {
        activateSlotPicker(openPlaceholders[0], true);
        renderAll({ resetSidebarScroll: true });
      };
    }

    const switchSpreadBtn = document.getElementById("btn-switch-t3-spread");
    if (switchSpreadBtn) {
      switchSpreadBtn.onclick = () => {
        plan.t3Strategy = "spread";
        plan.includeT3InAuto = true;
        const updated = Engine.autoSchedulePlan(course, plan, DATA);
        state.savedPlansByCourse[course.code] = updated;
        saveState();
        renderAll({ resetSidebarScroll: false });
        showToast("Switched T3 to Spread Load (lighter 18 CP trimesters where possible)!");
      };
    }

    const emptyAuto = document.getElementById("btn-empty-auto");
    if (emptyAuto) emptyAuto.onclick = runSmartAutoPlan;
    const emptyTpl = document.getElementById("btn-empty-templates");
    if (emptyTpl) emptyTpl.onclick = openStudyPlansModal;

    board.querySelectorAll("[data-mtri]").forEach((btn) => {
      btn.onclick = () => {
        state.mobileTriFilter = btn.dataset.mtri;
        renderBoard(course, plan, report);
      };
    });

    document.getElementById("btn-add-year").onclick = () => {
      const n = plan.years.length + 1;
      plan.years.push({
        id: Engine.uid("yr"),
        yearNum: n,
        name: `Year ${n} (${2026 + n})`,
        trimesters: { 1: [], 2: [], 3: [] },
      });
      saveState();
      renderAll({ resetSidebarScroll: false });
    };

    document.getElementById("btn-clear-board").onclick = () => {
      plan.years.forEach((yr) => {
        yr.trimesters = { 1: [], 2: [], 3: [] };
      });
      exitSlotPicker();
      saveState();
      renderAll({ resetSidebarScroll: false });
    };

    board.querySelectorAll("[data-remove-year]").forEach((btn) => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.removeYear, 10);
        plan.years.splice(idx, 1);
        plan.years.forEach((y, i) => {
          y.yearNum = i + 1;
          y.name = `Year ${i + 1} (${2027 + i})`;
        });
        exitSlotPicker();
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    });

    board.querySelectorAll("[data-pick-target]").forEach((el) => {
      el.onclick = () => {
        const [yIdx, tNum] = el.dataset.pickTarget.split("_").map(Number);
        if (
          state.targetSlot &&
          state.targetSlot.yearIdx === yIdx &&
          state.targetSlot.triNum === tNum &&
          !state.targetSlot.replaceSlotId
        ) {
          exitSlotPicker();
          renderAll({ resetSidebarScroll: false });
        } else {
          activateSlotPicker(
            {
              yearIdx: yIdx,
              triNum: tNum,
              label: `Add Unit to Year ${plan.years[yIdx]?.yearNum || yIdx + 1} · Trimester ${tNum}`,
            },
            true
          );
          renderAll({ resetSidebarScroll: true });
        }
      };
    });

    board.querySelectorAll("[data-resolve-placeholder]").forEach((btn) => {
      btn.onclick = () => {
        const [yIdx, tNum, slotId] = btn.dataset.resolvePlaceholder.split("|");
        const yr = plan.years[Number(yIdx)];
        const ph = (yr?.trimesters[Number(tNum)] || []).find((s) => s.id === slotId);
        activateSlotPicker(
          {
            yearIdx: Number(yIdx),
            triNum: Number(tNum),
            replaceSlotId: slotId,
            label: ph?.label || "Listed or Elective Unit",
            slotKind: ph?.slotKind || "",
            hintCodes: ph?.hintCodes || [],
          },
          true
        );
        renderAll({ resetSidebarScroll: true });
      };
    });

    board.querySelectorAll("[data-remove-slot]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const [yIdx, tNum, slotId] = btn.dataset.removeSlot.split("|");
        removeSlot(Number(yIdx), Number(tNum), slotId);
      };
    });

    board.querySelectorAll("[data-move-slot]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const [yIdx, tNum, slotId, delta] = btn.dataset.moveSlot.split("|");
        moveSlotStep(Number(yIdx), Number(tNum), slotId, Number(delta));
      };
    });

    bindUnitTriggers(board, plan);
    bindDropZones(board, plan);
  }

  function renderBoardSlot(slot, yIdx, tNum, plan, report, bucketMap, attributedBucketByCode) {
    if (slot.type === "placeholder") {
      const isSelected = state.targetSlot && state.targetSlot.replaceSlotId === slot.id;
      return `
        <div class="slot-placeholder" style="${
          isSelected ? "border-color:var(--info);background:var(--info-bg);box-shadow:0 0 0 2px var(--info-border);" : ""
        }">
          <div class="slot-top">
            <span style="font-weight:700;font-size:12px;color:${isSelected ? "var(--info)" : "var(--text-muted)"};">
              🎯 ${esc(slot.label)} (${slot.cp || 6} CP)
            </span>
            <button class="icon-action remove no-print" data-remove-slot="${yIdx}|${tNum}|${esc(slot.id)}" title="Remove slot">✕</button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span style="font-size:11px;color:var(--text-subtle);">${isSelected ? "Choosing eligible unit…" : "Tap to pick valid unit"}</span>
            <button class="btn btn-sm ${isSelected ? "btn-primary" : "btn-soft"} no-print" data-resolve-placeholder="${yIdx}|${tNum}|${esc(
        slot.id
      )}">Choose Unit →</button>
          </div>
        </div>
      `;
    }

    const u = Engine.getUnit(slot.code, DATA, plan.customUnits);
    const bId = attributedBucketByCode[slot.code];
    const bucket = bucketMap[bId];
    const cat = bucket?.category || "elective";
    const diag = report.slotDiagnostics[slot.id] || { errors: [], warnings: [], infos: [] };
    const statusCls = diag.errors.length ? "has-error" : diag.warnings.length ? "has-warning" : "";

    return `
      <div class="slot-card cat-${cat} ${statusCls}" draggable="true" data-drag-board="${yIdx}|${tNum}|${esc(slot.id)}|${esc(slot.code)}">
        <div class="slot-top">
          <button class="unit-code-link" data-inspect-unit="${esc(slot.code)}">
            ${esc(slot.code)} <span style="font-weight:500;color:var(--text-subtle);">· ${u ? u.cp : (slot.cp || 6)} CP</span>
          </button>
          <div class="slot-actions no-print">
            <button class="icon-action" data-move-slot="${yIdx}|${tNum}|${esc(slot.id)}|-1" title="Move earlier">◀</button>
            <button class="icon-action" data-move-slot="${yIdx}|${tNum}|${esc(slot.id)}|1" title="Move later">▶</button>
            <button class="icon-action remove" data-remove-slot="${yIdx}|${tNum}|${esc(slot.id)}" title="Remove unit">✕</button>
          </div>
        </div>
        <div class="slot-title">${esc(u ? u.title : slot.code)}</div>
        <div class="slot-footer">
          <span class="cat-tag cat-${cat}">${esc(CAT_LABELS[cat] || "Unit")}</span>
          <div class="tri-pills">${
            u ? (u.trimesters || []).map((t) => `<span class="tri-pill ${t === tNum ? "active-tri" : ""}">T${t}</span>`).join("") : ""
          }</div>
        </div>
        ${diag.errors.map((m) => `<div class="slot-msg err">⛔ ${esc(m)}</div>`).join("")}
        ${diag.warnings.map((m) => `<div class="slot-msg warn">⚠ ${esc(m)}</div>`).join("")}
        ${diag.infos.map((m) => `<div class="slot-msg info">ℹ ${esc(m)}</div>`).join("")}
      </div>
    `;
  }

  /* ==========================================================================
     6. MOBILE BOTTOM NAVIGATION BAR (< 768px)
     ========================================================================== */
  function renderMobileBottomNav(course, plan) {
    const nav = document.getElementById("mobile-bottom-nav");
    const hasSlotDot = state.view === "planner" && (!!state.targetSlot || findOpenPlaceholders(plan).length > 0);

    nav.innerHTML = `
      <button class="mob-nav-btn ${state.view === "finder" ? "active" : ""}" id="mnav-find">
        <span class="mob-ico">🎓</span>
        <span>Find (${DATA.meta.counts.courses})</span>
      </button>
      <button class="mob-nav-btn ${state.view === "planner" && state.mobilePane === "plan" ? "active" : ""}" id="mnav-plan">
        <span class="mob-ico">📅</span>
        <span>My Plan</span>
      </button>
      <button class="mob-nav-btn ${state.view === "planner" && state.mobilePane === "units" ? "active" : ""}" id="mnav-units">
        <span class="mob-ico">📚</span>
        <span>${state.targetSlot ? "Slot Pick" : "Units"}</span>
        ${hasSlotDot ? `<span class="mob-badge-dot"></span>` : ""}
      </button>
      <button class="mob-nav-btn" id="mnav-tools">
        <span class="mob-ico">⚙️</span>
        <span>Tools</span>
      </button>
    `;

    document.getElementById("mnav-find").onclick = () => {
      state.view = "finder";
      renderAll({ resetSidebarScroll: false });
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    document.getElementById("mnav-plan").onclick = () => {
      state.view = "planner";
      state.mobilePane = "plan";
      renderAll({ resetSidebarScroll: false });
    };
    document.getElementById("mnav-units").onclick = () => {
      state.view = "planner";
      state.mobilePane = "units";
      renderAll({ resetSidebarScroll: false });
    };
    document.getElementById("mnav-tools").onclick = openMobileToolsSheet;
  }

  function openMobileToolsSheet() {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const spCount = Engine.getAvailableStudyPlans(course, plan, DATA).length;
    openModal(
      `<div style="font-weight:800;font-size:15px;">⚙️ ${esc(course.code)} Tools &amp; Actions</div>`,
      `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;">
          <button class="course-card-option" id="mtool-auto">
            <div style="font-weight:700;">✨ Smart Auto-Plan</div>
            <div style="font-size:11px;color:var(--text-subtle);">Build a valid schedule</div>
          </button>
          ${
            spCount
              ? `<button class="course-card-option" id="mtool-plans">
                  <div style="font-weight:700;">📋 Official Plans (${spCount})</div>
                  <div style="font-size:11px;color:var(--text-subtle);">UNE progression maps</div>
                </button>`
              : ""
          }
          <button class="course-card-option" id="mtool-info">
            <div style="font-weight:700;">📖 Rules &amp; Info</div>
            <div style="font-size:11px;color:var(--text-subtle);">Outcomes, ATAR, handbook</div>
          </button>
          <button class="course-card-option" id="mtool-export">
            <div style="font-weight:700;">⬇ Export / Save</div>
            <div style="font-size:11px;color:var(--text-subtle);">PDF, CSV, JSON, Reset</div>
          </button>
          <button class="course-card-option" id="mtool-custom">
            <div style="font-weight:700;">➕ Custom Elective</div>
            <div style="font-size:11px;color:var(--text-subtle);">Add any UNE unit</div>
          </button>
          <button class="course-card-option" id="mtool-theme">
            <div style="font-weight:700;">${document.documentElement.classList.contains("dark") ? "☀️ Light Mode" : "🌙 Dark Mode"}</div>
            <div style="font-size:11px;color:var(--text-subtle);">Switch appearance</div>
          </button>
        </div>
      `,
      (modal) => {
        modal.querySelector("#mtool-auto").onclick = () => {
          closeModal();
          state.view = "planner";
          state.mobilePane = "plan";
          runSmartAutoPlan();
        };
        const pBtn = modal.querySelector("#mtool-plans");
        if (pBtn) pBtn.onclick = () => { closeModal(); openStudyPlansModal(); };
        modal.querySelector("#mtool-info").onclick = () => { closeModal(); openCourseInfoModal(); };
        modal.querySelector("#mtool-export").onclick = () => { closeModal(); openExportModal(); };
        modal.querySelector("#mtool-custom").onclick = () => { closeModal(); openCustomUnitModal(); };
        modal.querySelector("#mtool-theme").onclick = () => {
          document.documentElement.classList.toggle("dark");
          localStorage.setItem(THEME_KEY, document.documentElement.classList.contains("dark") ? "dark" : "light");
          closeModal();
          renderAll({ resetSidebarScroll: false });
        };
      }
    );
  }

  /* ==========================================================================
     7. DRAG & DROP + MODALS
     ========================================================================== */
  function bindUnitTriggers(root, plan) {
    root.querySelectorAll("[data-add-unit]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        addUnitToPlan(btn.dataset.addUnit);
      };
    });
    root.querySelectorAll("[data-inspect-unit]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openUnitModal(btn.dataset.inspectUnit);
      };
    });
    root.querySelectorAll("[data-drag-pool-code]").forEach((el) => {
      el.ondragstart = (e) => {
        const code = el.dataset.dragPoolCode;
        state.dragging = { source: "pool", code };
        e.dataTransfer.setData("text/plain", code);
        highlightOfferingColumns(code, plan, true);
      };
      el.ondragend = () => {
        state.dragging = null;
        highlightOfferingColumns(null, plan, false);
      };
    });
    root.querySelectorAll("[data-drag-board]").forEach((el) => {
      el.ondragstart = (e) => {
        const [yIdx, tNum, slotId, code] = el.dataset.dragBoard.split("|");
        state.dragging = { source: "board", fromYearIdx: Number(yIdx), fromTriNum: Number(tNum), slotId, code };
        e.dataTransfer.setData("text/plain", code);
        highlightOfferingColumns(code, plan, true);
      };
      el.ondragend = () => {
        state.dragging = null;
        highlightOfferingColumns(null, plan, false);
      };
    });
  }

  function highlightOfferingColumns(code, plan, active) {
    const cols = document.querySelectorAll(".tri-col");
    if (!active || !code) {
      cols.forEach((c) => c.classList.remove("drag-valid", "drag-invalid"));
      return;
    }
    const u = Engine.getUnit(code, DATA, plan.customUnits);
    cols.forEach((col) => {
      const tNum = Number(col.dataset.dropTri);
      if (!u || !u.trimesters || u.trimesters.length === 0 || u.trimesters.includes(tNum)) col.classList.add("drag-valid");
      else col.classList.add("drag-invalid");
    });
  }

  function bindDropZones(board, plan) {
    board.querySelectorAll("[data-drop-year]").forEach((col) => {
      col.ondragover = (e) => e.preventDefault();
      col.ondrop = (e) => {
        e.preventDefault();
        const toY = Number(col.dataset.dropYear);
        const toT = Number(col.dataset.dropTri);
        const drag = state.dragging;
        highlightOfferingColumns(null, plan, false);
        if (!drag) return;
        if (drag.source === "pool") {
          if (isUnitPlanned(drag.code, plan)) {
            showToast(`${drag.code} is already on your board.`);
            return;
          }
          plan.years[toY].trimesters[toT].push({ id: Engine.uid("u"), type: "unit", code: drag.code });
        } else if (drag.source === "board") {
          const fromList = plan.years[drag.fromYearIdx]?.trimesters[drag.fromTriNum];
          if (!fromList) return;
          const idx = fromList.findIndex((s) => s.id === drag.slotId);
          if (idx === -1) return;
          const [moved] = fromList.splice(idx, 1);
          plan.years[toY].trimesters[toT].push(moved);
        }
        state.dragging = null;
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    });
  }

  function openModal(titleHtml, bodyHtml, onMount) {
    const backdrop = document.getElementById("modal-backdrop");
    backdrop.innerHTML = `
      <div class="modal-panel" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div style="min-width:0;flex:1;">${titleHtml}</div>
          <button class="btn btn-sm" id="btn-modal-close">✕ Close</button>
        </div>
        <div class="modal-body" id="modal-body-content">${bodyHtml}</div>
      </div>
    `;
    backdrop.classList.remove("hidden");
    document.getElementById("btn-modal-close").onclick = closeModal;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeModal();
    };
    if (onMount) onMount(backdrop);
  }

  function closeModal() {
    document.getElementById("modal-backdrop").classList.add("hidden");
  }

  function openUnitModal(code) {
    const plan = getCurrentPlan();
    const u = Engine.getUnit(code, DATA, plan.customUnits);
    if (!u) return;
    const plannedLoc = isUnitPlanned(code, plan);
    const colors = ["#1d7880", "#2774ae", "#95c236", "#b45309", "#b91c4a", "#6d28d9"];
    const assessBar = (u.assessments || [])
      .filter((a) => a.weight > 0)
      .map((a, i) => `<div style="width:${a.weight}%;background:${colors[i % colors.length]};" title="${esc(a.name)}: ${a.weight}%"></div>`)
      .join("");

    function linkifyCodes(txt) {
      if (!txt) return "<span style='color:var(--text-subtle);'>None</span>";
      return esc(txt).replace(/\b([A-Z]{2,4}\d{3}[A-Z]?)\b/g, (m) =>
        DATA.units[m]
          ? `<button class="unit-code-link" style="color:var(--primary);" data-jump-unit="${m}">${m}</button>`
          : `<strong>${m}</strong>`
      );
    }

    const addButtons = (plan.years || [])
      .map((yr, yIdx) =>
        [1, 2, 3]
          .filter((t) => !u.trimesters || !u.trimesters.length || u.trimesters.includes(t))
          .map((t) => `<button class="btn btn-sm btn-soft" data-modal-place="${yIdx}|${t}">+ Y${yr.yearNum} T${t}</button>`)
          .join(" ")
      )
      .join(" ");

    openModal(
      `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
         <span class="course-code-pill teal">${esc(u.code)}</span>
         <span style="font-weight:800;font-size:15.5px;">${esc(u.title)}</span>
       </div>
       <div style="font-size:12px;color:var(--text-subtle);margin-top:3px;">${u.cp} Credit Points · ${u.level}-Level · ${esc(u.school || "UNE")}</div>`,
      `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--surface-alt);padding:10px 12px;border-radius:8px;border:1px solid var(--border);">
          <div>
            ${
              plannedLoc
                ? `<span style="color:var(--ok);font-weight:700;">✓ Planned in ${esc(plannedLoc)}</span>`
                : u.offered2027 === false
                ? `<span style="color:var(--err);font-weight:700;">⛔ No 2027 Offering Published</span>`
                : `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-sm btn-primary" id="btn-modal-smart-add">${
                      state.targetSlot
                        ? `Select for Y${plan.years[state.targetSlot.yearIdx]?.yearNum || 1} T${state.targetSlot.triNum} →`
                        : "✨ Best Available Trimester"
                    }</button>
                    ${addButtons}
                  </div>`
            }
          </div>
          <a href="${esc(u.url)}" target="_blank" rel="noopener" class="btn btn-sm">Official 2027 Unit Page ↗</a>
        </div>
        ${u.overview ? `<div><div class="config-label" style="margin-bottom:4px;">Unit Description</div><div style="white-space:pre-line;color:var(--text-muted);">${esc(u.overview)}</div></div>` : ""}
        <div class="info-grid">
          <div class="info-stat"><div class="info-stat-label">Pre-requisites</div><div style="font-size:12.5px;margin-top:4px;">${linkifyCodes(u.prereqText)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Co-requisites</div><div style="font-size:12.5px;margin-top:4px;">${linkifyCodes(u.coreqText)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Restrictions / Exclusions</div><div style="font-size:12.5px;margin-top:4px;">${linkifyCodes(u.restrictionText)}</div></div>
        </div>
        ${u.assumedKnowledge ? `<div class="info-stat"><div class="info-stat-label">Assumed Knowledge</div><div style="font-size:12px;margin-top:3px;">${esc(u.assumedKnowledge)}</div></div>` : ""}
        <div>
          <div class="config-label" style="margin-bottom:6px;">2027 Offerings &amp; Intensive Schools</div>
          ${
            u.intensive
              ? `<div style="margin-bottom:8px;"><span class="badge-mini badge-intensive">${esc(u.intensive)} Intensive School${
                  u.intensiveDates?.length ? `: ${esc(u.intensiveDates.join(", "))}` : ""
                }</span></div>`
              : ""
          }
          ${
            (u.offerings || []).length
              ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:8px;">
                  ${u.offerings
                    .map(
                      (o) => `<div style="border:1px solid var(--border);border-radius:6px;padding:7px 10px;background:var(--surface-alt);">
                        <div style="font-weight:700;font-size:12.5px;">${esc(o.period)}</div>
                        <div style="font-size:11.5px;color:var(--text-muted);">${esc(o.modes.join(", ") || "Standard")} · ${esc(o.location || "UNE")}</div>
                      </div>`
                    )
                    .join("")}
                </div>`
              : `<div style="color:var(--text-subtle);font-size:12px;">No 2027 teaching periods listed.</div>`
          }
        </div>
        ${
          (u.assessments || []).length
            ? `<div>
                <div class="config-label" style="margin-bottom:6px;">Assessment Structure</div>
                ${assessBar ? `<div class="assess-bar" style="margin-bottom:8px;">${assessBar}</div>` : ""}
                <div style="display:flex;flex-direction:column;gap:5px;">
                  ${u.assessments
                    .map(
                      (a, idx) => `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;padding:5px 8px;background:var(--surface-alt);border-radius:5px;">
                        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[idx % colors.length]};margin-right:6px;"></span><strong>${esc(
                        a.name
                      )}</strong> ${a.hurdle ? `<span class="badge-mini badge-intensive" style="margin-left:4px;">Hurdle</span>` : ""}</span>
                        <strong>${a.weight ? `${a.weight}%` : "Pass/Fail"}</strong>
                      </div>`
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }
        ${
          (u.outcomes || []).length
            ? `<div>
                <div class="config-label" style="margin-bottom:6px;">Unit Learning Outcomes</div>
                <ul style="margin:0;padding-left:18px;color:var(--text-muted);font-size:12px;display:flex;flex-direction:column;gap:4px;">
                  ${u.outcomes.map((o) => `<li>${esc(o)}</li>`).join("")}
                </ul>
              </div>`
            : ""
        }
      `,
      (modal) => {
        const smartBtn = modal.querySelector("#btn-modal-smart-add");
        if (smartBtn) smartBtn.onclick = () => { closeModal(); addUnitToPlan(u.code); };
        modal.querySelectorAll("[data-modal-place]").forEach((b) => {
          b.onclick = () => {
            const [yIdx, tNum] = b.dataset.modalPlace.split("|").map(Number);
            plan.years[yIdx].trimesters[tNum].push({ id: Engine.uid("u"), type: "unit", code: u.code });
            saveState();
            closeModal();
            renderAll({ resetSidebarScroll: false });
          };
        });
        modal.querySelectorAll("[data-jump-unit]").forEach((b) => {
          b.onclick = () => openUnitModal(b.dataset.jumpUnit);
        });
      }
    );
  }

  function openStudyPlansModal() {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const plans = Engine.getAvailableStudyPlans(course, plan, DATA);
    const groups = {};
    for (const sp of plans) {
      groups[sp.group] = groups[sp.group] || [];
      groups[sp.group].push(sp);
    }
    openModal(
      `<div style="font-weight:800;font-size:15.5px;">Official UNE 2027 Progression Maps (${plans.length})</div>
       <div style="font-size:12px;color:var(--text-subtle);">Load an official UNE trimester template, then tap "Choose Unit →" on any placeholder slot.</div>`,
      Object.entries(groups)
        .map(
          ([grp, list]) => `
        <div>
          <div class="config-label" style="margin-bottom:6px;">${esc(grp)}</div>
          <div style="display:flex;flex-direction:column;gap:7px;">
            ${list
              .map(
                (sp) => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface-alt);">
                  <div>
                    <div style="font-weight:700;font-size:13px;">${esc(sp.title)}</div>
                    <div style="font-size:11.5px;color:var(--text-subtle);">${sp.years.length} Year(s) · Commencing T${sp.commencementTrimester} · ${esc(sp.loadType)}</div>
                  </div>
                  <button class="btn btn-sm btn-primary" data-load-sp="${esc(sp.id)}">Load</button>
                </div>`
              )
              .join("")}
          </div>
        </div>`
        )
        .join(""),
      (modal) => {
        modal.querySelectorAll("[data-load-sp]").forEach((btn) => {
          btn.onclick = () => {
            const loaded = Engine.applyOfficialStudyPlan(btn.dataset.loadSp, course, plan, DATA);
            state.savedPlansByCourse[course.code] = loaded;
            const openPh = findOpenPlaceholders(loaded);
            if (openPh.length > 0 && !isMobileViewport()) activateSlotPicker(openPh[0], !isTabletViewport());
            else exitSlotPicker();
            state.mobilePane = "plan";
            saveState();
            closeModal();
            renderAll({ resetSidebarScroll: true });
            showToast("Loaded official UNE Study Plan!");
          };
        });
      }
    );
  }

  function openCourseInfoModal(courseCode) {
    const c = typeof courseCode === "string" ? getCourse(courseCode) : getCurrentCourse();
    const isOtherOrFinder = state.view === "finder" || c.code !== state.currentCourseCode;
    const majorList = (c.majorTitles || []).filter((t) => !/listed unit/i.test(t));
    openModal(
      `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
         <span class="course-code-pill teal">${esc(c.code)}</span>
         <span style="font-weight:800;font-size:15.5px;">${esc(c.title)} (2027)</span>
       </div>`,
      `
        <div class="info-grid">
          <div class="info-stat"><div class="info-stat-label">Award Credit Points</div><div class="info-stat-val">${c.totalCp} CP</div></div>
          <div class="info-stat"><div class="info-stat-label">School</div><div class="info-stat-val">${esc(c.school)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Study / AQF Level</div><div class="info-stat-val">${esc(c.aqfLevel || c.studyLevel)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Delivery</div><div class="info-stat-val">${esc(c.modes.join(", ") || "Standard")}</div></div>
          ${c.atar ? `<div class="info-stat"><div class="info-stat-label">Selection Rank (ATAR)</div><div class="info-stat-val">${esc(c.atar)}</div></div>` : ""}
          ${c.cricos ? `<div class="info-stat"><div class="info-stat-label">CRICOS Code</div><div class="info-stat-val">${esc(c.cricos)}</div></div>` : ""}
        </div>
        ${
          majorList.length
            ? `<div class="info-stat">
                 <div class="info-stat-label">Available Majors / Specialisations (${majorList.length})</div>
                 <div style="margin-top:4px;font-size:12px;color:var(--text-muted);">${esc(majorList.join(" · "))}</div>
               </div>`
            : ""
        }
        ${c.progressionText ? `<div class="info-stat"><div class="info-stat-label">Official Course Progression Rule</div><div style="margin-top:4px;">${esc(c.progressionText)}</div></div>` : ""}
        ${
          (c.enrolmentRules || []).length
            ? `<div><div class="config-label" style="margin-bottom:6px;">Course Enrolment Rules</div><div style="display:flex;flex-direction:column;gap:6px;">${c.enrolmentRules
                .map((r) => `<div style="background:var(--surface-alt);border:1px solid var(--border);border-radius:6px;padding:8px 11px;white-space:pre-line;font-size:12px;">${esc(r)}</div>`)
                .join("")}</div></div>`
            : ""
        }
        ${c.overview ? `<div><div class="config-label" style="margin-bottom:4px;">Overview</div><div style="white-space:pre-line;color:var(--text-muted);">${esc(c.overview)}</div></div>` : ""}
        ${c.careers ? `<div><div class="config-label" style="margin-bottom:4px;">Career Opportunities</div><div style="white-space:pre-line;color:var(--text-muted);">${esc(c.careers)}</div></div>` : ""}
        ${
          (c.outcomes || []).length
            ? `<div><div class="config-label" style="margin-bottom:6px;">Learning Outcomes</div><ul style="margin:0;padding-left:18px;color:var(--text-muted);font-size:12px;display:flex;flex-direction:column;gap:4px;">${c.outcomes
                .map((o) => `<li>${esc(o)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <a href="${esc(c.url)}" target="_blank" rel="noopener" class="btn">Official 2027 UNE Handbook Page ↗</a>
          ${isOtherOrFinder ? `<button class="btn btn-primary" id="btn-modal-launch-course">Plan ${esc(c.code)} Now →</button>` : ""}
        </div>
      `,
      (modal) => {
        const launchBtn = modal.querySelector("#btn-modal-launch-course");
        if (launchBtn) {
          launchBtn.onclick = () => {
            closeModal();
            openCourseInPlanner(c.code);
          };
        }
      }
    );
  }

  function openCustomUnitModal() {
    const plan = getCurrentPlan();
    openModal(
      `<div style="font-weight:800;font-size:15.5px;">Add Custom / Cross-Faculty UNE Elective</div>`,
      `
        <div class="form-grid-2">
          <div>
            <label class="config-label">Unit Code</label>
            <input type="text" class="text-input" id="cust-code" placeholder="e.g. FREN101" style="width:100%;margin-top:4px;text-transform:uppercase;" />
          </div>
          <div>
            <label class="config-label">Unit Title</label>
            <input type="text" class="text-input" id="cust-title" placeholder="e.g. Introductory French 1" style="width:100%;margin-top:4px;" />
          </div>
          <div>
            <label class="config-label">Credit Points</label>
            <select class="select-input" id="cust-cp" style="width:100%;margin-top:4px;">
              <option value="6" selected>6 CP</option>
              <option value="12">12 CP</option>
              <option value="24">24 CP</option>
            </select>
          </div>
          <div>
            <label class="config-label">Unit Level</label>
            <select class="select-input" id="cust-lvl" style="width:100%;margin-top:4px;">
              <option value="100">100-level</option>
              <option value="200">200-level</option>
              <option value="300">300-level</option>
              <option value="400">400-level</option>
              <option value="500">500-level</option>
            </select>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button class="btn btn-primary" id="btn-save-custom">Add to Plan</button>
        </div>
      `,
      (modal) => {
        modal.querySelector("#btn-save-custom").onclick = () => {
          const code = (modal.querySelector("#cust-code").value || "").trim().toUpperCase().replace(/\s+/g, "");
          const title = (modal.querySelector("#cust-title").value || "").trim() || "General Elective Unit";
          const cp = parseInt(modal.querySelector("#cust-cp").value, 10) || 6;
          const level = parseInt(modal.querySelector("#cust-lvl").value, 10) || 100;
          if (!code) { showToast("Please enter a unit code."); return; }
          plan.customUnits = plan.customUnits || {};
          plan.customUnits[code] = {
            code, title, cp, level,
            prefix: (code.match(/^[A-Z]+/) || ["ELEC"])[0],
            school: "Cross-Faculty Elective",
            offered2027: true,
            trimesters: [1, 2, 3],
            modes: ["Online", "On Campus"],
            offerings: [],
            prereqText: "", coreqText: "", restrictionText: "",
            assessments: [], outcomes: [],
            url: `https://handbook.une.edu.au/units/2027/${code}?year=2027`,
          };
          closeModal();
          addUnitToPlan(code);
        };
      }
    );
  }

  function openExportModal() {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    openModal(
      `<div style="font-weight:800;font-size:15.5px;">Export, Print or Reset Study Plan</div>`,
      `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">
          <button class="course-card-option" id="exp-print"><div style="font-weight:700;">🖨️ Print / Save PDF</div><div style="font-size:11.5px;color:var(--text-subtle);">Clean degree progression summary</div></button>
          <button class="course-card-option" id="exp-csv"><div style="font-weight:700;">📊 Download CSV</div><div style="font-size:11.5px;color:var(--text-subtle);">Spreadsheet of Year/Tri/Units</div></button>
          <button class="course-card-option" id="exp-json"><div style="font-weight:700;">💾 Export JSON</div><div style="font-size:11.5px;color:var(--text-subtle);">Backup file to reload anytime</div></button>
          <label class="course-card-option" style="cursor:pointer;"><div style="font-weight:700;">📂 Import JSON</div><div style="font-size:11.5px;color:var(--text-subtle);">Restore saved plan file</div><input type="file" id="inp-import-json" accept=".json" style="display:none;" /></label>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:12px;color:var(--text-subtle);">Reset ${esc(course.code)} to a blank plan.</span>
          <button class="btn" id="exp-reset" style="color:var(--err);border-color:var(--err-border);">Reset ${esc(course.code)}</button>
        </div>
      `,
      (modal) => {
        modal.querySelector("#exp-print").onclick = () => { closeModal(); setTimeout(() => window.print(), 150); };
        modal.querySelector("#exp-csv").onclick = () => {
          const report = Engine.validatePlan(course, plan, DATA);
          const rows = [["Course", "Year", "Trimester", "Code", "Title", "CreditPoints", "Category"]];
          plan.years.forEach((yr) => {
            for (const t of [1, 2, 3]) {
              for (const s of yr.trimesters[t] || []) {
                if (s.type === "unit") {
                  const u = Engine.getUnit(s.code, DATA, plan.customUnits);
                  const bId = report.resolved.attributedBucketByCode[s.code];
                  const b = report.resolved.buckets.find((x) => x.id === bId);
                  rows.push([course.code, yr.name, `Trimester ${t}`, s.code, u?.title || s.code, u?.cp || 6, b?.title || "Elective"]);
                } else {
                  rows.push([course.code, yr.name, `Trimester ${t}`, "PLACEHOLDER", s.label, s.cp || 6, "Placeholder"]);
                }
              }
            }
          });
          const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
          downloadBlob(`${course.code}_2027_StudyPlan.csv`, csv, "text/csv;charset=utf-8;");
          closeModal();
        };
        modal.querySelector("#exp-json").onclick = () => {
          downloadBlob(`${course.code}_2027_Plan.json`, JSON.stringify(plan, null, 2), "application/json");
          closeModal();
        };
        modal.querySelector("#inp-import-json").onchange = (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const imported = JSON.parse(reader.result);
              if (imported.courseCode && DATA.courses.some((c) => c.code === imported.courseCode)) {
                state.currentCourseCode = imported.courseCode;
                state.savedPlansByCourse[imported.courseCode] = imported;
                state.view = "planner";
                exitSlotPicker();
                saveState();
                closeModal();
                renderAll({ resetSidebarScroll: true });
                showToast(`Imported plan for ${imported.courseCode}!`);
              } else showToast("Invalid plan JSON file.");
            } catch (_) { showToast("Could not parse JSON file."); }
          };
          reader.readAsText(file);
        };
        modal.querySelector("#exp-reset").onclick = () => {
          state.savedPlansByCourse[course.code] = Engine.createDefaultPlan(course, DATA);
          exitSlotPicker();
          saveState();
          closeModal();
          renderAll({ resetSidebarScroll: true });
          showToast(`Reset ${course.code} plan.`);
        };
      }
    );
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ==========================================================================
     8. MAIN RENDER ORCHESTRATOR
     ========================================================================== */
  function renderAll(opts) {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const finderEl = document.getElementById("finder-view");
    const plannerEl = document.getElementById("planner-shell");

    renderHeader(course, plan);
    renderMobileBottomNav(course, plan);

    if (state.view === "finder") {
      document.title = `Find a Course (233 Degrees) | UNE 2027 Interactive Course Planner`;
      finderEl.classList.remove("hidden");
      plannerEl.classList.add("hidden");
      renderCourseFinder();
    } else {
      document.title = `${course.code} — ${course.title} | UNE 2027 Course & Unit Planner`;
      finderEl.classList.add("hidden");
      plannerEl.classList.remove("hidden");
      const report = Engine.validatePlan(course, plan, DATA);
      renderConfigRibbon(course, plan, report);
      renderSidebar(course, plan, report, { resetScroll: Boolean(opts?.resetSidebarScroll) });
      renderBoard(course, plan, report);
    }

    syncResponsiveClasses();
  }

  // Backdrop click closes Tablet slide-over drawer
  const sbBackdrop = document.getElementById("sidebar-backdrop");
  if (sbBackdrop) {
    sbBackdrop.onclick = () => {
      state.tabletDrawerOpen = false;
      syncResponsiveClasses();
    };
  }

  // Dismissible trial banner
  const dismissTrialBtn = document.getElementById("btn-dismiss-trial");
  const trialBannerEl = document.getElementById("trial-banner");
  if (trialBannerEl && sessionStorage.getItem("une_trial_banner_dismissed") === "1") {
    trialBannerEl.style.display = "none";
  }
  if (dismissTrialBtn && trialBannerEl) {
    dismissTrialBtn.onclick = () => {
      trialBannerEl.style.display = "none";
      try { sessionStorage.setItem("une_trial_banner_dismissed", "1"); } catch (_) {}
    };
  }

  window.addEventListener("resize", syncResponsiveClasses);

  // Global keyboard shortcuts: '/' focuses Course Finder search, 'Escape' closes modals or tablet drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const mb = document.getElementById("modal-backdrop");
      if (mb && !mb.classList.contains("hidden")) {
        closeModal();
        return;
      }
      if (state.tabletDrawerOpen) {
        state.tabletDrawerOpen = false;
        syncResponsiveClasses();
      }
    } else if (
      e.key === "/" &&
      state.view === "finder" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    ) {
      e.preventDefault();
      document.getElementById("inp-finder-search")?.focus();
    }
  });

  loadState();
  renderAll({ resetSidebarScroll: true });
};
