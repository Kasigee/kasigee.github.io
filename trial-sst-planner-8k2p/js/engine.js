/**
 * UNE School of Science & Technology — Curriculum, Prerequisite & Auto-Scheduler Engine
 * Covers all 45 courses, 110 Majors/Minors/Pathways, 401 Study Plans, and 500+ Units (2027).
 */
(function (global) {
  "use strict";

  let _uidCounter = 1;
  function uid(prefix) {
    return (prefix || "s") + "_" + Date.now().toString(36) + "_" + (_uidCounter++).toString(36);
  }

  function getUnit(code, data, customUnits) {
    if (!code) return null;
    if (customUnits && customUnits[code]) return customUnits[code];
    return data.units[code] || null;
  }

  /**
   * Resolves a unit's Intensive School metadata (kind, location, campuses, published dates, TBA flag)
   * for a specific trimester (or overall if triNum is omitted).
   */
  function getUnitIntensiveForTri(u, triNum) {
    if (!u || !u.intensive) return null;
    const byTri = triNum && u.intensiveByTri ? u.intensiveByTri[String(triNum)] : null;
    const kind = byTri?.kind || u.intensive;
    const dates = byTri ? (byTri.dates || []) : (u.intensiveDates || []);
    const campuses = byTri && byTri.campuses?.length ? byTri.campuses : (u.intensiveCampuses || []);
    const location = byTri?.location || u.intensiveLocation || "Location TBA";
    const tba = byTri ? Boolean(byTri.tba) : (dates.length === 0);
    const physicalCampuses = campuses.filter((c) => c !== "online");
    const isOnlineOnly = campuses.length > 0 && physicalCampuses.length === 0;
    return {
      kind,
      dates,
      tba,
      location,
      campuses,
      physicalCampuses,
      isPhysical: !isOnlineOnly,
      duration: u.intensiveDuration || "",
      note: u.intensiveNote || "",
    };
  }

  function getPhysicalCampusGroup(intInfo) {
    if (!intInfo || intInfo.kind !== "Mandatory" || !intInfo.isPhysical) return null;
    const s = new Set(intInfo.physicalCampuses || []);
    if (s.has("armidale") && s.has("sydney")) return "armidale_sydney";
    if (s.has("sydney")) return "sydney_only";
    if (s.has("armidale")) return "armidale_only";
    if (s.size > 0) return Array.from(s).sort().join("_");
    return null;
  }

  /**
   * Recursive-descent boolean evaluator for unit prerequisite token streams:
   * Tokens: '(', ')', 'AND', 'OR', or UnitCode (e.g. 'MTHS120').
   * Adjacent unit codes without explicit connector default to OR if inside choice parens, else AND.
   */
  function evalPrereqTokens(tokens, completedSet) {
    if (!tokens || !tokens.length) return true;
    // Normalize adjacent unit codes if any slipped through comma-lists (e.g., "BIOL110, CHEM110 and CHEM120")
    // In UNE prose, "A, B and C" means A AND B AND C; "A, B or C" means A OR B OR C.
    const norm = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const prev = norm[norm.length - 1];
      const isCode = tok !== "(" && tok !== ")" && tok !== "AND" && tok !== "OR";
      const prevIsCodeOrClose = prev && prev !== "(" && prev !== "AND" && prev !== "OR";
      if ((isCode || tok === "(") && prevIsCodeOrClose) {
        // Look ahead to next connector to see if this comma list ends with OR or AND
        let inferred = "AND";
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j] === "(" || tokens[j] === ")") break;
          if (tokens[j] === "OR" || tokens[j] === "AND") {
            inferred = tokens[j];
            break;
          }
        }
        norm.push(inferred);
      }
      norm.push(tok);
    }

    let pos = 0;
    function parseOr() {
      let left = parseAnd();
      while (pos < norm.length && norm[pos] === "OR") {
        pos++;
        const right = parseAnd();
        left = left || right;
      }
      return left;
    }
    function parseAnd() {
      let left = parseAtom();
      while (pos < norm.length && norm[pos] === "AND") {
        pos++;
        const right = parseAtom();
        left = left && right;
      }
      return left;
    }
    function parseAtom() {
      if (pos >= norm.length) return true;
      const tok = norm[pos];
      if (tok === "(") {
        pos++;
        const val = parseOr();
        if (pos < norm.length && norm[pos] === ")") pos++;
        return val;
      }
      if (tok === ")" || tok === "AND" || tok === "OR") {
        pos++;
        return true;
      }
      pos++;
      return completedSet.has(tok);
    }
    try {
      return parseOr();
    } catch (_) {
      return true;
    }
  }

  /**
   * Computes Advanced Standing credit points for the selected Admission Rule (if any).
   */
  function getAdvancedStandingCp(course, admissionRule) {
    if (!course.structureConfig.hasAdmissionRules) return 0;
    const ruleCont = course.containers.find((c) => c.title.trim() === admissionRule);
    if (!ruleCont) return 0;
    let adv = 0;
    function walk(list) {
      for (const c of list || []) {
        if (c.isAdvancedStanding) adv += c.advancedStandingCp || c.cpMin || 0;
        walk(c.children);
      }
    }
    walk(ruleCont.children);
    return adv;
  }

  /**
   * Creates a clean initial plan state for a given course.
   */
  function createDefaultPlan(course, data) {
    const cfg = course.structureConfig;
    const admissionRule = cfg.hasAdmissionRules ? (cfg.admissionRules[0] || "") : "";
    let aosStructure = "none";
    if (cfg.aosMode === "bsc") aosStructure = "1m";
    else if (cfg.aosMode === "bcomp") aosStructure = "opt1";
    else if (cfg.aosMode === "bit01") aosStructure = "1m";
    else if (cfg.aosMode === "bbiosc") aosStructure = "listed";
    else if (cfg.aosMode !== "none") aosStructure = cfg.aosMode;

    const advCp = getAdvancedStandingCp(course, admissionRule);
    const studyCp = Math.max(24, (course.totalCp || 144) - advCp);
    const numYears = Math.max(1, Math.ceil(studyCp / 48));

    const years = [];
    for (let y = 1; y <= numYears; y++) {
      years.push({
        id: uid("yr"),
        yearNum: y,
        name: `Year ${y} (${2026 + y})`,
        trimesters: { 1: [], 2: [], 3: [] },
      });
    }

    return {
      courseCode: course.code,
      planName: "My 2027 Plan",
      admissionRule,
      aosStructure,
      selectedMajors: [],
      selectedMinor: "",
      dynamicAosSelections: {},
      commencingTrimester: 1,
      studyLoad: "Full-time",
      preferredMode: (course.modes || []).includes("Online") ? "Online" : (course.modes[0] || "On Campus"),
      t3Strategy: "none", // 'none' | 'spread' | 'accelerate'
      includeT3InAuto: false,
      customUnits: {},
      years,
    };
  }

  /**
   * Extracts available AOS options (Majors, Minors, Pathways, Components) for the active Course & Rule.
   */
  function getAvailableAOSOptions(course, plan, data) {
    const cfg = course.structureConfig;
    const activeTopContainers = cfg.hasAdmissionRules
      ? (course.containers.find((c) => c.title.trim() === plan.admissionRule)?.children || [])
      : course.containers;

    const majors = [];
    const minors = [];
    const pathways = [];
    const mandatoryComponents = [];

    function scan(conts) {
      for (const c of conts || []) {
        const aosItems = (c.items || []).filter((it) => it.kind === "aos");
        if (aosItems.length) {
          const vg = (c.vg || "").toLowerCase();
          const titleLow = c.title.toLowerCase();
          if (cfg.aosMode === "mandatory_components") {
            mandatoryComponents.push(...aosItems);
          } else if (cfg.aosMode === "dscnce") {
            for (const it of aosItems) {
              pathways.push({ ...it, groupLabel: c.title });
            }
          } else if (cfg.aosMode === "mnsc_pathway") {
            pathways.push(...aosItems);
          } else if (vg === "minor" || titleLow.includes("minor")) {
            minors.push(...aosItems);
          } else {
            majors.push(...aosItems);
          }
        }
        scan(c.children);
      }
    }
    scan(activeTopContainers);

    return { majors, minors, pathways, mandatoryComponents };
  }

  /**
   * For any whole-university course using aosMode === 'dynamic' (e.g. BA, BBus, BASC, BSCLAW, BED*, BAGR, etc.),
   * extracts every active AOS selector container (Majors, Minors, Specialisations, Teaching Areas, Focus Areas).
   */
  function getDynamicAOSGroups(course, plan, data) {
    const cfg = course.structureConfig;
    const activeTopContainers = cfg.hasAdmissionRules
      ? (course.containers.find((c) => c.title.trim() === plan.admissionRule)?.children || course.containers[0]?.children || [])
      : course.containers;

    const groups = [];
    function scan(conts) {
      for (const c of conts || []) {
        const aosItems = (c.items || []).filter((it) => it.kind === "aos");
        if (aosItems.length > 0) {
          const vgLow = (c.vg || "").toLowerCase();
          const titleLow = c.title.toLowerCase();
          const descLow = (c.description || "").toLowerCase();
          const isMinor = vgLow === "minor" || titleLow.includes("minor");
          const isMandatorySingle =
            aosItems.length === 1 &&
            (descLow.includes("complete the following") ||
              descLow.includes("available law listed") ||
              titleLow.includes("focus area") ||
              titleLow.includes("articulation"));
          const cleanLabel = c.title
            .replace(/^Rule\s+[A-Z0-9\s/&-]+-\s*/i, "")
            .replace(/^Schedule\s+[A-Z0-9\s/&-]+-\s*/i, "")
            .trim();
          groups.push({
            id: c.title,
            title: cleanLabel || c.title,
            isMinor,
            isMandatorySingle,
            description: c.description || "",
            items: aosItems,
          });
        }
        scan(c.children);
      }
    }
    scan(activeTopContainers);
    return groups;
  }

  /**
   * Collects all planned unit slots & placeholder slots across the board in chronological order.
   */
  function getPlannedPlacements(plan, data) {
    const placements = [];
    (plan.years || []).forEach((yr, yIdx) => {
      for (const tNum of [1, 2, 3]) {
        const slots = (yr.trimesters && yr.trimesters[tNum]) || [];
        slots.forEach((slot, sIdx) => {
          const chrono = yIdx * 3 + (tNum - 1);
          if (slot.type === "unit") {
            const u = getUnit(slot.code, data, plan.customUnits);
            placements.push({
              slot,
              slotIdx: sIdx,
              yearIdx: yIdx,
              yearNum: yr.yearNum || yIdx + 1,
              triNum: tNum,
              chrono,
              type: "unit",
              code: slot.code,
              unit: u,
              cp: u ? u.cp : (slot.cp || 6),
            });
          } else {
            placements.push({
              slot,
              slotIdx: sIdx,
              yearIdx: yIdx,
              yearNum: yr.yearNum || yIdx + 1,
              triNum: tNum,
              chrono,
              type: "placeholder",
              label: slot.label || "Elective Unit",
              hintCodes: slot.hintCodes || [],
              cp: slot.cp || 6,
            });
          }
        });
      }
    });
    return placements;
  }

  /**
   * Flattens an AOS or Course container into structured display/validation buckets.
   */
  function buildAOSBuckets(aosCode, category, labelPrefix, data, majorCoreHints) {
    const aos = data.aos[aosCode];
    if (!aos) return [];
    if (aos.coreDirective) {
      for (const mCode of aos.coreDirective.mandatory || []) {
        majorCoreHints.mandatory[mCode] = majorCoreHints.mandatory[mCode] || [];
        if (!majorCoreHints.mandatory[mCode].includes(aos.title)) {
          majorCoreHints.mandatory[mCode].push(aos.title);
        }
      }
      for (const grp of aos.coreDirective.choiceGroups || []) {
        majorCoreHints.choiceGroups.push({ majorCode: aosCode, majorTitle: aos.title, codes: grp });
      }
    }

    const out = [];
    function walk(cont, parentTitle) {
      const unitItems = (cont.items || []).filter((i) => i.kind === "unit");
      const isZeroCoreNote = cont.title.toLowerCase().includes("core") && !unitItems.length && !(cont.children || []).length;
      if (isZeroCoreNote) return;

      if (unitItems.length) {
        // Check if cpMin is specified on container or inferred from "Complete X credit points" in description
        let cpMin = cont.cpMin;
        let cpMax = cont.cpMax;
        if ((cpMin === null || cpMin === 0) && cont.description) {
          const mRange = cont.description.match(/complete\s+(\d+)\s*(?:to|-|–)\s*(\d+)\s*credit points/i);
          const mExact = cont.description.match(/complete\s+(\d+)\s*credit points/i);
          if (mRange) {
            cpMin = parseInt(mRange[1], 10);
            cpMax = parseInt(mRange[2], 10);
          } else if (mExact) {
            cpMin = parseInt(mExact[1], 10);
            cpMax = cpMin;
          } else if (/complete (all )?the following unit/i.test(cont.description)) {
            cpMin = unitItems.reduce((s, x) => s + (x.cp || 6), 0);
          }
        }
        // If parent container had totalCp (e.g. Prescribed Units 42 CP with 6 mandatory = 36 CP + child Additional Prescribed = 6 CP), adjust parent cpMin to direct units when children carry the rest
        let childInferredSum = 0;
        for (const ch of cont.children || []) {
          const mEx = (ch.description || "").match(/complete\s+(\d+)\s*credit points/i);
          if (ch.cpMin) childInferredSum += ch.cpMin;
          else if (mEx) childInferredSum += parseInt(mEx[1], 10);
        }
        const directSum = unitItems.reduce((s, x) => s + (x.cp || 6), 0);
        const effectiveMin = (cpMin && childInferredSum > 0 && cpMin === directSum + childInferredSum)
          ? directSum
          : cpMin;

        out.push({
          id: `aos_${aosCode}_${cont.title}`,
          title: `${labelPrefix}: ${cont.title}`,
          shortTitle: cont.title,
          aosCode,
          aosTitle: aos.title,
          category,
          cpMin: effectiveMin,
          cpMax: cpMax || effectiveMin || null,
          description: cont.description || "",
          units: unitItems.map((u) => u.code),
        });
      }
      for (const ch of cont.children || []) {
        walk(ch, cont.title);
      }
    }
    for (const c of aos.containers || []) {
      walk(c, "");
    }
    return out;
  }

  /**
   * Resolves all active requirement buckets, unit attributions, Major Core hints, and Major overlaps.
   */
  function resolveCurriculumBuckets(course, plan, data) {
    const cfg = course.structureConfig;
    const advCp = getAdvancedStandingCp(course, plan.admissionRule);
    const majorCoreHints = { mandatory: {}, choiceGroups: [] };
    const buckets = [];

    // 1. Pre-scan selected Majors/Minors first so majorCoreHints are populated BEFORE building Core buckets!
    const activeAOSBuckets = [];
    const aosOptions = getAvailableAOSOptions(course, plan, data);

    if (cfg.aosMode === "mandatory_components") {
      aosOptions.mandatoryComponents.forEach((comp, idx) => {
        activeAOSBuckets.push(
          ...buildAOSBuckets(comp.code, idx === 0 ? "major1" : "minor", comp.title, data, majorCoreHints)
        );
      });
    } else if (cfg.aosMode === "dynamic") {
      const dynGroups = getDynamicAOSGroups(course, plan, data);
      const dynSel = plan.dynamicAosSelections || {};
      let majorSlotIdx = 0;
      for (const grp of dynGroups) {
        let chosenCode = "";
        if (grp.isMandatorySingle) {
          chosenCode = grp.items[0]?.code || "";
        } else {
          chosenCode = dynSel[grp.id] || "";
        }
        if (chosenCode && data.aos[chosenCode]) {
          const aObj = data.aos[chosenCode];
          const cleanName = (grp.items.find((x) => x.code === chosenCode)?.title || aObj.title)
            .replace(/^[A-Z0-9]+\s*-\s*/, "")
            .replace(/\s*\((Major|Minor)\)\s*$/i, "")
            .trim();
          const isListedFocus = /listed unit/i.test(grp.title) || /listed unit/i.test(cleanName);
          const cat = isListedFocus ? "listed" : grp.isMinor ? "minor" : majorSlotIdx === 0 ? "major1" : "major2";
          if (!grp.isMinor && !isListedFocus) majorSlotIdx++;
          activeAOSBuckets.push(
            ...buildAOSBuckets(chosenCode, cat, `${grp.title} (${cleanName})`, data, majorCoreHints)
          );
        }
      }
    } else {
      const maxMajors =
        (cfg.aosMode === "bsc" && plan.aosStructure === "2m") ||
        (cfg.aosMode === "bcomp" && plan.aosStructure === "opt3") ||
        (cfg.aosMode === "bit01" && plan.aosStructure === "2m")
          ? 2
          : ["bsc", "bcomp", "bit01", "single_major"].includes(cfg.aosMode)
          ? 1
          : 0;

      const allowMinor =
        (cfg.aosMode === "bsc" && plan.aosStructure === "1m1n") ||
        (cfg.aosMode === "bcomp" && plan.aosStructure === "opt2") ||
        (cfg.aosMode === "bbiosc" && plan.aosStructure === "minor") ||
        cfg.aosMode === "dscnce" ||
        cfg.aosMode === "mnsc_pathway";

      const chosenMajors = (plan.selectedMajors || []).slice(0, maxMajors);
      chosenMajors.forEach((mCode, idx) => {
        const mObj = data.aos[mCode];
        if (mObj) {
          const cleanName = (aosOptions.majors.find((x) => x.code === mCode)?.title || mObj.title)
            .replace(/^[A-Z0-9]+\s*-\s*/, "")
            .replace(/\s*\((Major|Minor)\)\s*$/i, "")
            .trim();
          activeAOSBuckets.push(
            ...buildAOSBuckets(
              mCode,
              idx === 0 ? "major1" : "major2",
              `${maxMajors > 1 ? `Major ${idx + 1}` : "Major"} (${cleanName})`,
              data,
              majorCoreHints
            )
          );
        }
      });

      if (allowMinor && plan.selectedMinor && data.aos[plan.selectedMinor]) {
        const minObj = data.aos[plan.selectedMinor];
        const cleanMinName = minObj.title
          .replace(/^[A-Z0-9]+\s*-\s*/, "")
          .replace(/\s*\((Major|Minor)\)\s*$/i, "")
          .trim();
        const roleLabel = cfg.aosMode === "mnsc_pathway" ? "Pathway" : cfg.aosMode === "dscnce" ? "Stream / Minor" : "Minor";
        activeAOSBuckets.push(
          ...buildAOSBuckets(plan.selectedMinor, "minor", `${roleLabel} (${cleanMinName})`, data, majorCoreHints)
        );
      }
    }

    // 2. Unpack Course containers (for active Admission Rule if applicable)
    let sourceContainers = course.containers || [];
    if (cfg.hasAdmissionRules) {
      const ruleCont = sourceContainers.find((c) => c.title.trim() === plan.admissionRule) || sourceContainers[0];
      if (ruleCont) {
        sourceContainers = [];
        const directUnits = (ruleCont.items || []).filter((i) => i.kind === "unit");
        if (directUnits.length) {
          const directCp = directUnits.reduce((s, x) => s + (x.cp || 6), 0);
          sourceContainers.push({
            title: `${ruleCont.title} - Core Units`,
            vg: "Core",
            cpMin: directCp,
            cpMax: directCp,
            description: ruleCont.description || "Complete the following Core Units:",
            items: directUnits,
            children: [],
          });
        }
        sourceContainers.push(...(ruleCont.children || []));
      }
    }

    let hasExplicitElectiveContainer = false;
    function walkCourseContainer(cont, parentTitle) {
      if (cont.isAdvancedStanding) return;
      const vgLow = (cont.vg || "").toLowerCase();
      const titleLow = cont.title.toLowerCase();

      // Skip AOS selector containers (handled via activeAOSBuckets)
      const hasOnlyAOS =
        (cont.items || []).length > 0 && (cont.items || []).every((i) => i.kind === "aos");
      if (hasOnlyAOS || vgLow === "major" || (vgLow === "minor" && !(cont.items || []).some((i) => i.kind === "unit"))) {
        return;
      }
      if (cfg.aosMode === "dscnce" && titleLow.includes("general studies in science or minor")) {
        return;
      }
      if (cfg.aosMode === "dynamic" && (cont.items || []).some((i) => i.kind === "aos") && !(cont.items || []).some((i) => i.kind === "unit")) {
        return;
      }

      const unitItems = (cont.items || []).filter((i) => i.kind === "unit");
      const children = cont.children || [];

      if (vgLow === "elective" || titleLow.includes("elective unit")) {
        hasExplicitElectiveContainer = true;
      }

      if (unitItems.length) {
        let cat = "listed";
        if (vgLow === "core" || titleLow.includes("core")) cat = "core";
        else if (titleLow.includes("capstone") || titleLow.includes("research") || titleLow.includes("project")) cat = "capstone";
        else if (vgLow === "elective" || titleLow.includes("elective")) cat = "elective";

        // If container has both direct mandatory unit(s) AND sub-containers (like BSC Core Units: STAT100 [6 CP] + 3 children [6+6+24 = 36 CP] = 42 CP)
        const childCpSum = children.reduce((s, ch) => s + (ch.cpMin || 0), 0);
        const directCpSum = unitItems.reduce((s, u) => s + (u.cp || 6), 0);
        let effMin = cont.cpMin;
        if (effMin && childCpSum > 0 && effMin === directCpSum + childCpSum) {
          effMin = directCpSum;
        }

        buckets.push({
          id: `course_${cont.title}`,
          title: parentTitle && !cont.title.startsWith(parentTitle) ? `${cont.title}` : cont.title,
          shortTitle: cont.title,
          category: cat,
          cpMin: effMin,
          cpMax: cont.cpMax || (cat === "core" ? effMin : null),
          description: cont.description || "",
          units: unitItems.map((u) => u.code),
        });
      }

      for (const ch of children) {
        walkCourseContainer(ch, cont.title);
      }
    }

    for (const topC of sourceContainers) {
      walkCourseContainer(topC, "");
    }

    // Insert Major / Minor buckets right after Core buckets
    const coreBuckets = buckets.filter((b) => b.category === "core");
    const nonCoreBuckets = buckets.filter((b) => b.category !== "core");

    // Special BSC Listed Units enrichment:
    // 1) Additional Science Core units beyond 24 CP count in Listed Units - Foundational Science
    // 2) Any unit prescribed in ANY BSc Major counts in Listed Units - General Science
    if (course.code === "BSC") {
      const foundSciBucket = nonCoreBuckets.find((b) => b.title.includes("Foundational Science"));
      const sciCoreBucket = coreBuckets.find((b) => b.title.includes("Science Core"));
      if (foundSciBucket && sciCoreBucket) {
        const setF = new Set(foundSciBucket.units);
        sciCoreBucket.units.forEach((u) => setF.add(u));
        foundSciBucket.units = Array.from(setF);
      }
      const genSciBucket = nonCoreBuckets.find((b) => b.title.includes("General Science"));
      if (genSciBucket) {
        const extraSciUnits = new Set(genSciBucket.units);
        for (const mOpt of aosOptions.majors) {
          const mAos = data.aos[mOpt.code];
          if (mAos) {
            for (const mc of mAos.containers || []) {
              for (const it of mc.items || []) if (it.kind === "unit") extraSciUnits.add(it.code);
              for (const sub of mc.children || []) {
                for (const it of sub.items || []) if (it.kind === "unit") extraSciUnits.add(it.code);
              }
            }
          }
        }
        genSciBucket.units = Array.from(extraSciUnits);
      }
    }

    // Adjust Elective / Listed caps for BSC & BCOMP & BBIOSC based on chosen structure!
    let electiveCap = null;
    if (course.code === "BSC") {
      if (plan.aosStructure === "2m") electiveCap = 18;
      else electiveCap = 36;
    } else if (course.code === "BCOMP") {
      if (plan.aosStructure === "opt1") electiveCap = 42;
      else if (plan.aosStructure === "opt2") electiveCap = 18;
      else electiveCap = 0;
    } else if (course.code === "BBIOSC") {
      // Specialist minor (24 CP) leaves 6 CP Listed; no minor uses 30 CP Listed
      const listedParent = nonCoreBuckets.filter((b) => b.category === "listed");
      if (plan.aosStructure === "minor" && listedParent.length) {
        listedParent.forEach((b) => { b.cpMin = null; b.cpMax = 6; });
      }
    } else if (course.code === "BNHSC") {
      electiveCap = 12;
    } else if (course.code === "BSCST") {
      electiveCap = 24;
    } else if (course.code === "HBCOMP") {
      electiveCap = 24;
    } else if (course.code === "BIT01") {
      electiveCap = plan.aosStructure === "2m" ? 12 : 48;
    } else if (course.code === "MSCST") {
      electiveCap = 42;
    }

    const orderedBuckets = [...coreBuckets, ...activeAOSBuckets, ...nonCoreBuckets];

    if (hasExplicitElectiveContainer || electiveCap !== null) {
      if (!orderedBuckets.some((b) => b.category === "elective")) {
        orderedBuckets.push({
          id: "general_electives",
          title: "Elective / Open Pool Units",
          shortTitle: "Elective Units",
          category: "elective",
          cpMin: null,
          cpMax: electiveCap,
          description:
            electiveCap === 0
              ? "Double Major option uses full credit allocation in Core + Majors."
              : `Select any university-wide units for which you meet prerequisites${electiveCap ? ` (up to ${electiveCap} CP)` : ""}.`,
          units: [],
        });
      }
    }

    // 3. Attribute planned units on the board to buckets (without double-counting!)
    const placements = getPlannedPlacements(plan, data);
    const plannedUnitPlacements = placements.filter((p) => p.type === "unit");
    const attributedBucketByCode = {};
    for (const b of orderedBuckets) {
      b.plannedUnits = [];
      b.plannedCp = 0;
    }

    // Priority attribution: Core -> Major 1 -> Major 2 -> Minor -> Capstone -> Listed -> Elective
    const priorityOrder = ["core", "major1", "major2", "minor", "capstone", "listed", "elective"];
    const bucketsByPriority = [...orderedBuckets].sort(
      (a, b) => priorityOrder.indexOf(a.category) - priorityOrder.indexOf(b.category)
    );

    for (const p of plannedUnitPlacements) {
      if (attributedBucketByCode[p.code]) continue; // prevent duplicate unit code from counting twice
      let matched = null;
      // First pass: prefer bucket that contains p.code AND hasn't hit cpMax yet
      for (const b of bucketsByPriority) {
        if (b.category === "elective") continue;
        if (b.units.includes(p.code)) {
          if (!b.cpMax || b.plannedCp + p.cp <= b.cpMax) {
            matched = b;
            break;
          }
        }
      }
      // Second pass: any bucket containing p.code
      if (!matched) {
        for (const b of bucketsByPriority) {
          if (b.category !== "elective" && b.units.includes(p.code)) {
            matched = b;
            break;
          }
        }
      }
      // Fallback: Elective bucket (or an "Unmatched / Elective" bucket)
      if (!matched) {
        matched = orderedBuckets.find((b) => b.category === "elective");
        if (!matched) {
          matched = {
            id: "extra_units",
            title: "Additional / Unlisted Units",
            shortTitle: "Additional Units",
            category: "elective",
            cpMin: null,
            cpMax: null,
            description: "Units outside the prescribed/listed containers for this course.",
            units: [],
            plannedUnits: [],
            plannedCp: 0,
          };
          orderedBuckets.push(matched);
        }
      }
      matched.plannedUnits.push(p.code);
      matched.plannedCp += p.cp;
      attributedBucketByCode[p.code] = matched.id;
    }

    // Compute bucket completion status
    for (const b of orderedBuckets) {
      if (b.cpMax && b.plannedCp > b.cpMax) b.status = "over";
      else if (b.cpMin && b.plannedCp >= b.cpMin) b.status = "complete";
      else if (b.cpMin && b.plannedCp < b.cpMin) b.status = "in_progress";
      else b.status = "optional";
    }

    // 4. Detect Major 1 vs Major 2 200/300-level overlap
    const m1Units = new Set();
    const m2Units = new Set();
    for (const b of activeAOSBuckets) {
      if (b.category === "major1") b.units.forEach((u) => m1Units.add(u));
      if (b.category === "major2") b.units.forEach((u) => m2Units.add(u));
    }
    const majorOverlapUnits = [];
    for (const uCode of m1Units) {
      if (m2Units.has(uCode)) {
        const uObj = getUnit(uCode, data, plan.customUnits);
        if (!uObj || uObj.level >= 200) majorOverlapUnits.push(uCode);
      }
    }

    // 5. Check incompatible Major pairs (e.g. BSC Neuroscience + Palaeobiology)
    let incompatiblePairWarning = null;
    for (const [a, b] of course.incompatibleAOS || []) {
      if ((plan.selectedMajors || []).includes(a) && (plan.selectedMajors || []).includes(b)) {
        const tA = data.aos[a]?.title || a;
        const tB = data.aos[b]?.title || b;
        incompatiblePairWarning = `UNE Enrolment Rule: Students cannot enrol in ${tA} and ${tB} concurrently.`;
      }
    }

    return {
      buckets: orderedBuckets,
      attributedBucketByCode,
      advancedStandingCp: advCp,
      majorCoreHints,
      majorOverlapUnits,
      incompatiblePairWarning,
      aosOptions,
    };
  }

  /**
   * Evaluates every unit placement on the board for trimester offerings, modes, intensives,
   * restrictions, co-requisites, and prerequisites.
   */
  function evaluateAllPlacements(course, plan, data, advCp) {
    const placements = getPlannedPlacements(plan, data);
    const unitPlacements = placements.filter((p) => p.type === "unit");
    const allCodes = new Set(unitPlacements.map((p) => p.code));
    const codeCounts = {};
    for (const p of unitPlacements) codeCounts[p.code] = (codeCounts[p.code] || 0) + 1;

    // Reverse restriction lookup: only bidirectional if BOTH units restrict each other;
    // otherwise directional (e.g., CHEM100 restricts CHEM110 if CHEM110 is taken in the SAME or EARLIER trimester,
    // whereas taking CHEM100 in T1 BEFORE CHEM110 in T2 is valid!).
    const resultsBySlotId = {};

    for (const p of placements) {
      if (p.type !== "unit") {
        resultsBySlotId[p.slot.id] = { errors: [], warnings: [], infos: [], intensiveAlerts: [] };
        continue;
      }
      const errors = [];
      const warnings = [];
      const infos = [];
      const intensiveAlerts = [];
      const u = p.unit;

      if (codeCounts[p.code] > 1) {
        errors.push(`Duplicate unit: ${p.code} appears more than once in your plan.`);
      }

      if (!u) {
        warnings.push("Custom/unlisted unit — verify handbook offering & prerequisites.");
        resultsBySlotId[p.slot.id] = { errors, warnings, infos, intensiveAlerts };
        continue;
      }

      if (u.offered2027 === false) {
        errors.push(`${p.code} has no published 2027 UNE unit offering (archived unit).`);
      } else if (u.trimesters && u.trimesters.length > 0 && !u.trimesters.includes(p.triNum)) {
        errors.push(
          `${p.code} is not offered in Trimester ${p.triNum} in 2027 (offered in T${u.trimesters.join(", T")}).`
        );
      }

      if (u.t3RepeatOnly && p.triNum === 3) {
        warnings.push(`${p.code} Trimester 3 is for repeating students only (requires Head of School permission).`);
      }

      if (u.modes && u.modes.length > 0 && plan.preferredMode && !u.modes.includes(plan.preferredMode)) {
        warnings.push(`${p.code} is offered ${u.modes.join(" / ")} only (your preference is ${plan.preferredMode}).`);
      }

      const intInfo = getUnitIntensiveForTri(u, p.triNum);
      if (intInfo && intInfo.kind === "Mandatory") {
        const locPart = intInfo.location ? ` · ${intInfo.location}` : "";
        if (intInfo.tba) {
          intensiveAlerts.push(`Mandatory Intensive${locPart} — Dates TBA (check dates)`);
        } else {
          infos.push(`Mandatory Intensive${locPart}: ${intInfo.dates[0]}`);
        }
      } else if (u.yearLong) {
        infos.push("Year-Long / Multi-Period Unit");
      }

      // Prior & same-or-prior completed sets
      const priorUnits = new Set();
      const sameOrPriorUnits = new Set();
      let priorCp = advCp || 0;
      const priorPrefixCp = {};

      for (const other of placements) {
        if (other.slot.id === p.slot.id) continue;
        if (other.chrono < p.chrono) {
          priorCp += other.cp || 6;
          if (other.type === "unit") {
            priorUnits.add(other.code);
            sameOrPriorUnits.add(other.code);
            const pref = other.unit?.prefix || "";
            if (pref) priorPrefixCp[pref] = (priorPrefixCp[pref] || 0) + (other.cp || 6);
          }
        } else if (other.chrono === p.chrono && other.type === "unit") {
          sameOrPriorUnits.add(other.code);
        }
      }

      // Directional / Mutual Restriction check
      const triggeredRestrictions = [];
      for (const rCode of u.restrictedUnits || []) {
        const rUnit = getUnit(rCode, data, plan.customUnits);
        const isMutual = rUnit && (rUnit.restrictedUnits || []).includes(p.code);
        if (isMutual && allCodes.has(rCode)) {
          triggeredRestrictions.push(rCode);
        } else if (!isMutual && sameOrPriorUnits.has(rCode)) {
          triggeredRestrictions.push(`${rCode} (cannot take ${p.code} concurrently with or after ${rCode})`);
        }
      }
      if (triggeredRestrictions.length) {
        errors.push(`Incompatible / Restricted with ${triggeredRestrictions.join(", ")}.`);
      }

      // Co-requisites (structured boolean AST + course scoping)
      const cm = u.coreqMeta;
      if (cm) {
        const courseApplies = !cm.onlyCourses || cm.onlyCourses.includes(course.code);
        const ruleApplies = !cm.onlyRulePattern || (plan.admissionRule || "").includes(cm.onlyRulePattern);
        const waived = cm.pgWaiver && course.studyLevel === "Postgraduate";
        if (courseApplies && ruleApplies && !waived) {
          if (cm.tokens && cm.tokens.length > 0 && !evalPrereqTokens(cm.tokens, sameOrPriorUnits)) {
            warnings.push(`Co-requisite not met concurrently or earlier: ${u.coreqText}`);
          }
        }
      }

      // Prerequisites
      const pm = u.prereqMeta;
      const inCourseBuckets = isUnitInCourseBuckets(p.code, course, plan, data);
      if (course.studyLevel === "Undergraduate" && u.level >= 500 && !inCourseBuckets) {
        errors.push(`Restricted to Postgraduate candidature (${u.level}-level unit).`);
      }
      if (pm) {
        if (pm.pgOnly && course.studyLevel !== "Postgraduate" && !inCourseBuckets) {
          errors.push("Restricted to Postgraduate candidature.");
        } else if (pm.honoursOnly && course.studyLevel !== "Bachelor Honours" && !inCourseBuckets) {
          errors.push("Restricted to Honours candidature.");
        } else if (pm.courseRestricted && !inCourseBuckets) {
          warnings.push(`Check degree candidature restriction: ${pm.courseRestricted}`);
        }

        if (pm.pgWaiver && course.studyLevel === "Postgraduate") {
          infos.push("UG prerequisites waived via Postgraduate candidature.");
        } else {
          if (pm.minCp > 0 && priorCp < pm.minCp) {
            warnings.push(
              `Requires ${pm.minCp} CP completed prior to this trimester (currently ${priorCp} CP prior).`
            );
          }
          if (pm.prefixCp) {
            const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
            const havePrefCp = prefs.reduce((s, pr) => s + (priorPrefixCp[pr] || 0), 0);
            if (havePrefCp < pm.prefixCp.cp) {
              warnings.push(
                `Requires ${pm.prefixCp.cp} CP in ${prefs.join("/")} units prior (currently ${havePrefCp} CP).`
              );
            }
          }
          if (pm.tokens && pm.tokens.length > 0 && !evalPrereqTokens(pm.tokens, priorUnits)) {
            warnings.push(`Prerequisite not satisfied in an earlier trimester: ${u.prereqText}`);
          }
        }
      }

      resultsBySlotId[p.slot.id] = { errors, warnings, infos, intensiveAlerts };
    }

    return resultsBySlotId;
  }

  /**
   * Full degree validation report: CP totals, level caps/minimums, Major directives, trimester loads, and unit diagnostics.
   */
  function validatePlan(course, plan, data) {
    const resolved = resolveCurriculumBuckets(course, plan, data);
    const placements = getPlannedPlacements(plan, data);
    const slotDiagnostics = evaluateAllPlacements(course, plan, data, resolved.advancedStandingCp);

    const uniqueUnits = new Map();
    let placeholderCp = 0;
    for (const p of placements) {
      if (p.type === "unit") {
        if (!uniqueUnits.has(p.code)) uniqueUnits.set(p.code, p);
      } else {
        placeholderCp += p.cp || 6;
      }
    }

    let unitCp = 0;
    const cpByLevel = { 100: 0, 200: 0, 300: 0, 400: 0, 500: 0, 600: 0 };
    for (const p of uniqueUnits.values()) {
      unitCp += p.cp;
      const lvl = p.unit?.level || 100;
      cpByLevel[lvl] = (cpByLevel[lvl] || 0) + p.cp;
    }

    const totalPlannedCp = resolved.advancedStandingCp + unitCp + placeholderCp;
    const targetCp = course.totalCp || 144;

    // Evaluate course level rules
    const levelChecks = [];
    for (const lr of course.levelRules || []) {
      if (lr.onlyRules && !lr.onlyRules.includes(plan.admissionRule)) continue;

      if (lr.special === "BCOMP_300") {
        let cosc300Cp = 0;
        let hasStat330 = uniqueUnits.has("STAT330");
        for (const p of uniqueUnits.values()) {
          if (p.unit?.prefix === "COSC" && p.unit?.level === 300) cosc300Cp += p.cp;
        }
        const ok = cosc300Cp >= 36 || (hasStat330 && cosc300Cp >= 30);
        levelChecks.push({
          label: lr.label,
          currentCp: cosc300Cp + (hasStat330 ? 6 : 0),
          targetText: hasStat330 ? "≥ 36 CP (STAT330 + 30 CP COSC3xx)" : "≥ 36 CP COSC3xx",
          passed: ok,
          kind: "min",
        });
        continue;
      }

      let sumLvl = 0;
      for (const lvl of lr.levels || []) sumLvl += cpByLevel[lvl] || 0;
      if (lr.includeAdvStanding) sumLvl += resolved.advancedStandingCp;

      if (lr.maxCp !== undefined) {
        levelChecks.push({
          label: lr.label,
          currentCp: sumLvl,
          targetCp: lr.maxCp,
          targetText: `${sumLvl} / ${lr.maxCp} CP max`,
          passed: sumLvl <= lr.maxCp,
          kind: "max",
        });
      } else if (lr.minCp !== undefined) {
        levelChecks.push({
          label: lr.label,
          currentCp: sumLvl,
          targetCp: lr.minCp,
          targetText: `${sumLvl} / ${lr.minCp} CP min`,
          passed: sumLvl >= lr.minCp,
          kind: "min",
        });
      }
    }

    // Check BSC Major Core Directives
    const globalIssues = [];
    if (resolved.incompatiblePairWarning) {
      globalIssues.push({ severity: "error", text: resolved.incompatiblePairWarning });
    }

    for (const [mCode, majorsRequiring] of Object.entries(resolved.majorCoreHints.mandatory)) {
      if (!uniqueUnits.has(mCode)) {
        globalIssues.push({
          severity: "warning",
          text: `Major Core Requirement: ${majorsRequiring.join(" & ")} requires ${mCode} in your Course Core Units.`,
          actionUnit: mCode,
        });
      }
    }
    for (const grp of resolved.majorCoreHints.choiceGroups) {
      if (!grp.codes.some((c) => uniqueUnits.has(c))) {
        globalIssues.push({
          severity: "warning",
          text: `Major Core Requirement: ${grp.majorTitle} requires one of (${grp.codes.join(" or ")}) in your Science Core.`,
        });
      }
    }

    // Also attach t3Analysis to globalIssues when validatePlan runs so the user always sees why Fast-Track saved or didn't save time!
    if (plan.t3Analysis) {
      const ta = plan.t3Analysis;
      if (ta.status === "bottlenecked") {
        const bn = ta.bottleneckUnits?.length ? ` (${ta.bottleneckUnits.join(", ")})` : "";
        globalIssues.push({
          severity: "info",
          text: `T3 Fast-Track Check: 0 trimesters saved — offerings & prerequisite chains still finish in ${ta.stdFinishLabel} (${ta.t3MajorUnits}/${ta.totalMajorUnits} prescribed Major/Stream units run in T3; final T1/T2 bottleneck${bn}). Kept standard T1/T2 pacing instead of overloading Year 1.`,
          actionT3Spread: true,
        });
      } else if (ta.status === "accelerated") {
        globalIssues.push({
          severity: "info",
          text: `⚡ T3 Fast-Track Active: Finishes in ${ta.accFinishLabel} instead of ${ta.stdFinishLabel} (${ta.trimestersSaved} trimester period${ta.trimestersSaved === 1 ? "" : "s"} earlier).`,
        });
      } else if (ta.status === "spread") {
        globalIssues.push({
          severity: "info",
          text: `🌿 T3 Load-Spread Active: Lighter 18 CP T1/T2 load where T3 units/electives permit — still finishes in ${ta.accFinishLabel}.`,
        });
      }
    }

    if (resolved.majorOverlapUnits.length > 0) {
      globalIssues.push({
        severity: "info",
        text: `Shared 200/300-level Major unit(s): ${resolved.majorOverlapUnits.join(", ")} counts toward Major 1 only under UNE rules — ensure Major 2 reaches its full CP via an additional Listed/Prescribed unit.`,
      });
    }

    // Check AOS selection completeness
    const cfg = course.structureConfig;
    if (["bsc", "bcomp", "bit01", "single_major"].includes(cfg.aosMode)) {
      const reqMajors =
        (cfg.aosMode === "bsc" && plan.aosStructure === "2m") ||
        (cfg.aosMode === "bcomp" && plan.aosStructure === "opt3") ||
        (cfg.aosMode === "bit01" && plan.aosStructure === "2m")
          ? 2
          : 1;
      if ((plan.selectedMajors || []).filter(Boolean).length < reqMajors) {
        globalIssues.push({
          severity: "info",
          text: `Select ${reqMajors === 2 ? "two Majors" : "a Major"} in the Course Configuration bar to load its prescribed units.`,
        });
      }
    }
    if (
      ((cfg.aosMode === "bsc" && plan.aosStructure === "1m1n") ||
        (cfg.aosMode === "bcomp" && plan.aosStructure === "opt2") ||
        (cfg.aosMode === "bbiosc" && plan.aosStructure === "minor") ||
        cfg.aosMode === "dscnce" ||
        cfg.aosMode === "mnsc_pathway") &&
      !plan.selectedMinor
    ) {
      globalIssues.push({
        severity: "info",
        text: `Select your ${cfg.aosMode === "mnsc_pathway" ? "Pathway" : "Minor / Stream"} in the Course Configuration bar.`,
      });
    }

    // Trimester overload checks (> 24 CP) + Intensive School TBA & Multi-Campus Travel Conflict checks!
    const trimesterLoads = {};
    (plan.years || []).forEach((yr, yIdx) => {
      for (const tNum of [1, 2, 3]) {
        const slots = yr.trimesters[tNum] || [];
        let cpSum = 0;
        let effLoadSum = 0;
        let intensives = 0;
        let tbaIntensives = 0;
        const armidaleOnly = [];
        const sydneyOnly = [];
        const sydneyOrArmidale = [];
        const otherPhysical = [];

        for (const s of slots) {
          const u = s.type === "unit" ? getUnit(s.code, data, plan.customUnits) : null;
          const uCp = u ? u.cp : (s.cp || 6);
          cpSum += uCp;
          effLoadSum += u && (u.yearLong || uCp >= 24) ? Math.ceil(uCp / 2) : uCp;
          const intInfo = u ? getUnitIntensiveForTri(u, tNum) : null;
          if (intInfo && intInfo.kind === "Mandatory") {
            intensives++;
            if (intInfo.tba) tbaIntensives++;
            const grp = getPhysicalCampusGroup(intInfo);
            if (grp === "armidale_only") armidaleOnly.push(u.code);
            else if (grp === "sydney_only") sydneyOnly.push(u.code);
            else if (grp === "armidale_sydney") sydneyOrArmidale.push(u.code);
            else if (grp) otherPhysical.push(`${u.code} (${intInfo.location})`);
          }
        }

        const hasCampusConflict =
          (armidaleOnly.length > 0 && (sydneyOnly.length > 0 || sydneyOrArmidale.length > 0)) ||
          (sydneyOnly.length > 0 && sydneyOrArmidale.length > 0);

        const key = `${yIdx}_${tNum}`;
        trimesterLoads[key] = {
          cp: cpSum,
          intensives,
          tbaIntensives,
          campusConflict: hasCampusConflict,
        };

        if (effLoadSum > 24) {
          globalIssues.push({
            severity: "warning",
            text: `${yr.name} Trimester ${tNum} has ${cpSum} CP (exceeds standard 24 CP full-time load; requires UNE overload approval).`,
          });
        }
        if (hasCampusConflict) {
          const leftStr = armidaleOnly.length ? `Armidale (${armidaleOnly.join(", ")})` : "";
          const rightParts = [];
          if (sydneyOnly.length) rightParts.push(`Sydney (${sydneyOnly.join(", ")})`);
          if (sydneyOrArmidale.length) rightParts.push(`Sydney / Armidale TBC (${sydneyOrArmidale.join(", ")})`);
          const desc = [leftStr, ...rightParts].filter(Boolean).join(" with ");
          globalIssues.push({
            severity: "warning",
            text: `Intensive Campus Clash in ${yr.name} Trimester ${tNum}: mixes ${desc} — attending intensives at different campuses in the same trimester may require travel; confirm intensive locations & dates.`,
          });
        }
      }
    });

    // Count total unit errors & warnings
    let unitErrorCount = 0;
    let unitWarningCount = 0;
    for (const diag of Object.values(slotDiagnostics)) {
      unitErrorCount += diag.errors.length;
      unitWarningCount += diag.warnings.length;
    }

    const allBucketsMet = resolved.buckets.every(
      (b) => (!b.cpMin || b.plannedCp >= b.cpMin) && (!b.cpMax || b.plannedCp <= b.cpMax)
    );
    const allLevelsMet = levelChecks.every((l) => l.passed);
    const isAwardReady =
      totalPlannedCp === targetCp &&
      placeholderCp === 0 &&
      unitErrorCount === 0 &&
      unitWarningCount === 0 &&
      allBucketsMet &&
      allLevelsMet &&
      !resolved.incompatiblePairWarning;

    return {
      resolved,
      slotDiagnostics,
      trimesterLoads,
      unitCp,
      placeholderCp,
      advancedStandingCp: resolved.advancedStandingCp,
      totalPlannedCp,
      targetCp,
      cpByLevel,
      levelChecks,
      globalIssues,
      unitErrorCount,
      unitWarningCount,
      isAwardReady,
    };
  }

  /**
   * Smart Auto-Scheduler: selects required/recommended units from active buckets with T1/T2 trimester
   * balancing, then schedules chronologically using critical-path prerequisite DAG depth so long
   * prerequisite chains (like BEXSS/BCEP) finish in standard duration without artificial year spills!
   */
  function autoSchedulePlan(course, plan, data) {
    const nextPlan = JSON.parse(JSON.stringify(plan));
    const resolved = resolveCurriculumBuckets(course, nextPlan, data);
    const targetStudyCp = Math.max(0, (course.totalCp || 144) - resolved.advancedStandingCp);
    const strategy = nextPlan.t3Strategy || (nextPlan.includeT3InAuto ? "accelerate" : "none");
    const allowT3Pick = strategy !== "none" || (nextPlan.commencingTrimester || 1) === 3;
    const stdYears = Math.max(1, Math.ceil(targetStudyCp / 48));
    const perTriBudget = Math.min(stdYears * 24, Math.ceil(targetStudyCp / 2) + 6);

    const max100Rule = (course.levelRules || []).find(
      (r) => r.levels && r.levels.length === 1 && r.levels[0] === 100 && r.maxCp && (!r.onlyRules || r.onlyRules.includes(nextPlan.admissionRule))
    );
    const min300Rule = (course.levelRules || []).find(
      (r) => r.levels && r.levels.includes(300) && r.minCp && (!r.onlyRules || r.onlyRules.includes(nextPlan.admissionRule))
    );
    const min500Rule = (course.levelRules || []).find(
      (r) => r.levels && r.levels.includes(500) && r.minCp && (!r.onlyRules || r.onlyRules.includes(nextPlan.admissionRule))
    );

    const chosenSet = new Set();
    const chosenList = [];
    let t1OnlyCp = 0;
    let t2OnlyCp = 0;
    let upperT1OnlyCp = 0;
    let upperT2OnlyCp = 0;
    let t1PrefCp = 0;
    let t2PrefCp = 0;
    const chosenPrefixCp = {};

    function getLvlCp(lvl) {
      return chosenList.filter((u) => u.level === lvl).reduce((s, u) => s + u.cp, 0);
    }

    function isUnitLockedT1(u) {
      const ts = u.trimesters || [];
      return ts.includes(1) && !ts.includes(2) && (allowT3Pick ? !ts.includes(3) : true);
    }
    function isUnitLockedT2(u) {
      const ts = u.trimesters || [];
      return ts.includes(2) && !ts.includes(1) && (allowT3Pick ? !ts.includes(3) : true);
    }
    function isUnitT3Only(u) {
      const ts = u.trimesters || [];
      return ts.length === 1 && ts[0] === 3;
    }

    function tryPick(code) {
      if (chosenSet.has(code)) return false;
      const u = getUnit(code, data, nextPlan.customUnits);
      if (!u || u.offered2027 === false) return false;
      for (const rCode of u.restrictedUnits || []) {
        if (chosenSet.has(rCode)) return false;
      }
      for (const existing of chosenList) {
        if ((existing.restrictedUnits || []).includes(code)) return false;
      }
      chosenSet.add(code);
      chosenList.push(u);
      if (u.prefix) chosenPrefixCp[u.prefix] = (chosenPrefixCp[u.prefix] || 0) + u.cp;
      const ts = u.trimesters || [];
      const isUpper = (u.level || 100) >= 200;
      if (isUnitLockedT1(u)) {
        t1OnlyCp += u.cp;
        if (isUpper) upperT1OnlyCp += u.cp;
      }
      if (isUnitLockedT2(u)) {
        t2OnlyCp += u.cp;
        if (isUpper) upperT2OnlyCp += u.cp;
      }
      if (ts.includes(1) && !ts.includes(2)) t1PrefCp += u.cp;
      else if (ts.includes(2) && !ts.includes(1)) t2PrefCp += u.cp;
      else if (ts.includes(1) && ts.includes(2)) {
        t1PrefCp += u.cp / 2;
        t2PrefCp += u.cp / 2;
      }
      return true;
    }

    let accCp = 0;
    // 1. Pre-seed BSC Major-required Core units first so Science/Maths Core picks match the student's Majors!
    const preSeededCore = new Set();
    for (const mCode of Object.keys(resolved.majorCoreHints.mandatory)) {
      preSeededCore.add(mCode);
    }
    for (const grp of resolved.majorCoreHints.choiceGroups) {
      const avail = grp.codes.find((c) => getUnit(c, data, nextPlan.customUnits)?.offered2027 !== false);
      if (avail) preSeededCore.add(avail);
    }

    // Pre-scan which unit codes are referenced as prerequisites by mandatory core/major units so choice pools pick them!
    const neededByMandatory = new Set();
    for (const b of resolved.buckets) {
      if (b.category === "elective" || !b.cpMin) continue;
      for (const code of b.units) {
        const u = getUnit(code, data, nextPlan.customUnits);
        if (!u || !u.prereqMeta || (u.prereqMeta.pgWaiver && course.studyLevel === "Postgraduate")) continue;
        for (const req of u.prereqMeta.codes || []) neededByMandatory.add(req);
      }
    }

    // Score a candidate unit when picking from a choice pool (balancing T1/T2 offerings, level rules & prereqs)
    function scoreChoiceCandidate(code, preferUpper) {
      const u = getUnit(code, data, nextPlan.customUnits);
      if (!u || u.offered2027 === false) return 1e9;
      let sc = 0;
      if (preSeededCore.has(code)) sc -= 1000;
      if (neededByMandatory.has(code)) sc -= 160;
      if (!allowT3Pick && isUnitT3Only(u)) sc += 500;

      // Respect 100-level maximum cap when picking choices
      if (max100Rule && u.level === 100 && getLvlCp(100) + u.cp > max100Rule.maxCp) sc += 400;

      // Satisfy upper-level minimums if needed
      if (preferUpper) {
        if (min500Rule && getLvlCp(500) < min500Rule.minCp && u.level === 500) sc -= 120;
        if (min300Rule && getLvlCp(300) < min300Rule.minCp && u.level === 300) sc -= 120;
      }

      // Strongly prefer units whose unit-code & prefixCp prereqs are already in chosenSet (or empty),
      // and avoid picking same-trimester chained prereqs in 1-year degrees (e.g. NEUR545 -> NEUR535 both T2-only!)
      const pm = u.prereqMeta;
      if (pm && !(pm.pgWaiver && course.studyLevel === "Postgraduate")) {
        if (pm.prefixCp) {
          const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
          const haveP = prefs.reduce((s, pr) => s + (chosenPrefixCp[pr] || 0), 0);
          if (haveP < pm.prefixCp.cp) sc += 260;
        }
        if (pm.tokens && pm.tokens.length > 0) {
          const okNow = evalPrereqTokens(pm.tokens, chosenSet);
          if (!okNow) sc += 220;
          else if (stdYears === 1) {
            const uTris = u.trimesters || [];
            const hasSameTriChain = (pm.codes || []).some((req) => {
              if (!chosenSet.has(req)) return false;
              const ru = getUnit(req, data, nextPlan.customUnits);
              const rTris = ru?.trimesters || [];
              return uTris.length === 1 && rTris.length === 1 && uTris[0] === rTris[0];
            });
            if (hasSameTriChain) sc += 350;
          }
        }
      }

      // Balance T1 vs T2 (including upper-year 200/300-level T1/T2 slots!) so optional picks never spill an extra year!
      const ts = u.trimesters || [];
      const hasT1 = ts.includes(1);
      const hasT2 = ts.includes(2);
      const upperPerTriBudget = stdYears >= 2 ? (stdYears - 1) * 24 : 24;
      const isUpper = (u.level || 100) >= 200;
      if (isUnitLockedT1(u)) {
        if (t1OnlyCp + u.cp > perTriBudget || (isUpper && upperT1OnlyCp + u.cp > upperPerTriBudget)) sc += 340;
        else if (t1PrefCp > t2PrefCp + 6) sc += 65;
        else if (t1PrefCp < t2PrefCp - 6) sc -= 35;
      } else if (isUnitLockedT2(u)) {
        if (t2OnlyCp + u.cp > perTriBudget || (isUpper && upperT2OnlyCp + u.cp > upperPerTriBudget)) sc += 340;
        else if (t2PrefCp > t1PrefCp + 6) sc += 65;
        else if (t2PrefCp < t1PrefCp - 6) sc -= 35;
      } else if (hasT1 && hasT2) {
        sc -= 25; // Flexible T1/T2 units are always great!
      }

      // Mild tie-breaker: lower level in core/major buckets, mid/upper in listed buckets
      sc += preferUpper ? (u.level || 200) / 100 : (u.level || 100) / 50;
      return sc;
    }

    // 2. Walk buckets in priority order and pick units up to each bucket's cpMin
    // Respect parent AOS totalCp so mutually-exclusive Streams (like Biological Science's 3x36 CP streams inside a 42 CP Major) pick ONE stream!
    const aosPickedCp = {};
    for (const b of resolved.buckets) {
      if (b.category === "elective" || !b.cpMin) continue;
      const aosMatch = (b.id || "").match(/^aos_([^_]+)_/);
      const aosCode = aosMatch ? aosMatch[1] : null;
      const aosCap = aosCode && data.aos[aosCode]?.totalCp ? data.aos[aosCode].totalCp : null;
      if (aosCap && (aosPickedCp[aosCode] || 0) >= aosCap) continue;

      const effectiveMin = aosCap ? Math.min(b.cpMin, Math.max(0, aosCap - (aosPickedCp[aosCode] || 0))) : b.cpMin;
      let bucketCp = 0;
      const availUnits = b.units.filter((code) => {
        const u = getUnit(code, data, nextPlan.customUnits);
        return u && u.offered2027 !== false;
      });
      const availTotalCp = availUnits.reduce((s, c) => s + (getUnit(c, data, nextPlan.customUnits)?.cp || 6), 0);
      const isChoicePool = availTotalCp > effectiveMin;

      if (!isChoicePool) {
        // Mandatory bucket: pick all units
        for (const code of availUnits) {
          if (bucketCp >= effectiveMin || accCp >= targetStudyCp) break;
          const u = getUnit(code, data, nextPlan.customUnits);
          if (accCp + u.cp > targetStudyCp) continue;
          if (tryPick(code)) {
            bucketCp += u.cp;
            accCp += u.cp;
            if (aosCode) aosPickedCp[aosCode] = (aosPickedCp[aosCode] || 0) + u.cp;
          }
        }
      } else {
        // Choice pool: pick greedily one-by-one re-evaluating T1/T2 balance & prereqs after each pick!
        const remainingPool = [...availUnits];
        while (bucketCp < effectiveMin && accCp < targetStudyCp && remainingPool.length > 0) {
          remainingPool.sort((a, c) => {
            const sa = scoreChoiceCandidate(a, b.category === "listed" || b.category === "capstone");
            const sc = scoreChoiceCandidate(c, b.category === "listed" || b.category === "capstone");
            if (sa !== sc) return sa - sc;
            return a.localeCompare(c);
          });
          let pickedAny = false;
          for (let i = 0; i < remainingPool.length; i++) {
            const code = remainingPool[i];
            const u = getUnit(code, data, nextPlan.customUnits);
            if (!u || accCp + u.cp > targetStudyCp) {
              remainingPool.splice(i, 1);
              i--;
              continue;
            }
            if (tryPick(code)) {
              bucketCp += u.cp;
              accCp += u.cp;
              if (aosCode) aosPickedCp[aosCode] = (aosPickedCp[aosCode] || 0) + u.cp;
              remainingPool.splice(i, 1);
              pickedAny = true;
              break;
            } else {
              remainingPool.splice(i, 1);
              i--;
            }
          }
          if (!pickedAny) break;
        }
      }
    }

    // 3. Fill remaining non-elective shortfall from Listed / Capstone buckets if needed (respecting level rules & T1/T2 balance!)
    if (accCp < targetStudyCp) {
      const electiveBucket = resolved.buckets.find((b) => b.category === "elective");
      const maxElectiveReserve = electiveBucket
        ? Math.min(electiveBucket.cpMax !== null ? electiveBucket.cpMax : 24, 24)
        : 0;

      const poolBuckets = resolved.buckets.filter((b) => b.category === "capstone" || b.category === "listed");
      const poolUnits = [];
      for (const b of poolBuckets) {
        for (const c of b.units) {
          if (!chosenSet.has(c) && !poolUnits.includes(c)) poolUnits.push(c);
        }
      }

      const listedTarget = targetStudyCp - maxElectiveReserve;
      while (accCp < listedTarget && poolUnits.length > 0) {
        poolUnits.sort((a, b) => {
          const sa = scoreChoiceCandidate(a, true);
          const sb = scoreChoiceCandidate(b, true);
          if (sa !== sb) return sa - sb;
          return a.localeCompare(b);
        });
        let pickedAny = false;
        for (let i = 0; i < poolUnits.length; i++) {
          const code = poolUnits[i];
          const u = getUnit(code, data, nextPlan.customUnits);
          if (!u || u.offered2027 === false || accCp + u.cp > targetStudyCp) {
            poolUnits.splice(i, 1);
            i--;
            continue;
          }
          if (!allowT3Pick && isUnitT3Only(u)) {
            poolUnits.splice(i, 1);
            i--;
            continue;
          }
          if (max100Rule && u.level === 100 && getLvlCp(100) + u.cp > max100Rule.maxCp) {
            poolUnits.splice(i, 1);
            i--;
            continue;
          }
          const pm3 = u.prereqMeta;
          if (pm3 && !(pm3.pgWaiver && course.studyLevel === "Postgraduate")) {
            if (pm3.codes?.length > 0 && !evalPrereqTokens(pm3.tokens || [], chosenSet)) {
              poolUnits.splice(i, 1);
              i--;
              continue;
            }
            if (pm3.prefixCp) {
              const prefs = pm3.prefixCp.prefixes || [pm3.prefixCp.prefix];
              const haveP = prefs.reduce((s, pr) => s + (chosenPrefixCp[pr] || 0), 0);
              if (haveP < pm3.prefixCp.cp) {
                poolUnits.splice(i, 1);
                i--;
                continue;
              }
            }
          }
          if (tryPick(code)) {
            accCp += u.cp;
            poolUnits.splice(i, 1);
            pickedAny = true;
            break;
          } else {
            poolUnits.splice(i, 1);
            i--;
          }
        }
        if (!pickedAny) break;
      }
    }

    // 4. Create clean, accurately typed Placeholder slots for any remaining open Listed / Elective CP!
    const placeholders = [];
    let remCp = targetStudyCp - accCp;
    const hasElectiveBucket = resolved.buckets.some((b) => b.category === "elective");
    const hasListedBucket = resolved.buckets.some((b) => b.category === "listed");
    const electiveBucketObj = resolved.buckets.find((b) => b.category === "elective");
    const maxOpenElectiveCp = hasElectiveBucket
      ? (electiveBucketObj?.cpMax !== null && electiveBucketObj?.cpMax !== undefined ? electiveBucketObj.cpMax : remCp)
      : 0;

    let openElectiveRemaining = maxOpenElectiveCp;
    while (remCp >= 6) {
      let phLabel = "Listed Unit";
      let slotKind = "listed";
      if (hasElectiveBucket && !hasListedBucket) {
        phLabel = "Elective Unit";
        slotKind = "elective";
      } else if (hasElectiveBucket && hasListedBucket) {
        if (remCp > openElectiveRemaining) {
          phLabel = "Listed Unit";
          slotKind = "listed";
        } else {
          phLabel = "Listed or Elective Unit";
          slotKind = "listed_or_elective";
          openElectiveRemaining = Math.max(0, openElectiveRemaining - 6);
        }
      }
      placeholders.push({
        id: uid("ph"),
        type: "placeholder",
        label: phLabel,
        slotKind,
        cp: 6,
        hintCodes: [],
      });
      remCp -= 6;
    }

    // Helper: compute minimum calendar-trimester distance from taking unit at `fromTri` to dependent `depUnit`
    function minTriStepGap(fromTri, depUnit, allowT3) {
      const depTris = depUnit.trimesters && depUnit.trimesters.length ? depUnit.trimesters : [1, 2];
      let best = 99;
      for (const dt of depTris) {
        if (dt === 3 && !allowT3 && depTris.length > 1) continue;
        if (allowT3) {
          const diff = dt > fromTri ? dt - fromTri : 3 - fromTri + dt;
          if (diff < best) best = diff;
        } else {
          // 2 active periods per year: T1=0, T2=1
          const a = fromTri === 1 ? 0 : 1;
          const b = dt === 1 ? 0 : 1;
          const diff = b > a ? b - a : 2 - a + b;
          if (diff < best) best = diff;
        }
      }
      return best === 99 ? 1 : best;
    }

    // Compute transitive critical-path span (in active trimesters) for every remaining unit!
    function computeCriticalSpans(remUnits, doneSet, allowT3) {
      const remByCode = new Map(remUnits.map((u) => [u.code, u]));
      const depEdges = new Map(); // prereqCode -> [dependentUnit, ...]
      for (const v of remUnits) {
        const pm = v.prereqMeta;
        if (pm && pm.codes && pm.codes.length && !(pm.pgWaiver && course.studyLevel === "Postgraduate")) {
          if (!(pm.tokens && pm.tokens.length && evalPrereqTokens(pm.tokens, doneSet))) {
            for (const reqCode of pm.codes) {
              if (remByCode.has(reqCode)) {
                if (!depEdges.has(reqCode)) depEdges.set(reqCode, []);
                depEdges.get(reqCode).push(v);
              }
            }
          }
        }
        // Also prioritize active co-requisites (e.g. COSC110 for COSC510 in MIT Rule A, LAW100 for LAW102/131/162!)
        const cm = v.coreqMeta;
        if (cm && cm.codes && cm.codes.length) {
          const courseApplies = !cm.onlyCourses || cm.onlyCourses.includes(course.code);
          const ruleApplies = !cm.onlyRulePattern || (nextPlan.admissionRule || "").includes(cm.onlyRulePattern);
          const waived = cm.pgWaiver && course.studyLevel === "Postgraduate";
          if (courseApplies && ruleApplies && !waived && !(cm.tokens && cm.tokens.length && evalPrereqTokens(cm.tokens, doneSet))) {
            for (const reqCode of cm.codes) {
              if (remByCode.has(reqCode)) {
                if (!depEdges.has(reqCode)) depEdges.set(reqCode, []);
                depEdges.get(reqCode).push(v);
              }
            }
          }
        }
      }

      const memo = new Map();
      const visiting = new Set();
      function dfs(code, curTriHint) {
        const key = `${code}_${curTriHint || 0}`;
        if (memo.has(key)) return memo.get(key);
        if (visiting.has(code)) return 1;
        visiting.add(code);
        const u = remByCode.get(code);
        const uTris = u?.trimesters && u.trimesters.length ? u.trimesters : [1, 2];
        const fromTri = curTriHint || uTris[0] || 1;
        let maxSpan = 1;
        for (const dep of depEdges.get(code) || []) {
          const gap = minTriStepGap(fromTri, dep, allowT3);
          const depFirstTri = (dep.trimesters || []).find((t) => allowT3 || t !== 3) || dep.trimesters?.[0] || 1;
          const sub = gap + dfs(dep.code, depFirstTri);
          if (sub > maxSpan) maxSpan = sub;
        }
        visiting.delete(code);
        memo.set(key, maxSpan);
        return maxSpan;
      }

      const spans = {};
      for (const u of remUnits) {
        spans[u.code] = dfs(u.code, null);
      }
      return { spans, depEdges };
    }

    // 5. Chronological Trimester Scheduling ('none' | 'spread' | 'accelerate')
    function simulateSchedule(mode, capYear1To2At18) {
      const baseMax = nextPlan.studyLoad === "Part-time" ? 12 : 24;
      const remUnits = chosenList.map((u) => u);
      const remPh = placeholders.map((p) => ({ ...p, id: uid("ph") }));
      const doneSet = new Set();
      let doneCp = resolved.advancedStandingCp;
      const donePrefixCp = {};
      const simYears = [];
      const safetyYears = nextPlan.studyLoad === "Part-time" ? 10 : 6;
      const startTri = nextPlan.commencingTrimester || 1;

      for (let y = 1; y <= safetyYears; y++) {
        if (remUnits.length === 0 && remPh.length === 0) break;
        const yrObj = {
          id: uid("yr"),
          yearNum: y,
          name: `Year ${y} (${2026 + y})`,
          trimesters: { 1: [], 2: [], 3: [] },
        };

        for (const tNum of [1, 2, 3]) {
          if (y === 1 && tNum < startTri) continue;
          if (remUnits.length === 0 && remPh.length === 0) break;

          const allowGeneralT3 = mode === "accelerate" || mode === "spread" || (y === 1 && startTri === 3);

          let maxThisTri = baseMax;
          if (mode === "spread" && nextPlan.studyLoad !== "Part-time") {
            const yearsRemainingInclThis = Math.max(1, stdYears - y + 1);
            const lockedToThisTriCount = remUnits.filter(
              (u) => !(u.trimesters || []).includes(3) && (!u.trimesters || !u.trimesters.length || u.trimesters.includes(tNum)) && (u.trimesters?.length || 1) === 1
            ).length;
            const nonT3RemainingCount = remUnits.filter((u) => !(u.trimesters || []).includes(3)).length;
            const t3ReadyUnitsCount = remUnits.filter((u) => {
              if (!(u.trimesters || []).includes(3)) return false;
              if (course.studyLevel === "Undergraduate" && y === 1 && u.level >= 300 && (course.totalCp || 144) >= 96) {
                return false;
              }
              return true;
            }).length;
            const t3SlotsAvailable = t3ReadyUnitsCount + remPh.length;
            const canDropTo3Units =
              lockedToThisTriCount <= (yearsRemainingInclThis - 1) * 4 + 3 &&
              nonT3RemainingCount <= (yearsRemainingInclThis - 1) * 8 + 6;
            if (tNum !== 3 && capYear1To2At18 && t3SlotsAvailable >= 2 && canDropTo3Units) {
              maxThisTri = 18;
            } else if (tNum === 3) {
              maxThisTri = 12;
            }
          }

          let triEffCp = 0;
          const { spans: critSpans, depEdges } = computeCriticalSpans(remUnits, doneSet, allowGeneralT3);

          const eligible = remUnits.filter((u) => {
            const offeredHere = !u.trimesters || u.trimesters.length === 0 || u.trimesters.includes(tNum);
            if (!offeredHere) return false;
            if (tNum === 3 && u.t3RepeatOnly) return false;
            if (course.studyLevel === "Undergraduate" && y === 1 && u.level >= 300 && (course.totalCp || 144) >= 96) {
              return false;
            }
            if (tNum === 3 && !allowGeneralT3) {
              return u.trimesters && u.trimesters.length === 1 && u.trimesters[0] === 3;
            }
            return true;
          });

          // Sort Priority:
          // 1. Prereq ready NOW
          // 2. Longest critical-path prerequisite DAG span (so EXSC360/EXSC370 run in Y2 ahead of leaf 100-level units!)
          // 3. Trimester scarcity (T1-only beats T1+T2 flexible units in T1!)
          // 4. T3 preservation when T3 is active (non-T3 leaf units first in T1/T2)
          // 5. Lower unit level (natural 100 -> 200 -> 300 progression among equal-priority units)
          const otherMainTri = tNum === 1 ? 2 : 1;
          eligible.sort((a, b) => {
            const aReady = isPrereqReady(a, doneSet, doneCp, donePrefixCp, course);
            const bReady = isPrereqReady(b, doneSet, doneCp, donePrefixCp, course);
            if (aReady !== bReady) return aReady ? -1 : 1;

            const aSpan = critSpans[a.code] || 1;
            const bSpan = critSpans[b.code] || 1;
            if (aSpan !== bSpan) return bSpan - aSpan;

            const aLocked = (a.trimesters || []).length > 0 && !(a.trimesters || []).includes(otherMainTri) ? 0 : 1;
            const bLocked = (b.trimesters || []).length > 0 && !(b.trimesters || []).includes(otherMainTri) ? 0 : 1;
            if (tNum !== 3 && aLocked !== bLocked) return aLocked - bLocked;

            if (allowGeneralT3 && tNum !== 3) {
              const aHasT3 = (a.trimesters || []).includes(3) ? 1 : 0;
              const bHasT3 = (b.trimesters || []).includes(3) ? 1 : 0;
              if (!(depEdges.get(a.code)?.length) && !(depEdges.get(b.code)?.length) && aHasT3 !== bHasT3) {
                return aHasT3 - bHasT3;
              }
            }

            if (a.level !== b.level) return a.level - b.level;
            return (depEdges.get(b.code)?.length || 0) - (depEdges.get(a.code)?.length || 0);
          });

          const totalRemainingCp = remUnits.reduce((s, x) => s + x.cp, 0) + remPh.reduce((s, x) => s + (x.cp || 6), 0);
          const placedThisTri = [];
          const campusDeferred = [];
          const activeCampusGroups = new Set();

          function wouldClashCampus(u) {
            const grp = getPhysicalCampusGroup(getUnitIntensiveForTri(u, tNum));
            if (!grp || activeCampusGroups.size === 0 || activeCampusGroups.has(grp)) return false;
            // Clash when mixing armidale_only with sydney_only or armidale_sydney (e.g. EXSC340 Armidale with EXSC260/239/370 Sydney!)
            if (
              (grp === "armidale_only" && (activeCampusGroups.has("sydney_only") || activeCampusGroups.has("armidale_sydney"))) ||
              ((grp === "sydney_only" || grp === "armidale_sydney") && activeCampusGroups.has("armidale_only")) ||
              (grp === "sydney_only" && activeCampusGroups.has("armidale_sydney")) ||
              (grp === "armidale_sydney" && activeCampusGroups.has("sydney_only"))
            ) {
              return true;
            }
            return false;
          }

          function tryPlaceInTri(u, allowCampusClash) {
            const effCp = (u.yearLong || u.cp >= 24) && nextPlan.studyLoad !== "Part-time" ? Math.ceil(u.cp / 2) : u.cp;
            if (triEffCp + effCp > maxThisTri) return false;

            const readyNow = isPrereqReady(u, doneSet, doneCp, donePrefixCp, course);
            if (!readyNow) {
              const pm = u.prereqMeta;
              const hasFutureCodePrereq = (pm?.codes || []).some(
                (c) => remUnits.some((x) => x.code === c) || placedThisTri.some((x) => x.code === c)
              );
              const hasFutureMinCp = pm?.minCp > 0 && doneCp < pm.minCp && doneCp + totalRemainingCp - u.cp >= pm.minCp;
              let hasFuturePrefixCp = false;
              if (pm?.prefixCp) {
                const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
                const curP = prefs.reduce((s, pr) => s + (donePrefixCp[pr] || 0), 0);
                const remP = remUnits
                  .filter((x) => x.code !== u.code && prefs.includes(x.prefix))
                  .reduce((s, x) => s + x.cp, 0);
                const curTriP = placedThisTri
                  .filter((x) => prefs.includes(x.prefix))
                  .reduce((s, x) => s + x.cp, 0);
                if (curP < pm.prefixCp.cp && curP + remP + curTriP >= pm.prefixCp.cp) {
                  hasFuturePrefixCp = true;
                }
              }
              if (hasFutureCodePrereq || hasFutureMinCp || hasFuturePrefixCp) return false;
            }

            if (!allowCampusClash && wouldClashCampus(u)) {
              campusDeferred.push(u);
              return false;
            }

            yrObj.trimesters[tNum].push({ id: uid("u"), type: "unit", code: u.code });
            triEffCp += effCp;
            placedThisTri.push(u);
            const grp = getPhysicalCampusGroup(getUnitIntensiveForTri(u, tNum));
            if (grp) activeCampusGroups.add(grp);
            const idx = remUnits.findIndex((x) => x.code === u.code);
            if (idx !== -1) remUnits.splice(idx, 1);
            return true;
          }

          // Pass 1: Place ready units while keeping same-trimester Mandatory Intensives on the same campus!
          for (const u of eligible) {
            tryPlaceInTri(u, false);
          }

          // Pass 2: Only place a campus-clashing unit in this trimester if we are in the final standard year
          // OR deferring it would genuinely delay graduation (critical-path span exceeds remaining active trimesters)!
          const remainingStdActiveTris = Math.max(1, (stdYears - y) * 2 + (tNum === 1 ? 2 : 1));
          for (const u of campusDeferred) {
            if (triEffCp >= maxThisTri) break;
            const uSpan = critSpans[u.code] || 1;
            const mustPlaceNow = y >= stdYears || uSpan >= remainingStdActiveTris;
            if (mustPlaceNow) {
              tryPlaceInTri(u, true);
            }
          }

          if ((tNum !== 3 || allowGeneralT3) && remPh.length > 0) {
            const holdPhForT3 =
              mode === "spread" &&
              tNum !== 3 &&
              y < stdYears &&
              remUnits.filter((u) => (u.trimesters || []).includes(3)).length < 2;
            const yrCpBeforeThisTri = [1, 2, 3]
              .filter((tn) => tn !== tNum)
              .reduce(
                (s, tn) =>
                  s +
                  yrObj.trimesters[tn].reduce((ss, sl) => {
                    const su = sl.type === "unit" ? getUnit(sl.code, data, nextPlan.customUnits) : null;
                    return ss + (su ? su.cp : (sl.cp || 6));
                  }, 0),
                0
              );
            while (!holdPhForT3 && remPh.length > 0 && triEffCp + 6 <= maxThisTri) {
              if (mode === "spread" && tNum === 3 && yrCpBeforeThisTri + triEffCp + 6 > 48) {
                break;
              }
              const ph = remPh.shift();
              yrObj.trimesters[tNum].push(ph);
              triEffCp += ph.cp;
            }
          }

          for (const u of placedThisTri) {
            doneSet.add(u.code);
            doneCp += u.cp;
            if (u.prefix) donePrefixCp[u.prefix] = (donePrefixCp[u.prefix] || 0) + u.cp;
          }
          doneCp += yrObj.trimesters[tNum].filter((s) => s.type === "placeholder").reduce((s, x) => s + x.cp, 0);
        }

        if ([1, 2, 3].some((t) => yrObj.trimesters[t].length > 0)) {
          simYears.push(yrObj);
        }
      }

      if (remUnits.length > 0 || remPh.length > 0) {
        const lastYr = simYears[simYears.length - 1] || {
          id: uid("yr"),
          yearNum: 1,
          name: "Year 1 (2027)",
          trimesters: { 1: [], 2: [], 3: [] },
        };
        if (!simYears.length) simYears.push(lastYr);
        for (const u of remUnits) {
          const t = u.trimesters?.[0] || 1;
          lastYr.trimesters[t].push({ id: uid("u"), type: "unit", code: u.code });
        }
        for (const ph of remPh) {
          lastYr.trimesters[2].push(ph);
        }
      }

      let lastChrono = 0;
      let finishLabel = "Year 1 · T1";
      let finalStageUnits = [];
      simYears.forEach((yr, yIdx) => {
        for (const tNum of [1, 2, 3]) {
          if ((yr.trimesters[tNum] || []).length > 0) {
            lastChrono = yIdx * 3 + (tNum - 1);
            finishLabel = `Year ${yr.yearNum} · T${tNum}`;
            finalStageUnits = yr.trimesters[tNum]
              .filter((s) => s.type === "unit")
              .map((s) => s.code);
          }
        }
      });

      return { years: simYears, lastChrono, finishLabel, finalStageUnits };
    }

    const stdSim = simulateSchedule("none", false);

    // Count how many prescribed Major/Minor units are offered in T3
    const majorBuckets = resolved.buckets.filter((b) => ["major1", "major2", "minor"].includes(b.category));
    const majorUnitSet = new Set();
    majorBuckets.forEach((b) => b.units.forEach((u) => majorUnitSet.add(u)));
    const totalMajorUnits = majorUnitSet.size;
    const t3MajorUnits = Array.from(majorUnitSet).filter((c) =>
      (getUnit(c, data, nextPlan.customUnits)?.trimesters || []).includes(3)
    ).length;

    if (strategy === "accelerate") {
      const accSim = simulateSchedule("accelerate", false);
      const trimestersSaved = stdSim.lastChrono - accSim.lastChrono;
      if (trimestersSaved > 0) {
        nextPlan.years = accSim.years;
        nextPlan.t3Analysis = {
          strategy: "accelerate",
          status: "accelerated",
          trimestersSaved,
          stdFinishLabel: stdSim.finishLabel,
          accFinishLabel: accSim.finishLabel,
          t3MajorUnits,
          totalMajorUnits,
        };
      } else {
        nextPlan.years = stdSim.years;
        nextPlan.t3Analysis = {
          strategy: "accelerate",
          status: "bottlenecked",
          trimestersSaved: 0,
          stdFinishLabel: stdSim.finishLabel,
          accFinishLabel: accSim.finishLabel,
          bottleneckUnits: accSim.finalStageUnits.slice(0, 4),
          t3MajorUnits,
          totalMajorUnits,
        };
      }
    } else if (strategy === "spread") {
      let spreadSim = simulateSchedule("spread", true);
      if (spreadSim.lastChrono > stdSim.lastChrono + 1) {
        spreadSim = simulateSchedule("spread", false);
      }
      nextPlan.years = spreadSim.years;
      nextPlan.t3Analysis = {
        strategy: "spread",
        status: "spread",
        trimestersSaved: 0,
        stdFinishLabel: stdSim.finishLabel,
        accFinishLabel: spreadSim.finishLabel,
        t3MajorUnits,
        totalMajorUnits,
      };
    } else {
      nextPlan.years = stdSim.years;
      nextPlan.t3Analysis = null;
    }

    return nextPlan;
  }

  function isPrereqReady(u, completedSet, completedCp, completedPrefixCp, course) {
    const pm = u.prereqMeta;
    if (!pm) return true;
    if (pm.pgWaiver && course.studyLevel === "Postgraduate") return true;
    if (pm.minCp > 0 && completedCp < pm.minCp) return false;
    if (pm.prefixCp && completedPrefixCp) {
      const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
      const havePref = prefs.reduce((s, pr) => s + (completedPrefixCp[pr] || 0), 0);
      if (havePref < pm.prefixCp.cp) return false;
    }
    if (pm.tokens && pm.tokens.length > 0 && !evalPrereqTokens(pm.tokens, completedSet)) return false;
    return true;
  }

  /**
   * Loads an official UNE Study Plan (Progression Map) directly onto the board.
   */
  function applyOfficialStudyPlan(studyPlanId, course, plan, data) {
    const sp = data.studyPlans[studyPlanId];
    if (!sp) return plan;
    const nextPlan = JSON.parse(JSON.stringify(plan));
    nextPlan.commencingTrimester = sp.commencementTrimester || 1;
    nextPlan.studyLoad = sp.loadType || "Full-time";

    // If the study plan belongs to an AOS (Major/Minor) or mentions a Major in its title, auto-select it if appropriate!
    const aosOptions = getAvailableAOSOptions(course, nextPlan, data);
    if (sp.ownerType === "aos") {
      if (aosOptions.majors.some((m) => m.code === sp.ownerCode) && !nextPlan.selectedMajors.includes(sp.ownerCode)) {
        nextPlan.selectedMajors = [sp.ownerCode];
      } else if (aosOptions.minors.some((m) => m.code === sp.ownerCode) || aosOptions.pathways.some((p) => p.code === sp.ownerCode)) {
        nextPlan.selectedMinor = sp.ownerCode;
      }
    } else {
      const titleLow = sp.title.toLowerCase();
      for (const m of aosOptions.majors) {
        if (titleLow.includes(m.title.toLowerCase())) {
          if (!nextPlan.selectedMajors.includes(m.code)) nextPlan.selectedMajors = [m.code];
          break;
        }
      }
      if (course.structureConfig.hasAdmissionRules) {
        for (const rName of course.structureConfig.admissionRules) {
          if (titleLow.includes(rName.toLowerCase())) {
            nextPlan.admissionRule = rName;
            break;
          }
        }
      }
    }

    nextPlan.years = sp.years.map((yr, idx) => {
      const triMap = { 1: [], 2: [], 3: [] };
      for (const t of yr.trimesters || []) {
        if (![1, 2, 3].includes(t.num)) continue;
        triMap[t.num] = (t.slots || []).map((s) => {
          if (s.type === "unit") {
            return { id: uid("u"), type: "unit", code: s.code, cp: s.cp || 6 };
          }
          return {
            id: uid("ph"),
            type: "placeholder",
            label: s.label || "Listed / Elective Unit",
            cp: s.cp || 6,
            hintCodes: s.hintCodes || [],
          };
        });
      }
      return {
        id: uid("yr"),
        yearNum: idx + 1,
        name: `${yr.name} (${2027 + idx})`,
        trimesters: triMap,
      };
    });

    return nextPlan;
  }

  /**
   * Lists all official UNE Study Plans relevant to the active Course + its Majors/Minors.
   */
  function getAvailableStudyPlans(course, plan, data) {
    const out = [];
    const seen = new Set();
    for (const pid of course.studyPlanIds || []) {
      if (data.studyPlans[pid] && !seen.has(pid)) {
        seen.add(pid);
        out.push({ ...data.studyPlans[pid], group: `${course.code} Official Plans` });
      }
    }
    const aosOpts = getAvailableAOSOptions(course, plan, data);
    const activeAosCodes = [
      ...(plan.selectedMajors || []),
      plan.selectedMinor,
      ...aosOpts.majors.map((m) => m.code),
      ...aosOpts.pathways.map((p) => p.code),
    ].filter(Boolean);

    for (const aCode of activeAosCodes) {
      const aObj = data.aos[aCode];
      if (!aObj) continue;
      for (const pid of aObj.studyPlanIds || []) {
        if (data.studyPlans[pid] && !seen.has(pid)) {
          seen.add(pid);
          out.push({ ...data.studyPlans[pid], group: `${aObj.title} (${aObj.aosType})` });
        }
      }
    }
    return out;
  }

  /**
   * Helper: checks whether a unit code explicitly belongs to any container of the active course or its AOS options.
   */
  function isUnitInCourseBuckets(code, course, plan, data) {
    let found = false;
    function walk(conts) {
      for (const c of conts || []) {
        for (const it of c.items || []) {
          if (it.kind === "unit" && it.code === code) { found = true; return; }
          if (it.kind === "aos" && data.aos[it.code]) {
            walk(data.aos[it.code].containers);
            if (found) return;
          }
        }
        walk(c.children);
        if (found) return;
      }
    }
    walk(course.containers);
    return found;
  }

  /**
   * Parses a target slot (either a specific Placeholder from Official Plans / Smart Auto-Plan
   * or an open Year/Trimester slot) into exact pool & level rules.
   */
  function parseSlotSpec(targetSlot, resolved, course, data) {
    const label = (targetSlot?.label || "").trim();
    const low = label.toLowerCase();
    const hints = targetSlot?.hintCodes || [];
    const slotKind = targetSlot?.slotKind || "";
    const isReplacingPlaceholder = !!targetSlot?.replaceSlotId;

    // 1. Parse level constraints from label (e.g. "200 or 300-level", "400 level or above", "300 level Prescribed")
    let allowedLevels = null;
    const mAbove = low.match(/\b([1-5]00)\s*(?:-|\s)?level\s+or\s+above\b/);
    if (mAbove) {
      const base = parseInt(mAbove[1], 10);
      allowedLevels = [100, 200, 300, 400, 500, 600].filter((l) => l >= base);
    } else if (/\blevel\b/i.test(low)) {
      const lvls = [];
      const lvlSection = low.split("level")[0];
      for (const m of lvlSection.matchAll(/\b([1-5]00)\b/g)) {
        const v = parseInt(m[1], 10);
        if (!lvls.includes(v)) lvls.push(v);
      }
      if (lvls.length > 0) allowedLevels = lvls;
    }

    // 2. Parse discipline prefix constraints if explicitly mentioned (e.g. "in Mathematics, Statistics or Computer Science")
    let allowedPrefixes = null;
    if (/mathematics,\s*statistic.*computer science/i.test(low)) {
      allowedPrefixes = ["MATH", "MTHS", "PMTH", "AMTH", "STAT", "COSC"];
    }

    // 3. Determine which curriculum buckets & open pools match this slot
    const coursePoolMap = new Map(); // code -> poolLabel
    const addBuckets = (pred) => {
      for (const b of resolved.buckets) {
        if (b.category === "elective") continue;
        if (pred(b)) {
          for (const uCode of b.units || []) {
            if (!coursePoolMap.has(uCode)) coursePoolMap.set(uCode, b.title);
          }
        }
      }
    };

    let scopeTitle = label || "Add Unit to Trimester";
    let scopeSubtitle = "";
    let allowsElectives = false;
    let strictPoolOnly = false;

    const hasGenericPoolKeyword = /\b(listed|elective|prescribed|pathway|group\s*\d|core|specialisation)\b/i.test(low);

    if (isReplacingPlaceholder && hints.length > 0 && !hasGenericPoolKeyword) {
      // Pure choice list, e.g. "MTHS110 or MTHS120", "OORA200 or ENSC220", "STAT100 or COSC102"
      for (const h of hints) coursePoolMap.set(h, "Specified Slot Option");
      strictPoolOnly = true;
      scopeSubtitle = `Choose from specified option(s): ${hints.join(", ")}`;
    } else if (isReplacingPlaceholder && /\bcore\b/i.test(low)) {
      if (low.includes("science core")) {
        addBuckets((b) => b.category === "core" && b.title.toLowerCase().includes("science core"));
      } else if (low.includes("indigenous")) {
        addBuckets((b) => b.category === "core" && b.title.toLowerCase().includes("indigenous"));
      } else if (low.includes("math")) {
        addBuckets((b) => b.category === "core" && b.title.toLowerCase().includes("math"));
      } else {
        addBuckets((b) => b.category === "core");
      }
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, "Specified Core Option");
      strictPoolOnly = true;
      scopeSubtitle = "Showing Core Units matching this slot";
    } else if (isReplacingPlaceholder && /\b(capstone|thesis|research principle)\b/i.test(low) && !low.includes("listed")) {
      const grpMatch = low.match(/group\s*(\d)/i);
      addBuckets(
        (b) =>
          b.category === "capstone" &&
          (!grpMatch || b.title.toLowerCase().includes(`group ${grpMatch[1]}`))
      );
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, "Specified Capstone Option");
      strictPoolOnly = true;
      scopeSubtitle = "Showing Capstone / Research units for this slot";
    } else if (isReplacingPlaceholder && /\bprescribed\b/i.test(low) && !low.includes("listed")) {
      const grpMatch = low.match(/group\s*(\d)/i);
      const secondOnly = low.includes("second major") || low.includes("minor");
      addBuckets((b) => {
        if (secondOnly && !["major2", "minor"].includes(b.category)) return false;
        if (!secondOnly && !["major1", "major2", "minor"].includes(b.category)) return false;
        if (grpMatch && !b.title.toLowerCase().includes(`group ${grpMatch[1]}`)) return false;
        return true;
      });
      // Fallback if student hasn't selected Major 2/Minor yet: include all Major/Minor buckets
      if (coursePoolMap.size === 0) {
        addBuckets((b) => ["major1", "major2", "minor"].includes(b.category));
      }
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, "Specified Option");
      allowsElectives = low.includes("elective");
      strictPoolOnly = !allowsElectives;
      scopeSubtitle = allowsElectives
        ? "Showing Major/Minor Prescribed units + eligible Electives"
        : "Showing Prescribed units from your selected Major / Minor";
    } else if (
      slotKind === "listed" ||
      (isReplacingPlaceholder && /\b(listed|pathway|specialisation)\b/i.test(low) && !low.includes("elective"))
    ) {
      // Check for specific sub-group (e.g. "Group 1", "Group 2", "Group 3", "Neuroscience", "Business", "Criminology", "Education", "Clinical")
      const subKeywords = ["group 1", "group 2", "group 3", "neuroscience", "business", "criminology", "education", "clinical"];
      const matchedKw = subKeywords.filter((kw) => low.includes(kw));
      if (matchedKw.length > 0) {
        addBuckets((b) => matchedKw.some((kw) => b.title.toLowerCase().includes(kw)));
      }
      if (low.includes("prescribed") || low.includes("minor")) {
        addBuckets((b) => ["major2", "minor"].includes(b.category));
      }
      if (coursePoolMap.size === 0) {
        addBuckets((b) => b.category === "listed" || b.category === "minor" || b.title.toLowerCase().includes("listed"));
      }
      // If still empty (e.g. course stores pool in Prescribed/Capstone/Core), include all non-elective buckets
      if (coursePoolMap.size === 0) {
        addBuckets(() => true);
      }
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, "Specified Option");
      strictPoolOnly = true;
      scopeSubtitle = "Showing Listed / Pathway units permitted for this slot";
    } else if (
      slotKind === "elective" ||
      (isReplacingPlaceholder && low.includes("elective") && !/\b(listed|prescribed|major|minor)\b/i.test(low))
    ) {
      // Pure Elective slot: include unfulfilled course/listed units as helpful tags, plus all university units!
      addBuckets((b) => b.category === "listed");
      allowsElectives = true;
      strictPoolOnly = false;
      scopeSubtitle = allowedLevels
        ? `Showing ${allowedLevels.join("/")}-level Elective units`
        : "Showing University-Wide Elective units (eligible units first)";
    } else {
      // "Listed or Elective Unit" OR clicking an empty trimester drop zone!
      // Add unfulfilled Core/Major/Minor/Capstone buckets + all Listed buckets
      addBuckets((b) => b.status !== "complete" || b.category === "listed");
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, "Specified Option");
      const courseHasElectives = resolved.buckets.some((b) => b.category === "elective");
      allowsElectives = slotKind === "listed_or_elective" || low.includes("elective") || (!isReplacingPlaceholder && courseHasElectives);
      strictPoolOnly = !allowsElectives;
      scopeSubtitle = allowsElectives
        ? "Showing Course/Listed units + eligible University Electives"
        : "Showing Course, Major & Listed units for this trimester";
    }

    return {
      title: scopeTitle,
      subtitle: scopeSubtitle,
      allowedLevels,
      allowedPrefixes,
      coursePoolMap,
      allowsElectives,
      strictPoolOnly,
      hints,
    };
  }

  /**
   * Evaluates all candidate units for a specific (yearIdx, triNum) target slot,
   * cleanly separating ELIGIBLE units from INELIGIBLE units (with explicit reasons!).
   */
  function resolveSlotCandidates(targetSlot, course, plan, data, options) {
    const resolved = resolveCurriculumBuckets(course, plan, data);
    const spec = parseSlotSpec(targetSlot, resolved, course, data);
    const yearIdx = targetSlot.yearIdx;
    const triNum = targetSlot.triNum;
    const targetChrono = yearIdx * 3 + (triNum - 1);
    const yearNum = plan.years[yearIdx]?.yearNum || yearIdx + 1;
    const replaceSlotId = targetSlot.replaceSlotId || null;
    const includeAllElectives = options?.forceIncludeElectives || spec.allowsElectives;

    // Build prior & current board state (excluding the placeholder slot being replaced)
    const placements = getPlannedPlacements(plan, data);
    const alreadyPlannedMap = new Map(); // code -> "Year X · TY"
    const priorUnits = new Set();
    const sameOrPriorUnits = new Set();
    let priorCp = resolved.advancedStandingCp || 0;
    const priorPrefixCp = {};
    let curTriCp = 0;
    const cpByLevelCurrent = { 100: 0, 200: 0, 300: 0, 400: 0, 500: 0, 600: 0 };

    for (const p of placements) {
      if (replaceSlotId && p.slot.id === replaceSlotId) continue;
      if (p.yearIdx === yearIdx && p.triNum === triNum) {
        curTriCp += p.cp || 6;
      }
      if (p.type === "unit") {
        alreadyPlannedMap.set(p.code, `Y${p.yearNum} · T${p.triNum}`);
        const lvl = p.unit?.level || 100;
        cpByLevelCurrent[lvl] = (cpByLevelCurrent[lvl] || 0) + (p.cp || 6);
      }
      if (p.chrono < targetChrono) {
        priorCp += p.cp || 6;
        if (p.type === "unit") {
          priorUnits.add(p.code);
          sameOrPriorUnits.add(p.code);
          const pref = p.unit?.prefix || "";
          if (pref) priorPrefixCp[pref] = (priorPrefixCp[pref] || 0) + (p.cp || 6);
        }
      } else if (p.chrono === targetChrono && p.type === "unit") {
        sameOrPriorUnits.add(p.code);
      }
    }

    // Collect candidate unit codes
    const candidateCodes = new Set(spec.coursePoolMap.keys());

    // Guardrail: if all units in a strict Listed/Prescribed pool are already planned (or user hasn't picked a Major/Stream yet),
    // gracefully widen to unplanned units in other active course buckets -> course AOS options -> open electives so slots are never dead!
    if (spec.strictPoolOnly && !includeAllElectives && (spec.hints || []).length === 0) {
      let unplannedInPool = 0;
      for (const code of candidateCodes) {
        if (!alreadyPlannedMap.has(code)) unplannedInPool++;
      }
      if (unplannedInPool === 0) {
        for (const b of resolved.buckets) {
          if (b.category === "elective") continue;
          for (const uCode of b.units || []) {
            if (!alreadyPlannedMap.has(uCode)) {
              candidateCodes.add(uCode);
              if (!spec.coursePoolMap.has(uCode)) spec.coursePoolMap.set(uCode, b.title);
              unplannedInPool++;
            }
          }
        }
      }
      if (unplannedInPool === 0) {
        const idxMap = getCourseUnitIndex(data);
        const courseEntry = idxMap.get(course.code);
        if (courseEntry) {
          for (const uCode of courseEntry.units) {
            if (!alreadyPlannedMap.has(uCode)) {
              candidateCodes.add(uCode);
              if (!spec.coursePoolMap.has(uCode)) spec.coursePoolMap.set(uCode, `${course.code} Major / Stream Pool`);
              unplannedInPool++;
            }
          }
          if (unplannedInPool > 0) {
            spec.subtitle = "Select a Major / Stream above, or preview units from this course's specialisations";
          }
        }
      }
      if (unplannedInPool === 0) {
        spec.allowsElectives = true;
        spec.strictPoolOnly = false;
        spec.subtitle = "All direct listed units are planned — showing eligible University units";
      }
    }

    if (includeAllElectives || !spec.strictPoolOnly || spec.allowsElectives) {
      for (const uCode of Object.keys(data.units)) candidateCodes.add(uCode);
      for (const uCode of Object.keys(plan.customUnits || {})) candidateCodes.add(uCode);
    }

    // Precompute active level caps & minimums on the course
    const activeLevelMaxRules = (course.levelRules || []).filter(
      (r) => r.maxCp !== undefined && (!r.onlyRules || r.onlyRules.includes(plan.admissionRule))
    );
    const activeLevelMinRules = (course.levelRules || []).filter(
      (r) => r.minCp !== undefined && r.levels && (!r.onlyRules || r.onlyRules.includes(plan.admissionRule))
    );

    const eligible = [];
    const ineligible = [];
    let alreadyPlannedCount = 0;
    const hintSet = new Set(spec.hints || []);

    for (const code of candidateCodes) {
      if (alreadyPlannedMap.has(code)) {
        alreadyPlannedCount++;
        continue;
      }
      const u = getUnit(code, data, plan.customUnits);
      if (!u) continue;

      // Apply hard discipline prefix filter if specified by the slot label itself
      if (spec.allowedPrefixes && !spec.allowedPrefixes.includes(u.prefix)) {
        continue;
      }

      const inCoursePool = spec.coursePoolMap.has(code);
      const poolLabel = spec.coursePoolMap.get(code) || "General Elective";
      const reasons = [];

      // 1. 2027 Availability & Trimester Offering
      if (u.offered2027 === false) {
        reasons.push("Not offered in 2027 (archived unit)");
      } else if (u.trimesters && u.trimesters.length > 0 && !u.trimesters.includes(triNum)) {
        reasons.push(`Not offered in Trimester ${triNum} (offered in T${u.trimesters.join(", T")})`);
      }

      // 2. Slot-specific level requirement (e.g. "300-level Listed Unit")
      if (spec.allowedLevels && !spec.allowedLevels.includes(u.level)) {
        reasons.push(`Slot requires ${spec.allowedLevels.join("/")}-level (${code} is ${u.level}-level)`);
      }

      // 3. Candidature & Study-Level restrictions
      const inCourseBuckets = inCoursePool || isUnitInCourseBuckets(code, course, plan, data);
      const pm = u.prereqMeta;
      if (course.studyLevel === "Undergraduate" && u.level >= 500 && !inCourseBuckets) {
        reasons.push(`Restricted to Postgraduate candidature (${u.level}-level unit)`);
      } else if (pm?.pgOnly && course.studyLevel !== "Postgraduate" && !inCourseBuckets) {
        reasons.push("Restricted to Postgraduate candidature");
      } else if (pm?.honoursOnly && course.studyLevel !== "Bachelor Honours" && !inCourseBuckets) {
        reasons.push("Restricted to Honours candidature");
      } else if (pm?.courseRestricted && !inCourseBuckets) {
        reasons.push(`Restricted candidature (${pm.courseRestricted})`);
      }

      // 4. Course Level Maximum Caps (e.g. 100-level <= 60 CP in BSC!)
      for (const mr of activeLevelMaxRules) {
        if ((mr.levels || []).includes(u.level)) {
          const curSum = (mr.levels || []).reduce((s, l) => s + (cpByLevelCurrent[l] || 0), 0);
          if (curSum + u.cp > mr.maxCp) {
            reasons.push(`Exceeds ${mr.label} (already at ${curSum} / ${mr.maxCp} CP)`);
          }
        }
      }

      // 5. Directional & Mutual Unit Restrictions / Exclusions
      for (const rCode of u.restrictedUnits || []) {
        const rUnit = getUnit(rCode, data, plan.customUnits);
        const isMutual = rUnit && (rUnit.restrictedUnits || []).includes(code);
        if (isMutual && alreadyPlannedMap.has(rCode)) {
          reasons.push(`Incompatible / Restricted with ${rCode} (${alreadyPlannedMap.get(rCode)})`);
        } else if (!isMutual && sameOrPriorUnits.has(rCode)) {
          reasons.push(`Cannot take concurrently with or after ${rCode} (${alreadyPlannedMap.get(rCode)})`);
        }
      }
      // Also check if an LATER planned unit would become restricted if this unit were placed earlier!
      for (const [plannedCode, locStr] of alreadyPlannedMap.entries()) {
        const pObj = placements.find((x) => x.type === "unit" && x.code === plannedCode);
        if (pObj && pObj.chrono >= targetChrono) {
          const pU = pObj.unit;
          if ((pU?.restrictedUnits || []).includes(code)) {
            reasons.push(`Conflicts with ${plannedCode} planned in ${locStr}`);
          }
        }
      }

      // 6. Prerequisites & Credit-Point Maturity prior to (yearIdx, triNum)
      if (pm && !(pm.pgWaiver && course.studyLevel === "Postgraduate")) {
        if (pm.minCp > 0 && priorCp < pm.minCp) {
          reasons.push(`Requires ${pm.minCp} CP completed before Y${yearNum} T${triNum} (${priorCp} CP prior)`);
        }
        if (pm.prefixCp) {
          const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
          const havePref = prefs.reduce((s, pr) => s + (priorPrefixCp[pr] || 0), 0);
          if (havePref < pm.prefixCp.cp) {
            reasons.push(`Requires ${pm.prefixCp.cp} CP in ${prefs.join("/")} units prior (${havePref} CP prior)`);
          }
        }
        if (pm.tokens && pm.tokens.length > 0 && !evalPrereqTokens(pm.tokens, priorUnits)) {
          reasons.push(`Pre-requisite not met before Y${yearNum} T${triNum}: ${u.prereqText}`);
        }
      }

      // 7. Co-requisites in same or earlier trimester
      const cm = u.coreqMeta;
      if (cm) {
        const courseApplies = !cm.onlyCourses || cm.onlyCourses.includes(course.code);
        const ruleApplies = !cm.onlyRulePattern || (plan.admissionRule || "").includes(cm.onlyRulePattern);
        const waived = cm.pgWaiver && course.studyLevel === "Postgraduate";
        if (courseApplies && ruleApplies && !waived) {
          if (cm.tokens && cm.tokens.length > 0 && !evalPrereqTokens(cm.tokens, sameOrPriorUnits)) {
            reasons.push(`Co-requisite needed in Y${yearNum} T${triNum} or earlier: ${u.coreqText}`);
          }
        }
      }

      // 8. Trimester 24 CP overload check
      if (curTriCp + u.cp > 24) {
        reasons.push(`Exceeds 24 CP standard trimester load (${curTriCp + u.cp} CP in Y${yearNum} T${triNum})`);
      }

      const modeWarning =
        u.modes && u.modes.length > 0 && plan.preferredMode && !u.modes.includes(plan.preferredMode)
          ? `${u.modes.join("/")} only`
          : null;

      if (reasons.length === 0) {
        // Compute helpful relevance sort score for Eligible units:
        // 0: explicit hintCodes, 1: Major-required Core, 2: Course/Major/Listed pool, 3: helps unmet level minimum, 4: General Elective
        let priority = 4;
        if (hintSet.has(code)) priority = 0;
        else if (resolved.majorCoreHints.mandatory[code]) priority = 1;
        else if (inCoursePool) priority = 2;

        let helpsLevelMin = false;
        for (const minR of activeLevelMinRules) {
          const curSum = (minR.levels || []).reduce((s, l) => s + (cpByLevelCurrent[l] || 0), 0);
          if (curSum < minR.minCp && (minR.levels || []).includes(u.level)) {
            helpsLevelMin = true;
          }
        }

        eligible.push({
          code,
          unit: u,
          inCoursePool,
          poolLabel,
          majorRequiredBy: resolved.majorCoreHints.mandatory[code] || null,
          helpsLevelMin,
          modeWarning,
          priority,
        });
      } else {
        ineligible.push({
          code,
          unit: u,
          inCoursePool,
          poolLabel,
          reasons,
        });
      }
    }

    eligible.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.helpsLevelMin !== b.helpsLevelMin) return a.helpsLevelMin ? -1 : 1;
      if (Boolean(a.modeWarning) !== Boolean(b.modeWarning)) return a.modeWarning ? 1 : -1;
      if (a.unit.level !== b.unit.level) return a.unit.level - b.unit.level;
      return a.code.localeCompare(b.code);
    });

    ineligible.sort((a, b) => {
      if (a.inCoursePool !== b.inCoursePool) return a.inCoursePool ? -1 : 1;
      if (a.reasons.length !== b.reasons.length) return a.reasons.length - b.reasons.length;
      return a.code.localeCompare(b.code);
    });

    return {
      spec,
      yearNum,
      triNum,
      priorCp,
      curTriCp,
      eligible,
      ineligible,
      alreadyPlannedCount,
    };
  }

  /* ================= WHOLE-UNIVERSITY COURSE FINDER SEARCH ENGINE ================= */

  const COURSE_SYNONYMS = {
    cs: ["computer science", "information technology", "software", "cosc"],
    compsci: ["computer science", "cosc"],
    coding: ["computer science", "information technology", "software", "data science"],
    software: ["computer science", "information technology", "software"],
    programming: ["computer science", "information technology", "data science"],
    ai: ["artificial intelligence", "machine learning", "data science", "intelligent systems"],
    ml: ["machine learning", "artificial intelligence", "data science"],
    cyber: ["cybersecurity", "cyber security", "computer science", "information technology"],
    security: ["cybersecurity", "criminology"],
    vet: ["veterinary", "animal science", "zoology"],
    animal: ["animal science", "zoology", "veterinary"],
    animals: ["animal science", "zoology", "veterinary"],
    psych: ["psychology", "counselling", "mental health"],
    mental: ["mental health", "psychology", "counselling", "neuroscience"],
    teach: ["teaching", "education", "early childhood"],
    teacher: ["teaching", "education", "early childhood"],
    teaching: ["teaching", "education"],
    med: ["medicine", "medical", "biomedical", "medicinal"],
    doctor: ["medicine", "medical", "biomedical"],
    nurse: ["nursing"],
    nursing: ["nursing"],
    law: ["laws", "legal", "juris doctor"],
    lawyer: ["laws", "legal", "juris doctor"],
    llb: ["laws", "law"],
    jd: ["juris doctor", "laws"],
    biz: ["business", "commerce", "accounting", "management"],
    business: ["business", "accounting", "economics", "management", "mba"],
    mba: ["business administration", "mba"],
    finance: ["accounting", "economics", "business", "finance"],
    econ: ["economics", "agribusiness"],
    ag: ["agriculture", "agribusiness", "rural science"],
    agri: ["agriculture", "agribusiness", "rural science"],
    farm: ["agriculture", "agribusiness", "rural science"],
    farming: ["agriculture", "agribusiness", "rural science"],
    rural: ["rural science", "agriculture", "rural medicine"],
    chem: ["chemistry", "medicinal chemistry", "biochemistry"],
    bio: ["biology", "biological", "biomedical", "biodiversity", "genetics"],
    math: ["mathematics", "statistics", "data science"],
    maths: ["mathematics", "statistics", "data science"],
    stats: ["statistics", "data science", "mathematics"],
    phys: ["physics", "renewable energy"],
    energy: ["renewable energy", "physics"],
    env: ["environmental", "ecology", "sustainability", "biodiversity"],
    climate: ["environmental", "sustainability", "ecology", "geoscience"],
    geo: ["geography", "geoscience", "palaeobiology"],
    sport: ["exercise", "sports science", "clinical exercise"],
    fitness: ["exercise", "sports science", "nutrition"],
    diet: ["nutrition", "health science"],
    food: ["nutrition", "agriculture", "agribusiness"],
    brain: ["neuroscience", "psychology"],
    crim: ["criminology", "forensic"],
    history: ["history", "ancient history", "archaeology"],
    language: ["languages", "linguistics", "modern languages"],
    writing: ["writing", "creative", "english", "media", "communications"],
    media: ["media", "communications", "journalism"],
    music: ["music", "theatre"],
    double: ["double", "combined"],
    combined: ["double", "combined"],
    honours: ["honours", "hons"],
    phd: ["doctor of philosophy", "doctorate"],
    masters: ["master"],
    diploma: ["diploma", "advanced diploma", "graduate diploma"],
    pathway: ["enabling", "pathway", "tracks"],
  };

  function matchTerm(haystack, term) {
    if (!haystack || !term) return false;
    const escTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Short terms (<=3 chars like "ai", "law", "mba", "cs", "vet") MUST match whole word boundaries
    // so "ai" never matches "sustainable" or "training"!
    if (term.length <= 3) {
      return new RegExp(`\\b${escTerm}\\b`, "i").test(haystack);
    }
    return new RegExp(`\\b${escTerm}`, "i").test(haystack);
  }

  function editDistLeq1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; }
      else {
        edits++;
        if (edits > 1) return false;
        if (a.length > b.length) i++;
        else if (b.length > a.length) j++;
        else { i++; j++; }
      }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  let _courseUnitIndexCache = null;
  function getCourseUnitIndex(data) {
    if (_courseUnitIndexCache) return _courseUnitIndexCache;
    const map = new Map(); // courseCode -> { units: Set, aosEntries: [{code,title,isMinor}] }
    for (const c of data.courses) {
      const units = new Set();
      const aosEntries = [];
      const seenAos = new Set();
      function walk(conts) {
        for (const ct of conts || []) {
          for (const it of ct.items || []) {
            if (it.kind === "unit") {
              units.add(it.code);
            } else if (it.kind === "aos") {
              if (!seenAos.has(it.code)) {
                seenAos.add(it.code);
                const cleanT = (it.title || "")
                  .replace(/^[A-Z0-9]+\s*-\s*/, "")
                  .replace(/\s*\((Major|Minor)\)\s*$/i, "")
                  .trim();
                const isMinor = (it.subType || "").toLowerCase() === "minor" || (ct.title || "").toLowerCase().includes("minor");
                if (!/listed unit/i.test(cleanT) && !/listed unit/i.test(ct.title || "")) {
                  aosEntries.push({ code: it.code, title: cleanT || it.code, isMinor, containerTitle: ct.title });
                }
              }
              if (data.aos[it.code]) walk(data.aos[it.code].containers);
            }
          }
          walk(ct.children);
        }
      }
      walk(c.containers);
      map.set(c.code, { units, aosEntries });
    }
    _courseUnitIndexCache = map;
    return map;
  }

  /**
   * Brilliant ranked search across ALL 233 UNE courses, their 675 Majors/Minors/Specialisations,
   * 1,720 unit codes, career keywords, schools, faculties, ATAR, and study modes.
   */
  function searchCourses(rawQuery, filters, data) {
    const q = (rawQuery || "").trim().toLowerCase();
    const qUpper = q.toUpperCase();
    const f = filters || {};
    const unitIdxMap = getCourseUnitIndex(data);
    const isUnitCodeQuery = /^[A-Z]{2,4}\d{3}[A-Z]?$/.test(qUpper);
    const tokens = q.split(/[\s/,&-]+/).filter((t) => t.length >= 2);

    // Expand synonyms for each token
    const expandedGroups = tokens.map((tok) => {
      const alts = new Set([tok]);
      if (COURSE_SYNONYMS[tok]) {
        for (const syn of COURSE_SYNONYMS[tok]) alts.add(syn);
      }
      return Array.from(alts);
    });

    const results = [];

    for (const c of data.courses) {
      // Facet filters
      if (f.studyLevel && f.studyLevel !== "ALL") {
        if (f.studyLevel === "Double") {
          if (!c.isDoubleDegree) continue;
        } else if (f.studyLevel === "Pathway") {
          if (!["Pathway Programs", "Other"].includes(c.studyLevel)) continue;
        } else if (c.studyLevel !== f.studyLevel) {
          continue;
        }
      }
      if (f.school && f.school !== "ALL" && c.school !== f.school) continue;
      if (f.faculty && f.faculty !== "ALL" && c.faculty !== f.faculty) continue;
      if (f.mode && f.mode !== "ALL" && !(c.modes || []).includes(f.mode)) continue;
      if (f.intake && f.intake !== "ALL" && !(c.intakes || "").includes(`Trimester ${f.intake}`)) continue;
      if (f.maxAtar && f.maxAtar !== "ALL") {
        const atarNum = parseInt(c.atar, 10);
        if (isNaN(atarNum) || atarNum > parseInt(f.maxAtar, 10)) continue;
      }

      if (!q) {
        results.push({ course: c, score: c.code === "BSC" ? 10 : 0, matchedMajors: [], matchedUnit: null, matchBadges: [] });
        continue;
      }

      const codeLow = c.code.toLowerCase();
      const titleLow = c.title.toLowerCase();
      const schoolLow = (c.school || "").toLowerCase();
      const facLow = (c.faculty || "").toLowerCase();
      const ascedLow = (c.asced || "").toLowerCase();
      const careersLow = (c.careers || "").toLowerCase();
      const overviewLow = (c.overview || "").toLowerCase();
      const prefixesLow = (c.unitPrefixes || []).map((p) => p.toLowerCase());
      const idxEntry = unitIdxMap.get(c.code) || { units: new Set(), aosEntries: [] };

      let score = 0;
      const matchBadges = [];
      const matchedMajors = [];
      let matchedUnit = null;

      // 1. Unit Code reverse lookup! (e.g. "CHEM110" or "COSC110")
      if (isUnitCodeQuery && idxEntry.units.has(qUpper)) {
        score += 110;
        matchedUnit = qUpper;
        matchBadges.push(`Includes unit ${qUpper}`);
      }

      // 2. Exact / prefix Course Code match
      if (codeLow === q) score += 160;
      else if (codeLow.startsWith(q)) score += 95;

      // 3. Exact phrase in Title (word-boundary safe for short queries like "ai" or "law" / "laws")
      if (matchTerm(titleLow, q) || (q.length >= 3 && !q.endsWith("s") && matchTerm(titleLow, `${q}s`))) score += 95;

      // 4. Double degree keyword boost
      if ((q.includes("double") || q.includes("combined")) && c.isDoubleDegree) {
        score += 45;
        matchBadges.push("Double / Combined Degree");
      }

      // 5. Major / Minor / Specialisation matching (capped so one course with 5 similar minors doesn't outrank primary degree)
      let majorBonus = 0;
      for (const aos of idxEntry.aosEntries) {
        const aLow = aos.title.toLowerCase();
        const directMatch = matchTerm(aLow, q);
        const synMatch =
          !directMatch &&
          expandedGroups.length > 0 &&
          expandedGroups.every((alts) => alts.some((alt) => matchTerm(aLow, alt)));
        if (directMatch || synMatch) {
          majorBonus = Math.max(majorBonus, directMatch ? 64 : 42);
          if (matchedMajors.length < 4 && !matchedMajors.some((m) => m.title === aos.title)) {
            matchedMajors.push(aos);
          }
        }
      }
      score += majorBonus + Math.min(matchedMajors.length, 3) * 3;

      // 6. Per-token & synonym scoring across title, majors, prefixes, school, ASCED, overview, careers
      if (tokens.length > 0) {
        const titleWords = titleLow.split(/[^a-z0-9]+/).filter(Boolean);
        let tokensMatched = 0;
        let titleTokensMatched = 0;
        for (let tIdx = 0; tIdx < expandedGroups.length; tIdx++) {
          const origTok = tokens[tIdx];
          const alts = expandedGroups[tIdx];
          let bestTokScore = 0;
          let hitTitle = false;
          for (const alt of alts) {
            const isDirect = alt === origTok;
            const mult = isDirect ? 1 : 0.72;
            if (codeLow === alt) {
              bestTokScore = Math.max(bestTokScore, Math.round(60 * mult));
              hitTitle = true;
            } else if (matchTerm(titleLow, alt)) {
              bestTokScore = Math.max(bestTokScore, Math.round(46 * mult));
              hitTitle = true;
            } else if (
              isDirect &&
              alt.length >= 4 &&
              titleWords.some((w) => editDistLeq1(alt, w) || (w.length > alt.length && editDistLeq1(alt.slice(0, 6), w.slice(0, 6))))
            ) {
              bestTokScore = Math.max(bestTokScore, 32);
              hitTitle = true;
            } else if (alt === "double" || alt === "combined") {
              if (c.isDoubleDegree) {
                bestTokScore = Math.max(bestTokScore, 40);
                hitTitle = true;
              }
            } else if (prefixesLow.includes(alt)) {
              bestTokScore = Math.max(bestTokScore, Math.round(28 * mult));
            } else if (idxEntry.aosEntries.some((a) => matchTerm(a.title.toLowerCase(), alt))) {
              bestTokScore = Math.max(bestTokScore, Math.round(30 * mult));
            } else if (matchTerm(ascedLow, alt)) {
              bestTokScore = Math.max(bestTokScore, Math.round(16 * mult));
            } else if (matchTerm(schoolLow, alt) || matchTerm(facLow, alt)) {
              bestTokScore = Math.max(bestTokScore, Math.round(13 * mult));
            } else if (isDirect && (matchTerm(careersLow, alt) || matchTerm(overviewLow, alt))) {
              // Only match noisy prose (overview/careers) on direct user terms, never on expanded synonyms
              bestTokScore = Math.max(bestTokScore, 8);
            }
          }
          if (bestTokScore > 0) {
            tokensMatched++;
            if (hitTitle) titleTokensMatched++;
            score += bestTokScore;
          }
        }
        if (titleTokensMatched === tokens.length) score += 28;
        if (tokens.length >= 2 && tokensMatched < tokens.length && !matchedUnit && matchedMajors.length === 0) {
          score = 0;
        }
      }

      if (score > 0) {
        if (c.studyLevel === "Undergraduate" && c.totalCp >= 144) score += 4;
        if (!q.includes("double") && !q.includes("combined") && !c.isDoubleDegree) score += 2;
        results.push({ course: c, score, matchedMajors, matchedUnit, matchBadges });
      }
    }

    const sortBy = f.sortBy || "relevance";
    results.sort((a, b) => {
      if (sortBy === "az") return a.course.title.localeCompare(b.course.title);
      if (sortBy === "cp_asc") return (a.course.totalCp || 0) - (b.course.totalCp || 0) || a.course.title.localeCompare(b.course.title);
      if (sortBy === "cp_desc") return (b.course.totalCp || 0) - (a.course.totalCp || 0) || a.course.title.localeCompare(b.course.title);
      if (sortBy === "atar") {
        const aA = parseInt(a.course.atar, 10) || 999;
        const bA = parseInt(b.course.atar, 10) || 999;
        return aA - bA || a.course.title.localeCompare(b.course.title);
      }
      // Relevance (or default featured order when query is empty)
      if (b.score !== a.score) return b.score - a.score;
      return a.course.title.localeCompare(b.course.title);
    });

    return results;
  }

  function preselectAOS(course, plan, aosEntry, data) {
    if (!aosEntry || !aosEntry.code) return;
    const cfg = course.structureConfig;
    if (cfg.aosMode === "dynamic") {
      plan.dynamicAosSelections = plan.dynamicAosSelections || {};
      const groups = getDynamicAOSGroups(course, plan, data);
      const matchGrp =
        groups.find((g) => g.items.some((it) => it.code === aosEntry.code)) ||
        groups.find((g) => g.id === aosEntry.containerTitle);
      if (matchGrp && !matchGrp.isMandatorySingle) {
        plan.dynamicAosSelections[matchGrp.id] = aosEntry.code;
      }
      return;
    }
    const opts = getAvailableAOSOptions(course, plan, data);
    if (opts.majors.some((m) => m.code === aosEntry.code)) {
      if (!plan.selectedMajors.includes(aosEntry.code)) {
        plan.selectedMajors = [aosEntry.code];
      }
    } else if (opts.minors.some((m) => m.code === aosEntry.code)) {
      if (cfg.aosMode === "bsc") plan.aosStructure = "1m1n";
      else if (cfg.aosMode === "bcomp") plan.aosStructure = "opt2";
      else if (cfg.aosMode === "bbiosc") plan.aosStructure = "minor";
      plan.selectedMinor = aosEntry.code;
    } else if (opts.pathways.some((p) => p.code === aosEntry.code)) {
      plan.selectedMinor = aosEntry.code;
    }
  }

  global.UNEPlannerEngine = {
    uid,
    getUnit,
    getUnitIntensiveForTri,
    evalPrereqTokens,
    getAdvancedStandingCp,
    createDefaultPlan,
    getAvailableAOSOptions,
    getDynamicAOSGroups,
    getPlannedPlacements,
    resolveCurriculumBuckets,
    evaluateAllPlacements,
    validatePlan,
    autoSchedulePlan,
    applyOfficialStudyPlan,
    getAvailableStudyPlans,
    parseSlotSpec,
    resolveSlotCandidates,
    searchCourses,
    preselectAOS,
  };
})(typeof window !== "undefined" ? window : globalThis);
