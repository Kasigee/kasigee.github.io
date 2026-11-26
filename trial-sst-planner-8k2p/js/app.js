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
  const FEEDBACK_LOG_KEY = "une_planner_feedback_log_v1";
  const FEEDBACK_REVIEWER_KEY = "une_planner_reviewer_v1";

  // Staff Testing Feedback Tracker Config (optional: paste a UNE Microsoft Forms / SharePoint tracker URL here!)
  const FEEDBACK_CONFIG = {
    formUrl: "",
    sharedDocLabel: "Shared Feedback Tracker",
  };

  // Safe storage helpers so sandboxed myLearn / Moodle iframes & strict privacy modes never throw SecurityError
  function safeLocalGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeLocalSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function safeSessionGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeSessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function safeHttpUrl(rawUrl, fallback) {
    const fb = fallback || "";
    if (typeof rawUrl !== "string") return fb;
    const trimmed = rawUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return fb;
  }

  function csvSafeCell(v) {
    const s = String(v === null || v === undefined ? "" : v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) {
      return "'" + s;
    }
    return s;
  }

  function formatValidAtar(atar) {
    if (atar === null || atar === undefined) return null;
    const s = String(atar).trim();
    if (!s || /^(not applicable|n\/a|none|na|-|tba)$/i.test(s)) return null;
    const num = parseFloat(s);
    if (!Number.isFinite(num) || num <= 0) return null;
    return s;
  }

  function getCourseNotOfferedLabel(c) {
    if (!c) return null;
    const intakes = String(c.intakes || "");
    if (c.offered2027 === false || /not offered/i.test(intakes)) {
      if (/exit award/i.test(intakes)) return "Exit Award Only";
      if (/pending withdrawal/i.test(intakes)) return "Not Offered · Pending Withdrawal";
      if (/pending review/i.test(intakes)) return "Not Offered · Pending Review";
      return "Not Offered 2027";
    }
    return null;
  }

  function loadFeedbackLog() {
    try {
      const raw = safeLocalGet(FEEDBACK_LOG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x) => x && typeof x === "object" && !Array.isArray(x));
    } catch (_) {
      return [];
    }
  }

  function saveFeedbackLog(list) {
    safeLocalSet(FEEDBACK_LOG_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  }

  const CAT_LABELS = {
    core: "Core",
    major1: "Major 1",
    major2: "Major 2",
    minor: "Minor / Stream",
    capstone: "Capstone / Research",
    listed: "Listed",
    elective: "Elective",
  };

  function safeCat(cat) {
    return Object.prototype.hasOwnProperty.call(CAT_LABELS, cat) ? cat : "elective";
  }

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
    { label: "Data, AI & Computing", school: "ALL", query: "computer science OR data science OR ai OR cyber OR it" },
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
    catalogShowIneligible: null, // null = auto, true = force open, false = force collapsed
    catEligLimit: 80,
    catIneligLimit: 60,

    targetSlot: null,
    slotQuery: "",
    slotPoolFilter: "all",
    slotLevelFilter: "all",
    slotShowIneligible: null, // null = auto, true = force open, false = force collapsed
    slotForceElectives: false,
    slotEligLimit: 100,
    slotSwapLimit: 60,
    slotIneligLimit: 80,

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
      const fresh = Engine.createDefaultPlan(c, DATA);
      fresh.hasUserEdits = false;
      state.savedPlansByCourse[c.code] = fresh;
    }
    return state.savedPlansByCourse[c.code];
  }

  function hasBoardConcreteUnits(plan) {
    for (const yr of plan?.years || []) {
      for (const t of [1, 2, 3]) {
        for (const s of yr?.trimesters?.[t] || []) {
          if (s.type === "unit") return true;
        }
      }
    }
    return false;
  }

  function hasBoardAnySlots(plan) {
    for (const yr of plan?.years || []) {
      for (const t of [1, 2, 3]) {
        if ((yr?.trimesters?.[t] || []).length > 0) return true;
      }
    }
    return false;
  }

  const AUTO_PLAN_OVERWRITE_MSG =
    "Re-running Auto-Plan will overwrite the unit selections and changes you've made. Continue?";

  function shouldConfirmAutoPlanOverwrite(plan) {
    if (!plan) return false;
    if (plan.hasUserEdits === false) return false;
    if (plan.hasUserEdits === true) return true;
    // Legacy saved plans (without hasUserEdits flag): protect concrete unit selections / custom units
    return hasBoardConcreteUnits(plan) || Object.keys(plan.customUnits || {}).length > 0;
  }

  function confirmAutoPlanOverwrite(plan) {
    if (!shouldConfirmAutoPlanOverwrite(plan)) return true;
    return typeof window.confirm === "function" ? window.confirm(AUTO_PLAN_OVERWRITE_MSG) : true;
  }

  function getPlanYear(yr, yIdx) {
    if (Engine && typeof Engine.getPlanYear === "function") {
      return Engine.getPlanYear(yr, yIdx);
    }
    if (yr && Number.isInteger(yr.year) && yr.year >= 2020 && yr.year <= 2100) return yr.year;
    if (yr && typeof yr.name === "string") {
      const m = yr.name.match(/\b(20\d{2})\b/);
      if (m) return parseInt(m[1], 10);
    }
    return 2026 + (yr?.yearNum || (yIdx || 0) + 1);
  }

  function getUnitPlannedYear(code, plan) {
    for (let yIdx = 0; yIdx < (plan?.years || []).length; yIdx++) {
      const yr = plan.years[yIdx];
      for (const t of [1, 2, 3]) {
        for (const s of yr.trimesters[t] || []) {
          if (s.type === "unit" && s.code === code) return getPlanYear(yr, yIdx);
        }
      }
    }
    return null;
  }

  function getUnitBucketInfo(code, report, bucketMap) {
    const ubMap = report?.unitBucketMap || report?.resolved?.unitBucketMap;
    if (ubMap && ubMap[code]) {
      const info = ubMap[code];
      const cat = safeCat(info.category);
      return {
        bucketId: info.bucketId || null,
        bucketTitle: info.bucketTitle || CAT_LABELS[cat] || "Elective",
        shortTitle: info.shortTitle || info.bucketTitle || CAT_LABELS[cat] || "Elective",
        category: cat,
        badgeRole: info.badgeRole || CAT_LABELS[cat] || "Unit",
      };
    }
    const bId = report?.resolved?.attributedBucketByCode?.[code];
    const bucket = bucketMap ? bucketMap[bId] : report?.resolved?.buckets?.find((x) => x.id === bId);
    const cat = safeCat(bucket?.category);
    return {
      bucketId: bId || null,
      bucketTitle: bucket?.title || "Elective",
      shortTitle: bucket?.title || "Elective",
      category: cat,
      badgeRole: CAT_LABELS[cat] || "Unit",
    };
  }

  function buildPlaceholderTarget(ph, yr, yIdx, triNum) {
    return {
      yearIdx: yIdx,
      yearNum: yr?.yearNum || yIdx + 1,
      planYear: getPlanYear(yr, yIdx),
      triNum,
      replaceSlotId: ph.id,
      label: ph.label || "Listed or Elective Unit",
      slotKind: ph.slotKind || "",
      category: ph.category || "",
      bucketId: ph.bucketId || null,
      bucketTitle: ph.bucketTitle || "",
      hintCodes: Array.isArray(ph.hintCodes) ? ph.hintCodes : [],
      strictHints: Boolean(ph.strictHints),
      eligibleCount: ph.eligibleCount !== undefined && ph.eligibleCount !== null ? Number(ph.eligibleCount) : null,
      allowedLevels: Array.isArray(ph.allowedLevels) ? ph.allowedLevels : null,
      levelMin: ph.levelMin !== undefined && ph.levelMin !== null ? Number(ph.levelMin) : null,
      levelMax: ph.levelMax !== undefined && ph.levelMax !== null ? Number(ph.levelMax) : null,
      strictPoolOnly: typeof ph.strictPoolOnly === "boolean" ? ph.strictPoolOnly : undefined,
    };
  }

  function validateAndSanitizePlan(rawPlan, expectedCourseCode) {
    if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) return null;
    const rawCode = typeof rawPlan.courseCode === "string" ? rawPlan.courseCode.trim().toUpperCase() : "";
    const courseCode = expectedCourseCode || rawCode;
    const course = DATA.courses.find((c) => c.code === courseCode);
    if (!course) return null;
    if (rawCode && expectedCourseCode && rawCode !== expectedCourseCode) return null;

    if (!Array.isArray(rawPlan.years) || rawPlan.years.length === 0 || rawPlan.years.length > 20) {
      return null;
    }

    const sanitizedYears = [];
    for (let yIdx = 0; yIdx < rawPlan.years.length; yIdx++) {
      const yr = rawPlan.years[yIdx];
      if (!yr || typeof yr !== "object" || Array.isArray(yr)) return null;
      if (!yr.trimesters || typeof yr.trimesters !== "object" || Array.isArray(yr.trimesters)) return null;
      const tris = { 1: [], 2: [], 3: [] };
      for (const t of [1, 2, 3]) {
        const rawArr = yr.trimesters[t] ?? yr.trimesters[String(t)];
        if (rawArr !== undefined && !Array.isArray(rawArr)) return null;
        if (!Array.isArray(rawArr)) continue;
        for (const s of rawArr) {
          if (!s || typeof s !== "object" || Array.isArray(s)) continue;
          const sid = typeof s.id === "string" && s.id.trim() && !s.id.includes("|") ? s.id.trim() : Engine.uid("s");
          if (s.type === "unit") {
            const uCode = typeof s.code === "string" ? s.code.trim().toUpperCase() : "";
            if (!uCode || uCode.includes("|")) continue;
            const parsedCp = Number(s.cp);
            const cleanSlot = { id: sid, type: "unit", code: uCode };
            if (s.cp !== undefined && Number.isFinite(parsedCp) && parsedCp >= 0 && parsedCp <= 96) {
              cleanSlot.cp = parsedCp;
            }
            tris[t].push(cleanSlot);
          } else if (s.type === "placeholder") {
            const parsedCp = Number(s.cp);
            const cleanPh = {
              id: sid,
              type: "placeholder",
              label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : "Listed or Elective Unit",
              cp: Number.isFinite(parsedCp) && parsedCp >= 0 && parsedCp <= 96 ? parsedCp : 6,
              slotKind: typeof s.slotKind === "string" ? s.slotKind : "",
              hintCodes: Array.isArray(s.hintCodes) ? s.hintCodes.filter((h) => typeof h === "string" && !h.includes("|")) : [],
            };
            if (typeof s.category === "string" && Object.prototype.hasOwnProperty.call(CAT_LABELS, s.category)) {
              cleanPh.category = s.category;
            }
            if (typeof s.bucketId === "string" && s.bucketId.trim()) {
              cleanPh.bucketId = s.bucketId.trim();
            }
            if (typeof s.bucketTitle === "string" && s.bucketTitle.trim()) {
              cleanPh.bucketTitle = s.bucketTitle.trim().slice(0, 120);
            }
            if (typeof s.strictHints === "boolean") cleanPh.strictHints = s.strictHints;
            if (s.eligibleCount !== undefined && s.eligibleCount !== null && Number.isFinite(Number(s.eligibleCount))) {
              cleanPh.eligibleCount = Math.max(0, Math.floor(Number(s.eligibleCount)));
            }
            if (Array.isArray(s.allowedLevels)) {
              const lvls = s.allowedLevels.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 900);
              if (lvls.length) cleanPh.allowedLevels = lvls;
            }
            if (s.levelMin !== undefined && s.levelMin !== null && Number.isFinite(Number(s.levelMin))) {
              cleanPh.levelMin = Number(s.levelMin);
            }
            if (s.levelMax !== undefined && s.levelMax !== null && Number.isFinite(Number(s.levelMax))) {
              cleanPh.levelMax = Number(s.levelMax);
            }
            if (typeof s.strictPoolOnly === "boolean") cleanPh.strictPoolOnly = s.strictPoolOnly;
            tris[t].push(cleanPh);
          }
        }
      }
      const yearNum = Number.isInteger(yr.yearNum) && yr.yearNum > 0 ? yr.yearNum : yIdx + 1;
      const calYear = getPlanYear({ ...yr, yearNum }, yIdx);
      sanitizedYears.push({
        id: typeof yr.id === "string" && yr.id.trim() ? yr.id.trim() : Engine.uid("yr"),
        yearNum,
        year: calYear,
        name: typeof yr.name === "string" && yr.name.trim() ? yr.name.trim() : `Year ${yearNum} (${calYear})`,
        trimesters: tris,
      });
    }

    const def = Engine.createDefaultPlan(course, DATA);
    const sanitizedCustomUnits = {};
    if (rawPlan.customUnits && typeof rawPlan.customUnits === "object" && !Array.isArray(rawPlan.customUnits)) {
      for (const [k, cu] of Object.entries(rawPlan.customUnits)) {
        if (!cu || typeof cu !== "object" || Array.isArray(cu)) continue;
        const code = String(cu.code || k || "").trim().toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) continue;
        if (DATA.units[code]) continue; // Never allow custom unit import to shadow an official UNE unit
        const cpNum = Number(cu.cp);
        const lvlNum = Number(cu.level);
        const cp = Number.isFinite(cpNum) && cpNum >= 0 && cpNum <= 96 ? cpNum : 6;
        const level = Number.isFinite(lvlNum) && lvlNum >= 0 && lvlNum <= 900 ? lvlNum : 100;
        const trimesters = Array.isArray(cu.trimesters)
          ? cu.trimesters.map(Number).filter((t) => t === 1 || t === 2 || t === 3)
          : [1, 2, 3];
        const modes = Array.isArray(cu.modes)
          ? cu.modes.filter((m) => typeof m === "string" && m.trim()).slice(0, 5)
          : ["Online", "On Campus"];
        sanitizedCustomUnits[code] = {
          code,
          title: typeof cu.title === "string" && cu.title.trim() ? cu.title.trim().slice(0, 180) : "General Elective Unit",
          cp,
          level,
          prefix: typeof cu.prefix === "string" && /^[A-Z0-9]{1,10}$/.test(cu.prefix) ? cu.prefix : (code.match(/^[A-Z]+/) || ["ELEC"])[0],
          school: typeof cu.school === "string" && cu.school.trim() ? cu.school.trim().slice(0, 120) : "Cross-Faculty Elective",
          offered2027: cu.offered2027 !== false,
          trimesters: trimesters.length ? trimesters : [1, 2, 3],
          modes: modes.length ? modes : ["Online", "On Campus"],
          offerings: [],
          prereqText: typeof cu.prereqText === "string" ? cu.prereqText.slice(0, 500) : "",
          coreqText: typeof cu.coreqText === "string" ? cu.coreqText.slice(0, 500) : "",
          restrictionText: typeof cu.restrictionText === "string" ? cu.restrictionText.slice(0, 500) : "",
          assessments: [],
          outcomes: [],
          url: safeHttpUrl(cu.url, `https://handbook.une.edu.au/units/2027/${encodeURIComponent(code)}?year=2027`),
        };
      }
    }

    const dynSel = {};
    if (rawPlan.dynamicAosSelections && typeof rawPlan.dynamicAosSelections === "object" && !Array.isArray(rawPlan.dynamicAosSelections)) {
      for (const [k, v] of Object.entries(rawPlan.dynamicAosSelections)) {
        if (typeof k === "string" && typeof v === "string") dynSel[k] = v;
      }
    }

    const cTri = Number(rawPlan.commencingTrimester);
    const t3Strat = ["none", "spread", "accelerate"].includes(rawPlan.t3Strategy) ? rawPlan.t3Strategy : def.t3Strategy;
    const hasConcreteInSanitized = sanitizedYears.some((yr) =>
      [1, 2, 3].some((t) => (yr.trimesters[t] || []).some((s) => s.type === "unit"))
    );
    const hasUserEdits =
      typeof rawPlan.hasUserEdits === "boolean"
        ? rawPlan.hasUserEdits
        : hasConcreteInSanitized || Object.keys(sanitizedCustomUnits).length > 0;

    return {
      ...def,
      courseCode: course.code,
      admissionRule: typeof rawPlan.admissionRule === "string" && rawPlan.admissionRule ? rawPlan.admissionRule : def.admissionRule,
      aosStructure: typeof rawPlan.aosStructure === "string" && rawPlan.aosStructure ? rawPlan.aosStructure : def.aosStructure,
      selectedMajors: Array.isArray(rawPlan.selectedMajors)
        ? rawPlan.selectedMajors.filter((x) => typeof x === "string")
        : def.selectedMajors,
      selectedMinor: typeof rawPlan.selectedMinor === "string" ? rawPlan.selectedMinor : "",
      dynamicAosSelections: dynSel,
      commencingTrimester: cTri === 1 || cTri === 2 || cTri === 3 ? cTri : def.commencingTrimester,
      studyLoad: rawPlan.studyLoad === "Part-time" ? "Part-time" : "Full-time",
      preferredMode: rawPlan.preferredMode === "On Campus" ? "On Campus" : "Online",
      t3Strategy: t3Strat,
      includeT3InAuto: t3Strat !== "none",
      t3Analysis: rawPlan.t3Analysis && typeof rawPlan.t3Analysis === "object" && !Array.isArray(rawPlan.t3Analysis) ? rawPlan.t3Analysis : null,
      hasUserEdits,
      customUnits: sanitizedCustomUnits,
      years: sanitizedYears,
    };
  }

  function saveState() {
    safeLocalSet(
      STORAGE_KEY,
      JSON.stringify({
        currentCourseCode: state.currentCourseCode,
        savedPlansByCourse: state.savedPlansByCourse,
      })
    );
  }

  function loadState() {
    try {
      const savedTheme = safeLocalGet(THEME_KEY);
      if (savedTheme === "dark") document.documentElement.classList.add("dark");

      const raw = safeLocalGet(STORAGE_KEY) || safeLocalGet(LEGACY_STORAGE_KEY);
      let hasSaved = false;
      let hadCorruption = false;
      if (raw) {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          hadCorruption = true;
        }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (parsed.savedPlansByCourse && typeof parsed.savedPlansByCourse === "object" && !Array.isArray(parsed.savedPlansByCourse)) {
            const cleanMap = {};
            for (const [code, rawPlan] of Object.entries(parsed.savedPlansByCourse)) {
              const valid = validateAndSanitizePlan(rawPlan, code);
              if (valid) cleanMap[code] = valid;
              else hadCorruption = true;
            }
            state.savedPlansByCourse = cleanMap;
            hasSaved = Object.keys(cleanMap).length > 0;
          }
          if (typeof parsed.currentCourseCode === "string" && DATA.courses.some((c) => c.code === parsed.currentCourseCode)) {
            state.currentCourseCode = parsed.currentCourseCode;
          }
        } else if (raw) {
          hadCorruption = true;
        }
      }
      if (hadCorruption) {
        saveState();
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
      state.savedPlansByCourse = {};
      state.view = "finder";
    }
  }

  function openCourseInPlanner(courseCode, matchedAosEntry) {
    if (!DATA.courses.some((c) => c.code === courseCode)) return;
    state.currentCourseCode = courseCode;
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    let aosApplied = false;
    if (matchedAosEntry) {
      aosApplied = Boolean(Engine.preselectAOS(course, plan, matchedAosEntry, DATA));
    }
    exitSlotPicker();
    state.catalogShowIneligible = null;
    state.catEligLimit = 80;
    state.catIneligLimit = 60;
    state.view = "planner";
    state.mobilePane = "plan";
    state.tabletDrawerOpen = false;
    state.mobileConfigOpen = false;
    saveState();
    renderAll({ resetSidebarScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    if (matchedAosEntry && aosApplied) {
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
            list.push(buildPlaceholderTarget(s, yr, yIdx, tNum));
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
    state.slotShowIneligible = null;
    state.slotForceElectives = false;
    state.slotEligLimit = 100;
    state.slotSwapLimit = 60;
    state.slotIneligLimit = 80;
    if (openUiPane !== false) {
      if (isMobileViewport()) state.mobilePane = "units";
      else if (isTabletViewport()) state.tabletDrawerOpen = true;
    }
  }

  function applySiblingSwapFromPicker(unitCode, toTri, swapPlaceholderId) {
    if (!state.targetSlot || !state.targetSlot.replaceSlotId) return;
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const { yearIdx, triNum: fromTri, replaceSlotId } = state.targetSlot;
    if (typeof Engine.applySiblingSwapUnit !== "function") {
      showToast("Sibling-trimester swap unavailable.");
      return;
    }
    const res = Engine.applySiblingSwapUnit(
      course,
      plan,
      yearIdx,
      fromTri,
      replaceSlotId,
      Number(toTri),
      swapPlaceholderId,
      unitCode,
      DATA
    );
    if (!res || !res.ok || !res.plan) {
      showToast(res?.error || "Could not swap slots for that unit.");
      return;
    }
    res.plan.hasUserEdits = true;
    state.savedPlansByCourse[course.code] = res.plan;
    const remaining = findOpenPlaceholders(res.plan);
    if (state.sidebarTab === "slot" && remaining.length > 0) {
      activateSlotPicker(remaining[0], false);
    } else {
      exitSlotPicker();
      if (isMobileViewport()) state.mobilePane = "plan";
      if (isTabletViewport()) state.tabletDrawerOpen = false;
    }
    saveState();
    renderAll({ resetSidebarScroll: true });
    showToast(
      res.message ||
        `Added ${unitCode} to Year ${res.plan.years[yearIdx]?.yearNum || yearIdx + 1}, Trimester ${toTri} (moved ${
          res.swappedLabel || "Elective"
        } slot to Trimester ${fromTri}).`
    );
  }

  function exitSlotPicker() {
    state.targetSlot = null;
    if (state.sidebarTab === "slot") {
      state.sidebarTab = "requirements";
    }
  }

  function syncResponsiveClasses() {
    if (!isTabletViewport() && state.tabletDrawerOpen) {
      state.tabletDrawerOpen = false;
    }
    document.body.classList.toggle("drawer-open", state.tabletDrawerOpen && state.view === "planner" && isTabletViewport());
    document.body.classList.toggle("mobile-pane-units", state.view === "planner" && state.mobilePane === "units");
    document.body.classList.toggle("mobile-pane-plan", state.view === "planner" && state.mobilePane !== "units");
  }

  function getUnitEffectiveCp(uObj, fallbackCp) {
    const rawCp = uObj ? (uObj.cp ?? 6) : (fallbackCp ?? 6);
    return uObj && uObj.yearLong ? Math.ceil(rawCp / 2) : rawCp;
  }

  function scorePlaceholderMatchForUnit(slot, code, u, bucketById, unitBucketCats) {
    if (!slot || slot.type !== "placeholder") return -1;
    const uLvl = u?.level ?? 100;
    const uEffCp = getUnitEffectiveCp(u, 6);
    const levelMismatch =
      (Array.isArray(slot.allowedLevels) && slot.allowedLevels.length > 0 && !slot.allowedLevels.includes(uLvl)) ||
      (slot.levelMin !== undefined && slot.levelMin !== null && uLvl < slot.levelMin) ||
      (slot.levelMax !== undefined && slot.levelMax !== null && uLvl > slot.levelMax);

    const hintMatch = Array.isArray(slot.hintCodes) && slot.hintCodes.includes(code);
    const phBucket = slot.bucketId ? bucketById[slot.bucketId] : null;
    const bucketPoolMatch = Boolean(phBucket && Array.isArray(phBucket.units) && phBucket.units.includes(code));
    const phCat = inferPlaceholderCategory(slot);
    const cpBonus = (slot.cp ?? 6) === uEffCp ? 2 : 0;

    if (hintMatch) {
      return 100 - (levelMismatch ? 40 : 0) + cpBonus;
    }
    if (bucketPoolMatch) {
      const catBase =
        phCat === "core"
          ? 95
          : phCat === "major1" || phCat === "major2"
          ? 90
          : phCat === "minor" || phCat === "capstone"
          ? 85
          : phCat === "listed"
          ? 80
          : 75;
      return catBase - (levelMismatch ? 40 : 0) + cpBonus;
    }
    if (phCat === "core" && unitBucketCats.has("core")) {
      return 70 - (levelMismatch ? 35 : 0) + cpBonus;
    }
    if ((phCat === "major1" || phCat === "major2") && (unitBucketCats.has("major1") || unitBucketCats.has("major2"))) {
      return 65 - (levelMismatch ? 35 : 0) + cpBonus;
    }
    if (phCat === "listed" && unitBucketCats.has("listed")) {
      return 55 - (levelMismatch ? 30 : 0) + cpBonus;
    }
    if (phCat === "elective" && !slot.strictHints && !slot.strictPoolOnly) {
      return 40 - (levelMismatch ? 25 : 0) + cpBonus;
    }
    if (phCat === "listed" && !slot.strictHints && !slot.strictPoolOnly) {
      return 30 - (levelMismatch ? 20 : 0) + cpBonus;
    }
    if (!slot.strictHints && !slot.strictPoolOnly) {
      return 15 - (levelMismatch ? 10 : 0) + cpBonus;
    }
    return 5 + cpBonus;
  }

  function findBestMatchingPlaceholderIndex(slots, code, u, bucketById, unitBucketCats, exactMatchOnly) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < (slots || []).length; i++) {
      const s = slots[i];
      if (!s || s.type !== "placeholder") continue;
      const sc = scorePlaceholderMatchForUnit(s, code, u, bucketById, unitBucketCats);
      if (exactMatchOnly && sc < 55) continue;
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function addUnitToPlan(code, opts) {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const u = Engine.getUnit(code, DATA, plan.customUnits);
    if (!u) return;

    const existingLoc = isUnitPlanned(code, plan);
    if (existingLoc && !u.repeatable) {
      showToast(`${code} is already in your plan (${existingLoc}).`);
      return;
    }

    const maxPerTri = plan.studyLoad === "Part-time" ? 12 : 24;
    const isRolling = u.offered2027 === false && Number.isInteger(u.rollingStartYear);
    const effectiveTris =
      u.trimesters && u.trimesters.length > 0
        ? u.trimesters
        : isRolling && Array.isArray(u.indicativeTrimesters) && u.indicativeTrimesters.length > 0
        ? u.indicativeTrimesters
        : [];
    const allowOverride = Boolean(opts && opts.allowOverride);
    const forceSmart = Boolean(opts && opts.forceSmart);

    // Only apply direct state.targetSlot replacement when explicitly in Slot Picker mode (not Requirements/Catalog or board diagnostics)
    if (state.targetSlot && state.sidebarTab === "slot" && !forceSmart) {
      const { yearIdx, triNum, replaceSlotId } = state.targetSlot;
      const yr = plan.years[yearIdx];
      if (yr && yr.trimesters[triNum]) {
        const targetYear = state.targetSlot.planYear || getPlanYear(yr, yearIdx);
        const offeredInTarget =
          (effectiveTris.length === 0 || effectiveTris.includes(triNum)) &&
          (!isRolling || targetYear >= u.rollingStartYear);

        if (!offeredInTarget && !allowOverride) {
          // Never silently shove an unoffered unit (e.g. T2-only CHEM120) into a T1 slot:
          // first attempt a clean Sibling-Trimester Auto-Swap if available, otherwise fall through to smart placement!
          if (replaceSlotId && typeof Engine.resolveSlotCandidates === "function") {
            const se = Engine.resolveSlotCandidates(state.targetSlot, course, plan, DATA, {
              forceIncludeElectives: state.slotForceElectives,
            });
            const swapMatch = (se?.siblingSwapEligible || []).find((it) => it.code === code);
            if (swapMatch) {
              applySiblingSwapFromPicker(code, swapMatch.siblingTri, swapMatch.swapPlaceholderId);
              return;
            }
          }
          // No sibling swap available for this slot — fall through to smart placement instead of creating an offering error
        } else {
          const newSlot = { id: Engine.uid("u"), type: "unit", code };
          plan.hasUserEdits = true;
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
              return s + getUnitEffectiveCp(xu, x.cp);
            }, 0);
            if (newLoadCp >= maxPerTri) {
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
    }

    // Adding from Requirements / Catalog clears stale state.targetSlot so it doesn't confuse later actions
    if (state.targetSlot && state.sidebarTab !== "slot") {
      state.targetSlot = null;
    }

    // Smart earliest valid placement preserving left sidebar scroll — delegates to Engine.findBestSmartPlacement!
    const uEffCp = getUnitEffectiveCp(u, 6);
    let placedLabel = "";
    let replacedPhNote = "";

    if (typeof Engine.findBestSmartPlacement === "function") {
      const sp = Engine.findBestSmartPlacement(course, plan, code, DATA);
      const newSlot = { id: Engine.uid("u"), type: "unit", code };
      if (sp && !sp.needsNewYear && plan.years[sp.yearIdx]?.trimesters?.[sp.triNum]) {
        const targetYr = plan.years[sp.yearIdx];
        const slots = targetYr.trimesters[sp.triNum];
        if (sp.replacePlaceholderId) {
          const phIdx = slots.findIndex((s) => s.id === sp.replacePlaceholderId);
          if (phIdx !== -1) {
            const ph = slots[phIdx];
            replacedPhNote = sp.replacePlaceholderLabel || ph.label || "open slot";
            if (state.targetSlot && state.targetSlot.replaceSlotId === ph.id) {
              exitSlotPicker();
            }
            slots[phIdx] = newSlot;
          } else {
            slots.push(newSlot);
          }
        } else {
          slots.push(newSlot);
        }
        // For multi-slot (>6 CP) units replacing a single 6-CP placeholder, trim extra open placeholder(s) if load now exceeds maxPerTri
        let postTotal = slots.reduce((sum, s) => {
          const su = s.type === "unit" ? Engine.getUnit(s.code, DATA, plan.customUnits) : null;
          return sum + getUnitEffectiveCp(su, s.cp);
        }, 0);
        if (postTotal > maxPerTri && uEffCp > 6) {
          const curReport = Engine.validatePlan(course, plan, DATA);
          const curBuckets = curReport?.resolved?.buckets || [];
          const bucketById = Object.fromEntries(curBuckets.map((b) => [b.id, b]));
          const unitBucketCats = new Set(
            curBuckets.filter((b) => Array.isArray(b.units) && b.units.includes(code)).map((b) => b.category)
          );
          while (postTotal > maxPerTri) {
            const extraPhIdx = findBestMatchingPlaceholderIndex(slots, code, u, bucketById, unitBucketCats, false);
            if (extraPhIdx === -1) break;
            const extraPh = slots[extraPhIdx];
            if (state.targetSlot && state.targetSlot.replaceSlotId === extraPh.id) exitSlotPicker();
            slots.splice(extraPhIdx, 1);
            postTotal -= extraPh.cp ?? 6;
          }
        }
        placedLabel = `Y${targetYr.yearNum} · T${sp.triNum}`;
      } else {
        const fallbackTri = sp?.triNum || (effectiveTris[0] || plan.commencingTrimester || 1);
        while (isRolling && 2026 + plan.years.length + 1 < u.rollingStartYear) {
          const padNum = plan.years.length + 1;
          plan.years.push({
            id: Engine.uid("yr"),
            yearNum: padNum,
            year: 2026 + padNum,
            name: `Year ${padNum} (${2026 + padNum})`,
            trimesters: { 1: [], 2: [], 3: [] },
          });
        }
        const newYNum = plan.years.length + 1;
        const newYr = {
          id: Engine.uid("yr"),
          yearNum: newYNum,
          year: 2026 + newYNum,
          name: `Year ${newYNum} (${2026 + newYNum})`,
          trimesters: { 1: [], 2: [], 3: [] },
        };
        newYr.trimesters[fallbackTri].push(newSlot);
        plan.years.push(newYr);
        placedLabel = `Y${newYNum} · T${fallbackTri}`;
      }
      plan.hasUserEdits = true;
      saveState();
      renderAll({ resetSidebarScroll: false });
      showToast(
        replacedPhNote
          ? `Added ${code} → ${placedLabel} (filled ${replacedPhNote})`
          : `Added ${code} → ${placedLabel}`
      );
      return;
    }

    // Defensive fallback if Engine.findBestSmartPlacement is unavailable
    const curReport = Engine.validatePlan(course, plan, DATA);
    const curBuckets = curReport?.resolved?.buckets || [];
    const bucketById = Object.fromEntries(curBuckets.map((b) => [b.id, b]));
    const unitBucketCats = new Set(
      curBuckets.filter((b) => Array.isArray(b.units) && b.units.includes(code)).map((b) => b.category)
    );

    const placements = Engine.getPlannedPlacements(plan, DATA);
    const advCp = Engine.getAdvancedStandingCp(course, plan.admissionRule);
    const startTri = plan.commencingTrimester || 1;
    const isPgCourse = course.studyLevel === "Postgraduate" || course.studyLevel === "Postgraduate Research";
    const allPlannedCodes = new Set(placements.filter((p) => p.type === "unit").map((p) => p.code));

    let best = null;

    plan.years.forEach((yr, yIdx) => {
      const planYear = getPlanYear(yr, yIdx);
      if (isRolling && planYear < u.rollingStartYear) return;
      for (const tNum of [1, 2, 3]) {
        if (yIdx === 0 && tNum < startTri) continue;
        const offeredOk = effectiveTris.length === 0 || effectiveTris.includes(tNum);
        if (!offeredOk) continue;
        if (
          tNum === 3 &&
          (!plan.t3Strategy || plan.t3Strategy === "none") &&
          !(effectiveTris.length === 1 && effectiveTris[0] === 3)
        ) {
          continue;
        }
        if (tNum === 3 && u.t3RepeatOnly && effectiveTris.length > 1) {
          continue;
        }
        const slots = yr.trimesters[tNum] || [];
        let concreteEffCp = 0;
        let totalEffCp = 0;
        for (const s of slots) {
          if (s.type === "unit") {
            const su = Engine.getUnit(s.code, DATA, plan.customUnits);
            const eCp = getUnitEffectiveCp(su, s.cp);
            concreteEffCp += eCp;
            totalEffCp += eCp;
          } else {
            totalEffCp += s.cp ?? 6;
          }
        }
        // Check concrete load so trimesters filled with open placeholders (e.g. Y1 T2 at 24 CP) remain eligible!
        const fitsConcreteLoad =
          concreteEffCp + uEffCp <= maxPerTri || (concreteEffCp === 0 && uEffCp > maxPerTri);
        if (!fitsConcreteLoad) continue;

        const chrono = yIdx * 3 + (tNum - 1);
        const priorSet = new Set();
        const sameOrPriorSet = new Set();
        let priorCp = advCp;
        const priorPrefixCp = {};
        const priorLevelCp = {};
        for (const p of placements) {
          const pCp = p.cp ?? 6;
          if (p.chrono < chrono) {
            priorCp += pCp;
            if (p.type === "unit") {
              priorSet.add(p.code);
              sameOrPriorSet.add(p.code);
              const pref = p.unit?.prefix || "";
              if (pref) priorPrefixCp[pref] = (priorPrefixCp[pref] || 0) + pCp;
              const lvl = p.unit?.level ?? 100;
              priorLevelCp[lvl] = (priorLevelCp[lvl] || 0) + pCp;
            }
          } else if (p.chrono === chrono && p.type === "unit") {
            sameOrPriorSet.add(p.code);
          }
        }

        let penalty = 0;
        const pm = u.prereqMeta;
        if (pm && !(pm.pgWaiver && isPgCourse)) {
          let prereqOk = true;
          if (pm.combineOp === "OR" || (Array.isArray(pm.alternatives) && pm.alternatives.length > 0)) {
            let anyPass = false;
            if (pm.minCp > 0 && priorCp >= pm.minCp) anyPass = true;
            if (pm.prefixCp) {
              const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
              const havePref = prefs.reduce((s, pr) => s + (priorPrefixCp[pr] || 0), 0);
              if (havePref >= pm.prefixCp.cp) anyPass = true;
            }
            if (pm.tokens && pm.tokens.length > 0 && Engine.evalPrereqTokens(pm.tokens, priorSet)) anyPass = true;
            if (!anyPass && (pm.minCp > 0 || pm.prefixCp || (pm.tokens && pm.tokens.length > 0))) prereqOk = false;
          } else {
            if (pm.minCp > 0 && priorCp < pm.minCp) prereqOk = false;
            if (pm.prefixCp) {
              const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
              const havePref = prefs.reduce((s, pr) => s + (priorPrefixCp[pr] || 0), 0);
              if (havePref < pm.prefixCp.cp) prereqOk = false;
            }
            if (pm.levelCp && Array.isArray(pm.levelCp.levels)) {
              const haveLvl = pm.levelCp.levels.reduce((s, l) => s + (priorLevelCp[l] || 0), 0);
              if (haveLvl < pm.levelCp.cp) prereqOk = false;
            }
            if (pm.tokens && pm.tokens.length > 0 && !Engine.evalPrereqTokens(pm.tokens, priorSet)) prereqOk = false;
          }
          if (!prereqOk) penalty += 100;
        }

        const cm = u.coreqMeta;
        if (cm) {
          const courseApplies = !cm.onlyCourses || cm.onlyCourses.includes(course.code);
          const ruleApplies = !cm.onlyRulePattern || (plan.admissionRule || "").includes(cm.onlyRulePattern);
          const waived = cm.pgWaiver && isPgCourse;
          if (courseApplies && ruleApplies && !waived && cm.tokens && cm.tokens.length > 0) {
            if (!Engine.evalPrereqTokens(cm.tokens, sameOrPriorSet)) penalty += 50;
          }
        }

        for (const rCode of u.restrictedUnits || []) {
          const rUnit = Engine.getUnit(rCode, DATA, plan.customUnits);
          const isMutual = rUnit && (rUnit.restrictedUnits || []).includes(code);
          if ((isMutual && allPlannedCodes.has(rCode)) || (!isMutual && sameOrPriorSet.has(rCode))) {
            penalty += 500;
          }
        }

        // Penalize overlapping 2027 intensive dates with already-placed concrete units in this trimester
        if (planYear <= 2027 && typeof Engine.getUnitIntensiveForTri === "function") {
          const uInt = Engine.getUnitIntensiveForTri(u, tNum, plan.preferredMode, planYear);
          if (
            uInt &&
            uInt.kind === "Mandatory" &&
            uInt.applicableForMode &&
            !uInt.tba &&
            Array.isArray(uInt.dateRanges) &&
            uInt.dateRanges.length > 0
          ) {
            const hasClash = slots.some((s) => {
              if (s.type !== "unit") return false;
              const su = Engine.getUnit(s.code, DATA, plan.customUnits);
              const sInt = su ? Engine.getUnitIntensiveForTri(su, tNum, plan.preferredMode, planYear) : null;
              if (!sInt || sInt.kind !== "Mandatory" || !sInt.applicableForMode || sInt.tba || !Array.isArray(sInt.dateRanges)) {
                return false;
              }
              for (const ra of uInt.dateRanges) {
                for (const rb of sInt.dateRanges) {
                  if (ra.start && ra.end && rb.start && rb.end && ra.start <= rb.end && rb.start <= ra.end) return true;
                }
              }
              return false;
            });
            if (hasClash) penalty += 40;
          }
        }

        // Prefer trimesters containing a matching open placeholder (capped at -1.5 so earlier valid years still win!)
        const bestPhIdx = findBestMatchingPlaceholderIndex(slots, code, u, bucketById, unitBucketCats, false);
        let phBonus = 0;
        if (bestPhIdx !== -1) {
          const phScore = scorePlaceholderMatchForUnit(slots[bestPhIdx], code, u, bucketById, unitBucketCats);
          if (phScore >= 80) phBonus = 1.5;
          else if (phScore >= 55) phBonus = 1.0;
          else if (phScore >= 30) phBonus = 0.4;
        } else if (totalEffCp + uEffCp <= maxPerTri) {
          phBonus = 0.2;
        }

        const score = penalty + chrono - phBonus;
        if (!best || score < best.score) best = { yIdx, tNum, score };
      }
    });

    function insertUnitIntoTrimester(targetYr, targetTri) {
      const slots = targetYr.trimesters[targetTri];
      const newSlot = { id: Engine.uid("u"), type: "unit", code };
      let totalBefore = slots.reduce((sum, s) => {
        const su = s.type === "unit" ? Engine.getUnit(s.code, DATA, plan.customUnits) : null;
        return sum + getUnitEffectiveCp(su, s.cp);
      }, 0);

      let replacedLabel = "";
      if (totalBefore + uEffCp > maxPerTri) {
        let firstReplacedIdx = -1;
        while (totalBefore + uEffCp > maxPerTri) {
          const phIdx = findBestMatchingPlaceholderIndex(slots, code, u, bucketById, unitBucketCats, false);
          if (phIdx === -1) break;
          const ph = slots[phIdx];
          const phCp = ph.cp ?? 6;
          if (!replacedLabel) replacedLabel = ph.label || "open slot";
          if (state.targetSlot && state.targetSlot.replaceSlotId === ph.id) {
            exitSlotPicker();
          }
          if (firstReplacedIdx === -1) {
            slots[phIdx] = newSlot;
            firstReplacedIdx = phIdx;
          } else {
            slots.splice(phIdx, 1);
          }
          totalBefore -= phCp;
        }
        if (firstReplacedIdx === -1) {
          slots.push(newSlot);
        }
      } else {
        // Under load cap: still replace an exact matching bucket/core/major placeholder if present to avoid duplicating requirement slots
        const exactPhIdx = findBestMatchingPlaceholderIndex(slots, code, u, bucketById, unitBucketCats, true);
        if (exactPhIdx !== -1) {
          const ph = slots[exactPhIdx];
          replacedLabel = ph.label || "open slot";
          if (state.targetSlot && state.targetSlot.replaceSlotId === ph.id) {
            exitSlotPicker();
          }
          slots[exactPhIdx] = newSlot;
        } else {
          slots.push(newSlot);
        }
      }
      return replacedLabel;
    }

    placedLabel = "";
    replacedPhNote = "";
    if (!best) {
      const offeredTris =
        effectiveTris.length > 0
          ? effectiveTris.filter((t) => !(t === 3 && u.t3RepeatOnly && effectiveTris.length > 1))
          : [startTri];
      const fallbackTris = offeredTris.length ? offeredTris : [1];
      let placed = false;
      for (let yIdx = 0; yIdx < plan.years.length && !placed; yIdx++) {
        if (isRolling && getPlanYear(plan.years[yIdx], yIdx) < u.rollingStartYear) continue;
        for (const fTri of fallbackTris) {
          if (yIdx === 0 && fTri < startTri) continue;
          const slots = plan.years[yIdx].trimesters[fTri] || [];
          const concreteEffCp = slots.reduce((sum, s) => {
            if (s.type !== "unit") return sum;
            const su = Engine.getUnit(s.code, DATA, plan.customUnits);
            return sum + getUnitEffectiveCp(su, s.cp);
          }, 0);
          if (concreteEffCp + uEffCp <= maxPerTri || (concreteEffCp === 0 && uEffCp > maxPerTri)) {
            replacedPhNote = insertUnitIntoTrimester(plan.years[yIdx], fTri);
            placedLabel = `Y${plan.years[yIdx].yearNum} · T${fTri}`;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        const fallbackTri = fallbackTris[0] || 1;
        while (isRolling && 2026 + plan.years.length + 1 < u.rollingStartYear) {
          const padNum = plan.years.length + 1;
          plan.years.push({
            id: Engine.uid("yr"),
            yearNum: padNum,
            year: 2026 + padNum,
            name: `Year ${padNum} (${2026 + padNum})`,
            trimesters: { 1: [], 2: [], 3: [] },
          });
        }
        const newYNum = plan.years.length + 1;
        const newYr = {
          id: Engine.uid("yr"),
          yearNum: newYNum,
          year: 2026 + newYNum,
          name: `Year ${newYNum} (${2026 + newYNum})`,
          trimesters: { 1: [], 2: [], 3: [] },
        };
        newYr.trimesters[fallbackTri].push({ id: Engine.uid("u"), type: "unit", code });
        plan.years.push(newYr);
        placedLabel = `Y${newYNum} · T${fallbackTri}`;
      }
    } else {
      replacedPhNote = insertUnitIntoTrimester(plan.years[best.yIdx], best.tNum);
      placedLabel = `Y${plan.years[best.yIdx].yearNum} · T${best.tNum}`;
    }

    plan.hasUserEdits = true;
    saveState();
    renderAll({ resetSidebarScroll: false });
    showToast(
      replacedPhNote
        ? `Added ${code} → ${placedLabel} (filled ${replacedPhNote})`
        : `Added ${code} → ${placedLabel}`
    );
  }

  function removeSlot(yearIdx, triNum, slotId) {
    const plan = getCurrentPlan();
    const yr = plan.years[yearIdx];
    if (!yr) return;
    yr.trimesters[triNum] = (yr.trimesters[triNum] || []).filter((s) => s.id !== slotId);
    if (state.targetSlot && state.targetSlot.replaceSlotId === slotId) exitSlotPicker();
    plan.hasUserEdits = hasBoardAnySlots(plan) || Object.keys(plan.customUnits || {}).length > 0;
    saveState();
    renderAll({ resetSidebarScroll: false });
  }

  function moveSlotStep(yearIdx, triNum, slotId, delta) {
    const plan = getCurrentPlan();
    const yr = plan.years[yearIdx];
    if (!yr) return;
    const idx = yr.trimesters[triNum].findIndex((s) => s.id === slotId);
    if (idx === -1) return;

    const minFlatIdx = Math.max(0, (plan.commencingTrimester || 1) - 1);
    const curFlatIdx = yearIdx * 3 + (triNum - 1);
    let flatIdx = curFlatIdx + delta;
    if (delta < 0 && curFlatIdx === 0) return;
    if (delta < 0 && flatIdx < minFlatIdx && curFlatIdx >= minFlatIdx) {
      showToast(`Trimester ${(flatIdx % 3) + 1} is before your commencing Trimester T${plan.commencingTrimester || 1}.`);
      return;
    }
    if (flatIdx < 0) flatIdx = 0;

    const [slot] = yr.trimesters[triNum].splice(idx, 1);
    const newY = Math.floor(flatIdx / 3);
    const newT = (flatIdx % 3) + 1;
    while (plan.years.length <= newY) {
      const n = plan.years.length + 1;
      plan.years.push({
        id: Engine.uid("yr"),
        yearNum: n,
        year: 2026 + n,
        name: `Year ${n} (${2026 + n})`,
        trimesters: { 1: [], 2: [], 3: [] },
      });
    }
    plan.years[newY].trimesters[newT].push(slot);
    if (state.targetSlot && state.targetSlot.replaceSlotId === slotId) {
      state.targetSlot = buildPlaceholderTarget(slot, plan.years[newY], newY, newT);
    }
    plan.hasUserEdits = true;
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
    const bugLogCount = loadFeedbackLog().length;

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
              <button class="btn btn-hdr-lime" id="btn-auto-plan" title="Automatically schedule mandatory units and open student-choice slots">
                <span>✨ <span class="auto-plan-full">Auto-Plan</span><span class="auto-plan-short">Auto</span></span>
              </button>
              <button class="btn btn-hdr hdr-hide-mobile" id="btn-course-info" title="Course Rules, Outcomes &amp; Handbook">
                <span>📖 Info</span>
              </button>
              <button class="btn btn-hdr hdr-hide-mobile" id="btn-export-menu" title="Print, Export CSV/JSON or Reset">
                <span>⬇ Export</span>
              </button>
              <button class="btn btn-hdr hdr-hide-mobile" id="btn-report-bug" title="Log a bug or rule issue (auto-captures current course &amp; plan)">
                <span>🐞 Bug${bugLogCount ? ` (${bugLogCount})` : ""}</span>
              </button>
            `
            : `
              <button class="btn btn-hdr hdr-hide-mobile" id="btn-report-bug" title="Log a bug or feedback item">
                <span>🐞 Bug${bugLogCount ? ` (${bugLogCount})` : ""}</span>
              </button>
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

    const bugBtn = document.getElementById("btn-report-bug");
    if (bugBtn) bugBtn.onclick = () => openBugReportModal();

    document.getElementById("btn-theme-toggle").onclick = () => {
      document.documentElement.classList.toggle("dark");
      safeLocalSet(THEME_KEY, document.documentElement.classList.contains("dark") ? "dark" : "light");
      renderAll({ resetSidebarScroll: false });
    };
  }

  function runSmartAutoPlan() {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    if (!confirmAutoPlanOverwrite(plan)) return false;
    const generated = Engine.autoSchedulePlan(course, plan, DATA);
    generated.hasUserEdits = false;
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
        ? `Generated ${course.code} schedule! ${openPh.length} student-choice slot${openPh.length === 1 ? "" : "s"} ready to pick.`
        : `Generated complete schedule for ${course.code}!`
    );
    return true;
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
          if (state.finderActiveTopic !== -1) {
            const activeTopic = FINDER_TOPICS[state.finderActiveTopic];
            if (!activeTopic || (activeTopic.studyLevel || "ALL") !== state.finderLevel) {
              state.finderActiveTopic = -1;
            }
          }
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
                const notOff = getCourseNotOfferedLabel(c);
                const subBits = [
                  c.school.replace(/^School of /, ""),
                  `${c.totalCp} CP`,
                  notOff ? `⚠ ${notOff}` : "",
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
    const validAtar = formatValidAtar(c.atar);
    const notOfferedLabel = getCourseNotOfferedLabel(c);

    const majorsPreviewHtml =
      majorCount > 0 && !(res.matchedMajors && res.matchedMajors.length > 0)
        ? `<div class="finder-majors-preview">
             <strong>Majors:</strong> ${esc(majorTitles.slice(0, 4).join(", "))}${
               majorCount > 4 ? ` <em>+${majorCount - 4} more</em>` : ""
             }
           </div>`
        : "";

    return `
      <article class="finder-card ${cardTone} ${notOfferedLabel ? "not-offered-card" : ""}">
        <div class="finder-card-top">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span class="course-code-pill teal">${esc(c.code)}</span>
            <span class="meta-chip">${esc(c.studyLevel)}</span>
            ${c.isDoubleDegree ? `<span class="meta-chip" style="color:var(--une-blue);border-color:var(--info-border);background:var(--info-bg);">Double Degree</span>` : ""}
            ${notOfferedLabel ? `<span class="meta-chip not-offered" title="${esc(c.intakes || notOfferedLabel)}">⚠ ${esc(notOfferedLabel)}</span>` : ""}
          </div>
          <span style="font-weight:800;font-size:12.5px;color:var(--primary);font-variant-numeric:tabular-nums;">${esc(c.totalCp)} CP</span>
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
          ${validAtar ? `<span class="meta-chip">ATAR ${esc(validAtar)}</span>` : ""}
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
  function getActiveAosLabels(course, plan) {
    const cfg = course.structureConfig || {};
    const labels = [];
    const cleanAos = (code) =>
      (DATA.aos[code]?.title || code)
        .replace(/^[A-Z0-9]+\s*-\s*/, "")
        .replace(/\s*\((Major|Minor)\)\s*$/i, "");

    if (cfg.aosMode === "dynamic") {
      const activeGroups = Engine.getDynamicAOSGroups(course, plan, DATA).filter((g) => !g.isMandatorySingle);
      const dynSel = plan.dynamicAosSelections || {};
      for (const grp of activeGroups) {
        const chosen = dynSel[grp.id];
        if (chosen && grp.items.some((it) => it.code === chosen)) {
          labels.push(cleanAos(chosen));
        }
      }
      return labels;
    }

    const needMajors =
      (cfg.aosMode === "bsc" && plan.aosStructure === "2m") ||
      (cfg.aosMode === "bcomp" && plan.aosStructure === "opt3") ||
      (cfg.aosMode === "bit01" && plan.aosStructure === "2m")
        ? 2
        : ["bsc", "bcomp", "bit01", "single_major"].includes(cfg.aosMode)
        ? 1
        : 0;
    if (needMajors > 0) {
      const activeMajors = (plan.selectedMajors || []).slice(0, needMajors).filter(Boolean);
      activeMajors.forEach((mc) => labels.push(cleanAos(mc)));
    }

    const showMinor =
      (cfg.aosMode === "bsc" && plan.aosStructure === "1m1n") ||
      (cfg.aosMode === "bcomp" && plan.aosStructure === "opt2") ||
      (cfg.aosMode === "bbiosc" && plan.aosStructure === "minor") ||
      cfg.aosMode === "dscnce" ||
      cfg.aosMode === "mnsc_pathway";
    if (showMinor && plan.selectedMinor) {
      labels.push(`Minor/Pathway: ${cleanAos(plan.selectedMinor)}`);
    }
    return labels;
  }

  function renderConfigRibbon(course, plan, report) {
    const cfg = course.structureConfig;
    const opts = report.resolved.aosOptions;
    const ribbon = document.getElementById("config-ribbon");
    const mobToggle = document.getElementById("btn-mobile-config-toggle");
    const parts = [];

    // Summary line for mobile collapsible config button (active AOS only!)
    const summaryPieces = [];
    if (cfg.hasAdmissionRules && plan.admissionRule) summaryPieces.push(plan.admissionRule);
    const activeAos = getActiveAosLabels(course, plan);
    if (activeAos.length) {
      summaryPieces.push(activeAos.slice(0, 2).join(" + "));
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
        // Collapse blank placeholder slot in selectedMajors if switching back to 1-major mode
        if (!["2m", "opt3"].includes(plan.aosStructure) && Array.isArray(plan.selectedMajors)) {
          plan.selectedMajors = plan.selectedMajors.filter(Boolean);
        }
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
        const second = plan.selectedMajors[1] && plan.selectedMajors[1] !== v ? plan.selectedMajors[1] : "";
        if (v) {
          plan.selectedMajors = second ? [v, second] : [v];
        } else {
          plan.selectedMajors = second ? ["", second] : [];
        }
        saveState();
        renderAll({ resetSidebarScroll: false });
      };
    }
    const m2El = document.getElementById("sel-major-2");
    if (m2El) {
      m2El.onchange = (e) => {
        const v = e.target.value;
        const first = plan.selectedMajors[0] || "";
        if (v) {
          plan.selectedMajors = [first, v];
        } else {
          plan.selectedMajors = first ? [first] : [];
        }
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
      const nextVal = e.target.value;
      const prevVal = plan.t3Strategy || "none";
      const existingCount = Engine.getPlannedPlacements(plan, DATA).length;
      const stratNames = {
        none: "Off (T1 & T2)",
        spread: "Spread Load (3+3+2)",
        accelerate: "Fast-Track (If Possible)",
      };

      if (existingCount === 0) {
        plan.t3Strategy = nextVal;
        plan.includeT3InAuto = nextVal !== "none";
        plan.t3Analysis = null;
        exitSlotPicker();
        saveState();
        renderAll({ resetSidebarScroll: false });
        return;
      }

      // If the user has made edits (or legacy concrete units), confirm before overwriting and revert on cancel!
      if (!confirmAutoPlanOverwrite(plan)) {
        const sEl = document.getElementById("sel-t3-strategy");
        if (sEl) sEl.value = prevVal;
        if (e && e.target) e.target.value = prevVal;
        return;
      }

      plan.t3Strategy = nextVal;
      plan.includeT3InAuto = nextVal !== "none";
      const updated = Engine.autoSchedulePlan(course, plan, DATA);
      updated.hasUserEdits = false;
      state.savedPlansByCourse[course.code] = updated;
      const openPh = findOpenPlaceholders(updated);
      if (openPh.length > 0 && state.sidebarTab === "slot" && !isMobileViewport()) {
        activateSlotPicker(openPh[0], false);
      } else {
        exitSlotPicker();
      }
      saveState();
      renderAll({ resetSidebarScroll: false });
      showToast(`Re-scheduled ${course.code} with T3 strategy: ${stratNames[nextVal] || nextVal}.`);
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
          if (!confirmAutoPlanOverwrite(plan)) return;
          const pr = BSC_PRESETS[parseInt(btn.dataset.preset, 10)];
          plan.aosStructure = pr.structure;
          plan.selectedMajors = [...pr.majors];
          plan.selectedMinor = pr.minor;
          const generated = Engine.autoSchedulePlan(course, plan, DATA);
          generated.hasUserEdits = false;
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
  const UNIT_LEVEL_FILTERS = [0, 100, 200, 300, 400, 500, 600];

  function getFallbackBaseIneligibility(u, course, targetYear) {
    const reasons = [];
    if (!u) return reasons;
    const isRolling = u.offered2027 === false && Number.isInteger(u.rollingStartYear);
    if (u.offered2027 === false) {
      if (isRolling) {
        if (targetYear && targetYear < u.rollingStartYear) {
          reasons.push(`Rolling-start unit — scheduled from ${u.rollingStartYear}`);
        }
      } else {
        reasons.push("Not offered in 2027 (archived unit)");
      }
    }
    const pm = u.prereqMeta;
    const isUg = course.studyLevel === "Undergraduate" || course.studyLevel === "Pathway Programs" || course.studyLevel === "Other";
    const isPg = course.studyLevel === "Postgraduate" || course.studyLevel === "Postgraduate Research";
    if (isUg && u.level >= 500) {
      reasons.push(`Restricted to Postgraduate candidature (${u.level}-level)`);
    } else if (pm?.pgOnly && !isPg) {
      reasons.push("Restricted to Postgraduate candidature");
    } else if (pm?.honoursOnly && course.studyLevel !== "Bachelor Honours") {
      reasons.push("Restricted to Honours candidature");
    } else if (pm?.courseRestricted) {
      reasons.push(`Restricted candidature (${pm.courseRestricted})`);
    }
    if (Array.isArray(u.courseExclusions) && u.courseExclusions.includes(course.code)) {
      reasons.push(u.courseExclusionNote || `Excluded from ${course.code}`);
    }
    return reasons;
  }

  function getUnitIneligibilityReasons(u, course, plan, slotEval, slotEligSet, slotIneligMap, includePoolCheck) {
    if (!u) return null;
    if (state.targetSlot && slotEval) {
      if (isUnitPlanned(u.code, plan) && !u.repeatable) return null;
      if (slotEligSet.has(u.code)) return null;
      if (slotIneligMap.has(u.code)) return slotIneligMap.get(u.code);
      if (typeof slotEval.evaluateAnyUnit === "function") {
        const ev = slotEval.evaluateAnyUnit(u.code, !includePoolCheck);
        return ev && !ev.eligible && ev.reasons?.length ? ev.reasons : null;
      }
      // Defensive fallback if Engine.resolveSlotCandidates doesn't expose evaluateAnyUnit
      const targetYr = state.targetSlot.planYear || getPlanYear(plan.years[state.targetSlot.yearIdx], state.targetSlot.yearIdx);
      const reasons = getFallbackBaseIneligibility(u, course, targetYr);
      const triNum = state.targetSlot.triNum;
      if (u.offered2027 !== false && u.trimesters && u.trimesters.length > 0 && !u.trimesters.includes(triNum)) {
        reasons.push(
          targetYr > 2027
            ? `Not offered in Trimester ${triNum} (based on 2027 Handbook: T${u.trimesters.join(", T")})`
            : `Not offered in Trimester ${triNum} (offered in T${u.trimesters.join(", T")})`
        );
      }
      if (u.t3RepeatOnly && triNum === 3) {
        reasons.push("Trimester 3 is for repeating students only");
      }
      if (slotEval.spec?.allowedLevels && !slotEval.spec.allowedLevels.includes(u.level)) {
        reasons.push(`Slot requires ${slotEval.spec.allowedLevels.join("/")}-level (${u.code} is ${u.level}-level)`);
      }
      if (slotEval.spec?.allowedPrefixes && !slotEval.spec.allowedPrefixes.includes(u.prefix)) {
        reasons.push(`Slot requires ${slotEval.spec.allowedPrefixes.join("/")} prefix`);
      }
      const maxLoad = plan.studyLoad === "Part-time" ? 12 : 24;
      const uEffCp = getUnitEffectiveCp(u, 6);
      const curCp = slotEval.curTriCp ?? 0;
      if (curCp + uEffCp > maxLoad && !(curCp === 0 && uEffCp > maxLoad)) {
        reasons.push(`Exceeds ${maxLoad} CP trimester load (${curCp + uEffCp} CP)`);
      }
      if (includePoolCheck && slotEval.spec?.strictPoolOnly && !slotEval.spec.coursePoolMap?.has(u.code)) {
        reasons.push(`Outside this slot's required pool (${slotEval.spec.title || "Prescribed Units"})`);
      }
      return reasons.length > 0 ? reasons : null;
    }

    // Outside a targeted slot, allow rolling-start units to appear browseable in future years
    const maxPlanYr = Math.max(2027, ...(plan.years || []).map((yr, i) => getPlanYear(yr, i)));
    if (typeof Engine.getBaseUnitIneligibility === "function") {
      const reasons = Engine.getBaseUnitIneligibility(u, course, plan, DATA, maxPlanYr);
      return reasons && reasons.length > 0 ? reasons : null;
    }
    const reasons = getFallbackBaseIneligibility(u, course, maxPlanYr);
    return reasons.length > 0 ? reasons : null;
  }

  function renderSidebar(course, plan, report, opts) {
    const sb = document.getElementById("sidebar");
    const prevBodyEl = document.getElementById("sidebar-body-scroll");
    const savedInnerScroll = opts?.resetScroll ? 0 : prevBodyEl ? prevBodyEl.scrollTop : 0;
    const savedOuterScroll = opts?.resetScroll ? 0 : sb.scrollTop;

    if (state.sidebarTab === "slot" && !state.targetSlot) state.sidebarTab = "requirements";

    const { buckets, majorCoreHints } = report.resolved;
    let slotEval = null;
    const slotEligSet = new Set();
    const slotIneligMap = new Map();
    if (state.targetSlot) {
      slotEval = Engine.resolveSlotCandidates(state.targetSlot, course, plan, DATA, {
        forceIncludeElectives: state.slotForceElectives,
      });
      slotEval.eligible.forEach((i) => slotEligSet.add(i.code));
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

    function computeCatalogPartition(qRaw) {
      const q2 = qRaw.trim().toLowerCase();
      const allList = [
        ...Object.values(DATA.units),
        ...Object.values(plan.customUnits || {}).filter((cu) => !DATA.units[cu.code]),
      ].filter((u) => {
        if (state.catalogLevel !== "all" && String(u.level) !== state.catalogLevel) return false;
        if (state.catalogTri !== "all" && !(u.trimesters || []).includes(parseInt(state.catalogTri, 10))) return false;
        if (state.catalogPrefix !== "all" && u.prefix !== state.catalogPrefix) return false;
        if (q2 && !`${u.code} ${u.title} ${u.school}`.toLowerCase().includes(q2)) return false;
        return true;
      });
      const topUnits = [];
      const bottomInelig = [];
      const includePool = !state.slotForceElectives;
      for (const u of allList) {
        const reasons = getUnitIneligibilityReasons(u, course, plan, slotEval, slotEligSet, slotIneligMap, includePool);
        if (reasons && reasons.length > 0) bottomInelig.push({ unit: u, reasons });
        else topUnits.push(u);
      }
      topUnits.sort((a, b) => a.code.localeCompare(b.code));
      bottomInelig.sort((a, b) => a.unit.code.localeCompare(b.unit.code));
      const showCatInelig =
        state.catalogShowIneligible !== null ? state.catalogShowIneligible : topUnits.length === 0 || q2.length > 0;
      return { topUnits, bottomInelig, showCatInelig };
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
      const filteredSwap = (slotEval.siblingSwapEligible || []).filter(filterFn);
      const filteredIneligible = slotEval.ineligible.filter(filterFn);
      const autoExpandInelig =
        state.slotShowIneligible !== null
          ? state.slotShowIneligible
          : (filteredEligible.length === 0 && filteredSwap.length === 0) || q.length > 0;
      const courseEligCount = slotEval.eligible.filter((x) => x.inCoursePool).length;
      const elecEligCount = slotEval.eligible.filter((x) => !x.inCoursePool).length;

      bodyHtml = `
        <div class="slot-context-box">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-weight:800;font-size:13px;color:var(--info);">
                🎯 Filling Year ${yr?.yearNum || state.targetSlot.yearIdx + 1} (${getPlanYear(yr, state.targetSlot.yearIdx)}) · Trimester ${state.targetSlot.triNum}
              </div>
              <div style="font-weight:700;font-size:12px;color:var(--text);margin-top:1px;">${esc(slotEval.spec.title)}</div>
              <div style="font-size:11px;color:var(--text-subtle);">${esc(slotEval.spec.subtitle)}</div>
            </div>
            <button class="btn btn-sm" id="btn-exit-slot">✕ Exit</button>
          </div>

          ${
            slotEval.eligible.length + (slotEval.siblingSwapEligible?.length || 0) + slotEval.ineligible.length > 4 ||
            q ||
            state.slotLevelFilter !== "all"
              ? `<div style="display:flex;gap:6px;margin-top:2px;">
                  <input type="search" class="text-input" id="inp-slot-search" placeholder="Filter units or check why ineligible…" value="${esc(
                    state.slotQuery
                  )}" style="flex:1;min-width:0;background:var(--surface);" />
                  <select class="select-input" id="sel-slot-level" style="background:var(--surface);">
                    <option value="all">Levels</option>
                    ${UNIT_LEVEL_FILTERS.map(
                      (l) =>
                        `<option value="${l}" ${state.slotLevelFilter === String(l) ? "selected" : ""}>${
                          l === 0 ? "L0 (Pathway)" : `L${l}`
                        }</option>`
                    ).join("")}
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
          ${renderSlotListInner(slotEval, filteredEligible, filteredSwap, filteredIneligible, autoExpandInelig, plan)}
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
          } else if (state.targetSlot && slotEval) {
            const eligInBucket = [];
            const plannedInBucket = [];
            const ineligInBucket = [];
            const includePool = !state.slotForceElectives;
            for (const uCode of baseUnits) {
              const uObj = Engine.getUnit(uCode, DATA, plan.customUnits);
              if (isUnitPlanned(uCode, plan) && !uObj?.repeatable) {
                plannedInBucket.push(uCode);
              } else {
                const reasons = getUnitIneligibilityReasons(uObj, course, plan, slotEval, slotEligSet, slotIneligMap, includePool);
                if (reasons && reasons.length > 0) ineligInBucket.push({ code: uCode, unit: uObj, reasons });
                else eligInBucket.push(uCode);
              }
            }
            bucketCardsHtml = [
              ...eligInBucket.map((uCode) => renderPoolUnitCard(uCode, plan, majorCoreHints)),
              ...plannedInBucket.map((uCode) => renderPoolUnitCard(uCode, plan, majorCoreHints)),
              ...(ineligInBucket.length
                ? [
                    `<div style="font-size:10.5px;font-weight:700;color:var(--warn);margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);">
                      Not eligible for Y${plan.years[state.targetSlot.yearIdx]?.yearNum || 1} · T${state.targetSlot.triNum} (${ineligInBucket.length}):
                    </div>`,
                    ...ineligInBucket.map((entry) =>
                      renderIneligibleUnitCard(entry.code, entry.unit, entry.reasons, null, false)
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
                  <span class="bucket-cp-pill ${esc(b.status)}" title="${
                    b.placeholderCp
                      ? `${b.plannedCp} CP chosen + ${b.placeholderCp} CP open student-choice slot(s)`
                      : `${b.plannedCp} CP planned`
                  }">${esc(cpLabel)}${b.placeholderCount ? ` (+${b.placeholderCount} open)` : ""}</span>
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
      const { topUnits, bottomInelig, showCatInelig } = computeCatalogPartition(state.catalogQuery);

      bodyHtml = `
        <div class="catalog-search-sticky" style="display:flex;flex-direction:column;gap:8px;position:sticky;top:0;background:var(--surface);padding-bottom:8px;z-index:5;border-bottom:1px solid var(--border);flex-shrink:0;">
          <input type="search" class="text-input" id="inp-catalog-search" placeholder="Search ${DATA.meta.counts.units.toLocaleString()} UNE units by code, title, school…" value="${esc(
            state.catalogQuery
          )}" style="width:100%;" />
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
            <select class="select-input" id="sel-cat-level">
              <option value="all">All Levels</option>
              ${UNIT_LEVEL_FILTERS.map(
                (l) =>
                  `<option value="${l}" ${state.catalogLevel === String(l) ? "selected" : ""}>${
                    l === 0 ? "L0 (Pathway)" : `L${l}`
                  }</option>`
              ).join("")}
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

    function refreshSlotResultsInPlace() {
      if (!slotEval) return;
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
      const fs = (slotEval.siblingSwapEligible || []).filter(filter2);
      const fi = slotEval.ineligible.filter(filter2);
      const autoExp =
        state.slotShowIneligible !== null
          ? state.slotShowIneligible
          : (fe.length === 0 && fs.length === 0) || q2.length > 0;
      wrap.innerHTML = renderSlotListInner(slotEval, fe, fs, fi, autoExp, plan);
      bindSlotListControls(wrap, autoExp);
      bindUnitTriggers(wrap, plan);
    }

    function bindSlotListControls(wrap, currentExpanded) {
      const tBtn = wrap.querySelector("#btn-toggle-slot-inelig");
      if (tBtn) {
        tBtn.onclick = () => {
          state.slotShowIneligible = !currentExpanded;
          refreshSlotResultsInPlace();
        };
      }
      const moreElig = wrap.querySelector("#btn-slot-more-elig");
      if (moreElig) {
        moreElig.onclick = () => {
          state.slotEligLimit += 100;
          refreshSlotResultsInPlace();
        };
      }
      const moreSwap = wrap.querySelector("#btn-slot-more-swap");
      if (moreSwap) {
        moreSwap.onclick = () => {
          state.slotSwapLimit += 60;
          refreshSlotResultsInPlace();
        };
      }
      const moreInelig = wrap.querySelector("#btn-slot-more-inelig");
      if (moreInelig) {
        moreInelig.onclick = () => {
          state.slotIneligLimit += 80;
          refreshSlotResultsInPlace();
        };
      }
    }

    const slotWrapEl = document.getElementById("slot-results-wrap");
    if (slotWrapEl && slotEval) {
      const qInit = state.slotQuery.trim().toLowerCase();
      const hasBothInit = slotEval.spec.allowsElectives && slotEval.spec.coursePoolMap && slotEval.spec.coursePoolMap.size > 0;
      const filterInit = (item) => {
        if (state.slotLevelFilter !== "all" && String(item.unit.level) !== state.slotLevelFilter) return false;
        if (hasBothInit) {
          if (state.slotPoolFilter === "course" && !item.inCoursePool) return false;
          if (state.slotPoolFilter === "elective" && item.inCoursePool) return false;
        }
        if (qInit && !`${item.code} ${item.unit.title} ${item.poolLabel} ${item.unit.school}`.toLowerCase().includes(qInit)) return false;
        return true;
      };
      const feCount = slotEval.eligible.filter(filterInit).length;
      const fsCount = (slotEval.siblingSwapEligible || []).filter(filterInit).length;
      const initExpanded =
        state.slotShowIneligible !== null
          ? state.slotShowIneligible
          : (feCount === 0 && fsCount === 0) || qInit.length > 0;
      bindSlotListControls(slotWrapEl, initExpanded);
    }

    const slotSearchInp = document.getElementById("inp-slot-search");
    if (slotSearchInp && slotEval) {
      const onSlotSearch = () => {
        state.slotQuery = slotSearchInp.value;
        state.slotShowIneligible = null;
        state.slotEligLimit = 100;
        state.slotSwapLimit = 60;
        state.slotIneligLimit = 80;
        refreshSlotResultsInPlace();
      };
      slotSearchInp.addEventListener("input", onSlotSearch);
      slotSearchInp.addEventListener("search", onSlotSearch);
      slotSearchInp.addEventListener("compositionend", onSlotSearch);
    }
    const slotLvlSel = document.getElementById("sel-slot-level");
    if (slotLvlSel) {
      slotLvlSel.onchange = (e) => {
        state.slotLevelFilter = e.target.value;
        state.slotShowIneligible = null;
        state.slotEligLimit = 100;
        state.slotSwapLimit = 60;
        state.slotIneligLimit = 80;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }
    sb.querySelectorAll("[data-spool]").forEach((btn) => {
      btn.onclick = () => {
        state.slotPoolFilter = btn.dataset.spool;
        state.slotEligLimit = 100;
        state.slotSwapLimit = 60;
        state.slotIneligLimit = 80;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    });
    const forceElecChk = document.getElementById("chk-slot-force-elec");
    if (forceElecChk) {
      forceElecChk.onchange = (e) => {
        state.slotForceElectives = e.target.checked;
        state.slotShowIneligible = null;
        state.slotEligLimit = 100;
        state.slotSwapLimit = 60;
        state.slotIneligLimit = 80;
        renderSidebar(course, plan, report, { resetScroll: true });
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

    function refreshCatalogInPlace() {
      const wrap = document.getElementById("catalog-results-wrap");
      if (!wrap) return;
      const { topUnits, bottomInelig, showCatInelig } = computeCatalogPartition(state.catalogQuery);
      const cLbl = document.getElementById("cat-count-lbl");
      if (cLbl) cLbl.textContent = `${topUnits.length} eligible${bottomInelig.length ? ` · ${bottomInelig.length} restricted below` : ""}`;
      wrap.innerHTML = renderCatalogListInner(topUnits, bottomInelig, showCatInelig, course, plan, majorCoreHints);
      bindCatalogListControls(wrap, showCatInelig);
      bindUnitTriggers(wrap, plan);
    }

    function bindCatalogListControls(wrap, currentExpanded) {
      const tBtn = wrap.querySelector("#btn-toggle-cat-inelig");
      if (tBtn) {
        tBtn.onclick = () => {
          state.catalogShowIneligible = !currentExpanded;
          refreshCatalogInPlace();
        };
      }
      const moreElig = wrap.querySelector("#btn-cat-more-elig");
      if (moreElig) {
        moreElig.onclick = () => {
          state.catEligLimit += 80;
          refreshCatalogInPlace();
        };
      }
      const moreInelig = wrap.querySelector("#btn-cat-more-inelig");
      if (moreInelig) {
        moreInelig.onclick = () => {
          state.catIneligLimit += 60;
          refreshCatalogInPlace();
        };
      }
    }

    const catWrapEl = document.getElementById("catalog-results-wrap");
    if (catWrapEl) {
      const { showCatInelig } = computeCatalogPartition(state.catalogQuery);
      bindCatalogListControls(catWrapEl, showCatInelig);
    }

    const searchInp = document.getElementById("inp-catalog-search");
    if (searchInp) {
      const onCatSearch = () => {
        state.catalogQuery = searchInp.value;
        state.catalogShowIneligible = null;
        state.catEligLimit = 80;
        state.catIneligLimit = 60;
        refreshCatalogInPlace();
      };
      searchInp.addEventListener("input", onCatSearch);
      searchInp.addEventListener("search", onCatSearch);
      searchInp.addEventListener("compositionend", onCatSearch);
    }
    const lvlSel = document.getElementById("sel-cat-level");
    if (lvlSel) {
      lvlSel.onchange = (e) => {
        state.catalogLevel = e.target.value;
        state.catalogShowIneligible = null;
        state.catEligLimit = 80;
        state.catIneligLimit = 60;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }
    const triSel = document.getElementById("sel-cat-tri");
    if (triSel) {
      triSel.onchange = (e) => {
        state.catalogTri = e.target.value;
        state.catalogShowIneligible = null;
        state.catEligLimit = 80;
        state.catIneligLimit = 60;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }
    const prefSel = document.getElementById("sel-cat-prefix");
    if (prefSel) {
      prefSel.onchange = (e) => {
        state.catalogPrefix = e.target.value;
        state.catalogShowIneligible = null;
        state.catEligLimit = 80;
        state.catIneligLimit = 60;
        renderSidebar(course, plan, report, { resetScroll: true });
      };
    }

    bindUnitTriggers(sb, plan);
  }

  function renderSlotListInner(slotEval, filteredEligible, filteredSwap, filteredIneligible, autoExpandInelig, plan) {
    const eligShown = filteredEligible.slice(0, state.slotEligLimit);
    const swapList = Array.isArray(filteredSwap) ? filteredSwap : [];
    const swapShown = swapList.slice(0, state.slotSwapLimit);
    const ineligShown = filteredIneligible.slice(0, state.slotIneligLimit);

    // Group sibling-swap candidates by target sibling trimester (e.g. T2 first when viewing T1)
    let swapSectionHtml = "";
    if (swapShown.length > 0) {
      const grouped = new Map();
      for (const item of swapShown) {
        const k = item.siblingTri;
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k).push(item);
      }
      const totalByTri = new Map();
      for (const item of swapList) {
        totalByTri.set(item.siblingTri, (totalByTri.get(item.siblingTri) || 0) + 1);
      }
      const parts = [];
      for (const [sibTri, grpItems] of grouped.entries()) {
        const sumMeta = slotEval.swapSummary?.[sibTri] || slotEval.swapSummary?.[String(sibTri)] || grpItems[0];
        const swapShort = sumMeta?.swapPlaceholderShort || sumMeta?.swapPlaceholderLabel || "Elective";
        const grpTotal = totalByTri.get(sibTri) || grpItems.length;
        parts.push(`
          <div class="swap-category-hdr">
            <span>↔ Available in Trimester ${sibTri} — Auto-Swaps Slot</span>
            <span>${grpTotal} unit${grpTotal === 1 ? "" : "s"}</span>
          </div>
          <div class="swap-category-sub">
            Places unit in Trimester ${sibTri} and moves your T${sibTri} ${esc(swapShort)} slot to Trimester ${slotEval.triNum}.
          </div>
          ${grpItems.map((item) => renderSlotSwapCard(item, plan, slotEval)).join("")}
        `);
      }
      if (swapList.length > swapShown.length) {
        parts.push(`
          <div class="catalog-trunc-bar">
            <span>Showing ${swapShown.length} of ${swapList.length} auto-swap units</span>
            <button class="btn btn-sm btn-soft" id="btn-slot-more-swap" type="button">Show more (+${Math.min(60, swapList.length - swapShown.length)})</button>
          </div>
        `);
      }
      swapSectionHtml = parts.join("");
    }

    return `
      <div class="elig-category-hdr">
        <span>✅ Eligible for Y${slotEval.yearNum} · T${slotEval.triNum}</span>
        <span>${filteredEligible.length} unit${filteredEligible.length === 1 ? "" : "s"}</span>
      </div>

      ${
        filteredEligible.length === 0
          ? `<div style="padding:12px;border:1px dashed var(--border-strong);border-radius:8px;font-size:12px;color:var(--text-subtle);text-align:center;">
              ${
                swapList.length > 0
                  ? `No units offered directly in Y${slotEval.yearNum} · T${slotEval.triNum} — use <strong>1-click Auto-Swap</strong> below to pick from Trimester ${swapList[0].siblingTri}!`
                  : `No eligible units match for Y${slotEval.yearNum} · T${slotEval.triNum}. See reasons in the Ineligible section below.`
              }
            </div>`
          : eligShown.map((item) => renderSlotEligibleCard(item, plan)).join("")
      }

      ${
        filteredEligible.length > eligShown.length
          ? `<div class="catalog-trunc-bar">
              <span>Showing ${eligShown.length} of ${filteredEligible.length} eligible units</span>
              <button class="btn btn-sm btn-soft" id="btn-slot-more-elig" type="button">Show more (+${Math.min(100, filteredEligible.length - eligShown.length)})</button>
            </div>`
          : ""
      }

      ${swapSectionHtml}

      ${
        filteredIneligible.length > 0
          ? `
            <button class="inelig-category-toggle" id="btn-toggle-slot-inelig" type="button">
              <span>🚫 Ineligible for Y${slotEval.yearNum} · T${slotEval.triNum} (${filteredIneligible.length})</span>
              <span style="font-size:11px;">${autoExpandInelig ? "Hide ▴" : "Show why ▾"}</span>
            </button>
            ${
              autoExpandInelig
                ? ineligShown
                    .map((item) => renderIneligibleUnitCard(item.code, item.unit, item.reasons, item.poolLabel, true))
                    .join("") +
                  (filteredIneligible.length > ineligShown.length
                    ? `<div class="catalog-trunc-bar">
                        <span>Showing ${ineligShown.length} of ${filteredIneligible.length} ineligible units</span>
                        <button class="btn btn-sm btn-soft" id="btn-slot-more-inelig" type="button">Show more (+${Math.min(80, filteredIneligible.length - ineligShown.length)})</button>
                      </div>`
                    : "")
                : ""
            }
          `
          : ""
      }
    `;
  }

  function renderSlotSwapCard(item, plan, slotEval) {
    const u = item.unit;
    const targetYr = state.targetSlot
      ? state.targetSlot.planYear || getPlanYear(plan?.years?.[state.targetSlot.yearIdx], state.targetSlot.yearIdx)
      : 2027;
    const isRolling = u.offered2027 === false && Number.isInteger(u.rollingStartYear);
    const swapShort = item.swapPlaceholderShort || item.swapPlaceholderLabel || "Elective";
    const swapTip = `Places ${item.code} in Year ${slotEval.yearNum} T${item.siblingTri} and moves your T${item.siblingTri} ${swapShort} slot to T${slotEval.triNum}`;
    return `
      <div class="pool-unit swap-unit-card ${item.majorRequiredBy ? "major-req" : ""}" draggable="true" data-drag-pool-code="${esc(item.code)}">
        <div class="pool-unit-top">
          <button class="unit-code-link" data-inspect-unit="${esc(item.code)}">${esc(item.code)} · ${esc(u.cp ?? 6)} CP</button>
          <button class="btn btn-sm btn-swap-add" data-swap-add="${esc(item.code)}|${item.siblingTri}|${esc(item.swapPlaceholderId)}" title="${esc(swapTip)}">Swap &amp; Add →</button>
        </div>
        <div class="pool-unit-title">${esc(u.title)}</div>
        <div class="pool-unit-meta">
          <div class="tri-pills">
            <span class="badge-mini badge-swap-tri" title="${esc(swapTip)}">↔ T${item.siblingTri} · Swaps with ${esc(swapShort)}</span>
            <span class="badge-mini" style="${
              item.inCoursePool
                ? "background:var(--primary-soft);color:var(--primary);border:1px solid var(--primary-border);"
                : "background:var(--surface-alt);color:var(--text-subtle);border:1px solid var(--border);"
            }">${esc(item.poolLabel)}</span>
            ${item.helpsLevelMin ? `<span class="badge-mini" style="background:var(--cat-major1-bg);color:var(--cat-major1);border:1px solid var(--cat-major1);">L${esc(u.level)} Target</span>` : ""}
            ${renderIntensiveBadgeMini(u, item.siblingTri, plan?.preferredMode, targetYr)}
            ${u.yearLong ? `<span class="badge-mini badge-yearlong">Year-Long</span>` : ""}
            ${isRolling ? `<span class="badge-mini badge-rolling">🗓 From ${esc(u.rollingStartYear)}</span>` : ""}
            ${item.modeWarning ? `<span class="badge-mini badge-intensive">${esc(item.modeWarning)}</span>` : ""}
          </div>
          <div class="tri-pills">${renderUnitTrimesterPills(u, item.siblingTri)}</div>
        </div>
      </div>
    `;
  }

  function renderCatalogListInner(topUnits, bottomInelig, showCatInelig, course, plan, majorCoreHints) {
    const eligShown = topUnits.slice(0, state.catEligLimit);
    const ineligShown = bottomInelig.slice(0, state.catIneligLimit);
    return `
      ${eligShown.map((u) => renderPoolUnitCard(u.code, plan, majorCoreHints)).join("")}

      ${
        topUnits.length > eligShown.length
          ? `<div class="catalog-trunc-bar">
              <span>Showing ${eligShown.length} of ${topUnits.length} eligible units — refine search or load more</span>
              <button class="btn btn-sm btn-soft" id="btn-cat-more-elig" type="button">Show more (+${Math.min(80, topUnits.length - eligShown.length)})</button>
            </div>`
          : ""
      }

      ${
        bottomInelig.length > 0
          ? `
            <button class="inelig-category-toggle" id="btn-toggle-cat-inelig" type="button">
              <span>🚫 ${
                state.targetSlot
                  ? `Ineligible for Y${plan.years[state.targetSlot.yearIdx]?.yearNum || 1} · T${state.targetSlot.triNum}`
                  : `Restricted / Not Eligible for ${esc(course.code)}`
              } (${bottomInelig.length})</span>
              <span style="font-size:11px;">${showCatInelig ? "Hide ▴" : "Show reasons ▾"}</span>
            </button>
            ${
              showCatInelig
                ? ineligShown
                    .map((it) => renderIneligibleUnitCard(it.unit.code, it.unit, it.reasons, null, false))
                    .join("") +
                  (bottomInelig.length > ineligShown.length
                    ? `<div class="catalog-trunc-bar">
                        <span>Showing ${ineligShown.length} of ${bottomInelig.length} restricted units</span>
                        <button class="btn btn-sm btn-soft" id="btn-cat-more-inelig" type="button">Show more (+${Math.min(60, bottomInelig.length - ineligShown.length)})</button>
                      </div>`
                    : "")
                : ""
            }
          `
          : ""
      }
    `;
  }

  function renderIntensiveBadgeMini(u, triNum, preferredMode, planYear) {
    const info = Engine.getUnitIntensiveForTri(u, triNum, preferredMode, planYear);
    if (!info || info.kind !== "Mandatory") return "";
    if (info.applicableForMode === false) return "";
    const shortLoc = info.location
      ? ` (${info.location.replace(" (TBC)", "").replace(" (Choice)", " · Choice")})`
      : "";
    const entries = info.entries || [];
    const hasMixedTba = Boolean(info.mixedTba || (triNum == null && u.intensiveMixedTba));
    const isMultiCohort = Boolean(info.multiCohort || Object.values(u.intensiveByTri || {}).some((x) => x?.multiCohort));
    const sameTriMulti =
      triNum != null
        ? entries.length > 1
        : Object.values(u.intensiveByTri || {}).some((x) => (x?.entries || []).length > 1);
    const dateSummary =
      entries.length > 1
        ? entries
            .map((e) => `${e.title ? e.title + ": " : Array.isArray(e.tris) && e.tris.length ? `T${e.tris.join("/T")}: ` : ""}${e.tba ? "TBA" : (e.dates || []).join(", ")}`)
            .join(" | ")
        : (info.dates || []).join(", ");

    // Future-year (2028+) calm guide badge: NEVER present 2027 dates as confirmed future dates or show red 2027 TBA
    const isFutureGuide = Boolean(info.isHistoricalGuide || (Number.isInteger(planYear) && planYear > 2027));
    if (isFutureGuide) {
      const guideTip = dateSummary
        ? `Mandatory Intensive School (${info.location}) — ${planYear} dates TBA (2027 draft guide: ${dateSummary})`
        : `Mandatory Intensive School (${info.location}) — ${planYear} dates TBA (check UNE Handbook when published)`;
      return `<span class="badge-mini badge-int-guide" title="${esc(guideTip)}">📅 Intensive${esc(shortLoc)} · ${esc(planYear)} TBA</span>`;
    }

    if (info.tba) {
      return `<span class="badge-mini badge-int-tba" title="Mandatory Intensive School (${esc(info.location)}) — 2027 Dates TBA (check dates)">🔴 Intensive${esc(shortLoc)} · TBA</span>`;
    }
    if (hasMixedTba) {
      return `<span class="badge-mini badge-int-tba" title="Mandatory Intensive School (${esc(info.location)}): ${esc(dateSummary)} (2027 provisional draft — subject to confirmation; some trimesters TBA)">🔴 Intensive${esc(shortLoc)} · Some TBA</span>`;
    }
    const cohortTag =
      sameTriMulti && entries.length > 1
        ? `<span class="badge-mini badge-int-cohort" title="${esc(dateSummary)} (2027 draft — subject to confirmation)">${isMultiCohort ? `${entries.length} Cohorts` : `${entries.length} Blocks`}</span>`
        : "";
    return `<span class="badge-mini badge-intensive" title="Mandatory Intensive School (${esc(info.location)}): ${esc(dateSummary)} (2027 provisional draft dates — subject to confirmation)">🏫 Intensive${esc(shortLoc)}</span>${cohortTag}`;
  }

  function renderUnitTrimesterPills(u, activeTriNum) {
    if (u && u.trimesters && u.trimesters.length > 0) {
      if (activeTriNum !== undefined && activeTriNum !== null) {
        return u.trimesters
          .map((t) => `<span class="tri-pill ${t === activeTriNum ? "active-tri" : ""}">T${t}</span>`)
          .join("");
      }
      return [1, 2, 3]
        .map((t) =>
          u.trimesters.includes(t)
            ? `<span class="tri-pill active-tri">T${t}</span>`
            : `<span class="tri-pill" style="opacity:0.35;">T${t}</span>`
        )
        .join("");
    }
    if (u && u.offered2027 === false && Number.isInteger(u.rollingStartYear)) {
      const ind = Array.isArray(u.indicativeTrimesters) && u.indicativeTrimesters.length
        ? u.indicativeTrimesters.map((t) => `<span class="tri-pill ${t === activeTriNum ? "active-tri" : ""}" title="Indicative trimester from study plan">~T${t}</span>`).join("")
        : "";
      return `${ind}<span class="badge-mini badge-rolling" title="Rolling-start unit scheduled from ${esc(u.rollingStartYear)}">From ${esc(u.rollingStartYear)}</span>`;
    }
    if (u && u.offered2027 !== false && u.nonStandardPeriods && u.nonStandardPeriods.length > 0) {
      return `<span class="tri-pill active-tri" title="Non-standard teaching period: ${esc(u.nonStandardPeriods.join(", "))}">${esc(u.nonStandardPeriods[0])}</span>`;
    }
    return [1, 2, 3].map((t) => `<span class="tri-pill" style="opacity:0.35;">T${t}</span>`).join("");
  }

  function renderSlotEligibleCard(item, plan) {
    const u = item.unit;
    const targetTri = state.targetSlot ? state.targetSlot.triNum : null;
    const targetYr = state.targetSlot
      ? state.targetSlot.planYear || getPlanYear(plan?.years?.[state.targetSlot.yearIdx], state.targetSlot.yearIdx)
      : 2027;
    const isRolling = u.offered2027 === false && Number.isInteger(u.rollingStartYear);
    return `
      <div class="pool-unit ${item.majorRequiredBy ? "major-req" : ""}" draggable="true" data-drag-pool-code="${esc(item.code)}">
        <div class="pool-unit-top">
          <button class="unit-code-link" data-inspect-unit="${esc(item.code)}">${esc(item.code)} · ${esc(u.cp ?? 6)} CP</button>
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
            ${item.helpsLevelMin ? `<span class="badge-mini" style="background:var(--cat-major1-bg);color:var(--cat-major1);border:1px solid var(--cat-major1);">L${esc(u.level)} Target</span>` : ""}
            ${renderIntensiveBadgeMini(u, targetTri, plan?.preferredMode, targetYr)}
            ${u.yearLong ? `<span class="badge-mini badge-yearlong">Year-Long</span>` : ""}
            ${isRolling ? `<span class="badge-mini badge-rolling">🗓 From ${esc(u.rollingStartYear)}</span>` : ""}
            ${item.modeWarning ? `<span class="badge-mini badge-intensive">${esc(item.modeWarning)}</span>` : ""}
          </div>
          <div class="tri-pills">${(u.trimesters || []).length ? u.trimesters.map((t) => `<span class="tri-pill active-tri">T${t}</span>`).join("") : renderUnitTrimesterPills(u)}</div>
        </div>
      </div>
    `;
  }

  function renderIneligibleUnitCard(code, u, reasons, poolLabel, allowOverride) {
    if (!u) return "";
    const canOverride = allowOverride && (u.offered2027 !== false || Number.isInteger(u.rollingStartYear));
    return `
      <div class="pool-unit ineligible-card">
        <div class="pool-unit-top">
          <button class="unit-code-link" data-inspect-unit="${esc(code)}">${esc(code)} · ${esc(u.cp ?? 6)} CP</button>
          <div style="display:flex;align-items:center;gap:4px;">
            ${poolLabel ? `<span style="font-size:10px;color:var(--text-subtle);">${esc(poolLabel)}</span>` : ""}
            ${
              canOverride
                ? `<button class="btn btn-sm" style="padding:1px 6px;font-size:10.5px;min-height:24px;color:var(--text-subtle);" data-add-unit="${esc(code)}" data-add-override="1" title="Add with manual override">Override</button>`
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
                  r.startsWith("Pre-requisite") || r.startsWith("Requires") || r.startsWith("Co-requisite") || r.startsWith("Rolling-start") ? "soft" : ""
                }">${
                  r.startsWith("Not offered") || r.startsWith("Restricted") || r.startsWith("Incompatible") || r.startsWith("Cannot") || r.startsWith("Exceeds") || r.startsWith("Outside") || r.startsWith("Excluded")
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
    const isRolling = u.offered2027 === false && Number.isInteger(u.rollingStartYear);
    const isArchived = u.offered2027 === false && !isRolling;

    return `
      <div class="pool-unit ${plannedLoc && !u.repeatable ? "planned" : ""} ${reqByMajors ? "major-req" : ""}"
           draggable="${(!plannedLoc || u.repeatable) && !isArchived}"
           data-drag-pool-code="${esc(code)}">
        <div class="pool-unit-top">
          <button class="unit-code-link" data-inspect-unit="${esc(code)}">${esc(code)} · ${esc(u.cp ?? 6)} CP</button>
          ${
            plannedLoc && !u.repeatable
              ? `<span class="badge-mini" style="background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-border);">✓ ${esc(plannedLoc)}</span>`
              : isArchived
              ? `<span class="badge-mini badge-archived">Not offered 2027</span>`
              : `<button class="btn btn-sm btn-soft" data-add-unit="${esc(code)}">${plannedLoc && u.repeatable ? "+ Repeat" : "+ Add"}</button>`
          }
        </div>
        <div class="pool-unit-title">${esc(u.title)}</div>
        <div class="pool-unit-meta">
          <div class="tri-pills">
            ${renderUnitTrimesterPills(u)}
            ${renderIntensiveBadgeMini(u, null, plan?.preferredMode, 2027)}
            ${u.yearLong ? `<span class="badge-mini badge-yearlong">Year-Long</span>` : ""}
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
            <a href="${esc(safeHttpUrl(course.url, "https://handbook.une.edu.au"))}" target="_blank" rel="noopener" class="btn btn-sm no-print">Handbook ↗</a>
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
                        ? `<button class="btn btn-sm" data-add-unit="${esc(iss.actionUnit)}" data-add-smart="1">+ Add ${esc(iss.actionUnit)}</button>`
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
        const planYear = getPlanYear(yr, yIdx);
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
                  const isFutureYear = Boolean(tLoad.isFutureYear !== undefined ? tLoad.isFutureYear : planYear > 2027);
                  const isTarget =
                    state.targetSlot &&
                    state.targetSlot.yearIdx === yIdx &&
                    state.targetSlot.triNum === tNum &&
                    !state.targetSlot.replaceSlotId;
                  const mobHidden = state.mobileTriFilter !== "all" && state.mobileTriFilter !== String(tNum);
                  const dateClashes = Array.isArray(tLoad.dateClashes) ? tLoad.dateClashes : [];
                  const hasConfirmedDateClash = !isFutureYear && Boolean(tLoad.hasDateClash || dateClashes.length > 0);
                  const dateClashTip = dateClashes
                    .map((dc) => dc.overlapText || `${dc.unitA} ↔ ${dc.unitB}`)
                    .join(" | ");
                  const histClashes = Array.isArray(tLoad.historicalDateClashes) ? tLoad.historicalDateClashes : [];
                  const hasHistClash = isFutureYear && Boolean(tLoad.hasHistoricalDateClash || histClashes.length > 0);
                  const histClashTip = histClashes
                    .map((dc) => dc.overlapText || `${dc.unitA} ↔ ${dc.unitB}`)
                    .join(" | ");
                  const maxTriLoad = tLoad.maxLoad || (plan.studyLoad === "Part-time" ? 12 : 24);
                  const effCp = tLoad.effCp !== undefined ? tLoad.effCp : tLoad.cp;
                  const isOverloaded = tLoad.isOverloaded !== undefined ? Boolean(tLoad.isOverloaded) : effCp > maxTriLoad;
                  const loadTip =
                    effCp !== tLoad.cp
                      ? `${tLoad.cp} CP enrolled (${effCp} CP effective load${
                          tLoad.carryOverCp ? `, incl. +${tLoad.carryOverCp} CP year-long carry-over` : ""
                        }; max ${maxTriLoad} CP)`
                      : `${tLoad.cp} CP (standard max ${maxTriLoad} CP)`;

                  let intensivePillHtml = "";
                  if (tLoad.intensives > 0) {
                    if (isFutureYear) {
                      const guideTip = tLoad.futureGuideIntensives > 0
                        ? `${tLoad.intensives} mandatory intensive(s) — ${planYear} dates TBA (2027 Handbook draft dates shown as indicative guide only)`
                        : `${tLoad.intensives} mandatory intensive(s) — ${planYear} dates TBA (check UNE Handbook when published)`;
                      intensivePillHtml = `<span class="badge-mini badge-int-guide" title="${esc(guideTip)}">📅 ${tLoad.intensives} Int · ${planYear} TBA</span>`;
                    } else if (tLoad.tbaIntensives > 0) {
                      intensivePillHtml = `<span class="badge-mini badge-int-tba" title="${tLoad.tbaIntensives} mandatory intensive(s) have 2027 dates TBA — check UNE Handbook / myLearn">🔴 ${tLoad.intensives} Int · Dates TBA</span>`;
                    } else {
                      intensivePillHtml = `<span class="badge-mini badge-intensive" title="2027 intensive dates shown are provisional Handbook draft dates — subject to official confirmation">${tLoad.intensives} Intensive${tLoad.intensives > 1 ? "s" : ""}</span>`;
                    }
                  }

                  return `
                    <div class="tri-col ${isTarget ? "target-active" : ""} ${mobHidden ? "mobile-hidden-tri" : ""}"
                         data-drop-year="${yIdx}"
                         data-drop-tri="${tNum}">
                      <div class="tri-col-header">
                        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                          <span class="tri-name">Trimester ${tNum}</span>
                          ${intensivePillHtml}
                          ${
                            hasConfirmedDateClash
                              ? `<span class="badge-mini badge-int-clash" title="2027 Draft Date Clash: ${esc(
                                  dateClashTip || "Check intensive school dates"
                                )} (provisional Handbook draft dates — subject to confirmation)">⛔ Draft Date Clash${dateClashes.length > 1 ? ` (${dateClashes.length})` : ""}</span>`
                              : ""
                          }
                          ${
                            hasHistClash
                              ? `<span class="badge-mini badge-int-hist" title="Possible overlap based on 2027 draft guide (${esc(
                                  histClashTip || "Check dates when published"
                                )}) — verify ${planYear} dates when released">ℹ Possible Overlap (2027 Guide)</span>`
                              : ""
                          }
                          ${
                            tLoad.campusConflict
                              ? `<span class="badge-mini badge-campus-clash" title="Mandatory intensives in this trimester span different physical campuses/locations">⚠ Mixed Campuses</span>`
                              : ""
                          }
                        </div>
                        <span class="tri-load-badge ${isOverloaded ? "overload" : ""}" title="${esc(loadTip)}">${tLoad.cp} CP</span>
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
        if (!confirmAutoPlanOverwrite(plan)) return;
        plan.t3Strategy = "spread";
        plan.includeT3InAuto = true;
        const updated = Engine.autoSchedulePlan(course, plan, DATA);
        updated.hasUserEdits = false;
        state.savedPlansByCourse[course.code] = updated;
        const openPh = findOpenPlaceholders(updated);
        if (openPh.length > 0 && state.sidebarTab === "slot" && !isMobileViewport()) {
          activateSlotPicker(openPh[0], false);
        } else {
          exitSlotPicker();
        }
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
        year: 2026 + n,
        name: `Year ${n} (${2026 + n})`,
        trimesters: { 1: [], 2: [], 3: [] },
      });
      plan.hasUserEdits = true;
      saveState();
      renderAll({ resetSidebarScroll: false });
    };

    document.getElementById("btn-clear-board").onclick = () => {
      plan.years.forEach((yr) => {
        yr.trimesters = { 1: [], 2: [], 3: [] };
      });
      plan.hasUserEdits = false;
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
          y.year = 2027 + i;
          y.name = `Year ${i + 1} (${2027 + i})`;
        });
        plan.hasUserEdits = hasBoardAnySlots(plan) || Object.keys(plan.customUnits || {}).length > 0;
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
          const yrObj = plan.years[yIdx];
          activateSlotPicker(
            {
              yearIdx: yIdx,
              yearNum: yrObj?.yearNum || yIdx + 1,
              planYear: getPlanYear(yrObj, yIdx),
              triNum: tNum,
              label: `Add Unit to Year ${yrObj?.yearNum || yIdx + 1} · Trimester ${tNum}`,
            },
            true
          );
          renderAll({ resetSidebarScroll: true });
        }
      };
    });

    board.querySelectorAll("[data-resolve-placeholder]").forEach((btn) => {
      btn.onclick = () => {
        const [yIdxStr, tNumStr, slotId] = btn.dataset.resolvePlaceholder.split("|");
        const yIdx = Number(yIdxStr);
        const tNum = Number(tNumStr);
        const yr = plan.years[yIdx];
        const ph = (yr?.trimesters[tNum] || []).find((s) => s.id === slotId);
        activateSlotPicker(
          ph
            ? buildPlaceholderTarget(ph, yr, yIdx, tNum)
            : {
                yearIdx: yIdx,
                yearNum: yr?.yearNum || yIdx + 1,
                planYear: getPlanYear(yr, yIdx),
                triNum: tNum,
                replaceSlotId: slotId,
                label: "Listed or Elective Unit",
                slotKind: "",
                hintCodes: [],
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

  function inferPlaceholderCategory(slot) {
    if (slot.category && Object.prototype.hasOwnProperty.call(CAT_LABELS, slot.category)) return slot.category;
    const sk = String(slot.slotKind || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CAT_LABELS, sk)) return sk;
    const lbl = String(slot.label || "").toLowerCase();
    if (lbl.includes("core")) return "core";
    if (lbl.includes("major")) return "major1";
    if (lbl.includes("minor") || lbl.includes("stream")) return "minor";
    if (lbl.includes("capstone") || lbl.includes("research")) return "capstone";
    if (lbl.includes("listed") || lbl.includes("prescribed")) return "listed";
    return "elective";
  }

  const CHOICE_ROLE_LABELS = {
    core: "Core Choice",
    major1: "Major Choice",
    major2: "Major 2 Choice",
    minor: "Minor Choice",
    capstone: "Capstone Choice",
    listed: "Listed Choice",
    elective: "Elective",
  };

  function renderBoardSlot(slot, yIdx, tNum, plan, report, bucketMap, attributedBucketByCode) {
    if (slot.type === "placeholder") {
      const isSelected = state.targetSlot && state.targetSlot.replaceSlotId === slot.id;
      const phCat = inferPlaceholderCategory(slot);
      const roleLabel = CHOICE_ROLE_LABELS[phCat] || "Student Choice";
      let lvlChip = "";
      if (Array.isArray(slot.allowedLevels) && slot.allowedLevels.length) {
        lvlChip = `<span class="badge-mini" style="background:var(--surface-alt);color:var(--text-subtle);border:1px solid var(--border);">L${slot.allowedLevels.join("/")}</span>`;
      } else if (slot.levelMin && slot.levelMax && slot.levelMin !== slot.levelMax) {
        lvlChip = `<span class="badge-mini" style="background:var(--surface-alt);color:var(--text-subtle);border:1px solid var(--border);">L${esc(slot.levelMin)}–${esc(slot.levelMax)}</span>`;
      } else if (slot.levelMin) {
        lvlChip = `<span class="badge-mini" style="background:var(--surface-alt);color:var(--text-subtle);border:1px solid var(--border);">L${esc(slot.levelMin)}+</span>`;
      }

      let metaHint = "";
      if (Array.isArray(slot.hintCodes) && slot.hintCodes.length > 0 && slot.hintCodes.length <= 4) {
        metaHint = `Options: ${slot.hintCodes.join(" / ")}`;
      } else if (slot.eligibleCount !== null && slot.eligibleCount !== undefined && slot.eligibleCount > 0) {
        metaHint = `${slot.eligibleCount} eligible unit${slot.eligibleCount === 1 ? "" : "s"}${
          slot.bucketTitle ? ` · ${slot.bucketTitle}` : ""
        }`;
      } else if (slot.bucketTitle) {
        metaHint = `Student choice · ${slot.bucketTitle}`;
      } else if (phCat === "elective") {
        metaHint = "Any eligible UNE elective unit";
      } else {
        metaHint = "Open student choice slot";
      }

      const curFlatIdxPh = yIdx * 3 + (tNum - 1);
      const minFlatIdxPh = Math.max(0, (plan.commencingTrimester || 1) - 1);
      const disableMoveBackPh = curFlatIdxPh === 0 || curFlatIdxPh === minFlatIdxPh;

      return `
        <div class="slot-placeholder cat-${phCat} ${isSelected ? "selected is-selected" : ""}"
             draggable="true"
             data-drag-placeholder="${yIdx}|${tNum}|${esc(slot.id)}"
             data-drop-placeholder="${yIdx}|${tNum}|${esc(slot.id)}">
          <div class="slot-placeholder-head">
            <div class="slot-placeholder-badges">
              <span class="cat-tag cat-${phCat}">${esc(roleLabel)}</span>
              ${lvlChip}
              <span style="font-size:10.5px;font-weight:700;color:var(--text-subtle);">${esc(slot.cp ?? 6)} CP</span>
            </div>
            <div class="slot-actions no-print">
              <button class="icon-action" data-move-slot="${yIdx}|${tNum}|${esc(slot.id)}|-1" title="${disableMoveBackPh ? "At earliest trimester" : "Move slot earlier"}" ${disableMoveBackPh ? "disabled" : ""}>◀</button>
              <button class="icon-action" data-move-slot="${yIdx}|${tNum}|${esc(slot.id)}|1" title="Move slot later">▶</button>
              <button class="icon-action remove" data-remove-slot="${yIdx}|${tNum}|${esc(slot.id)}" title="Remove slot">✕</button>
            </div>
          </div>
          <div class="slot-placeholder-label">${esc(slot.label || "Choose Unit")}</div>
          <div class="slot-placeholder-meta">${esc(metaHint)}</div>
          <div class="slot-placeholder-footer">
            <span style="font-size:10.5px;color:${isSelected ? "var(--info)" : "var(--text-subtle)"};font-weight:${isSelected ? "700" : "500"};">
              ${isSelected ? "🎯 Choosing eligible unit…" : "Tap to pick or drag to swap"}
            </span>
            <button class="btn btn-sm ${isSelected ? "btn-primary" : "btn-soft"} no-print" data-resolve-placeholder="${yIdx}|${tNum}|${esc(
        slot.id
      )}">Choose Unit →</button>
          </div>
        </div>
      `;
    }

    const u = Engine.getUnit(slot.code, DATA, plan.customUnits);
    const bInfo = getUnitBucketInfo(slot.code, report, bucketMap);
    const cat = bInfo.category;
    const diag = report.slotDiagnostics[slot.id] || {
      errors: [],
      warnings: [],
      infos: [],
      intensiveAlerts: [],
      intensiveClashes: [],
      intensiveGuides: [],
      historicalIntensiveClashes: [],
      rollingStartInfos: [],
    };
    const intClashes = diag.intensiveClashes || [];
    const histClashes = diag.historicalIntensiveClashes || [];
    const intGuides = diag.intensiveGuides || [];
    const rollingInfos = diag.rollingStartInfos || [];
    const statusCls = diag.errors.length ? "has-error" : diag.warnings.length || intClashes.length ? "has-warning" : "";
    const curFlatIdx = yIdx * 3 + (tNum - 1);
    const minFlatIdx = Math.max(0, (plan.commencingTrimester || 1) - 1);
    const disableMoveBack = curFlatIdx === 0 || curFlatIdx === minFlatIdx;

    return `
      <div class="slot-card cat-${cat} ${statusCls}" draggable="true" data-drag-board="${yIdx}|${tNum}|${esc(slot.id)}|${esc(slot.code)}">
        <div class="slot-top">
          <button class="unit-code-link" data-inspect-unit="${esc(slot.code)}">
            ${esc(slot.code)} <span style="font-weight:500;color:var(--text-subtle);">· ${esc(u ? (u.cp ?? 6) : (slot.cp ?? 6))} CP</span>
          </button>
          <div class="slot-actions no-print">
            <button class="icon-action" data-move-slot="${yIdx}|${tNum}|${esc(slot.id)}|-1" title="${disableMoveBack ? "At earliest trimester" : "Move earlier"}" ${disableMoveBack ? "disabled" : ""}>◀</button>
            <button class="icon-action" data-move-slot="${yIdx}|${tNum}|${esc(slot.id)}|1" title="Move later">▶</button>
            <button class="icon-action remove" data-remove-slot="${yIdx}|${tNum}|${esc(slot.id)}" title="Remove unit">✕</button>
          </div>
        </div>
        <div class="slot-title">${esc(u ? u.title : slot.code)}</div>
        <div class="slot-footer">
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
            <span class="cat-tag cat-${cat}" title="${esc(bInfo.bucketTitle)}">${esc(bInfo.badgeRole)}</span>
            ${u?.yearLong ? `<span class="badge-mini badge-yearlong">Year-Long</span>` : ""}
          </div>
          <div class="tri-pills">${u ? renderUnitTrimesterPills(u, tNum) : ""}</div>
        </div>
        ${diag.errors.map((m) => `<div class="slot-msg err">⛔ ${esc(m)}</div>`).join("")}
        ${intClashes.map((m) => `<div class="slot-msg int-clash">⛔ ${esc(m)}</div>`).join("")}
        ${(diag.intensiveAlerts || []).map((m) => `<div class="slot-msg int-tba">🔴 ${esc(m)}</div>`).join("")}
        ${histClashes.map((m) => `<div class="slot-msg int-hist">ℹ ${esc(m)}</div>`).join("")}
        ${diag.warnings.map((m) => `<div class="slot-msg warn">⚠ ${esc(m)}</div>`).join("")}
        ${intGuides.map((m) => `<div class="slot-msg int-guide">📅 ${esc(m)}</div>`).join("")}
        ${rollingInfos.map((m) => `<div class="slot-msg rolling">🗓 ${esc(m)}</div>`).join("")}
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
          <button class="course-card-option" id="mtool-bug">
            <div style="font-weight:700;">🐞 Report Bug${loadFeedbackLog().length ? ` (${loadFeedbackLog().length})` : ""}</div>
            <div style="font-size:11px;color:var(--text-subtle);">Log issue w/ plan snapshot</div>
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
        modal.querySelector("#mtool-bug").onclick = () => { closeModal(); openBugReportModal(); };
        modal.querySelector("#mtool-theme").onclick = () => {
          document.documentElement.classList.toggle("dark");
          safeLocalSet(THEME_KEY, document.documentElement.classList.contains("dark") ? "dark" : "light");
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
        addUnitToPlan(btn.dataset.addUnit, {
          allowOverride: btn.dataset.addOverride === "1",
          forceSmart: btn.dataset.addSmart === "1",
        });
      };
    });
    root.querySelectorAll("[data-swap-add]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const [uCode, toTriStr, swapPhId] = (btn.dataset.swapAdd || "").split("|");
        if (uCode && toTriStr && swapPhId) {
          applySiblingSwapFromPicker(uCode, Number(toTriStr), swapPhId);
        }
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
        if (e.dataTransfer) e.dataTransfer.setData("text/plain", code);
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
        el.classList.add("is-dragging");
        if (e.dataTransfer) e.dataTransfer.setData("text/plain", code);
        highlightOfferingColumns(code, plan, true);
      };
      el.ondragend = () => {
        state.dragging = null;
        el.classList.remove("is-dragging");
        highlightOfferingColumns(null, plan, false);
      };
    });
    root.querySelectorAll("[data-drag-placeholder]").forEach((el) => {
      el.ondragstart = (e) => {
        const [yIdx, tNum, slotId] = el.dataset.dragPlaceholder.split("|");
        state.dragging = { source: "placeholder", fromYearIdx: Number(yIdx), fromTriNum: Number(tNum), slotId };
        el.classList.add("is-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", slotId);
        }
        document.querySelectorAll(".tri-col").forEach((c) => c.classList.add("drag-valid"));
      };
      el.ondragend = () => {
        state.dragging = null;
        el.classList.remove("is-dragging");
        highlightOfferingColumns(null, plan, false);
        document.querySelectorAll(".drop-swap-over").forEach((p) => p.classList.remove("drop-swap-over"));
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
    // Allow dropping a dragged placeholder directly onto another placeholder to swap their trimesters cleanly!
    board.querySelectorAll("[data-drop-placeholder]").forEach((el) => {
      el.ondragover = (e) => {
        const drag = state.dragging;
        if (!drag || drag.source !== "placeholder") return;
        const [, , targetSlotId] = el.dataset.dropPlaceholder.split("|");
        if (drag.slotId === targetSlotId) return;
        e.preventDefault();
        e.stopPropagation();
        el.classList.add("drop-swap-over");
      };
      el.ondragleave = () => {
        el.classList.remove("drop-swap-over");
      };
      el.ondrop = (e) => {
        const drag = state.dragging;
        el.classList.remove("drop-swap-over");
        if (!drag || drag.source !== "placeholder") return;
        const [toYStr, toTStr, targetSlotId] = el.dataset.dropPlaceholder.split("|");
        if (drag.slotId === targetSlotId) return;
        e.preventDefault();
        e.stopPropagation();
        const toY = Number(toYStr);
        const toT = Number(toTStr);
        const fromList = plan.years[drag.fromYearIdx]?.trimesters[drag.fromTriNum];
        const toList = plan.years[toY]?.trimesters[toT];
        if (!fromList || !toList) return;
        const fromIdx = fromList.findIndex((s) => s.id === drag.slotId);
        const toIdx = toList.findIndex((s) => s.id === targetSlotId);
        if (fromIdx === -1 || toIdx === -1) return;

        const movedPh = fromList[fromIdx];
        const targetPh = toList[toIdx];
        fromList[fromIdx] = targetPh;
        toList[toIdx] = movedPh;

        if (state.targetSlot?.replaceSlotId === movedPh.id) {
          state.targetSlot = buildPlaceholderTarget(movedPh, plan.years[toY], toY, toT);
        } else if (state.targetSlot?.replaceSlotId === targetPh.id) {
          state.targetSlot = buildPlaceholderTarget(targetPh, plan.years[drag.fromYearIdx], drag.fromYearIdx, drag.fromTriNum);
        }

        state.dragging = null;
        highlightOfferingColumns(null, plan, false);
        plan.hasUserEdits = true;
        saveState();
        renderAll({ resetSidebarScroll: false });
        showToast(
          `Swapped ${movedPh.label || "Choice"} (Y${plan.years[toY]?.yearNum || toY + 1} T${toT}) ↔ ${
            targetPh.label || "Choice"
          } (Y${plan.years[drag.fromYearIdx]?.yearNum || drag.fromYearIdx + 1} T${drag.fromTriNum}).`
        );
      };
    });

    board.querySelectorAll("[data-drop-year]").forEach((col) => {
      col.ondragover = (e) => e.preventDefault();
      col.ondrop = (e) => {
        e.preventDefault();
        const toY = Number(col.dataset.dropYear);
        const toT = Number(col.dataset.dropTri);
        const drag = state.dragging;
        highlightOfferingColumns(null, plan, false);
        document.querySelectorAll(".drop-swap-over").forEach((p) => p.classList.remove("drop-swap-over"));
        if (!drag) return;
        if (drag.source === "pool") {
          const dragU = Engine.getUnit(drag.code, DATA, plan.customUnits);
          if (isUnitPlanned(drag.code, plan) && !dragU?.repeatable) {
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
        } else if (drag.source === "placeholder") {
          if (drag.fromYearIdx === toY && drag.fromTriNum === toT) {
            state.dragging = null;
            return;
          }
          const fromList = plan.years[drag.fromYearIdx]?.trimesters[drag.fromTriNum];
          if (!fromList) return;
          const idx = fromList.findIndex((s) => s.id === drag.slotId);
          if (idx === -1) return;
          const [moved] = fromList.splice(idx, 1);
          plan.years[toY].trimesters[toT].push(moved);
          if (state.targetSlot?.replaceSlotId === moved.id) {
            state.targetSlot = buildPlaceholderTarget(moved, plan.years[toY], toY, toT);
          }
          state.dragging = null;
          plan.hasUserEdits = true;
          saveState();
          renderAll({ resetSidebarScroll: false });
          showToast(`Moved ${moved.label || "Choice slot"} → Y${plan.years[toY]?.yearNum || toY + 1} · T${toT}.`);
          return;
        }
        state.dragging = null;
        plan.hasUserEdits = true;
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

  function renderUnitModalIntensiveBox(u, preferredMode, contextYear) {
    const planYear = Number.isInteger(contextYear) ? contextYear : 2027;
    const isFutureGuide = planYear > 2027;
    const intInfo = Engine.getUnitIntensiveForTri(u, null, preferredMode, planYear);
    if (!intInfo) return "";

    const rawEntries = Array.isArray(u.intensiveEntries) && u.intensiveEntries.length
      ? u.intensiveEntries
      : Array.isArray(intInfo.entries) && intInfo.entries.length
      ? intInfo.entries
      : null;

    // Also synthesize per-trimester rows if mixed dated + TBA across trimesters and no rawEntries
    let entries = rawEntries;
    if ((!entries || entries.length <= 1) && u.intensiveByTri && Object.keys(u.intensiveByTri).length > 1) {
      const triKeys = Object.keys(u.intensiveByTri).sort();
      const hasDiff = triKeys.some((k) => {
        const cur = u.intensiveByTri[k];
        const first = u.intensiveByTri[triKeys[0]];
        return Boolean(cur?.tba) !== Boolean(first?.tba) || (cur?.dates || []).join(",") !== (first?.dates || []).join(",") || (cur?.location || "") !== (first?.location || "");
      });
      if (hasDiff) {
        entries = [];
        for (const tk of triKeys) {
          const ti = Engine.getUnitIntensiveForTri(u, Number(tk), preferredMode, planYear);
          if (!ti) continue;
          if (Array.isArray(ti.entries) && ti.entries.length) {
            ti.entries.forEach((e) => entries.push({ ...e, tris: [Number(tk)] }));
          } else {
            entries.push({
              title: `Trimester ${tk}`,
              tris: [Number(tk)],
              dates: ti.dates || [],
              tba: Boolean(ti.tba),
              location: ti.location || intInfo.location,
              duration: ti.duration || intInfo.duration,
              note: ti.note || intInfo.note,
              onlineOnly: Boolean(ti.onlineOnlyIntensive),
              kind: ti.kind || intInfo.kind,
            });
          }
        }
      }
    }

    const futureNoticeHtml = isFutureGuide
      ? `<div class="slot-msg int-guide" style="font-size:11.5px;">📅 <strong>${esc(planYear)} dates TBA</strong> — dates below are from the 2027 UNE Handbook (provisional draft) as an indicative guide only.</div>`
      : "";
    const hasAny2027Dated =
      !isFutureGuide &&
      (!intInfo.tba || (Array.isArray(entries) && entries.some((e) => !e.tba && Array.isArray(e.dates) && e.dates.length > 0)));
    const draftDisclaimerHtml = hasAny2027Dated
      ? `<div style="font-size:11px;color:var(--text-muted);line-height:1.35;">ℹ 2027 intensive dates shown are provisional Handbook draft dates and remain subject to official confirmation.</div>`
      : "";
    const onlineOnlyNote =
      intInfo.onlineOnlyIntensive || u.intensiveOnlineOnly
        ? `<div style="font-size:11.5px;font-weight:600;color:var(--info);">ℹ Mandatory for Online students only (On-Campus students attend regular campus classes).</div>`
        : "";
    const choiceNote =
      intInfo.isStudentChoice || u.intensiveIsStudentChoice
        ? `<div style="font-size:11.5px;color:var(--text-muted);">✓ Students nominate their preferred campus (Armidale or Sydney).</div>`
        : "";

    if (entries && entries.length > 1) {
      const anyTba = Boolean(intInfo.tba || intInfo.hasTba || intInfo.mixedTba || entries.some((e) => e.tba));
      const allTba = entries.every((e) => e.tba);
      const useAlarm = !isFutureGuide && anyTba;
      const badgeCls = isFutureGuide ? "badge-int-guide" : useAlarm ? "badge-int-tba" : "badge-intensive";
      const boxBorder = isFutureGuide ? "var(--info-border)" : useAlarm ? "var(--err-border)" : "var(--warn-border)";
      const boxBg = isFutureGuide ? "var(--info-bg)" : useAlarm ? "var(--err-bg)" : "var(--warn-bg)";
      const locColor = isFutureGuide ? "var(--info)" : useAlarm ? "var(--err)" : "var(--warn)";
      const isMultiCohort = Boolean(intInfo.multiCohort || Object.values(u.intensiveByTri || {}).some((x) => x?.multiCohort));
      const uniqueTriKeys = new Set(entries.flatMap((e) => (Array.isArray(e.tris) ? e.tris : [])));
      const headerLabel = isMultiCohort
        ? `${entries.length} Cohorts`
        : uniqueTriKeys.size > 1
        ? `${uniqueTriKeys.size} Trimesters`
        : `${entries.length} Blocks`;
      return `
        <div style="border:1px solid ${boxBorder};background:${boxBg};border-radius:8px;padding:9px 11px;margin-bottom:9px;display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span class="badge-mini ${badgeCls}">${isFutureGuide ? "📅" : useAlarm ? "🔴" : "🏫"} ${esc(intInfo.kind)} Intensive School${
        isFutureGuide ? ` · ${esc(planYear)} TBA` : intInfo.mixedTba && !allTba ? " · Mixed Dated & TBA" : ""
      }</span>
            <span class="badge-mini badge-int-cohort">${esc(headerLabel)}</span>
            <span style="font-weight:700;font-size:12px;color:${locColor};">${esc(intInfo.location)}${
        intInfo.duration ? ` · ${esc(intInfo.duration)}` : ""
      }</span>
          </div>
          ${futureNoticeHtml}
          ${onlineOnlyNote}
          ${choiceNote}
          <div class="int-entry-list">
            ${entries
              .map((e) => {
                const triTag =
                  Array.isArray(e.tris) && e.tris.length
                    ? `<span class="tri-pill active-tri">${e.tris.map((t) => `T${t}`).join("/")}</span>`
                    : "";
                const rawDatesStr = (e.dates || []).join(" · ");
                const entryDates = isFutureGuide
                  ? e.tba
                    ? `${planYear} dates TBA (2027 dates also TBA)`
                    : `${planYear} dates TBA (2027 draft guide: ${rawDatesStr})`
                  : e.tba
                  ? "🔴 Dates TBA — check UNE Handbook / myLearn"
                  : rawDatesStr
                  ? `${rawDatesStr} (2027 draft)`
                  : "Provisional draft dates in 2027 handbook";
                const locDur = [e.location, e.duration].filter(Boolean).join(" · ");
                const itemCls = isFutureGuide ? "is-guide" : e.tba ? "is-tba" : "";
                return `
                  <div class="int-entry-item ${itemCls}">
                    <div class="int-entry-hdr">
                      ${triTag}
                      <span>${esc(e.title || e.kind || "Intensive Session")}</span>
                      ${locDur ? `<span style="font-weight:500;color:var(--text-subtle);">· ${esc(locDur)}</span>` : ""}
                      ${e.onlineOnly ? `<span class="badge-mini badge-int-cohort">Online only</span>` : ""}
                    </div>
                    <div class="int-entry-dates">${esc(entryDates)}</div>
                    ${e.note ? `<div class="int-entry-note">${esc(e.note)}</div>` : ""}
                  </div>
                `;
              })
              .join("")}
          </div>
          ${draftDisclaimerHtml}
        </div>
      `;
    }

    const isTba = Boolean(intInfo.tba || intInfo.mixedTba);
    const useAlarm = !isFutureGuide && isTba;
    const badgeCls = isFutureGuide ? "badge-int-guide" : useAlarm ? "badge-int-tba" : "badge-intensive";
    const boxBorder = isFutureGuide ? "var(--info-border)" : useAlarm ? "var(--err-border)" : "var(--warn-border)";
    const boxBg = isFutureGuide ? "var(--info-bg)" : useAlarm ? "var(--err-bg)" : "var(--warn-bg)";
    const locColor = isFutureGuide ? "var(--info)" : useAlarm ? "var(--err)" : "var(--warn)";
    const rawDateJoin = (intInfo.dates || []).join(" / ");
    const dateTxt = isFutureGuide
      ? intInfo.tba || !rawDateJoin
        ? `${planYear} dates TBA — check UNE Handbook when published`
        : `${planYear} dates TBA (2027 draft guide: ${rawDateJoin})`
      : intInfo.tba
      ? "2027 Dates TBA — check dates"
      : intInfo.mixedTba
      ? `2027 Handbook (draft): ${rawDateJoin} (other trimester(s) TBA — check dates)`
      : `2027 Handbook (draft): ${rawDateJoin}`;
    return `
      <div style="border:1px solid ${boxBorder};background:${boxBg};border-radius:8px;padding:9px 11px;margin-bottom:9px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="badge-mini ${badgeCls}">${isFutureGuide ? "📅" : useAlarm ? "🔴" : "🏫"} ${esc(intInfo.kind)} Intensive School${
      isFutureGuide ? ` · ${esc(planYear)} TBA` : ""
    }</span>
          <span style="font-weight:700;font-size:12px;color:${locColor};">${esc(intInfo.location)}${
      intInfo.duration ? ` · ${esc(intInfo.duration)}` : ""
    }</span>
        </div>
        ${futureNoticeHtml}
        ${onlineOnlyNote}
        ${choiceNote}
        <div style="font-size:12px;font-weight:700;color:${useAlarm ? "var(--err)" : "var(--text)"};">${esc(dateTxt)}</div>
        ${intInfo.note ? `<div style="font-size:11.5px;color:var(--text-muted);line-height:1.35;">${esc(intInfo.note)}</div>` : ""}
        ${draftDisclaimerHtml}
      </div>
    `;
  }

  function renderPlanningNotesHtml(u) {
    const notes = Array.isArray(u?.planningNotes) ? u.planningNotes : [];
    if (!notes.length) return "";
    return `
      <div>
        <div class="config-label" style="margin-bottom:6px;">Planning Notes &amp; Enrolment Conditions</div>
        <div class="planning-notes-list">
          ${notes
            .map((n) => {
              const obj = typeof n === "string" ? { severity: "info", label: n, detail: "" } : n || {};
              const sev = obj.severity === "err" ? "err" : obj.severity === "warn" ? "warn" : "info";
              const ico = sev === "err" ? "⛔" : sev === "warn" ? "⚠" : "ℹ";
              const titleAttr = obj.detail ? ` title="${esc(obj.detail)}"` : "";
              const labelTxt = obj.label || obj.detail || "";
              return `<span class="planning-note-chip ${sev}"${titleAttr}>${ico} <strong>${esc(labelTxt)}</strong>${
                obj.detail && obj.detail !== labelTxt ? ` — ${esc(obj.detail)}` : ""
              }</span>`;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function openUnitModal(code) {
    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const u = Engine.getUnit(code, DATA, plan.customUnits);
    if (!u) return;
    const plannedLoc = isUnitPlanned(code, plan);
    const plannedYear = getUnitPlannedYear(code, plan);
    const targetYear = state.targetSlot
      ? state.targetSlot.planYear || getPlanYear(plan.years[state.targetSlot.yearIdx], state.targetSlot.yearIdx)
      : null;
    const contextYear = plannedYear || targetYear || 2027;
    const isRolling = u.offered2027 === false && Number.isInteger(u.rollingStartYear);
    const isArchived = u.offered2027 === false && !isRolling;
    const modalReport = state.view === "planner" && plannedLoc ? Engine.validatePlan(course, plan, DATA) : null;
    const modalBucketInfo = modalReport ? getUnitBucketInfo(code, modalReport) : null;

    const colors = ["#1d7880", "#2774ae", "#95c236", "#b45309", "#b91c4a", "#6d28d9"];
    const assessBar = (u.assessments || [])
      .filter((a) => a.weight > 0)
      .map((a, i) => `<div style="width:${Number(a.weight) || 0}%;background:${colors[i % colors.length]};" title="${esc(a.name)}: ${esc(a.weight)}%"></div>`)
      .join("");

    function linkifyCodes(txt) {
      if (!txt) return "<span style='color:var(--text-subtle);'>None</span>";
      return esc(txt).replace(/\b(MEDI\d{4}[A-Z]?|PRAC[A-Z]{2,10}|LANTITE-[LN]|[A-Z]{2,4}\d{3}[A-Z]?)\b/g, (m) =>
        DATA.units[m]
          ? `<button class="unit-code-link" style="color:var(--primary);" data-jump-unit="${esc(m)}">${esc(m)}</button>`
          : `<strong>${esc(m)}</strong>`
      );
    }

    const availTris =
      u.trimesters && u.trimesters.length > 0
        ? u.trimesters
        : isRolling && Array.isArray(u.indicativeTrimesters) && u.indicativeTrimesters.length > 0
        ? u.indicativeTrimesters
        : [1, 2, 3];
    const addButtons = (plan.years || [])
      .map((yr, yIdx) => {
        const pYr = getPlanYear(yr, yIdx);
        if (isRolling && pYr < u.rollingStartYear) return "";
        return [1, 2, 3]
          .filter((t) => availTris.includes(t))
          .map((t) => `<button class="btn btn-sm btn-soft" data-modal-place="${yIdx}|${t}">+ Y${yr.yearNum} (${pYr}) T${t}</button>`)
          .join(" ");
      })
      .filter(Boolean)
      .join(" ");

    const safeUnitUrl = safeHttpUrl(
      u.url,
      `https://handbook.une.edu.au/units/2027/${encodeURIComponent(u.code)}?year=2027`
    );

    openModal(
      `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
         <span class="course-code-pill teal">${esc(u.code)}</span>
         <span style="font-weight:800;font-size:15.5px;">${esc(u.title)}</span>
         ${modalBucketInfo ? `<span class="cat-tag cat-${modalBucketInfo.category}" title="${esc(modalBucketInfo.bucketTitle)}">${esc(modalBucketInfo.badgeRole)}</span>` : ""}
         ${u.yearLong ? `<span class="badge-mini badge-yearlong">Year-Long</span>` : ""}
         ${u.repeatable ? `<span class="badge-mini badge-int-cohort">Repeatable</span>` : ""}
         ${isRolling ? `<span class="badge-mini badge-rolling">🗓 From ${esc(u.rollingStartYear)}</span>` : ""}
       </div>
       <div style="font-size:12px;color:var(--text-subtle);margin-top:3px;">${esc(u.cp ?? 6)} Credit Points · ${esc(u.level ?? 100)}-Level · ${esc(u.school || "UNE")}</div>`,
      `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--surface-alt);padding:10px 12px;border-radius:8px;border:1px solid var(--border);">
          <div>
            ${
              plannedLoc && !u.repeatable
                ? `<span style="color:var(--ok);font-weight:700;">✓ Planned in ${esc(plannedLoc)}${plannedYear ? ` (${plannedYear})` : ""}</span>`
                : isArchived
                ? `<span style="color:var(--err);font-weight:700;">⛔ No 2027 Offering Published</span>`
                : `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-sm btn-primary" id="btn-modal-smart-add">${
                      state.targetSlot &&
                      state.sidebarTab === "slot" &&
                      availTris.includes(state.targetSlot.triNum)
                        ? `Select for Y${plan.years[state.targetSlot.yearIdx]?.yearNum || 1} T${state.targetSlot.triNum} →`
                        : plannedLoc && u.repeatable
                        ? `+ Add Repeat (Already in ${esc(plannedLoc)})`
                        : "✨ Best Available Trimester"
                    }</button>
                    ${addButtons}
                  </div>`
            }
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm" id="btn-unit-report-bug" type="button" title="Report a prerequisite, offering or intensive issue on this unit">🐞 Flag Issue</button>
            <a href="${esc(safeUnitUrl)}" target="_blank" rel="noopener" class="btn btn-sm">Official 2027 Unit Page ↗</a>
          </div>
        </div>
        ${
          isRolling
            ? `<div class="slot-msg rolling" style="font-size:12px;">🗓 <strong>Rolling-Start Unit (from ${esc(u.rollingStartYear)}):</strong> Not offered in 2027 — scheduled for future cohorts from ${esc(u.rollingStartYear)}${
                Array.isArray(u.indicativeTrimesters) && u.indicativeTrimesters.length
                  ? ` (indicative trimester: T${u.indicativeTrimesters.join(", T")})`
                  : " (trimester TBA)"
              }.</div>`
            : ""
        }
        ${renderPlanningNotesHtml(u)}
        ${u.overview ? `<div><div class="config-label" style="margin-bottom:4px;">Unit Description</div><div style="white-space:pre-line;color:var(--text-muted);">${esc(u.overview)}</div></div>` : ""}
        <div class="info-grid">
          <div class="info-stat"><div class="info-stat-label">Pre-requisites</div><div style="font-size:12.5px;margin-top:4px;">${linkifyCodes(u.prereqText)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Co-requisites</div><div style="font-size:12.5px;margin-top:4px;">${linkifyCodes(u.coreqText)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Restrictions / Exclusions</div><div style="font-size:12.5px;margin-top:4px;">${linkifyCodes(u.restrictionText)}</div></div>
        </div>
        ${u.assumedKnowledge ? `<div class="info-stat"><div class="info-stat-label">Assumed Knowledge</div><div style="font-size:12px;margin-top:3px;">${esc(u.assumedKnowledge)}</div></div>` : ""}
        <div>
          <div class="config-label" style="margin-bottom:6px;">2027 Handbook Offerings &amp; Intensive Schools</div>
          ${
            u.t3RepeatOnly
              ? `<div class="slot-msg warn" style="margin-bottom:8px;">⚠ Trimester 3 is available to repeating students only (requires Head of School permission).</div>`
              : ""
          }
          ${renderUnitModalIntensiveBox(u, plan?.preferredMode, contextYear)}
          ${
            (u.offerings || []).length
              ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:8px;">
                  ${u.offerings
                    .map(
                      (o) => `<div style="border:1px solid var(--border);border-radius:6px;padding:7px 10px;background:var(--surface-alt);">
                        <div style="font-weight:700;font-size:12.5px;">${esc(o.period)}</div>
                        <div style="font-size:11.5px;color:var(--text-muted);">${esc((o.modes || []).join(", ") || "Standard")} · ${esc(o.location || "UNE")}</div>
                      </div>`
                    )
                    .join("")}
                </div>`
              : `<div style="color:var(--text-subtle);font-size:12px;">${
                  isRolling
                    ? `Scheduled rolling start from ${esc(u.rollingStartYear)} — future teaching periods will appear when published.`
                    : "No 2027 teaching periods listed."
                }</div>`
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
        const flagBtn = modal.querySelector("#btn-unit-report-bug");
        if (flagBtn) flagBtn.onclick = () => { closeModal(); openBugReportModal(u.code); };
        modal.querySelectorAll("[data-modal-place]").forEach((b) => {
          b.onclick = () => {
            const [yIdx, tNum] = b.dataset.modalPlace.split("|").map(Number);
            plan.years[yIdx].trimesters[tNum].push({ id: Engine.uid("u"), type: "unit", code: u.code });
            plan.hasUserEdits = true;
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
            loaded.hasUserEdits = true;
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
    const validAtar = formatValidAtar(c.atar);
    const notOfferedLabel = getCourseNotOfferedLabel(c);
    const safeCourseUrl = safeHttpUrl(c.url, "https://handbook.une.edu.au");

    openModal(
      `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
         <span class="course-code-pill teal">${esc(c.code)}</span>
         <span style="font-weight:800;font-size:15.5px;">${esc(c.title)} (2027)</span>
         ${notOfferedLabel ? `<span class="meta-chip not-offered" title="${esc(c.intakes || notOfferedLabel)}">⚠ ${esc(notOfferedLabel)}</span>` : ""}
       </div>`,
      `
        ${
          notOfferedLabel
            ? `<div class="slot-msg warn" style="font-size:12px;">⚠ <strong>2027 Offering Status:</strong> ${esc(c.intakes || notOfferedLabel)}</div>`
            : ""
        }
        <div class="info-grid">
          <div class="info-stat"><div class="info-stat-label">Award Credit Points</div><div class="info-stat-val">${esc(c.totalCp)} CP</div></div>
          <div class="info-stat"><div class="info-stat-label">School</div><div class="info-stat-val">${esc(c.school)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Study / AQF Level</div><div class="info-stat-val">${esc(c.aqfLevel || c.studyLevel)}</div></div>
          <div class="info-stat"><div class="info-stat-label">Delivery</div><div class="info-stat-val">${esc((c.modes || []).join(", ") || "Standard")}</div></div>
          ${validAtar ? `<div class="info-stat"><div class="info-stat-label">Selection Rank (ATAR)</div><div class="info-stat-val">${esc(validAtar)}</div></div>` : ""}
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
          <a href="${esc(safeCourseUrl)}" target="_blank" rel="noopener" class="btn">Official 2027 UNE Handbook Page ↗</a>
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
            <input type="text" class="text-input" id="cust-code" placeholder="e.g. XELEC101" style="width:100%;margin-top:4px;text-transform:uppercase;" />
          </div>
          <div>
            <label class="config-label">Unit Title</label>
            <input type="text" class="text-input" id="cust-title" placeholder="e.g. Cross-Institutional Elective" style="width:100%;margin-top:4px;" />
          </div>
          <div>
            <label class="config-label">Credit Points</label>
            <select class="select-input" id="cust-cp" style="width:100%;margin-top:4px;">
              <option value="0">0 CP</option>
              <option value="2">2 CP</option>
              <option value="6" selected>6 CP</option>
              <option value="12">12 CP</option>
              <option value="24">24 CP</option>
            </select>
          </div>
          <div>
            <label class="config-label">Unit Level</label>
            <select class="select-input" id="cust-lvl" style="width:100%;margin-top:4px;">
              <option value="0">0-level (Pathway)</option>
              <option value="100" selected>100-level</option>
              <option value="200">200-level</option>
              <option value="300">300-level</option>
              <option value="400">400-level</option>
              <option value="500">500-level</option>
              <option value="600">600-level</option>
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
          const parsedCp = parseInt(modal.querySelector("#cust-cp").value, 10);
          const cp = Number.isFinite(parsedCp) && parsedCp >= 0 ? parsedCp : 6;
          const parsedLvl = parseInt(modal.querySelector("#cust-lvl").value, 10);
          const level = Number.isFinite(parsedLvl) && parsedLvl >= 0 ? parsedLvl : 100;
          if (!code) { showToast("Please enter a unit code."); return; }
          if (code.includes("|") || !/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) {
            showToast("Unit code must be 2–20 letters/numbers (no '|' or special characters).");
            return;
          }
          if (DATA.units[code]) {
            showToast(`${code} is an official UNE unit — select it from the All Units tab instead.`);
            return;
          }
          plan.customUnits = plan.customUnits || {};
          plan.hasUserEdits = true;
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
            url: `https://handbook.une.edu.au/units/2027/${encodeURIComponent(code)}?year=2027`,
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
                  const bInfo = getUnitBucketInfo(s.code, report);
                  rows.push([
                    course.code,
                    yr.name,
                    `Trimester ${t}`,
                    s.code,
                    u?.title || s.code,
                    u ? (u.cp ?? 6) : (s.cp ?? 6),
                    bInfo.bucketTitle || "Elective",
                  ]);
                } else {
                  rows.push([
                    course.code,
                    yr.name,
                    `Trimester ${t}`,
                    "PLACEHOLDER",
                    s.label || "Placeholder",
                    s.cp ?? 6,
                    s.bucketTitle || "Placeholder",
                  ]);
                }
              }
            }
          });
          const csv = rows.map((r) => r.map((v) => `"${csvSafeCell(v).replace(/"/g, '""')}"`).join(",")).join("\n");
          downloadBlob(`${course.code}_2027_StudyPlan.csv`, csv, "text/csv;charset=utf-8;");
          closeModal();
        };
        modal.querySelector("#exp-json").onclick = () => {
          downloadBlob(`${course.code}_2027_Plan.json`, JSON.stringify(plan, null, 2), "application/json");
          closeModal();
        };
        modal.querySelector("#inp-import-json").onchange = (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const imported = JSON.parse(reader.result);
              const sanitized = validateAndSanitizePlan(imported);
              if (!sanitized) {
                showToast("Invalid plan JSON file — missing valid course or trimester structure.");
                return;
              }
              const targetCourse = getCourse(sanitized.courseCode);
              // Dry-run validation BEFORE mutating state or persisting to localStorage
              Engine.validatePlan(targetCourse, sanitized, DATA);
              state.currentCourseCode = sanitized.courseCode;
              state.savedPlansByCourse[sanitized.courseCode] = sanitized;
              state.view = "planner";
              exitSlotPicker();
              closeModal();
              renderAll({ resetSidebarScroll: true });
              saveState();
              showToast(`Imported plan for ${sanitized.courseCode}!`);
            } catch (_) {
              showToast("Could not import JSON file — invalid or corrupted study plan.");
            }
          };
          reader.readAsText(file);
        };
        modal.querySelector("#exp-reset").onclick = () => {
          const blank = Engine.createDefaultPlan(course, DATA);
          blank.hasUserEdits = false;
          state.savedPlansByCourse[course.code] = blank;
          exitSlotPicker();
          saveState();
          closeModal();
          renderAll({ resetSidebarScroll: true });
          showToast(`Reset ${course.code} plan.`);
        };
      }
    );
  }

  function capturePlannerContext() {
    const vp = `${window.innerWidth}x${window.innerHeight} (${isMobileViewport() ? "Mobile" : isTabletViewport() ? "Tablet" : "Desktop"})`;
    const baseUrl = window.location.href.split("?")[0].split("#")[0];

    if (state.view === "finder") {
      const topicObj = state.finderActiveTopic >= 0 ? FINDER_TOPICS[state.finderActiveTopic] : null;
      const finderFilters = [
        "View: Course Finder",
        state.finderQuery ? `Query: "${state.finderQuery}"` : "",
        topicObj ? `Topic: ${topicObj.label}` : "",
        state.finderLevel !== "ALL" ? `Level: ${state.finderLevel}` : "",
        state.finderSchool !== "ALL" ? `School: ${state.finderSchool}` : "",
        state.finderFaculty !== "ALL" ? `Faculty: ${state.finderFaculty}` : "",
        state.finderMode !== "ALL" ? `Mode: ${state.finderMode}` : "",
        state.finderIntake !== "ALL" ? `Intake: T${state.finderIntake}` : "",
        state.finderAtar !== "ALL" ? `Max ATAR: ${state.finderAtar}` : "",
        state.finderSort !== "relevance" ? `Sort: ${state.finderSort}` : "",
      ].filter(Boolean);

      const activeSchool =
        state.finderSchool !== "ALL"
          ? state.finderSchool
          : state.finderFaculty !== "ALL"
          ? state.finderFaculty
          : "All UNE Schools";

      return {
        view: "finder",
        courseCode: "FINDER",
        courseTitle: "Course Finder",
        school: activeSchool,
        configSummary: finderFilters.join(" | "),
        boardSnapshot: "(Course Finder view — no degree board active)",
        diagnosticsSummary: "N/A (Course Finder)",
        viewport: vp,
        directUrl: `${baseUrl}?browse=1`,
      };
    }

    const course = getCurrentCourse();
    const plan = getCurrentPlan();
    const report = Engine.validatePlan(course, plan, DATA);
    const activeAos = getActiveAosLabels(course, plan);
    const configParts = [
      plan.admissionRule || "",
      ...activeAos,
      `Start T${plan.commencingTrimester || 1}`,
      plan.studyLoad || "Full-time",
      plan.preferredMode || "Online",
      `T3=${plan.t3Strategy || "none"}`,
    ].filter(Boolean);

    const boardRows = [];
    for (const yr of plan.years || []) {
      for (const t of [1, 2, 3]) {
        const sl = yr.trimesters[t] || [];
        if (sl.length) {
          boardRows.push(`Y${yr.yearNum}T${t}: ${sl.map((x) => (x.type === "unit" ? x.code : `[${x.label || "Placeholder"}]`)).join(",")}`);
        }
      }
    }
    const diagList = report
      ? [
          ...report.globalIssues.map((g) => g.text),
          ...Object.values(report.slotDiagnostics || {}).flatMap((d) => [
            ...(d.errors || []),
            ...(d.intensiveClashes || []),
            ...(d.historicalIntensiveClashes || []),
            ...(d.warnings || []),
          ]),
        ].slice(0, 6)
      : [];

    return {
      view: "planner",
      courseCode: course.code,
      courseTitle: course.title,
      school: course.school,
      configSummary: configParts.join(" | "),
      boardSnapshot: boardRows.join(" ; ") || "(empty board)",
      diagnosticsSummary: diagList.join(" ; ") || "None",
      viewport: vp,
      directUrl: `${baseUrl}?course=${encodeURIComponent(course.code)}`,
    };
  }

  function copyTextToClipboard(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast(okMsg),
        () => fallbackCopyText(text, okMsg)
      );
    } else {
      fallbackCopyText(text, okMsg);
    }
  }

  function fallbackCopyText(text, okMsg) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      ta.setSelectionRange(0, text.length);
    } catch (_) {}
    let copied = false;
    try {
      copied = document.execCommand("copy") === true;
    } catch (_) {
      copied = false;
    }
    ta.remove();
    if (copied) {
      showToast(okMsg);
    } else {
      showToast("Copy blocked by browser — use Download CSV instead.");
    }
  }

  function openBugReportModal(prefillUnitCode, preservedDraft) {
    const ctx = capturePlannerContext();
    const savedReviewer = preservedDraft?.reviewer !== undefined ? preservedDraft.reviewer : (safeLocalGet(FEEDBACK_REVIEWER_KEY) || "");
    const savedCat = preservedDraft?.category || (ctx.view === "finder" ? "Mobile / Tablet / Search glitch" : "Prerequisite / Co-requisite error");
    const unitInit =
      preservedDraft?.units !== undefined
        ? preservedDraft.units
        : typeof prefillUnitCode === "string"
        ? prefillUnitCode
        : "";
    const descInit = preservedDraft?.description || "";
    const log = loadFeedbackLog();

    // Canonical 12-column schema matching dist/UNE_2027_Planner_Bug_Tracker_Template.csv
    const TRACKER_HEADERS = [
      "Timestamp",
      "Reviewer",
      "Course",
      "School",
      "Category",
      "Units",
      "Issue / Expected Behaviour",
      "Active Config",
      "Board Snapshot",
      "Viewport",
      "Status",
      "Resolution Notes",
    ];

    function itemToTrackerRow(x) {
      const courseCol =
        x.view === "finder" || x.courseCode === "FINDER"
          ? "Course Finder"
          : `${x.courseCode || ""} - ${x.courseTitle || ""}`.replace(/\s*-\s*$/, "");
      const boardCol =
        x.diagnosticsSummary && x.diagnosticsSummary !== "None" && x.diagnosticsSummary !== "N/A (Course Finder)"
          ? `${x.boardSnapshot || "(empty board)"} | Diag: ${x.diagnosticsSummary}`
          : x.boardSnapshot || "(empty board)";
      return [
        x.timestamp || "",
        x.reviewer || "Staff Tester",
        courseCol,
        x.school || "",
        x.category || "",
        x.units || "",
        x.description || "",
        x.configSummary || "",
        boardCol,
        x.viewport || "",
        x.status || "New",
        x.resolutionNotes || "",
      ];
    }

    function buildSingleText(item) {
      const courseLine =
        item.view === "finder" || item.courseCode === "FINDER"
          ? `Course Finder (${item.school})`
          : `${item.courseCode} — ${item.courseTitle} (${item.school})`;
      return [
        `UNE 2027 Course Planner — Tester Bug / Feedback Report`,
        `Date: ${item.timestamp}`,
        `Reviewer: ${item.reviewer || "Anonymous Staff"}`,
        `Context: ${courseLine}`,
        `Category: ${item.category}`,
        `Unit(s): ${item.units || "N/A"}`,
        `Issue / Feedback: ${item.description}`,
        `Active Config: ${item.configSummary}`,
        `Board Snapshot: ${item.boardSnapshot}`,
        `Diagnostics: ${item.diagnosticsSummary}`,
        `Viewport: ${item.viewport}`,
        `Link: ${item.directUrl}`,
      ].join("\n");
    }

    // Paste-ready data rows ONLY (12 columns matching UNE_2027_Planner_Bug_Tracker_Template.csv — no duplicate header row!)
    function buildTsv(items) {
      const clean = (v) => csvSafeCell(String(v || "").replace(/[\t\r\n]+/g, " ").trim());
      return items.map((x) => itemToTrackerRow(x).map(clean).join("\t")).join("\n");
    }

    // Full 12-column CSV matching dist/UNE_2027_Planner_Bug_Tracker_Template.csv exactly
    function buildCsv(items) {
      const q = (v) => `"${csvSafeCell(v).replace(/"/g, '""')}"`;
      const rows = [TRACKER_HEADERS, ...items.map(itemToTrackerRow)];
      return rows.map((r) => r.map(q).join(",")).join("\n");
    }

    const categories = [
      "Prerequisite / Co-requisite error",
      "Intensive School dates or campus",
      "Auto-Plan sequence / T3 issue",
      "Trimester offering / missing unit",
      "Course / Major / Minor rule",
      "Mobile / Tablet / Search glitch",
      "General suggestion",
    ];

    const logHtml =
      log.length > 0
        ? `
          <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <span class="config-label">Your Testing Session Log (${log.length} item${log.length === 1 ? "" : "s"})</span>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-primary" id="btn-bug-copy-tsv" type="button" title="Copies 12-column data rows (no duplicate header) matching the Tracker Template — paste into Row 2+">📊 Copy Rows (12-Col Template)</button>
                <button class="btn btn-sm btn-soft" id="btn-bug-dl-csv" type="button">⬇ Download CSV</button>
                <button class="btn btn-sm" id="btn-bug-clear-log" type="button" style="color:var(--err);">Clear Log</button>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:190px;overflow-y:auto;">
              ${log
                .map(
                  (it, idx) => `
                  <div class="bug-log-item">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                      <span><strong>${esc(it.courseCode)}</strong> · <span style="color:var(--primary);font-weight:700;">${esc(it.category)}</span>${it.units ? ` · <code>${esc(it.units)}</code>` : ""}</span>
                      <button class="icon-action remove" data-del-bug="${idx}" type="button" title="Delete entry">✕</button>
                    </div>
                    <div style="color:var(--text-muted);">${esc(it.description)}</div>
                  </div>
                `
                )
                .join("")}
            </div>
          </div>
        `
        : "";

    const safeFormUrl = safeHttpUrl(FEEDBACK_CONFIG.formUrl);

    openModal(
      `<div style="font-weight:800;font-size:15.5px;">🐞 Report a Bug or Rule Issue (DC / CC Testing)</div>
       <div style="font-size:12px;color:var(--text-subtle);">Log multiple issues as you test — auto-captures course, filters, rules, and schedule in the exact 12-column Bug Tracker schema.</div>`,
      `
        <div style="background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:11.5px;color:var(--text-muted);">
          <div><strong>Auto-captured context:</strong> <span class="course-code-pill teal" style="font-size:10.5px;padding:1px 6px;">${esc(ctx.courseCode)}</span> ${esc(ctx.courseTitle)} · ${esc(ctx.viewport)}</div>
          <div style="margin-top:3px;color:var(--text-subtle);word-break:break-word;">${esc(ctx.configSummary)}</div>
        </div>

        <div class="form-grid-2">
          <div>
            <label class="config-label">Your Name / Discipline</label>
            <input type="text" class="text-input" id="bug-reviewer" placeholder="e.g. Robert (Exercise Science)" value="${esc(savedReviewer)}" style="width:100%;margin-top:4px;" />
          </div>
          <div>
            <label class="config-label">Issue Category</label>
            <select class="select-input" id="bug-category" style="width:100%;margin-top:4px;">
              ${categories.map((catOpt) => `<option value="${esc(catOpt)}" ${savedCat === catOpt ? "selected" : ""}>${esc(catOpt)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div>
          <label class="config-label">Unit Code(s) Involved (optional)</label>
          <input type="text" class="text-input" id="bug-units" placeholder="e.g. EXSC390, EXSC260, EXSC370" value="${esc(unitInit)}" style="width:100%;margin-top:4px;text-transform:uppercase;" />
        </div>

        <div>
          <label class="config-label">What happened &amp; what should happen instead?</label>
          <textarea class="feedback-textarea" id="bug-desc" placeholder="Describe the issue clearly (e.g. 'EXSC390 was scheduled before EXSC381-384' or 'T2 intensive is in Sydney, not Armidale')…" style="margin-top:4px;">${esc(descInit)}</textarea>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="display:flex;gap:7px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="btn-bug-save-log" type="button">+ Add to Session Log</button>
            <button class="btn btn-soft" id="btn-bug-copy-one" type="button">📋 Copy Single Report</button>
          </div>
          ${
            safeFormUrl
              ? `<a href="${esc(safeFormUrl)}" target="_blank" rel="noopener" class="btn">Open ${esc(FEEDBACK_CONFIG.sharedDocLabel)} ↗</a>`
              : `<span style="font-size:11px;color:var(--text-subtle);">Tip: Log all items, then click <strong>Copy Rows</strong> to paste directly into Row 2+ of the shared tracker (or <strong>Download CSV</strong>).</span>`
          }
        </div>

        ${logHtml}
      `,
      (modal) => {
        function readCurrentDraft() {
          return {
            reviewer: modal.querySelector("#bug-reviewer").value || "",
            category: modal.querySelector("#bug-category").value,
            units: modal.querySelector("#bug-units").value || "",
            description: modal.querySelector("#bug-desc").value || "",
          };
        }

        function buildDraftItem() {
          const d = readCurrentDraft();
          const reviewer = d.reviewer.trim();
          const category = d.category;
          const units = d.units.trim().toUpperCase();
          const description = d.description.trim();
          if (reviewer) {
            safeLocalSet(FEEDBACK_REVIEWER_KEY, reviewer);
          }
          if (!description) {
            showToast("Please describe what happened first.");
            return null;
          }
          return {
            timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
            reviewer: reviewer || "Staff Tester",
            category,
            units,
            description,
            status: "New",
            resolutionNotes: "",
            ...ctx,
          };
        }

        modal.querySelector("#btn-bug-save-log").onclick = () => {
          const item = buildDraftItem();
          if (!item) return;
          const next = [item, ...loadFeedbackLog()];
          saveFeedbackLog(next);
          renderHeader(getCurrentCourse(), getCurrentPlan());
          showToast(`Saved to Testing Log (${next.length} item${next.length === 1 ? "" : "s"})!`);
          openBugReportModal("");
        };

        modal.querySelector("#btn-bug-copy-one").onclick = () => {
          const item = buildDraftItem();
          if (!item) return;
          copyTextToClipboard(buildSingleText(item), "Copied formatted bug report — paste into the shared tracker or Teams!");
        };

        const tsvBtn = modal.querySelector("#btn-bug-copy-tsv");
        if (tsvBtn) {
          tsvBtn.onclick = () => {
            const items = loadFeedbackLog();
            copyTextToClipboard(
              buildTsv(items),
              `Copied ${items.length} row(s) (12-col template, no header) — paste into Row 2+ in Excel / SharePoint!`
            );
          };
        }

        const csvBtn = modal.querySelector("#btn-bug-dl-csv");
        if (csvBtn) {
          csvBtn.onclick = () => {
            const items = loadFeedbackLog();
            const who = (items[0]?.reviewer || "Staff").replace(/[^a-z0-9]+/gi, "_").slice(0, 24);
            downloadBlob(`UNE_2027_Planner_Feedback_${who}.csv`, buildCsv(items), "text/csv;charset=utf-8;");
            showToast(`Downloaded ${items.length} feedback item(s) as 12-column CSV!`);
          };
        }

        const clrBtn = modal.querySelector("#btn-bug-clear-log");
        if (clrBtn) {
          clrBtn.onclick = () => {
            const draft = readCurrentDraft();
            saveFeedbackLog([]);
            renderHeader(getCurrentCourse(), getCurrentPlan());
            showToast("Cleared session feedback log.");
            openBugReportModal("", draft);
          };
        }

        modal.querySelectorAll("[data-del-bug]").forEach((btn) => {
          btn.onclick = () => {
            const draft = readCurrentDraft();
            const idx = parseInt(btn.dataset.delBug, 10);
            const list = loadFeedbackLog();
            list.splice(idx, 1);
            saveFeedbackLog(list);
            renderHeader(getCurrentCourse(), getCurrentPlan());
            openBugReportModal("", draft);
          };
        });
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
      document.title = `Find a Course (${DATA.meta.counts.courses} Degrees) | UNE 2027 Interactive Course Planner`;
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

  // Trial banner bug button & dismiss (safe sessionStorage access for sandboxed myLearn / Moodle iframes)
  const bannerBugBtn = document.getElementById("btn-banner-bug");
  if (bannerBugBtn) {
    bannerBugBtn.onclick = () => openBugReportModal();
  }
  const dismissTrialBtn = document.getElementById("btn-dismiss-trial");
  const trialBannerEl = document.getElementById("trial-banner");
  if (trialBannerEl && safeSessionGet("une_trial_banner_dismissed") === "1") {
    trialBannerEl.style.display = "none";
  }
  if (dismissTrialBtn && trialBannerEl) {
    dismissTrialBtn.onclick = () => {
      trialBannerEl.style.display = "none";
      safeSessionSet("une_trial_banner_dismissed", "1");
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
