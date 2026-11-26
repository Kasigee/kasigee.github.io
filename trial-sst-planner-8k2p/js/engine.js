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

  function getSlotCp(slot, unit) {
    if (unit && unit.cp !== undefined && unit.cp !== null) return unit.cp;
    if (slot && slot.cp !== undefined && slot.cp !== null) return slot.cp;
    return 6;
  }

  function getUnitModesForTri(u, triNum) {
    if (!u) return [];
    if (triNum && u.modesByTri) {
      const m = u.modesByTri[String(triNum)];
      if (Array.isArray(m) && m.length > 0) return m;
    }
    return u.modes || [];
  }

  // Published teaching periods retain their Handbook names. Board scheduling uses
  // the separate u.trimesters mapping so blocks and semesters can occupy a slot.
  function getUnitOfferingPeriods(unit) {
    if (!unit || unit.offered2027 === false || unit.offeringStatus === "not-offered") return [];
    let listed = (unit.offerings || []).filter(offering => offering.period);
    if (!listed.length) {
      listed = unit.nonStandardPeriods?.length
        ? unit.nonStandardPeriods.map(period => ({ period }))
        : (unit.trimesters || []).map(t => ({ period: `Trimester ${t}`, modes: unit.modesByTri?.[t] }));
    }
    return listed.map(({ period, modes }) => {
      const match = period.match(/^(OUA )?Trimester ([1-3])$/i);
      const trimester = match ? Number(match[2]) : null;
      let label = match ? `${match[1] || ""}T${trimester}` : period;
      if (trimester === 3 && unit.t3RepeatOnly) label += " · repeat only";
      return { period, modes, label, trimester };
    });
  }

  function getNoOfferingLabel(unit, year = 2027) {
    if (unit.offeringStatus === "not-offered") return `Not offered in ${year}`;
    if (unit.school === "Archived / Prior Year Unit") return `Prior Handbook reference. No ${year} schedule on file`;
    return `No ${year} offering listed`;
  }

  function getSlotPeriodMismatch(unit, tri, planYear) {
    const entries = getUnitOfferingPeriods(unit);
    const periods = entries.map(p => p.label).join(", ");
    const source = unit.school === "Cross-Faculty Elective" ? "The custom unit" : "The 2027 Handbook";
    const slots = entries.some(p => !p.trimester)
      ? ` (board slots ${unit.trimesters.map(t => `T${t}`).join(", ")})` : "";
    return `No offering mapped to board slot T${tri}. ${source} lists ${periods}${slots}.` +
      (planYear > 2027 ? ` Verify ${planYear} offerings when published.` : "");
  }

  function isPostgradLevel(studyLevel) {
    return studyLevel === "Postgraduate" || studyLevel === "Postgraduate Research";
  }

  function isHonoursOrPostgrad(studyLevel) {
    return (
      studyLevel === "Bachelor Honours" ||
      studyLevel === "Postgraduate" ||
      studyLevel === "Postgraduate Research"
    );
  }

  function isUndergradOrPathway(studyLevel) {
    return studyLevel === "Undergraduate" || studyLevel === "Pathway Programs";
  }

  /**
   * Resolves the calendar year (e.g. 2027, 2028, 2029) of a plan year entry,
   * supporting yr.year, yr.name ("Year 3 (2029)"), and legacy yr.yearNum / index.
   */
  function getPlanYear(yr, yIdx) {
    if (yr && Number.isInteger(yr.year) && yr.year >= 2020) return yr.year;
    if (yr && typeof yr.name === "string") {
      const m = yr.name.match(/\b(20\d{2})\b/);
      if (m) return parseInt(m[1], 10);
    }
    const num = yr && Number.isInteger(yr.yearNum) && yr.yearNum > 0 ? yr.yearNum : (yIdx || 0) + 1;
    return 2026 + num;
  }

  function isIntroductoryBridgingUnit(u) {
    if (!u) return false;
    if (u.isIntroductoryBridging !== undefined) return Boolean(u.isIntroductoryBridging);
    return ["CHEM100", "MTHS100", "PHYS100", "MUSI111", "QMER100", "AFM219"].includes(u.code);
  }

  function isUnitAvailableInYear(u, planYear) {
    if (!u) return false;
    if (u.offered2027 !== false) return true;
    return Boolean(u.rollingStartYear && Number.isFinite(planYear) && planYear >= u.rollingStartYear);
  }

  function isUnitAvailableForHorizon(u, maxPlanYear) {
    if (!u) return false;
    if (u.offered2027 !== false) return true;
    return Boolean(u.rollingStartYear && Number.isFinite(maxPlanYear) && u.rollingStartYear <= maxPlanYear);
  }

  function getUnitEffectiveTrimesters(u, planYear) {
    if (!u) return [1, 2];
    if (u.offered2027 !== false) {
      return u.trimesters && u.trimesters.length > 0 ? u.trimesters : [1, 2];
    }
    if (u.rollingStartYear && (!Number.isFinite(planYear) || planYear >= u.rollingStartYear)) {
      if (Array.isArray(u.indicativeTrimesters) && u.indicativeTrimesters.length > 0) {
        return u.indicativeTrimesters;
      }
      return [1, 2];
    }
    return [];
  }

  /**
   * Computes per-trimester effective credit-point load and multi-trimester span for a unit.
   * ONLY spreads/halves units that are genuinely year-long (u.yearLong === true) or multi-trimester
   * honours/research units (>= 42 CP). Non-yearLong 24 CP single-period units (e.g. MEDI1101A/B, OSLS391)
   * keep their full 24 CP load in their single period.
   */
  function getUnitLoadSpec(u, studyLoad) {
    const isPT = studyLoad === "Part-time";
    const baseMax = isPT ? 12 : 24;
    if (!u) return { cp: 6, effCp: 6, spanTris: 1, carryPerTri: 0, isSmallUnit: false };
    const cp = u.cp ?? 6;
    if (cp === 0) return { cp: 0, effCp: 0, spanTris: 1, carryPerTri: 0, isSmallUnit: false };
    const isSmallUnit = cp > 0 && cp <= 3;

    if (cp >= 72) {
      const spanTris = Math.max(3, Math.ceil(cp / baseMax));
      const effCp = Math.ceil(cp / spanTris);
      const carryPerTri = Math.floor((cp - effCp) / (spanTris - 1));
      return { cp, effCp, spanTris, carryPerTri: Math.max(carryPerTri, effCp), isSmallUnit: false };
    }
    if (u.yearLong || cp >= 42) {
      const minSpan = isPT ? Math.max(2, Math.ceil(cp / 12)) : 2;
      const effCp = Math.ceil(cp / minSpan);
      const rem = Math.max(0, cp - effCp);
      const carryPerTri = minSpan > 1 ? Math.ceil(rem / (minSpan - 1)) : 0;
      return { cp, effCp, spanTris: minSpan, carryPerTri, isSmallUnit };
    }
    return { cp, effCp: cp, spanTris: 1, carryPerTri: 0, isSmallUnit };
  }

  /**
   * Computes year-long / multi-trimester carry-over loads across the entire plan timeline.
   * Allows a unit's start trimester to absorb unused capacity up to baseMax (e.g. HBCOMP COSC493
   * 24 CP alone in FT T1 absorbs 24 CP -> 0 carry-over into T2; MBA 18 CP alone in PT T1 absorbs
   * 12 CP -> 6 CP carry-over into T2; SCI400 48 CP alone in FT T1 absorbs 24 CP -> 24 CP carry-over).
   */
  function computeTimelineCarryOver(plan, data, excludeSlotId) {
    const baseMax = plan.studyLoad === "Part-time" ? 12 : 24;
    const carryOverByChrono = {};
    const carrySmallByChrono = {};
    const carryUnitsByChrono = {};
    const startExtraAbsorbedByChrono = {};

    (plan.years || []).forEach((yr, yIdx) => {
      for (const tNum of [1, 2, 3]) {
        const chrono = yIdx * 3 + (tNum - 1);
        const slots = (yr.trimesters && yr.trimesters[tNum]) || [];
        let baselineDirectSum = 0;
        const multiTriEntries = [];

        for (const s of slots) {
          if (excludeSlotId && s.id === excludeSlotId) continue;
          if (s.type === "unit") {
            const u = getUnit(s.code, data, plan.customUnits);
            if (!u) {
              baselineDirectSum += s.cp ?? 6;
              continue;
            }
            const spec = getUnitLoadSpec(u, plan.studyLoad);
            baselineDirectSum += spec.effCp;
            if (spec.spanTris > 1 && spec.cp > spec.effCp) {
              multiTriEntries.push({ code: u.code, spec });
            }
          } else {
            baselineDirectSum += s.cp ?? 6;
          }
        }

        if (multiTriEntries.length === 0) continue;

        // Unused capacity in the start trimester (accounting for any prior carry-over already entering this chrono)
        let unusedCap = Math.max(0, baseMax - baselineDirectSum - (carryOverByChrono[chrono] || 0));

        for (const entry of multiTriEntries) {
          const { code, spec } = entry;
          const baseRem = Math.max(0, spec.cp - spec.effCp);
          const extraAbsorbed = Math.min(baseRem, unusedCap);
          unusedCap = Math.max(0, unusedCap - extraAbsorbed);

          if (extraAbsorbed > 0) {
            startExtraAbsorbedByChrono[chrono] = (startExtraAbsorbedByChrono[chrono] || 0) + extraAbsorbed;
          }

          const carryTotal = Math.max(0, baseRem - extraAbsorbed);
          if (carryTotal > 0) {
            const carryPerTri = Math.ceil(carryTotal / (spec.spanTris - 1));
            for (let k = 1; k < spec.spanTris; k++) {
              const cKey = chrono + k;
              carryOverByChrono[cKey] = (carryOverByChrono[cKey] || 0) + carryPerTri;
              if (spec.isSmallUnit) {
                carrySmallByChrono[cKey] = (carrySmallByChrono[cKey] || 0) + carryPerTri;
              }
              carryUnitsByChrono[cKey] = carryUnitsByChrono[cKey] || [];
              carryUnitsByChrono[cKey].push(code);
            }
          }
        }
      }
    });

    return {
      carryOverByChrono,
      carrySmallByChrono,
      carryUnitsByChrono,
      startExtraAbsorbedByChrono,
    };
  }

  /**
   * Resolves a unit's Intensive School metadata (kind, location, campuses, published dates,
   * ISO dateRanges, multi-cohort/multi-block entries, TBA flags, mode applicability, and
   * year-aware historical guide status for planYear > 2027)
   * for a specific trimester (or overall unit summary if triNum is omitted).
   * Never falls back to another trimester's intensive if triNum has no intensive.
   */
  function getUnitIntensiveForTri(u, triNum, preferredMode, planYear) {
    if (!u || !u.intensive) return null;
    const hasTriMap = u.intensiveByTri != null;
    let byTri = null;

    if (triNum !== null && triNum !== undefined && triNum !== "") {
      const tk = String(triNum);
      if (hasTriMap) {
        if (!Object.prototype.hasOwnProperty.call(u.intensiveByTri, tk) || !u.intensiveByTri[tk]) {
          // This trimester explicitly has NO intensive (e.g. GEOL110 T3, MM405 T3)
          return null;
        }
        byTri = u.intensiveByTri[tk];
      } else if (u.trimesters?.length !== 1 || !u.trimesters.includes(Number(triNum))) {
        return null;
      }
    }

    const resolvedYear = Number.isFinite(planYear) ? planYear : 2027;
    const isHistoricalGuide = Number.isFinite(planYear) && planYear > 2027;

    const kind = byTri ? (byTri.kind || u.intensive) : u.intensive;
    const dates = byTri ? (byTri.dates || []) : (u.intensiveDates || []);
    const dateRanges = byTri ? (byTri.dateRanges || []) : (u.intensiveDateRanges || []);
    const rawEntries = byTri ? (byTri.entries || []) : (u.intensiveEntries || []);
    const campuses = byTri
      ? (byTri.campuses || [])
      : (u.intensiveCampuses || []);
    const location = byTri ? (byTri.location || "Location TBA") : (u.intensiveLocation || "Location TBA");
    const tba = byTri ? Boolean(byTri.tba) : (dates.length === 0);
    const hasTba = byTri
      ? (byTri.hasTba !== undefined ? Boolean(byTri.hasTba) : tba)
      : (u.intensiveHasTba !== undefined ? Boolean(u.intensiveHasTba) : tba);
    const mixedTba = byTri
      ? Boolean(byTri.mixedTba)
      : Boolean(u.intensiveMixedTba || (hasTba && dates.length > 0));
    const onlineOnlyIntensive = byTri
      ? Boolean(byTri.onlineOnlyIntensive)
      : Boolean(u.intensiveOnlineOnly);
    const isStudentChoice = byTri
      ? Boolean(byTri.isStudentChoice)
      : Boolean(u.intensiveIsStudentChoice);
    const multiCohort = byTri
      ? Boolean(byTri.multiCohort)
      : (rawEntries.length > 1 && rawEntries.some((e) => /cohort|science|nursing|only/i.test(`${e.title || ""} ${e.note || ""}`)));

    const entries = rawEntries.length > 0
      ? rawEntries.map((e) => ({
          title: e.title || "",
          dates: e.dates || [],
          dateRanges: e.dateRanges || [],
          tba: e.tba !== undefined ? Boolean(e.tba) : !(e.dates && e.dates.length),
          location: e.location || location,
          campuses: e.campuses || campuses,
          duration: e.duration || (byTri ? "" : u.intensiveDuration || ""),
          note: e.note || "",
          onlineOnly: e.onlineOnly !== undefined ? Boolean(e.onlineOnly) : onlineOnlyIntensive,
          kind: e.kind || kind,
          tris: e.tris || (triNum ? [Number(triNum)] : undefined),
        }))
      : [
          {
            title: "",
            dates,
            dateRanges,
            tba,
            location,
            campuses,
            duration: byTri ? (byTri.duration || rawEntries[0]?.duration || "") : (u.intensiveDuration || ""),
            note: u.intensiveNote || "",
            onlineOnly: onlineOnlyIntensive,
            kind,
            tris: triNum ? [Number(triNum)] : undefined,
          },
        ];

    const physicalCampuses = campuses.filter((c) => c !== "online");
    const isOnlineOnlyLocation = campuses.length > 0 && physicalCampuses.length === 0;
    const isHybridOnline = campuses.includes("online") && physicalCampuses.length > 0;
    const applicableForMode = !(onlineOnlyIntensive && preferredMode === "On Campus");

    return {
      kind,
      dates,
      dateRanges,
      entries,
      tba,
      hasTba,
      mixedTba,
      location,
      campuses,
      physicalCampuses,
      isPhysical: !isOnlineOnlyLocation,
      isHybridOnline,
      onlineOnlyIntensive,
      applicableForMode,
      isStudentChoice,
      multiCohort,
      planYear: resolvedYear,
      referenceYear: 2027,
      isHistoricalGuide,
      isProvisionalDraft: !isHistoricalGuide && !tba,
      datesConfirmedForYear: !isHistoricalGuide && !tba,
      duration: byTri ? (byTri.duration || rawEntries[0]?.duration || "") : (u.intensiveDuration || ""),
      note: entries[0]?.note || (byTri ? "" : u.intensiveNote || ""),
    };
  }

  function getPhysicalCampusGroup(intInfo) {
    if (!intInfo || intInfo.kind !== "Mandatory" || !intInfo.isPhysical || !intInfo.applicableForMode) return null;
    // Hybrid units that can also be attended online do not force a physical travel clash
    if (intInfo.isHybridOnline) return null;
    const phys = Array.from(new Set(intInfo.physicalCampuses || [])).sort();
    if (phys.length === 0) return null;
    if (phys.length === 1) {
      if (phys[0] === "armidale") return "armidale_only";
      if (phys[0] === "sydney") return "sydney_only";
      return phys[0];
    }
    return phys.join("_");
  }

  /**
   * Pairwise physical intensive campus clash detector.
   * Handles ALL physical campuses (Armidale, Sydney, Field, Tamworth, Taree, Canberra,
   * Melbourne, Geelong), preserves hybrid campuses, distinguishes Student Choice (HSSW*)
   * from Campus TBC (EXSC239/260/370), and respects Online-only intensive mode suppression.
   */
  function doCampusesClash(intA, intB) {
    if (!intA || !intB) return false;
    if (intA.kind !== "Mandatory" || intB.kind !== "Mandatory") return false;
    if (!intA.applicableForMode || !intB.applicableForMode) return false;
    if (!intA.isPhysical || !intB.isPhysical) return false;
    if (intA.isHybridOnline || intB.isHybridOnline) return false;

    const setA = new Set(intA.physicalCampuses || []);
    const setB = new Set(intB.physicalCampuses || []);
    if (setA.size === 0 || setB.size === 0) return false;

    // 1. Disjoint physical campus sets ALWAYS clash (e.g. Armidale + Field, Armidale + Sydney,
    //    Armidale + Tamworth, Armidale + Canberra, Melbourne + Armidale, Tamworth + Taree)
    let hasCommon = false;
    for (const c of setA) {
      if (setB.has(c)) {
        hasCommon = true;
        break;
      }
    }
    if (!hasCommon) return true;

    // 2. If one unit has TBC multi-campus (NOT student choice, e.g. EXSC239/260/370 Armidale/Sydney TBC)
    //    and the other has a different single fixed campus, travel may still be required
    const aTbcMulti = setA.size > 1 && !intA.isStudentChoice && setA.has("armidale") && setA.has("sydney");
    const bTbcMulti = setB.size > 1 && !intB.isStudentChoice && setB.has("armidale") && setB.has("sydney");
    if ((aTbcMulti && setB.size === 1) || (bTbcMulti && setA.size === 1)) {
      return true;
    }

    return false;
  }

  function formatIsoShort(iso) {
    if (!iso || typeof iso !== "string") return "";
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${parts[2]} ${months[mIdx] || parts[1]} ${parts[0]}`;
  }

  function doDateRangesOverlap(r1, r2) {
    if (!r1 || !r2 || !r1.from || !r1.to || !r2.from || !r2.to) return false;
    return r1.from <= r2.to && r2.from <= r1.to;
  }

  /**
   * Detects overlapping published Mandatory Intensive dates between two units in the same trimester.
   * Respects multiCohort alternatives (e.g. PSIO110 Science vs Nursing cohorts) vs sequential blocks (MEDI1101A).
   */
  function checkUnitIntensiveDateOverlap(codeA, intA, codeB, intB) {
    if (!intA || !intB) return null;
    if (intA.kind !== "Mandatory" || intB.kind !== "Mandatory") return null;
    if (!intA.applicableForMode || !intB.applicableForMode) return null;

    // Collect option-groups of dateRanges:
    // - If multiCohort is true, each dated entry is an ALTERNATIVE cohort (student attends ONE).
    // - Otherwise, all dated ranges across entries are REQUIRED blocks (student attends ALL).
    function getOptionGroups(intInfo) {
      const datedEntries = (intInfo.entries || []).filter(
        (e) => (e.kind || intInfo.kind) === "Mandatory" && e.dateRanges && e.dateRanges.length > 0
      );
      if (intInfo.multiCohort && datedEntries.length > 1) {
        return datedEntries.map((e) => e.dateRanges);
      }
      const allRanges = (intInfo.dateRanges || []).filter((r) => r.from && r.to);
      if (allRanges.length > 0) return [allRanges];
      const flat = [];
      for (const e of datedEntries) {
        for (const r of e.dateRanges || []) if (r.from && r.to) flat.push(r);
      }
      return flat.length > 0 ? [flat] : [];
    }

    const groupsA = getOptionGroups(intA);
    const groupsB = getOptionGroups(intB);
    if (!groupsA.length || !groupsB.length) return null;

    // Guaranteed clash iff EVERY (cohortA, cohortB) combination has at least one overlapping date range
    let firstOverlap = null;
    for (const gA of groupsA) {
      for (const gB of groupsB) {
        let pairOverlap = null;
        for (const rA of gA) {
          for (const rB of gB) {
            if (doDateRangesOverlap(rA, rB)) {
              const ovFrom = rA.from > rB.from ? rA.from : rB.from;
              const ovTo = rA.to < rB.to ? rA.to : rB.to;
              const ovText =
                ovFrom === ovTo
                  ? formatIsoShort(ovFrom)
                  : `${formatIsoShort(ovFrom)}–${formatIsoShort(ovTo)}`;
              pairOverlap = {
                unitA: codeA,
                unitB: codeB,
                rangeA: rA.display || `${formatIsoShort(rA.from)}–${formatIsoShort(rA.to)}`,
                rangeB: rB.display || `${formatIsoShort(rB.from)}–${formatIsoShort(rB.to)}`,
                overlapFrom: ovFrom,
                overlapTo: ovTo,
                overlapText: ovText,
              };
              break;
            }
          }
          if (pairOverlap) break;
        }
        if (!pairOverlap) {
          // There exists a non-overlapping cohort choice — not a guaranteed clash
          return null;
        }
        if (!firstOverlap) firstOverlap = pairOverlap;
      }
    }
    return firstOverlap;
  }

  /**
   * Recursive-descent boolean evaluator for unit prerequisite token streams:
   * Tokens: '(', ')', 'AND', 'OR', or UnitCode (e.g. 'MTHS120', 'MEDI1101A', 'PRACENSC', 'LANTITE-L').
   * Hardened against empty parens, leading/trailing operators, and unbalanced tokens.
   */
  function evalPrereqTokens(tokens, completedSet) {
    if (!tokens || !tokens.length) return true;

    // 1. Defensive sanitization: strip leading/trailing ops, consecutive ops, empty/unbalanced parens
    const raw = [];
    for (const t of tokens) {
      if (t === null || t === undefined || t === "") continue;
      const tok = String(t).trim();
      if (!tok) continue;
      if (tok === "AND" || tok === "OR") {
        if (!raw.length || raw[raw.length - 1] === "(" || raw[raw.length - 1] === "AND" || raw[raw.length - 1] === "OR") {
          continue;
        }
        raw.push(tok);
      } else if (tok === ")") {
        while (raw.length && (raw[raw.length - 1] === "AND" || raw[raw.length - 1] === "OR")) {
          raw.pop();
        }
        if (raw.length && raw[raw.length - 1] === "(") {
          raw.pop();
          continue;
        }
        raw.push(tok);
      } else {
        raw.push(tok);
      }
    }
    while (raw.length && (raw[raw.length - 1] === "AND" || raw[raw.length - 1] === "OR" || raw[raw.length - 1] === "(")) {
      raw.pop();
    }
    // Balance parens
    let depth = 0;
    const balanced = [];
    for (const tok of raw) {
      if (tok === "(") {
        depth++;
        balanced.push(tok);
      } else if (tok === ")") {
        if (depth > 0) {
          depth--;
          balanced.push(tok);
        }
      } else {
        balanced.push(tok);
      }
    }
    while (depth > 0) {
      balanced.push(")");
      depth--;
    }
    // Second pass after dropping unmatched ')' to ensure no leading/trailing/empty ops remain
    const cleaned = [];
    for (const tok of balanced) {
      if (tok === "AND" || tok === "OR") {
        if (!cleaned.length || cleaned[cleaned.length - 1] === "(" || cleaned[cleaned.length - 1] === "AND" || cleaned[cleaned.length - 1] === "OR") {
          continue;
        }
      } else if (tok === ")") {
        while (cleaned.length && (cleaned[cleaned.length - 1] === "AND" || cleaned[cleaned.length - 1] === "OR")) {
          cleaned.pop();
        }
        if (cleaned.length && cleaned[cleaned.length - 1] === "(") {
          cleaned.pop();
          continue;
        }
      }
      cleaned.push(tok);
    }
    while (cleaned.length && (cleaned[cleaned.length - 1] === "AND" || cleaned[cleaned.length - 1] === "OR" || cleaned[cleaned.length - 1] === "(")) {
      cleaned.pop();
    }
    if (!cleaned.length) return true;

    // 2. Normalize adjacent unit codes if any slipped through comma-lists
    const norm = [];
    for (let i = 0; i < cleaned.length; i++) {
      const tok = cleaned[i];
      const prev = norm[norm.length - 1];
      const isCode = tok !== "(" && tok !== ")" && tok !== "AND" && tok !== "OR";
      const prevIsCodeOrClose = prev && prev !== "(" && prev !== "AND" && prev !== "OR";
      if ((isCode || tok === "(") && prevIsCodeOrClose) {
        let inferred = "AND";
        for (let j = i + 1; j < cleaned.length; j++) {
          if (cleaned[j] === "(" || cleaned[j] === ")") break;
          if (cleaned[j] === "OR" || cleaned[j] === "AND") {
            inferred = cleaned[j];
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
      if (pos >= norm.length) return false;
      const tok = norm[pos];
      if (tok === "(") {
        pos++;
        const val = parseOr();
        if (pos < norm.length && norm[pos] === ")") pos++;
        return val;
      }
      if (tok === ")" || tok === "AND" || tok === "OR") {
        pos++;
        return false;
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

  function matchesRulePattern(admissionRule, pattern) {
    if (!pattern) return true;
    const ar = (admissionRule || "").toLowerCase();
    const pat = String(pattern).toLowerCase();
    if (ar.includes(pat)) return true;
    // Match "Rule A" vs "Rule (a)" / "Rule A and Rule D"
    const mPat = pat.match(/\b(rule|schedule)\s*\(?([a-z])\)?\b/);
    if (mPat) {
      const rx = new RegExp(`\\b${mPat[1]}\\s*\\(?${mPat[2]}\\)?\\b`, "i");
      if (rx.test(ar)) return true;
    }
    return false;
  }

  /**
   * Evaluates a single requisite clause containing any combination of:
   * minCp, prefixCp (with optional levels), levelCp (with optional prefixes), minUnitsFrom, tokens,
   * combined by clause.combineOp ("AND" default, or "OR").
   */
  function evalRequisiteClause(clause, ctx, labelTiming) {
    if (!clause) return { ok: true, messages: [] };
    const timing = labelTiming || "prior to this trimester";
    const checks = [];

    if (clause.minCp && clause.minCp > 0) {
      const ok = ctx.cp >= clause.minCp;
      checks.push({
        ok,
        msg: `Requires ${clause.minCp} CP completed ${timing} (currently ${ctx.cp} CP).`,
      });
    }

    if (clause.prefixCp && clause.prefixCp.cp > 0) {
      const prefs = clause.prefixCp.prefixes || (clause.prefixCp.prefix ? [clause.prefixCp.prefix] : []);
      const lvls = clause.prefixCp.levels && clause.prefixCp.levels.length ? clause.prefixCp.levels : null;
      let have = 0;
      if (lvls && ctx.prefixLevelCp) {
        for (const pr of prefs) {
          for (const lv of lvls) have += ctx.prefixLevelCp[`${pr}_${lv}`] || 0;
        }
      } else {
        for (const pr of prefs) have += (ctx.prefixCp && ctx.prefixCp[pr]) || 0;
      }
      const ok = have >= clause.prefixCp.cp;
      const lvlStr = lvls ? `${lvls.join("/")}-level ` : "";
      checks.push({
        ok,
        msg: `Requires ${clause.prefixCp.cp} CP in ${lvlStr}${prefs.join("/")} units ${timing} (currently ${have} CP).`,
      });
    }

    if (clause.levelCp && clause.levelCp.cp > 0) {
      const lvls = clause.levelCp.levels || [];
      const prefs = clause.levelCp.prefixes && clause.levelCp.prefixes.length ? clause.levelCp.prefixes : null;
      let have = 0;
      if (prefs && ctx.prefixLevelCp) {
        for (const pr of prefs) {
          for (const lv of lvls) have += ctx.prefixLevelCp[`${pr}_${lv}`] || 0;
        }
      } else if (ctx.levelCp) {
        for (const lv of lvls) have += ctx.levelCp[lv] || 0;
      }
      const ok = have >= clause.levelCp.cp;
      const prefStr = prefs ? ` ${prefs.join("/")}` : "";
      checks.push({
        ok,
        msg: `Requires ${clause.levelCp.cp} CP at ${lvls.join("/")}-level${prefStr} ${timing} (currently ${have} CP).`,
      });
    }

    if (Array.isArray(clause.minUnitsFrom) && clause.minUnitsFrom.length > 0) {
      let allReqOk = true;
      const unmetParts = [];
      for (const req of clause.minUnitsFrom) {
        const codes = req.codes || [];
        let matchedCount = 0;
        let matchedCp = 0;
        for (const c of codes) {
          if (ctx.units.has(c)) {
            matchedCount++;
            matchedCp += (ctx.unitCpMap && ctx.unitCpMap.has(c) ? ctx.unitCpMap.get(c) : 6);
          }
        }
        const needCount = req.count || 0;
        const needCp = req.cp || 0;
        const reqOk = (!needCount || matchedCount >= needCount) && (!needCp || matchedCp >= needCp);
        if (!reqOk) {
          allReqOk = false;
          const desc = needCp ? `${needCp} CP` : `${needCount} units`;
          unmetParts.push(`${desc} from (${codes.slice(0, 6).join(", ")}${codes.length > 6 ? "…" : ""})`);
        }
      }
      checks.push({
        ok: allReqOk,
        msg: allReqOk ? "" : `Requires ${unmetParts.join(" and ")} ${timing}.`,
      });
    }

    if (clause.tokens && clause.tokens.length > 0) {
      const ok = evalPrereqTokens(clause.tokens, ctx.units);
      checks.push({
        ok,
        msg: clause.text ? `Prerequisite not satisfied ${timing}: ${clause.text}` : `Required units not satisfied ${timing}.`,
      });
    }

    if (!checks.length) return { ok: true, messages: [] };

    if (clause.combineOp === "OR") {
      if (checks.some((c) => c.ok)) return { ok: true, messages: [] };
      return { ok: false, messages: [checks.map((c) => c.msg.replace(/\.$/, "")).join(" OR ") + "."] };
    }

    const failed = checks.filter((c) => !c.ok).map((c) => c.msg);
    return { ok: failed.length === 0, messages: failed };
  }

  function altMatchesCourse(alt, course, admissionRule) {
    if (alt.onlyCourses && alt.onlyCourses.length > 0 && !alt.onlyCourses.includes(course.code)) {
      return false;
    }
    if (alt.onlyRulePattern && !matchesRulePattern(admissionRule, alt.onlyRulePattern)) {
      return false;
    }
    if (alt.onlyLevels && alt.onlyLevels.length > 0) {
      const sl = course.studyLevel;
      const matched = alt.onlyLevels.some(
        (lvl) =>
          lvl === sl ||
          (lvl === "Postgraduate" && isHonoursOrPostgrad(sl)) ||
          (lvl === "Undergraduate" && isUndergradOrPathway(sl))
      );
      if (!matched) return false;
    }
    return true;
  }

  /**
   * Evaluates full prerequisite metadata (study-level guards, pgWaiver, alternatives, and clauses).
   */
  function evaluatePrereqMeta(u, ctx, inCourseBuckets, labelTiming) {
    const errors = [];
    const warnings = [];
    const infos = [];
    const course = ctx.course;
    const pm = u.prereqMeta;

    if (isUndergradOrPathway(course.studyLevel) && u.level >= 500 && !inCourseBuckets) {
      errors.push(`Restricted to Postgraduate candidature (${u.level}-level unit).`);
    }
    if (!pm) return { errors, warnings, infos, ok: errors.length === 0 };

    if (pm.pgOnly && !isHonoursOrPostgrad(course.studyLevel) && !inCourseBuckets) {
      errors.push("Restricted to Postgraduate candidature.");
    } else if (pm.honoursOnly && course.studyLevel !== "Bachelor Honours" && !inCourseBuckets) {
      errors.push("Restricted to Honours candidature.");
    } else if (pm.courseRestricted && !inCourseBuckets) {
      warnings.push(`Check degree candidature restriction: ${pm.courseRestricted}`);
    }

    if (pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel)) {
      infos.push("UG prerequisites waived via Postgraduate / Honours candidature.");
      return { errors, warnings, infos, ok: errors.length === 0 };
    }

    // Course-scoped prerequisite (e.g. LAW100 "for DipParalegStuds, AdvDipParalegStuds and BLegStuds: LSU100")
    // does NOT apply to other courses like LLB / Double-Law degrees!
    if (Array.isArray(pm.onlyCourses) && pm.onlyCourses.length > 0 && !pm.onlyCourses.includes(course.code)) {
      return { errors, warnings, infos, ok: errors.length === 0 };
    }

    if (Array.isArray(pm.alternatives) && pm.alternatives.length > 0) {
      const applicable = pm.alternatives.filter((a) => altMatchesCourse(a, course, ctx.plan?.admissionRule));
      if (applicable.length > 0) {
        let anyPassed = false;
        for (const alt of applicable) {
          if (alt.pgWaiver && isHonoursOrPostgrad(course.studyLevel)) {
            anyPassed = true;
            infos.push("UG prerequisites waived via Postgraduate / Honours candidature.");
            break;
          }
          const res = evalRequisiteClause({ ...alt, text: u.prereqText }, ctx, labelTiming);
          if (res.ok) {
            anyPassed = true;
            break;
          }
        }
        if (!anyPassed) {
          warnings.push(`Prerequisite not satisfied ${labelTiming || "in an earlier trimester"}: ${u.prereqText}`);
        }
        return { errors, warnings, infos, ok: errors.length === 0 && warnings.length === 0 };
      }
    }

    const res = evalRequisiteClause({ ...pm, text: u.prereqText }, ctx, labelTiming);
    if (!res.ok) {
      for (const m of res.messages) warnings.push(m);
    }
    return { errors, warnings, infos, ok: errors.length === 0 && warnings.length === 0 };
  }

  /**
   * Evaluates full co-requisite metadata (including multi-course branches, CP/prefixCp/minUnitsFrom, and tokens).
   */
  function evaluateCoreqMeta(u, ctx, labelTiming) {
    const cm = u.coreqMeta;
    if (!cm) return { ok: true, warnings: [] };
    const course = ctx.course;
    const admissionRule = ctx.plan?.admissionRule || "";
    const timing = labelTiming || "concurrently or earlier";
    const warnings = [];

    if (Array.isArray(cm.branches) && cm.branches.length > 0) {
      const applicable = cm.branches.filter((br) => {
        const courseApplies = !br.onlyCourses || br.onlyCourses.includes(course.code);
        const ruleApplies = !br.onlyRulePattern || matchesRulePattern(admissionRule, br.onlyRulePattern);
        const waived = br.pgWaiver && isHonoursOrPostgrad(course.studyLevel);
        return courseApplies && ruleApplies && !waived;
      });
      for (const br of applicable) {
        const hasConstraint =
          (br.tokens && br.tokens.length > 0) ||
          (br.minCp && br.minCp > 0) ||
          (br.prefixCp && br.prefixCp.cp > 0) ||
          (br.minUnitsFrom && br.minUnitsFrom.length > 0);
        if (!hasConstraint) continue;
        const res = evalRequisiteClause(br, ctx, timing);
        if (!res.ok) {
          warnings.push(`Co-requisite not met ${timing}: ${u.coreqText}`);
          break;
        }
      }
      return { ok: warnings.length === 0, warnings };
    }

    const courseApplies = !cm.onlyCourses || cm.onlyCourses.includes(course.code);
    const ruleApplies = !cm.onlyRulePattern || matchesRulePattern(admissionRule, cm.onlyRulePattern);
    const waived = cm.pgWaiver && isHonoursOrPostgrad(course.studyLevel);
    if (courseApplies && ruleApplies && !waived) {
      const hasConstraint =
        (cm.tokens && cm.tokens.length > 0) ||
        (cm.minCp && cm.minCp > 0) ||
        (cm.prefixCp && cm.prefixCp.cp > 0) ||
        (cm.minUnitsFrom && cm.minUnitsFrom.length > 0);
      if (hasConstraint) {
        const res = evalRequisiteClause(cm, ctx, timing);
        if (!res.ok) {
          warnings.push(`Co-requisite not met ${timing}: ${u.coreqText}`);
        }
      }
    }
    return { ok: warnings.length === 0, warnings };
  }

  /**
   * Computes Advanced Standing credit points for the selected Admission Rule — OR for non-rule
   * courses with top-level/nested Advanced Standing containers (BEDPF, BMSMD, BORGL, GCSPSY).
   */
  function getAdvancedStandingCp(course, admissionRule) {
    const roots = course.structureConfig.hasAdmissionRules
      ? [
          course.containers.find((c) => c.title.trim() === admissionRule) ||
            course.containers[0],
        ].filter(Boolean)
      : course.containers || [];

    let adv = 0;
    function walk(list) {
      for (const c of list || []) {
        if (c.isAdvancedStanding) {
          const val = c.advancedStandingCp || c.cpMin || 0;
          if (val > 0) {
            adv += val;
            continue; // do not double-count nested child descriptions
          }
          // Skip conditional pathway children (like MC Rule D-F "additional 12-24 CP") when another
          // base Advanced Standing container already exists or when children are mutually exclusive
          continue;
        }
        walk(c.children);
      }
    }
    walk(roots);
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
        year: 2026 + y,
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
   * Scans the rule container itself (ruleCont.items) as well as ruleCont.children so courses like BACC Rule B/C work.
   */
  function getAvailableAOSOptions(course, plan, data) {
    const cfg = course.structureConfig;
    const ruleCont = cfg.hasAdmissionRules
      ? (course.containers.find((c) => c.title.trim() === plan.admissionRule) || course.containers[0])
      : null;
    const activeTopContainers = cfg.hasAdmissionRules
      ? (ruleCont ? [ruleCont] : [])
      : (course.containers || []);

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
   * For any whole-university course using aosMode === 'dynamic' (e.g. BA, BBus, BASC, BSCLAW, BED*, BAGR, BACC, etc.),
   * extracts every active AOS selector container (Majors, Minors, Specialisations, Teaching Areas, Focus Areas).
   * Scans both direct ruleCont.items (fixes BACC Rule B/C) and ruleCont.children, and accurately distinguishes
   * optional single-item containers (BA Articulation SSA100, BBUS Rule A Minor BUSANA001) from mandatory ones.
   */
  function getDynamicAOSGroups(course, plan, data) {
    const cfg = course.structureConfig;
    const ruleCont = cfg.hasAdmissionRules
      ? (course.containers.find((c) => c.title.trim() === plan.admissionRule) || course.containers[0])
      : null;
    const activeTopContainers = cfg.hasAdmissionRules
      ? (ruleCont ? [ruleCont] : [])
      : (course.containers || []);

    const groups = [];
    function scan(conts) {
      for (const c of conts || []) {
        const aosItems = (c.items || []).filter((it) => it.kind === "aos");
        if (aosItems.length > 0) {
          const vgLow = (c.vg || "").toLowerCase();
          const titleLow = c.title.toLowerCase();
          const descLow = (c.description || "").toLowerCase();
          const isMinor = vgLow === "minor" || titleLow.includes("minor");
          const isOptionalPhrase =
            /\b(may choose|optional|if a |elect to|not wishing|who have completed one major may|or \d+\s*(?:cp|credit points)\s+of\s+(?:elective|listed))\b/i.test(
              descLow
            ) || titleLow.includes("articulation");
          const isLawListedFocus =
            titleLow.includes("focus area") ||
            descLow.includes("available law listed") ||
            aosItems[0]?.code === "LAWLIST01";
          const startsWithCompleteFollowing = /^complete\s+the\s+following\b/i.test(descLow.trim());
          const isMandatorySingle =
            aosItems.length === 1 &&
            !isOptionalPhrase &&
            (isLawListedFocus || startsWithCompleteFollowing);
          const cleanLabel = c.title
            .replace(/^Rule\s+[A-Z0-9\s/&-]+-\s*/i, "")
            .replace(/^Schedule\s+[A-Z0-9\s/&-]+-\s*/i, "")
            .trim();
          groups.push({
            id: c.title,
            title: cleanLabel || c.title,
            isMinor,
            isMandatorySingle,
            isOptional: isOptionalPhrase || isMinor,
            cpMin: c.cpMin,
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
      const planYear = getPlanYear(yr, yIdx);
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
              planYear,
              triNum: tNum,
              chrono,
              type: "unit",
              code: slot.code,
              unit: u,
              cp: getSlotCp(slot, u),
            });
          } else {
            placements.push({
              slot,
              slotIdx: sIdx,
              yearIdx: yIdx,
              yearNum: yr.yearNum || yIdx + 1,
              planYear,
              triNum: tNum,
              chrono,
              type: "placeholder",
              label: slot.label || "Elective Unit",
              hintCodes: slot.hintCodes || [],
              cp: slot.cp ?? 6,
            });
          }
        });
      }
    });
    return placements;
  }

  /**
   * Parses credit-point bounds from UNE container descriptions (shared by AOS & Course buckets).
   */
  function parseContainerProseCp(desc, unitItems, data) {
    const out = { min: null, max: null, isTwice: false, explicitProse: false };
    if (!desc) return out;
    const directSum = (unitItems || []).reduce((s, x) => {
      const u = data && data.units ? data.units[x.code] : null;
      return s + (u && u.cp !== undefined && u.cp !== null ? u.cp : (x.cp ?? 6));
    }, 0);
    const minItemCp = (unitItems || []).length
      ? Math.min(
          ...unitItems.map((x) => {
            const u = data && data.units ? data.units[x.code] : null;
            return u && u.cp !== undefined && u.cp !== null ? u.cp : (x.cp ?? 6);
          })
        )
      : 6;

    // 1. "at least X credit points and not more than Y credit points" (e.g. ADSC Listed Units 36..48 CP)
    const mAtLeastMax = desc.match(
      /at\s+least\s+(\d+)\s*(?:cp|cps|credit\s+points?)\s+and\s+(?:not|no)\s+more\s+than\s+(\d+)\s*(?:cp|cps|credit\s+points?)/i
    );
    if (mAtLeastMax) {
      out.min = parseInt(mAtLeastMax[1], 10);
      out.max = parseInt(mAtLeastMax[2], 10);
      out.explicitProse = true;
      return out;
    }

    // 2. "Complete X to Y credit points" / "Complete X-Y credit points" / "Complete X or Y credit points"
    const mRange = desc.match(
      /(?:complete|select)\s+(\d+)\s*(?:to|-|–|or)\s*(\d+)\s*(?:cp|cps|credit\s+points?)/i
    );
    if (mRange) {
      out.min = parseInt(mRange[1], 10);
      out.max = parseInt(mRange[2], 10);
      out.explicitProse = true;
      return out;
    }

    // 3. "Complete the following unit(s) twice" (e.g. BLANG, BURP)
    if (/complete\s+(?:all\s+)?the\s+following\s+(?:prescribed\s+)?units?\s+twice/i.test(desc)) {
      out.min = directSum * 2;
      out.max = directSum * 2;
      out.isTwice = true;
      out.explicitProse = true;
      return out;
    }

    // 4. "Coursework candidates complete 0 credit points" (optional Honours container)
    if (/coursework\s+candidates\s+complete\s+0\s*(?:cp|credit\s+points?)/i.test(desc)) {
      out.min = 0;
      out.max = null;
      out.explicitProse = true;
      return out;
    }

    // 5. "Complete (at least) X credit points" (skip conditional "Candidates who complete X..." unless matched directly)
    const mExact = desc.match(
      /(?:^|[.;:\n]\s*)(?:and\s+)?(?:complete|select)\s+(?:a\s+further\s+)?(at\s+least\s+)?(\d+)\s*(?:cp|cps|credit\s+points?)/i
    );
    if (mExact) {
      out.min = parseInt(mExact[2], 10);
      out.max = mExact[1] ? null : out.min;
      out.explicitProse = true;
      return out;
    }

    // 6. "Complete ONE / TWO of the following units"
    const mOneOf = desc.match(/(?:complete|select)\s+(one|1|two|2)\s+of\s+the\s+following/i);
    if (mOneOf) {
      const n = /two|2/i.test(mOneOf[1]) ? 2 : 1;
      out.min = n * (minItemCp || 6);
      out.max = out.min;
      out.explicitProse = true;
      return out;
    }

    // 7. "Complete (all) the following unit(s)"
    if (/(?:complete|completing)\s+(?:all\s+)?the\s+following\s+(?:prescribed\s+|core\s+)?unit/i.test(desc)) {
      out.min = directSum;
      out.max = directSum;
      out.explicitProse = true;
      return out;
    }

    return out;
  }

  function isChooseOneContainer(cont) {
    if (!cont) return false;
    if (cont.selectionMode === "choose_one") return true;
    const ch = cont.children || [];
    if (ch.length < 2) return false;
    // Never treat Core + Listed/Elective sibling sub-parts whose cpMin sum equals parent cpMin (e.g. DBUS General Program 30+18=48) as choose_one!
    const hasCoreChild = ch.some((c) => (c.vg || "").toLowerCase() === "core" || /\bcore\b/i.test(c.title || ""));
    const hasListedOrElectiveChild = ch.some(
      (c) => ["listed", "elective"].includes((c.vg || "").toLowerCase()) || /\b(listed|elective)\b/i.test(c.title || "")
    );
    if (hasCoreChild && hasListedOrElectiveChild) return false;
    if (cont.cpMin && cont.cpMin > 0) {
      const childSum = ch.reduce((s, c) => s + (c.cpMin || 0), 0);
      if (childSum === cont.cpMin) return false;
    }
    const d = (cont.description || "").toLowerCase();
    const t = (cont.title || "").toLowerCase();
    if (
      /complete\s+(?:either\b|one\s+of\s+the\s+following|\d+\s*(?:cp|cps|credit\s+points?)\s+from\s+one\s+(?:of\s+the\s+following|specialisation|stream|option|teaching\s+area|subject\s+area|pathway))/.test(
        d
      ) ||
      /for\s+the\s+intended\s+masters?\s+program/.test(d) ||
      /\bor\b.*\b(thesis|project|capstone|stream|option)\b/.test(t)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Detects flat sibling mutually-exclusive option containers (e.g. MECCW Option 1 vs Option 2,
   * BURP/MURP Candidates wishing vs NOT wishing, MNSC CAPRESPAT Optional Research Units 1 vs 2,
   * MEDR Program A vs Program B) when no wrapper parent has selectionMode === 'choose_one'.
   */
  function assignSiblingExclusiveGroups(siblings, scopeKey, groupMap) {
    if (!siblings || siblings.length < 2) return;
    const patterns = [
      {
        name: "option",
        test: (c) => /\boption\s*[1-9]\b|\boptional\s+research\s+units?\s*[1-9]\b/i.test(c.title || ""),
      },
      {
        name: "wishing",
        test: (c) => /\bcandidates\s+(?:not\s+)?wishing\s+to\s+complete\b/i.test(c.title || ""),
      },
      {
        name: "program",
        test: (c) => /^program\s+[a-z]\b/i.test((c.title || "").trim()),
      },
    ];
    for (const pat of patterns) {
      const matched = siblings.filter((c) => !c.isAdvancedStanding && pat.test(c));
      if (matched.length >= 2) {
        const gid = `excl_sib_${scopeKey}_${pat.name}`;
        matched.forEach((c, idx) => {
          groupMap.set(c, { groupId: gid, optionId: `${gid}__opt_${idx}`, groupTitle: `${pat.name} choice` });
        });
        // Handle conditional Listed Units tied to Optional Research Units 2 (e.g. MNSC CAPRESPAT SCI501+SCI502)
        if (pat.name === "option") {
          const opt2 = matched.find((c) => /\b2\b/.test(c.title || ""));
          if (opt2) {
            const opt2UnitCodes = new Set((opt2.items || []).filter((i) => i.kind === "unit").map((i) => i.code));
            const opt2Meta = groupMap.get(opt2);
            for (const s of siblings) {
              if (groupMap.has(s) || s.isAdvancedStanding) continue;
              const sd = s.description || "";
              if (/candidates\s+who\s+complete\b/i.test(sd)) {
                for (const code of opt2UnitCodes) {
                  if (sd.includes(code)) {
                    groupMap.set(s, opt2Meta);
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  function extractRuleLetters(str) {
    const out = new Set();
    if (!str) return out;
    const low = str.toLowerCase();
    // Match "Rule A", "Rule (a)", "Rule (a), (g) or (h)", "Rule A and Rule D", "Schedule B"
    for (const m of low.matchAll(/\b(rule|schedule)\s*([a-z]|\([a-z]\))(?:\s*(?:,|and|or)\s*(?:(?:rule|schedule)\s*)?([a-z]|\([a-z]\)))*/g)) {
      const kind = m[1];
      const seg = m[0];
      for (const lm of seg.matchAll(/(?:\(([a-z])\)|\b(?:rule|schedule)\s+([a-z])\b|\b(?:and|or|,)\s+([a-z])\b)/g)) {
        const letter = lm[1] || lm[2] || lm[3];
        if (letter) out.add(`${kind}:${letter}`);
      }
    }
    return out;
  }

  function isUnitExcludedForCourse(u, course) {
    if (!u || !course) return false;
    if (Array.isArray(u.courseExclusions) && u.courseExclusions.includes(course.code)) return true;
    if (Array.isArray(u.levelExclusions) && u.levelExclusions.length > 0) {
      const sl = course.studyLevel;
      return u.levelExclusions.some(
        (lvl) =>
          lvl === sl ||
          (lvl === "Postgraduate" && isPostgradLevel(sl)) ||
          (lvl === "Undergraduate" && isUndergradOrPathway(sl))
      );
    }
    return false;
  }

  function isMutualRestriction(uA, uB) {
    if (!uA || !uB || uA.code === uB.code) return false;
    return (
      (uA.restrictedUnits || []).includes(uB.code) &&
      (uB.restrictedUnits || []).includes(uA.code)
    );
  }

  /**
   * Computes direct container effective cpMin/cpMax, resolving parent-child cpMin double-counting,
   * mutually-restricted pairs inside a single container (e.g. MDSC Core STAT210/STAT410),
   * and impossible cpMin > sum(non-repeatable compatible direct units).
   */
  function computeEffectiveContainerBounds(cont, unitItems, data) {
    const directSum = unitItems.reduce((s, x) => {
      const u = data && data.units ? data.units[x.code] : null;
      return s + (u && u.cp !== undefined && u.cp !== null ? u.cp : (x.cp ?? 6));
    }, 0);
    // Compute max compatible CP inside unitItems accounting for internal mutual restrictions (e.g. STAT210 <-> STAT410 in MDSC Core)
    let maxCompatibleDirectSum = directSum;
    if (data && data.units && unitItems.length >= 2) {
      const seenCompat = [];
      let compat = 0;
      for (const x of unitItems) {
        const u = data.units[x.code];
        const uCp = u && u.cp !== undefined && u.cp !== null ? u.cp : (x.cp ?? 6);
        const clashes = u && seenCompat.some((su) => isMutualRestriction(u, su));
        if (!clashes) {
          if (u) seenCompat.push(u);
          compat += uCp;
        }
      }
      maxCompatibleDirectSum = compat;
    }
    const hasRepeatableUnit = unitItems.some((x) => data && data.units && data.units[x.code]?.repeatable);
    const prose = parseContainerProseCp(cont.description || "", unitItems, data);

    let cpMin = cont.cpMin;
    let cpMax = cont.cpMax;

    // 1. If container cpMin is null or 0, infer from prose description
    if ((cpMin === null || cpMin === undefined || cpMin === 0) && prose.explicitProse) {
      cpMin = prose.min;
      if (cpMax === null || cpMax === undefined) cpMax = prose.max;
    }

    // 2. If container has unit-bearing children AND direct units, prevent parent-child double-counting
    const children = cont.children || [];
    const childUnitSum = (function sumChildMins(chList) {
      let s = 0;
      for (const ch of chList || []) {
        if (ch.isAdvancedStanding) continue;
        const chUnits = (ch.items || []).filter((i) => i.kind === "unit");
        const chProse = parseContainerProseCp(ch.description || "", chUnits, data);
        if (ch.cpMin && ch.cpMin > 0) {
          s += ch.cpMin;
        } else if (chProse.explicitProse && chProse.min > 0) {
          s += chProse.min;
        } else if (ch.children && ch.children.length) {
          if (isChooseOneContainer(ch)) {
            const optMins = ch.children.map((sub) => sub.cpMin || 0).filter((v) => v > 0);
            if (optMins.length) s += Math.min(...optMins);
          } else {
            s += sumChildMins(ch.children);
          }
        }
      }
      return s;
    })(children);

    if (children.length > 0 && unitItems.length > 0) {
      if (prose.explicitProse && prose.min !== null && (cpMin === null || cpMin === undefined || prose.min < cpMin)) {
        cpMin = prose.min;
        if (prose.max !== null) cpMax = prose.max;
      } else if (cpMin && childUnitSum > 0 && cpMin > maxCompatibleDirectSum) {
        cpMin = Math.min(maxCompatibleDirectSum, Math.max(0, cpMin - childUnitSum));
      } else if (cpMin && childUnitSum > 0 && (cpMin === directSum + childUnitSum || cpMin === maxCompatibleDirectSum + childUnitSum)) {
        cpMin = maxCompatibleDirectSum;
      }
    }

    // 3. A bucket with non-repeatable direct units cannot require more CP than its max compatible direct units!
    if (cpMin && maxCompatibleDirectSum > 0 && cpMin > maxCompatibleDirectSum && !prose.isTwice && !hasRepeatableUnit) {
      cpMin = maxCompatibleDirectSum;
    }

    // 4. Preserve explicit cpMax === 0; otherwise only default cpMax when sensible
    if (cpMax === undefined) cpMax = null;

    return { cpMin: cpMin ?? null, cpMax };
  }

  /**
   * Flattens an AOS container tree into structured display/validation buckets with exclusive-group tags.
   */
  function buildAOSBuckets(aosCode, category, labelPrefix, data, majorCoreHints, activeAdmissionRule) {
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

    const activeRuleLetters = activeAdmissionRule ? extractRuleLetters(activeAdmissionRule) : new Set();
    const out = [];
    let exclSeq = 0;

    function walkList(contList, parentTitle, inheritedExcl) {
      const siblingExclMap = new Map();
      if (!inheritedExcl) {
        assignSiblingExclusiveGroups(contList, `aos_${aosCode}_${++exclSeq}`, siblingExclMap);
      }

      for (const cont of contList || []) {
        if (cont.isAdvancedStanding) continue;
        // Skip AOS sub-containers scoped strictly to a DIFFERENT admission rule (e.g. MA02 Rule (a) when user is on Rule B)
        if (activeRuleLetters.size > 0) {
          const contRuleLetters = extractRuleLetters(cont.title);
          if (contRuleLetters.size > 0) {
            let overlaps = false;
            for (const rl of contRuleLetters) if (activeRuleLetters.has(rl)) overlaps = true;
            if (!overlaps) continue;
          }
        }

        const unitItems = (cont.items || []).filter((i) => i.kind === "unit");
        const isZeroCoreNote =
          cont.title.toLowerCase().includes("core") && !unitItems.length && !(cont.children || []).length;
        if (isZeroCoreNote) continue;

        const ownExcl = inheritedExcl || siblingExclMap.get(cont) || null;

        if (unitItems.length) {
          const { cpMin, cpMax } = computeEffectiveContainerBounds(cont, unitItems, data);
          out.push({
            id: `aos_${aosCode}_${cont.title}`,
            title: `${labelPrefix}: ${cont.title}`,
            shortTitle: cont.title,
            parentTitle: parentTitle || "",
            aosCode,
            aosTitle: aos.title,
            category,
            poolKind: cont.poolKind || null,
            cpMin,
            cpMax: cpMax !== null ? cpMax : (cpMin && cpMin > 0 ? cpMin : null),
            description: cont.description || "",
            units: unitItems.map((u) => u.code),
            exclusiveGroupId: ownExcl ? ownExcl.groupId : null,
            exclusiveOptionId: ownExcl ? ownExcl.optionId : null,
            exclusiveGroupTitle: ownExcl ? ownExcl.groupTitle : null,
          });
        }

        const children = cont.children || [];
        if (children.length) {
          if (!ownExcl && isChooseOneContainer(cont)) {
            const gid = `excl_aos_${aosCode}_${++exclSeq}`;
            children.forEach((ch, idx) => {
              walkList([ch], cont.title, {
                groupId: gid,
                optionId: `${gid}__opt_${idx}`,
                groupTitle: `${labelPrefix}: ${cont.title}`,
              });
            });
          } else {
            walkList(children, cont.title, ownExcl);
          }
        }
      }
    }

    walkList(aos.containers || [], "", null);
    return out;
  }

  /**
   * Resolves all active requirement buckets, unit attributions, exclusive groups, Major Core hints, and Major overlaps.
   */
  function resolveCurriculumBuckets(course, plan, data) {
    const cfg = course.structureConfig;
    const advCp = getAdvancedStandingCp(course, plan.admissionRule);
    const majorCoreHints = { mandatory: {}, choiceGroups: [] };
    const buckets = [];

    // 1. Pre-scan selected Majors/Minors first so majorCoreHints are populated BEFORE building Core buckets!
    const activeAOSBuckets = [];
    const aosOptions = getAvailableAOSOptions(course, plan, data);
    const selectedDynamicGroups = new Set();

    if (cfg.aosMode === "mandatory_components") {
      aosOptions.mandatoryComponents.forEach((comp, idx) => {
        activeAOSBuckets.push(
          ...buildAOSBuckets(comp.code, idx === 0 ? "major1" : "minor", comp.title, data, majorCoreHints, plan.admissionRule)
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
          selectedDynamicGroups.add(grp.id);
          const aObj = data.aos[chosenCode];
          const cleanName = (grp.items.find((x) => x.code === chosenCode)?.title || aObj.title)
            .replace(/^[A-Z0-9]+\s*-\s*/, "")
            .replace(/\s*\((Major|Minor)\)\s*$/i, "")
            .trim();
          const isListedFocus = /listed unit/i.test(grp.title) || /listed unit/i.test(cleanName) || chosenCode === "LAWLIST01";
          const cat = isListedFocus ? "listed" : grp.isMinor ? "minor" : majorSlotIdx === 0 ? "major1" : "major2";
          if (!grp.isMinor && !isListedFocus) majorSlotIdx++;
          activeAOSBuckets.push(
            ...buildAOSBuckets(chosenCode, cat, `${grp.title} (${cleanName})`, data, majorCoreHints, plan.admissionRule)
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
              majorCoreHints,
              plan.admissionRule
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
          ...buildAOSBuckets(plan.selectedMinor, "minor", `${roleLabel} (${cleanMinName})`, data, majorCoreHints, plan.admissionRule)
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
          const directCp = directUnits.reduce((s, x) => {
            const u = data.units[x.code];
            return s + (u && u.cp !== undefined && u.cp !== null ? u.cp : (x.cp ?? 6));
          }, 0);
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
    let parsedElectiveCap = null;
    let courseExclSeq = 0;

    function walkCourseList(contList, parentTitle, inheritedExcl, parentHasSelectedMinor) {
      const siblingExclMap = new Map();
      if (!inheritedExcl) {
        assignSiblingExclusiveGroups(contList, `course_${course.code}_${++courseExclSeq}`, siblingExclMap);
      }

      for (const cont of contList || []) {
        if (cont.isAdvancedStanding) continue;
        const vgLow = (cont.vg || "").toLowerCase();
        const titleLow = cont.title.toLowerCase();
        const descLow = (cont.description || "").toLowerCase();

        const hasUnitItems = (cont.items || []).some((i) => i.kind === "unit");
        const hasAosItems = (cont.items || []).some((i) => i.kind === "aos");
        const children = cont.children || [];
        const thisHasSelectedMinor = parentHasSelectedMinor || selectedDynamicGroups.has(cont.title);

        if (vgLow === "elective" || titleLow.includes("elective")) {
          hasExplicitElectiveContainer = true;
          // Retain Elective container CP cap from metadata or prose (36 courses)
          let eCap = null;
          if (cont.cpMax !== null && cont.cpMax !== undefined) eCap = cont.cpMax;
          else if (cont.cpMin !== null && cont.cpMin !== undefined && cont.cpMin > 0) eCap = cont.cpMin;
          const proseE = parseContainerProseCp(cont.description || "", [], data);
          if (proseE.explicitProse) {
            if (proseE.max !== null && proseE.max !== undefined) {
              eCap = eCap !== null ? Math.max(eCap, proseE.max) : proseE.max;
            } else if (proseE.min !== null && eCap === null) {
              eCap = proseE.min;
            }
          }
          if (eCap !== null && !thisHasSelectedMinor) {
            parsedElectiveCap = parsedElectiveCap === null ? eCap : Math.max(parsedElectiveCap, eCap);
          }
        }

        // Skip pure AOS selector containers' own bucket creation, BUT ALWAYS walk their children
        // (fixes BESLAW dropping child BEnvSc - Listed Units [10 units], and BANSC/BAGR/BENSC/BESMNR Electives!)
        const isPureAosContainer =
          (hasAosItems && !hasUnitItems) ||
          vgLow === "major" ||
          (vgLow === "minor" && !hasUnitItems) ||
          (cfg.aosMode === "dscnce" && titleLow.includes("general studies in science or minor"));

        const ownExcl = inheritedExcl || siblingExclMap.get(cont) || null;

        if (!isPureAosContainer && hasUnitItems) {
          const unitItems = (cont.items || []).filter((i) => i.kind === "unit");
          let cat = "listed";
          if (vgLow === "core" || titleLow.includes("core")) cat = "core";
          else if (titleLow.includes("capstone") || titleLow.includes("research") || titleLow.includes("project")) cat = "capstone";
          else if (vgLow === "elective" || titleLow.includes("elective")) cat = "elective";

          let { cpMin, cpMax } = computeEffectiveContainerBounds(cont, unitItems, data);

          // If this listed container is an alternative when a Minor is NOT chosen (e.g. BESLAW BEnvSc - Listed Units)
          // and the student HAS selected that Minor, make this container optional!
          if (parentHasSelectedMinor && /if a minor is not chosen/i.test(descLow)) {
            cpMin = null;
          }

          buckets.push({
            id: `course_${cont.title}`,
            title: parentTitle && !cont.title.startsWith(parentTitle) ? `${cont.title}` : cont.title,
            shortTitle: cont.title,
            parentTitle: parentTitle || "",
            category: cat,
            poolKind: cont.poolKind || null,
            cpMin,
            cpMax: cpMax !== null ? cpMax : (cat === "core" && cpMin !== null ? cpMin : null),
            description: cont.description || "",
            units: unitItems.map((u) => u.code),
            exclusiveGroupId: ownExcl ? ownExcl.groupId : null,
            exclusiveOptionId: ownExcl ? ownExcl.optionId : null,
            exclusiveGroupTitle: ownExcl ? ownExcl.groupTitle : null,
          });
        }

        if (children.length) {
          if (!ownExcl && !isPureAosContainer && isChooseOneContainer(cont)) {
            const gid = `excl_course_${course.code}_${++courseExclSeq}`;
            children.forEach((ch, idx) => {
              walkCourseList(
                [ch],
                cont.title,
                {
                  groupId: gid,
                  optionId: `${gid}__opt_${idx}`,
                  groupTitle: cont.title,
                },
                thisHasSelectedMinor
              );
            });
          } else {
            walkCourseList(children, cont.title, ownExcl, thisHasSelectedMinor);
          }
        }
      }
    }

    walkCourseList(sourceContainers, "", null, false);

    // Insert Major / Minor buckets right after Core buckets
    const coreBuckets = buckets.filter((b) => b.category === "core");
    const nonCoreBuckets = buckets.filter((b) => b.category !== "core");

    // Special BSC Listed Units enrichment:
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

    // Adjust Elective / Listed caps for special courses, otherwise retain parsedElectiveCap!
    let electiveCap = parsedElectiveCap;
    if (course.code === "BSC") {
      if (plan.aosStructure === "2m") electiveCap = 18;
      else electiveCap = 36;
    } else if (course.code === "BCOMP") {
      if (plan.aosStructure === "opt1") electiveCap = 42;
      else if (plan.aosStructure === "opt2") electiveCap = 18;
      else electiveCap = 0;
    } else if (course.code === "BBIOSC") {
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
          exclusiveGroupId: null,
          exclusiveOptionId: null,
          exclusiveGroupTitle: null,
        });
      }
    }

    // Ensure 100% unique bucket IDs across all courses & AOS (fixes BMCLAW, BSCST, DIT, MSLM1, PRDC, COUPAT001/002)
    const seenBucketIds = new Map();
    for (const b of orderedBuckets) {
      let candId = b.id;
      if (seenBucketIds.has(candId)) {
        if (b.parentTitle) {
          candId = `${b.id}__${b.parentTitle}`;
        }
        if (seenBucketIds.has(candId)) {
          const n = (seenBucketIds.get(b.id) || 1) + 1;
          seenBucketIds.set(b.id, n);
          candId = `${candId}__${n}`;
        }
      }
      seenBucketIds.set(candId, 1);
      b.id = candId;
    }

    // 3. Attribute planned units on the board to buckets in 100% BOARD-POSITION-INDEPENDENT order!
    //    (Dragging GEOL110 between Y1 T1 and Y1 T3 will NEVER change its attributed bucket or Core/Listed badge!)
    const placements = getPlannedPlacements(plan, data);
    const plannedUnitPlacements = placements.filter((p) => p.type === "unit");
    const attributedBucketByCode = {};
    const unitBucketMap = {};
    const attributedSlotsSeen = new Set();
    for (const b of orderedBuckets) {
      b.plannedUnits = [];
      b.plannedCp = 0;
      b.placeholderCount = 0;
      b.placeholderCp = 0;
    }

    // Track informational placeholder allocation per bucket (does NOT affect plannedCp or completion status)
    {
      const bById = new Map(orderedBuckets.map((b) => [b.id, b]));
      for (const p of placements) {
        if (p.type === "placeholder" && p.slot.bucketId && bById.has(p.slot.bucketId)) {
          const tb = bById.get(p.slot.bucketId);
          tb.placeholderCount++;
          tb.placeholderCp += p.cp ?? 6;
        }
      }
    }

    // Pre-identify best-matching option per exclusiveGroup based on the student's planned units
    // so shared units (like COSC591 in both MDSC Major Thesis & Research Project!) attribute to the student's active option!
    const plannedCodeSetForExcl = new Set(plannedUnitPlacements.map((p) => p.code));
    const preferredExclusiveOption = new Map();
    {
      const tmpGroups = new Map();
      for (const b of orderedBuckets) {
        if (!b.exclusiveGroupId) continue;
        if (!tmpGroups.has(b.exclusiveGroupId)) tmpGroups.set(b.exclusiveGroupId, new Map());
        const om = tmpGroups.get(b.exclusiveGroupId);
        if (!om.has(b.exclusiveOptionId)) om.set(b.exclusiveOptionId, []);
        om.get(b.exclusiveOptionId).push(b);
      }
      for (const [gid, optMap] of tmpGroups.entries()) {
        let bestOpt = null;
        let bestRank = -1;
        for (const [optId, optBuckets] of optMap.entries()) {
          let allSat = true;
          let matchedCp = 0;
          for (const b of optBuckets) {
            let bCp = 0;
            for (const uc of b.units) {
              if (plannedCodeSetForExcl.has(uc)) {
                const uObj = getUnit(uc, data, plan.customUnits);
                bCp += uObj?.cp ?? 6;
              }
            }
            matchedCp += bCp;
            if (b.cpMin && bCp < b.cpMin) allSat = false;
          }
          const rank = (allSat ? 10000 : 0) + matchedCp;
          if (rank > bestRank) {
            bestRank = rank;
            bestOpt = optId;
          }
        }
        if (bestOpt) preferredExclusiveOption.set(gid, bestOpt);
      }
    }

    // Priority attribution: Core -> Major 1 -> Major 2 -> Minor -> Capstone -> Listed -> Elective
    // Within the same category, prefer active exclusive-option buckets & explicit cpMin > 0 ahead of optional/inactive buckets!
    const priorityOrder = ["core", "major1", "major2", "minor", "capstone", "listed", "elective"];
    const bucketsByPriority = [...orderedBuckets].sort((a, b) => {
      const catDiff = priorityOrder.indexOf(a.category) - priorityOrder.indexOf(b.category);
      if (catDiff !== 0) return catDiff;
      const aInactiveExcl = a.exclusiveGroupId && preferredExclusiveOption.get(a.exclusiveGroupId) !== a.exclusiveOptionId ? 1 : 0;
      const bInactiveExcl = b.exclusiveGroupId && preferredExclusiveOption.get(b.exclusiveGroupId) !== b.exclusiveOptionId ? 1 : 0;
      if (aInactiveExcl !== bInactiveExcl) return aInactiveExcl - bInactiveExcl;
      const aReq = a.cpMin && a.cpMin > 0 ? 0 : 1;
      const bReq = b.cpMin && b.cpMin > 0 ? 0 : 1;
      return aReq - bReq;
    });

    // Collect deduplicated planned units and sort deterministically by curriculum role + constraint + code
    // (ZERO reliance on slot chrono/trimester/year position!)
    const majorChoiceCodes = new Set();
    for (const grp of majorCoreHints.choiceGroups || []) {
      for (const c of grp.codes || []) majorChoiceCodes.add(c);
    }

    const dedupedUnitEntries = [];
    const instanceCountByCode = {};
    for (const p of plannedUnitPlacements) {
      const isRepeatable = Boolean(p.unit && p.unit.repeatable);
      const dedupeKey = isRepeatable ? p : p.code;
      if (attributedSlotsSeen.has(dedupeKey)) continue;
      attributedSlotsSeen.add(dedupeKey);

      const matchingNonElective = bucketsByPriority.filter(
        (b) =>
          b.category !== "elective" &&
          b.units.includes(p.code) &&
          (!b.exclusiveGroupId || preferredExclusiveOption.get(b.exclusiveGroupId) === b.exclusiveOptionId)
      );
      const idxForCode = instanceCountByCode[p.code] || 0;
      instanceCountByCode[p.code] = idxForCode + 1;

      dedupedUnitEntries.push({
        code: p.code,
        cp: p.cp,
        isMajorCoreMandatory: Boolean(majorCoreHints.mandatory[p.code]),
        isMajorCoreChoice: majorChoiceCodes.has(p.code),
        matchCount: matchingNonElective.length,
        bestCatRank: matchingNonElective.length > 0 ? priorityOrder.indexOf(matchingNonElective[0].category) : 99,
        instanceIdx: idxForCode,
      });
    }

    dedupedUnitEntries.sort((a, b) => {
      if (a.isMajorCoreMandatory !== b.isMajorCoreMandatory) return a.isMajorCoreMandatory ? -1 : 1;
      if (a.isMajorCoreChoice !== b.isMajorCoreChoice) return a.isMajorCoreChoice ? -1 : 1;
      const aSingle = a.matchCount === 1 ? 0 : 1;
      const bSingle = b.matchCount === 1 ? 0 : 1;
      if (aSingle !== bSingle) return aSingle - bSingle;
      if (a.matchCount !== b.matchCount) return a.matchCount - b.matchCount;
      if (a.bestCatRank !== b.bestCatRank) return a.bestCatRank - b.bestCatRank;
      const codeCmp = a.code.localeCompare(b.code);
      if (codeCmp !== 0) return codeCmp;
      return a.instanceIdx - b.instanceIdx;
    });

    const BADGE_ROLE_MAP = {
      core: "Core",
      major1: "Major",
      major2: "Major",
      minor: "Minor",
      capstone: "Capstone",
      listed: "Listed",
      elective: "Elective",
    };

    for (const entry of dedupedUnitEntries) {
      let matched = null;
      // First pass: prefer bucket that contains entry.code AND hasn't hit cpMax yet (properly handling cpMax === 0!)
      for (const b of bucketsByPriority) {
        if (b.category === "elective") continue;
        if (b.units.includes(entry.code)) {
          const hasCap = b.cpMax !== null && b.cpMax !== undefined;
          if (!hasCap || b.plannedCp + entry.cp <= b.cpMax) {
            matched = b;
            break;
          }
        }
      }
      // Second pass: any non-elective bucket containing entry.code
      if (!matched) {
        for (const b of bucketsByPriority) {
          if (b.category !== "elective" && b.units.includes(entry.code)) {
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
            placeholderCount: 0,
            placeholderCp: 0,
            exclusiveGroupId: null,
            exclusiveOptionId: null,
            exclusiveGroupTitle: null,
          };
          orderedBuckets.push(matched);
        }
      }
      matched.plannedUnits.push(entry.code);
      matched.plannedCp += entry.cp;
      attributedBucketByCode[entry.code] = matched.id;
      if (!unitBucketMap[entry.code]) {
        unitBucketMap[entry.code] = {
          bucketId: matched.id,
          bucketTitle: matched.title,
          shortTitle: matched.shortTitle || matched.title,
          category: matched.category,
          badgeRole: BADGE_ROLE_MAP[matched.category] || "Elective",
        };
      }
    }

    // Compute exclusive-group completion status so mutually-exclusive options validate cleanly
    const exclusiveGroups = new Map(); // groupId -> { id, title, options: Map<optionId, buckets[]>, satisfied, winningOptionId }
    for (const b of orderedBuckets) {
      if (!b.exclusiveGroupId) continue;
      if (!exclusiveGroups.has(b.exclusiveGroupId)) {
        exclusiveGroups.set(b.exclusiveGroupId, {
          id: b.exclusiveGroupId,
          title: b.exclusiveGroupTitle || "Option Group",
          options: new Map(),
          satisfied: false,
          winningOptionId: null,
        });
      }
      const grp = exclusiveGroups.get(b.exclusiveGroupId);
      if (!grp.options.has(b.exclusiveOptionId)) grp.options.set(b.exclusiveOptionId, []);
      grp.options.get(b.exclusiveOptionId).push(b);
    }

    for (const grp of exclusiveGroups.values()) {
      let bestOptId = null;
      let bestOptCp = -1;
      for (const [optId, optBuckets] of grp.options.entries()) {
        const optMet = optBuckets.every(
          (b) =>
            (!b.cpMin || b.plannedCp >= b.cpMin) &&
            (b.cpMax === null || b.cpMax === undefined || b.plannedCp <= b.cpMax)
        );
        const optCp = optBuckets.reduce((s, b) => s + b.plannedCp, 0);
        if (optMet && !grp.satisfied) {
          grp.satisfied = true;
          grp.winningOptionId = optId;
        }
        if (optCp > bestOptCp) {
          bestOptCp = optCp;
          bestOptId = optId;
        }
      }
      if (!grp.winningOptionId) grp.winningOptionId = bestOptId;
    }

    // Compute bucket completion status (fixing cpMax === 0 falsy bug & marking unselected exclusive options optional)
    for (const b of orderedBuckets) {
      const hasCap = b.cpMax !== null && b.cpMax !== undefined;
      if (hasCap && b.plannedCp > b.cpMax) {
        b.status = "over";
      } else if (b.exclusiveGroupId) {
        const grp = exclusiveGroups.get(b.exclusiveGroupId);
        if (grp && grp.satisfied && b.exclusiveOptionId !== grp.winningOptionId) {
          b.status = "optional";
        } else if (b.cpMin && b.plannedCp >= b.cpMin) {
          b.status = "complete";
        } else if (grp && !grp.satisfied && b.exclusiveOptionId !== grp.winningOptionId && b.plannedCp === 0) {
          b.status = "optional";
        } else if (b.cpMin && b.plannedCp < b.cpMin) {
          b.status = "in_progress";
        } else {
          b.status = "optional";
        }
      } else if (b.cpMin && b.plannedCp >= b.cpMin) {
        b.status = "complete";
      } else if (b.cpMin && b.plannedCp < b.cpMin) {
        b.status = "in_progress";
      } else {
        b.status = "optional";
      }
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
      exclusiveGroups: Array.from(exclusiveGroups.values()),
      attributedBucketByCode,
      unitBucketMap,
      advancedStandingCp: advCp,
      majorCoreHints,
      majorOverlapUnits,
      incompatiblePairWarning,
      aosOptions,
    };
  }

  /**
   * Resolves the bounded candidate unit codes represented by a typed placeholder slot.
   */
  function getPlaceholderChoicePool(slot, bucketById) {
    if (!slot || slot.type !== "placeholder") return [];
    if (slot.strictHints && Array.isArray(slot.hintCodes) && slot.hintCodes.length > 0) {
      return slot.hintCodes;
    }
    if (slot.bucketId && bucketById && bucketById.has(slot.bucketId)) {
      const b = bucketById.get(slot.bucketId);
      if (b && Array.isArray(b.units) && b.units.length > 0) return b.units;
    }
    if (Array.isArray(slot.hintCodes) && slot.hintCodes.length > 0) {
      return slot.hintCodes;
    }
    return [];
  }

  /**
   * Returns true iff EVERY choice combination from relevant bounded prior placeholders
   * satisfies evalPrereqTokens(tokens, baseUnits U combo) — e.g. Core Maths [MTHS110/MTHS120]
   * guarantees satisfying (MTHS110 OR MTHS120) without forcing an arbitrary concrete pick!
   */
  function arePrereqTokensGuaranteedByPlaceholders(tokens, pmCodes, baseUnits, priorPlaceholders) {
    if (!tokens || !tokens.length || !priorPlaceholders || !priorPlaceholders.length) return false;
    if (evalPrereqTokens(tokens, baseUnits)) return true;
    const codeSet = new Set(pmCodes || []);
    const relevant = [];
    for (const ph of priorPlaceholders) {
      const pool = ph.choicePool || [];
      if (pool.length === 0 || pool.length > 8) continue;
      if (pool.some((c) => codeSet.has(c))) {
        relevant.push(pool);
      }
    }
    if (!relevant.length) return false;

    for (const pool of relevant) {
      if (
        pool.every((c) => {
          const s = new Set(baseUnits);
          s.add(c);
          return evalPrereqTokens(tokens, s);
        })
      ) {
        return true;
      }
    }
    if (relevant.length >= 2) {
      const lim = Math.min(relevant.length, 4);
      for (let i = 0; i < lim; i++) {
        for (let j = i + 1; j < lim; j++) {
          let allOk = true;
          for (const c1 of relevant[i]) {
            for (const c2 of relevant[j]) {
              const s = new Set(baseUnits);
              s.add(c1);
              s.add(c2);
              if (!evalPrereqTokens(tokens, s)) {
                allOk = false;
                break;
              }
            }
            if (!allOk) break;
          }
          if (allOk) return true;
        }
      }
    }
    return false;
  }

  /**
   * Evaluates every unit placement on the board for year-aware trimester offerings, rolling-start units,
   * per-trimester modes, year-aware intensives (2027 confirmed vs 2028+ indicative guide),
   * repeatable units, restrictions, course exclusions, co-requisites, and prerequisites.
   */
  function evaluateAllPlacements(course, plan, data, advCp, resolvedBucketsOpt) {
    const placements = getPlannedPlacements(plan, data);
    const unitPlacements = placements.filter((p) => p.type === "unit");
    const bucketById = Array.isArray(resolvedBucketsOpt)
      ? new Map(resolvedBucketsOpt.map((b) => [b.id, b]))
      : null;
    const allCodes = new Set(unitPlacements.map((p) => p.code));
    const codeCounts = {};
    for (const p of unitPlacements) codeCounts[p.code] = (codeCounts[p.code] || 0) + 1;
    const maxPlannedChrono = placements.reduce((m, x) => Math.max(m, x.chrono), 0);
    const unitChronosByCode = new Map();
    for (const x of unitPlacements) {
      if (!unitChronosByCode.has(x.code)) unitChronosByCode.set(x.code, []);
      unitChronosByCode.get(x.code).push(x.chrono);
    }

    const resultsBySlotId = {};

    for (const p of placements) {
      if (p.type !== "unit") {
        resultsBySlotId[p.slot.id] = {
          errors: [],
          warnings: [],
          infos: [],
          intensiveAlerts: [],
          intensiveClashes: [],
          intensiveGuides: [],
          historicalIntensiveClashes: [],
          rollingStartInfos: [],
          softModeWarnings: [],
        };
        continue;
      }
      const errors = [];
      const warnings = [];
      const softModeWarnings = [];
      const infos = [];
      const intensiveAlerts = [];
      const intensiveClashes = [];
      const intensiveGuides = [];
      const historicalIntensiveClashes = [];
      const rollingStartInfos = [];
      const u = p.unit;
      const planYear = p.planYear || 2027;

      if (codeCounts[p.code] > 1) {
        if (u && u.repeatable) {
          infos.push(`Repeatable unit (${p.code} may be taken more than once).`);
        } else {
          errors.push(`Duplicate unit: ${p.code} appears more than once in your plan.`);
        }
      }

      if (!u) {
        warnings.push("Custom/unlisted unit — verify handbook offering & prerequisites.");
        resultsBySlotId[p.slot.id] = {
          errors,
          warnings,
          infos,
          intensiveAlerts,
          intensiveClashes,
          intensiveGuides,
          historicalIntensiveClashes,
          rollingStartInfos,
          softModeWarnings,
        };
        continue;
      }

      // Year-aware offering, rolling-start (2028/2029), and odd/even offering-cycle checks
      if (u.offered2027 === false) {
        if (u.rollingStartYear && planYear >= u.rollingStartYear) {
          const indTris = Array.isArray(u.indicativeTrimesters) ? u.indicativeTrimesters : [];
          if (u.offeringCycle === "even" && planYear % 2 !== 0) {
            warnings.push(
              `${p.code} runs in even-numbered years only (${planYear} is odd — move to ${planYear + 1} or verify offering).`
            );
          } else if (indTris.length > 0 && !indTris.includes(p.triNum)) {
            warnings.push(
              `${p.code} is indicatively scheduled in T${indTris.join(", T")} (rolling-start from ${u.rollingStartYear} — verify ${planYear} offering when published).`
            );
          }
          const indSuffix = indTris.length > 0 ? ` (indicative: T${indTris.join(", T")})` : "";
          if (u.offeringCycle === "even") {
            rollingStartInfos.push(`Even-year offering — ${planYear} trimester TBA${indSuffix}`);
          } else {
            rollingStartInfos.push(`Indicative start in ${u.rollingStartYear} — ${planYear} trimester TBA${indSuffix}`);
          }
        } else if (u.rollingStartYear && planYear < u.rollingStartYear) {
          errors.push(
            `${p.code} has an indicative start in ${u.rollingStartYear} and cannot be scheduled in ${planYear}.`
          );
        } else {
          errors.push(`${p.code} · ${getNoOfferingLabel(u)}.`);
        }
      } else {
        if (u.offeringCycle === "odd" && planYear % 2 === 0) {
          warnings.push(
            `${p.code} is offered in odd-numbered years only (${planYear} is even — verify offering or move to ${planYear - 1}/${planYear + 1}).`
          );
        } else if (u.offeringCycle === "even" && planYear % 2 !== 0) {
          warnings.push(
            `${p.code} is offered in even-numbered years only (${planYear} is odd — verify offering).`
          );
        } else if (u.offeringCycle === "alternate" && planYear % 2 === 0) {
          warnings.push(
            `${p.code} is offered in alternate years (published for 2027 — verify ${planYear} offering before enrolling).`
          );
        }
        if (u.trimesters && u.trimesters.length > 0 && !u.trimesters.includes(p.triNum)) {
          errors.push(`${p.code} · ${getSlotPeriodMismatch(u, p.triNum, planYear)}`);
        }
      }

      if (u.t3RepeatOnly && p.triNum === 3) {
        warnings.push(`${p.code} Trimester 3 is for repeating students only (requires Head of School permission).`);
      }

      // Per-trimester attendance mode check (soft preference warning — never blocks isAwardReady)
      const triModes = getUnitModesForTri(u, p.triNum);
      if (triModes.length > 0 && plan.preferredMode && !triModes.includes(plan.preferredMode)) {
        const msg = `${p.code} is offered ${triModes.join(" / ")} only in Trimester ${p.triNum} (your preference is ${plan.preferredMode}).`;
        warnings.push(msg);
        softModeWarnings.push(msg);
      }

      // Year-aware Intensive School check (2027 confirmed dates/TBA vs 2028+ indicative 2027 guide!)
      const intInfo = getUnitIntensiveForTri(u, p.triNum, plan.preferredMode, planYear);
      if (intInfo && intInfo.kind === "Mandatory") {
        if (!intInfo.applicableForMode) {
          infos.push("Mandatory Intensive applies to Online students only (not required On Campus).");
        } else {
          const locPart = intInfo.location ? ` · ${intInfo.location}` : "";
          if (intInfo.isHistoricalGuide) {
            if (!intInfo.tba && intInfo.dates.length > 0) {
              const dateStr =
                intInfo.dates.length > 1
                  ? intInfo.multiCohort
                    ? `${intInfo.dates.join(" / ")} (cohort-dependent)`
                    : intInfo.dates.join(" · ")
                  : intInfo.dates[0];
              intensiveGuides.push(
                `Mandatory Intensive${locPart} — ${planYear} dates TBA (2027 draft guide: ${dateStr})`
              );
            } else {
              intensiveGuides.push(
                `Mandatory Intensive${locPart} — ${planYear} dates TBA (check when ${planYear} timetable is published)`
              );
            }
          } else {
            if (intInfo.tba) {
              intensiveAlerts.push(`Mandatory Intensive${locPart} — 2027 Dates TBA (check dates)`);
            } else {
              const dateStr =
                intInfo.dates.length > 1
                  ? intInfo.multiCohort
                    ? `${intInfo.dates.join(" / ")} (cohort-dependent)`
                    : intInfo.dates.join(" · ")
                  : intInfo.dates[0];
              infos.push(`Mandatory Intensive: ${dateStr} (draft)${locPart}`);
              if (intInfo.mixedTba) {
                intensiveAlerts.push(`Mandatory Intensive${locPart} — additional 2027 session date(s) TBA`);
              }
            }
          }
        }
      }
      // Allow Year-Long info badge to coexist alongside Mandatory Intensive badge!
      if (u.yearLong) {
        infos.push("Year-Long / Multi-Period Unit");
      }

      // Prior & same-or-prior completed sets (using ?? 6 so 0-CP units stay 0 CP!)
      const priorUnits = new Set();
      const sameOrPriorUnits = new Set();
      const priorBoundedPlaceholders = [];
      let priorCp = advCp || 0;
      let sameOrPriorCp = advCp || 0;
      const priorPrefixCp = {};
      const sameOrPriorPrefixCp = {};
      const priorLevelCp = {};
      const sameOrPriorLevelCp = {};
      const priorPrefixLevelCp = {};
      const sameOrPriorPrefixLevelCp = {};
      const priorUnitCpMap = new Map();
      const sameOrPriorUnitCpMap = new Map();

      for (const other of placements) {
        if (other.slot.id === p.slot.id) continue;
        const oCp = other.cp ?? 6;
        if (other.chrono < p.chrono) {
          priorCp += oCp;
          sameOrPriorCp += oCp;
          if (other.type === "unit") {
            priorUnits.add(other.code);
            sameOrPriorUnits.add(other.code);
            priorUnitCpMap.set(other.code, oCp);
            sameOrPriorUnitCpMap.set(other.code, oCp);
            const pref = other.unit?.prefix || "";
            const lvl = other.unit?.level ?? 100;
            priorLevelCp[lvl] = (priorLevelCp[lvl] || 0) + oCp;
            sameOrPriorLevelCp[lvl] = (sameOrPriorLevelCp[lvl] || 0) + oCp;
            if (pref) {
              priorPrefixCp[pref] = (priorPrefixCp[pref] || 0) + oCp;
              sameOrPriorPrefixCp[pref] = (sameOrPriorPrefixCp[pref] || 0) + oCp;
              const plk = `${pref}_${lvl}`;
              priorPrefixLevelCp[plk] = (priorPrefixLevelCp[plk] || 0) + oCp;
              sameOrPriorPrefixLevelCp[plk] = (sameOrPriorPrefixLevelCp[plk] || 0) + oCp;
            }
          } else if (other.type === "placeholder") {
            const phPool = getPlaceholderChoicePool(other.slot, bucketById);
            let creditedLevel = false;
            if (phPool.length > 0) {
              priorBoundedPlaceholders.push({ slot: other.slot, choicePool: phPool });
              // If all units in this bounded placeholder share a single level or prefix, reflect that in prior counts
              const poolUnits = phPool.map((c) => getUnit(c, data, plan.customUnits)).filter(Boolean);
              if (poolUnits.length > 0) {
                const lvls = new Set(poolUnits.map((x) => x.level ?? 100));
                if (lvls.size === 1) {
                  const l0 = poolUnits[0].level ?? 100;
                  priorLevelCp[l0] = (priorLevelCp[l0] || 0) + oCp;
                  sameOrPriorLevelCp[l0] = (sameOrPriorLevelCp[l0] || 0) + oCp;
                  creditedLevel = true;
                }
                const prefs = new Set(poolUnits.map((x) => x.prefix || "").filter(Boolean));
                if (prefs.size === 1) {
                  const pr0 = poolUnits[0].prefix;
                  priorPrefixCp[pr0] = (priorPrefixCp[pr0] || 0) + oCp;
                  sameOrPriorPrefixCp[pr0] = (sameOrPriorPrefixCp[pr0] || 0) + oCp;
                  if (lvls.size === 1) {
                    const plk = `${pr0}_${poolUnits[0].level ?? 100}`;
                    priorPrefixLevelCp[plk] = (priorPrefixLevelCp[plk] || 0) + oCp;
                    sameOrPriorPrefixLevelCp[plk] = (sameOrPriorPrefixLevelCp[plk] || 0) + oCp;
                  }
                }
              }
            }
            if (!creditedLevel && Array.isArray(other.slot.allowedLevels) && other.slot.allowedLevels.length === 1) {
              const l0 = other.slot.allowedLevels[0];
              priorLevelCp[l0] = (priorLevelCp[l0] || 0) + oCp;
              sameOrPriorLevelCp[l0] = (sameOrPriorLevelCp[l0] || 0) + oCp;
            }
          }
        } else if (other.chrono === p.chrono) {
          sameOrPriorCp += oCp;
          if (other.type === "unit") {
            sameOrPriorUnits.add(other.code);
            sameOrPriorUnitCpMap.set(other.code, oCp);
            const pref = other.unit?.prefix || "";
            const lvl = other.unit?.level ?? 100;
            sameOrPriorLevelCp[lvl] = (sameOrPriorLevelCp[lvl] || 0) + oCp;
            if (pref) {
              sameOrPriorPrefixCp[pref] = (sameOrPriorPrefixCp[pref] || 0) + oCp;
              const plk = `${pref}_${lvl}`;
              sameOrPriorPrefixLevelCp[plk] = (sameOrPriorPrefixLevelCp[plk] || 0) + oCp;
            }
          }
        }
      }

      // Course & Study-Level Exclusion Restrictions (e.g. CHEM100 in BPHARM/HBPH1, LSU100 in LLB, WORK300/500, HLTH101-104 in PG, ZOOL310 in BENSC, ENSC410 in BZOOL)
      if (isUnitExcludedForCourse(u, course)) {
        errors.push(
          `Not available in ${course.code}${u.courseExclusionNote ? ` (${u.courseExclusionNote})` : " (course/level exclusion restriction)"}.`
        );
      }

      // Directional / Mutual Restriction check
      const triggeredRestrictions = [];
      for (const rCode of u.restrictedUnits || []) {
        if (rCode === p.code) continue;
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

      // Co-requisites (supports course-scoped branches, CP/prefixCp/minUnitsFrom, and tokens)
      const sameOrPriorCtx = {
        units: sameOrPriorUnits,
        cp: sameOrPriorCp,
        prefixCp: sameOrPriorPrefixCp,
        levelCp: sameOrPriorLevelCp,
        prefixLevelCp: sameOrPriorPrefixLevelCp,
        unitCpMap: sameOrPriorUnitCpMap,
        course,
        plan,
      };
      const coreqRes = evaluateCoreqMeta(u, sameOrPriorCtx, "concurrently or earlier");
      for (const cw of coreqRes.warnings) warnings.push(cw);

      // Prerequisites (supports study-level guards, pgWaiver, OR vs AND, alternatives, levelCp, prefixCp.levels, minUnitsFrom,
      // AND guaranteed satisfaction via bounded prior choice placeholders like Core Maths [MTHS110/MTHS120] or [BIOL110/PSIO110]!)
      const inCourseBuckets = isUnitInCourseBuckets(p.code, course, plan, data);
      const priorCtx = {
        units: priorUnits,
        cp: priorCp,
        prefixCp: priorPrefixCp,
        levelCp: priorLevelCp,
        prefixLevelCp: priorPrefixLevelCp,
        unitCpMap: priorUnitCpMap,
        course,
        plan,
      };
      const prereqRes = evaluatePrereqMeta(u, priorCtx, inCourseBuckets, "prior to this trimester");
      for (const pe of prereqRes.errors) errors.push(pe);
      const pm = u.prereqMeta;
      const tokensGuaranteedByPh =
        prereqRes.warnings.length > 0 &&
        pm &&
        pm.tokens &&
        pm.tokens.length > 0 &&
        priorBoundedPlaceholders.length > 0 &&
        arePrereqTokensGuaranteedByPlaceholders(pm.tokens, pm.codes, priorUnits, priorBoundedPlaceholders);
      if (tokensGuaranteedByPh) {
        for (const pw of prereqRes.warnings) {
          if (/^(Missing prerequisite|Prerequisite not satisfied|Required units not satisfied)/i.test(pw)) {
            infos.push(`Prerequisite covered by your planned earlier choice slot (fill open choice slot to confirm).`);
          } else {
            warnings.push(pw);
          }
        }
      } else {
        for (const pw of prereqRes.warnings) warnings.push(pw);
      }
      for (const pi of prereqRes.infos) infos.push(pi);

      // Placement advisories from Handbook planningNotes (final-trimester capstones, gap & consecutive sequence rules)
      for (const pn of u.planningNotes || []) {
        if (pn.type === "capstone_final_tri" && maxPlannedChrono > 0 && p.chrono < maxPlannedChrono) {
          warnings.push(
            `${p.code} must be taken in your final trimester of study (currently placed before your last planned trimester).`
          );
        } else if (pn.type === "gap_rule" && p.code === "HLTH301" && unitChronosByCode.has("HLTH201")) {
          if (!unitChronosByCode.get("HLTH201").some((c) => p.chrono - c >= 2)) {
            warnings.push("Accreditation requires at least one trimester gap between HLTH201 and HLTH301.");
          }
        } else if (pn.type === "consecutive_ab" && p.code === "MEDI1101B" && unitChronosByCode.has("MEDI1101A")) {
          if (!unitChronosByCode.get("MEDI1101A").some((c) => p.chrono - c === 1)) {
            warnings.push("MEDI1101A and MEDI1101B must be completed in consecutive trimesters.");
          }
        }
      }

      resultsBySlotId[p.slot.id] = {
        errors,
        warnings,
        infos,
        intensiveAlerts,
        intensiveClashes,
        intensiveGuides,
        historicalIntensiveClashes,
        rollingStartInfos,
        softModeWarnings,
      };
    }

    return resultsBySlotId;
  }

  /**
   * Full degree validation report: CP totals, level caps/minimums, Major directives,
   * effective trimester loads (incl. year-long carry-over), overlapping published intensive dates,
   * physical campus travel conflicts, exclusive-option buckets, and Award Readiness.
   */
  function validatePlan(course, plan, data) {
    const resolved = resolveCurriculumBuckets(course, plan, data);
    const placements = getPlannedPlacements(plan, data);
    const slotDiagnostics = evaluateAllPlacements(course, plan, data, resolved.advancedStandingCp, resolved.buckets);

    const countedUnits = new Map();
    const uniqueUnitCodes = new Set();
    let placeholderCp = 0;
    for (const p of placements) {
      if (p.type === "unit") {
        uniqueUnitCodes.add(p.code);
        const isRep = Boolean(p.unit && p.unit.repeatable);
        const key = isRep ? p : p.code;
        if (!countedUnits.has(key)) countedUnits.set(key, p);
      } else {
        placeholderCp += p.cp ?? 6;
      }
    }

    let unitCp = 0;
    const cpByLevel = { 0: 0, 100: 0, 200: 0, 300: 0, 400: 0, 500: 0, 600: 0 };
    for (const p of countedUnits.values()) {
      const pCp = p.cp ?? 6;
      unitCp += pCp;
      const lvl = p.unit?.level ?? 100;
      cpByLevel[lvl] = (cpByLevel[lvl] || 0) + pCp;
    }

    const totalPlannedCp = resolved.advancedStandingCp + unitCp + placeholderCp;
    const targetCp = course.totalCp || 144;

    // Evaluate course level rules (with Double Degree combined rules, per-rule onlyRules, isHonoursOnly, and excludeUnits)
    const levelChecks = [];
    for (const lr of course.levelRules || []) {
      if (lr.isHonoursOnly && course.studyLevel !== "Bachelor Honours") continue;
      if (lr.onlyRules && lr.onlyRules.length > 0) {
        const matchesRule = lr.onlyRules.some(
          (r) => r === plan.admissionRule || matchesRulePattern(plan.admissionRule, r)
        );
        if (!matchesRule) continue;
      }

      if (lr.special === "BCOMP_300") {
        let cosc300Cp = 0;
        let hasStat330 = uniqueUnitCodes.has("STAT330");
        for (const p of countedUnits.values()) {
          if (p.unit?.prefix === "COSC" && p.unit?.level === 300) cosc300Cp += p.cp ?? 6;
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
      if (Array.isArray(lr.excludeUnits) && lr.excludeUnits.length > 0) {
        const exclSet = new Set(lr.excludeUnits);
        for (const p of countedUnits.values()) {
          if (exclSet.has(p.code)) continue;
          const lvl = p.unit?.level ?? 100;
          if ((lr.levels || []).includes(lvl)) sumLvl += p.cp ?? 6;
        }
      } else {
        for (const lvl of lr.levels || []) sumLvl += cpByLevel[lvl] || 0;
      }
      if (lr.includeAdvStanding) sumLvl += resolved.advancedStandingCp;

      if (lr.maxCp !== undefined && lr.maxCp !== null) {
        levelChecks.push({
          label: lr.label,
          currentCp: sumLvl,
          targetCp: lr.maxCp,
          targetText: `${sumLvl} / ${lr.maxCp} CP max`,
          passed: sumLvl <= lr.maxCp,
          kind: "max",
        });
      } else if (lr.minCp !== undefined && lr.minCp !== null) {
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
    let hasMajorCoreUnmet = false;
    if (resolved.incompatiblePairWarning) {
      globalIssues.push({ severity: "error", text: resolved.incompatiblePairWarning });
    }

    for (const [mCode, majorsRequiring] of Object.entries(resolved.majorCoreHints.mandatory)) {
      if (!uniqueUnitCodes.has(mCode)) {
        hasMajorCoreUnmet = true;
        globalIssues.push({
          severity: "warning",
          text: `Major Core Requirement: ${majorsRequiring.join(" & ")} requires ${mCode} in your Course Core Units.`,
          actionUnit: mCode,
        });
      }
    }
    for (const grp of resolved.majorCoreHints.choiceGroups) {
      if (!grp.codes.some((c) => uniqueUnitCodes.has(c))) {
        hasMajorCoreUnmet = true;
        globalIssues.push({
          severity: "warning",
          text: `Major Core Requirement: ${grp.majorTitle} requires one of (${grp.codes.join(" or ")}) in your Science Core.`,
        });
      }
    }

    // Attach t3Analysis to globalIssues (fixing misleading "0/0 prescribed Major/Stream units run in T3")
    if (plan.t3Analysis) {
      const ta = plan.t3Analysis;
      if (ta.status === "bottlenecked") {
        const chain = (ta.bottleneckChain || []).map((u) => u.code).join(" \u2192 ");
        const finalUnits = chain || (ta.bottleneckUnits || []).join(", ");
        const ratioTxt =
          ta.totalMajorUnits > 0
            ? `${ta.t3MajorUnits}/${ta.totalMajorUnits} prescribed Major/Stream units run in T3`
            : `${ta.t3CourseUnits ?? 0}/${ta.totalCourseUnits ?? 0} planned course units run in T3`;
        globalIssues.push({
          severity: "info",
          text: `T3 Fast-Track found no earlier finish than ${ta.stdFinishLabel}. ${ratioTxt}.${finalUnits ? ` Final-stage units: ${finalUnits}.` : ""}`,
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
          text: `🌿 T3 Load-Spread Active: Scheduled ${ta.t3PlacedCount ?? "available"} T3 slots. Finishes in ${ta.accFinishLabel}.`,
        });
      } else if (ta.status === "spread_fallback") {
        globalIssues.push({
          severity: "info",
          text: `🌿 T3 Load-Spread Check: No T3 spread found within the standard finish year. Standard pacing finishes in ${ta.stdFinishLabel}.`,
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
    let missingRequiredAos = false;
    if (["bsc", "bcomp", "bit01", "single_major"].includes(cfg.aosMode)) {
      const reqMajors =
        (cfg.aosMode === "bsc" && plan.aosStructure === "2m") ||
        (cfg.aosMode === "bcomp" && plan.aosStructure === "opt3") ||
        (cfg.aosMode === "bit01" && plan.aosStructure === "2m")
          ? 2
          : 1;
      if ((plan.selectedMajors || []).filter(Boolean).length < reqMajors) {
        missingRequiredAos = true;
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
      missingRequiredAos = true;
      globalIssues.push({
        severity: "info",
        text: `Select your ${cfg.aosMode === "mnsc_pathway" ? "Pathway" : "Minor / Stream"} in the Course Configuration bar.`,
      });
    }

    // Precompute Year-Long & Multi-Trimester carry-over loads across the entire timeline (with start-tri absorption)!
    const {
      carryOverByChrono,
      carrySmallByChrono,
      carryUnitsByChrono,
      startExtraAbsorbedByChrono,
    } = computeTimelineCarryOver(plan, data, null);

    // Trimester overload checks + Intensive TBA + Published Date Overlap + Pairwise Campus Travel Conflict checks!
    const baseMaxLoad = plan.studyLoad === "Part-time" ? 12 : 24;
    const trimesterLoads = {};
    let hasOverload = false;
    let hasAnyDateClash = false;

    (plan.years || []).forEach((yr, yIdx) => {
      const planYear = getPlanYear(yr, yIdx);
      const isFutureYear = planYear > 2027;
      for (const tNum of [1, 2, 3]) {
        const chrono = yIdx * 3 + (tNum - 1);
        const slots = yr.trimesters[tNum] || [];
        let cpSum = 0;
        let directEffSum = 0;
        let directSmallEff = 0;
        let intensives = 0;
        let tbaIntensives = 0;
        let futureGuideIntensives = 0;
        const mandatoryUnitsInTri = []; // { slot, unit, intInfo }

        for (const s of slots) {
          const u = s.type === "unit" ? getUnit(s.code, data, plan.customUnits) : null;
          const uCp = getSlotCp(s, u);
          cpSum += uCp;
          if (u) {
            const lSpec = getUnitLoadSpec(u, plan.studyLoad);
            directEffSum += lSpec.effCp;
            if (lSpec.isSmallUnit) directSmallEff += lSpec.effCp;
          } else {
            directEffSum += uCp;
            if (uCp > 0 && uCp <= 3) directSmallEff += uCp;
          }

          const intInfo = u ? getUnitIntensiveForTri(u, tNum, plan.preferredMode, planYear) : null;
          if (intInfo && intInfo.kind === "Mandatory" && intInfo.applicableForMode) {
            intensives++;
            if (isFutureYear) {
              futureGuideIntensives++;
            } else if (intInfo.tba || intInfo.mixedTba) {
              tbaIntensives++;
            }
            mandatoryUnitsInTri.push({ slot: s, unit: u, intInfo });
          }
        }

        const absorbedExtra = startExtraAbsorbedByChrono[chrono] || 0;
        const carryOverCp = carryOverByChrono[chrono] || 0;
        const effLoadSum = directEffSum + absorbedExtra + carryOverCp;
        const totalSmallEff = directSmallEff + (carrySmallByChrono[chrono] || 0);
        // Allow up to +3 CP alongside normal units when a 2-CP/3-CP unit (e.g. ZOOL111/222/333, ENSC222, GEOL223) is co-enrolled
        const smallAllowance = totalSmallEff > 0 ? Math.min(3, totalSmallEff) : 0;
        const effectiveMax = baseMaxLoad + smallAllowance;
        // Solo mandatory placement >12 CP in an otherwise empty PT trimester is full-time for that term, not a multi-unit overload unless >24 CP
        const isSoloPtLargeUnit =
          plan.studyLoad === "Part-time" && slots.length === 1 && carryOverCp === 0 && effLoadSum <= 24;
        const isOverloaded = !isSoloPtLargeUnit && effLoadSum > effectiveMax;

        // Pairwise Physical Campus Conflicts (fixes dead otherPhysical + hybrid campus erasure + student choice)
        const campusClashPairs = [];
        const involvedLocations = new Map(); // locationLabel -> Set<unitCode>
        for (let i = 0; i < mandatoryUnitsInTri.length; i++) {
          for (let j = i + 1; j < mandatoryUnitsInTri.length; j++) {
            const a = mandatoryUnitsInTri[i];
            const b = mandatoryUnitsInTri[j];
            if (doCampusesClash(a.intInfo, b.intInfo)) {
              campusClashPairs.push([a, b]);
              const locA = a.intInfo.location || "Campus A";
              const locB = b.intInfo.location || "Campus B";
              if (!involvedLocations.has(locA)) involvedLocations.set(locA, new Set());
              if (!involvedLocations.has(locB)) involvedLocations.set(locB, new Set());
              involvedLocations.get(locA).add(a.unit.code);
              involvedLocations.get(locB).add(b.unit.code);
            }
          }
        }
        const hasCampusConflict = campusClashPairs.length > 0;

        // Year-aware Mandatory Intensive Date Overlap Detection!
        // - planYear <= 2027: confirmed hard date clash (crimson, blocks isAwardReady)
        // - planYear > 2027: soft historical overlap advisory based on 2027 guide (amber, info only)
        const dateClashes = [];
        const historicalDateClashes = [];
        for (let i = 0; i < mandatoryUnitsInTri.length; i++) {
          for (let j = i + 1; j < mandatoryUnitsInTri.length; j++) {
            const a = mandatoryUnitsInTri[i];
            const b = mandatoryUnitsInTri[j];
            const ov = checkUnitIntensiveDateOverlap(a.unit.code, a.intInfo, b.unit.code, b.intInfo);
            if (ov) {
              const diagA = slotDiagnostics[a.slot.id];
              const diagB = slotDiagnostics[b.slot.id];
              if (isFutureYear) {
                historicalDateClashes.push({ ...ov, planYear, referenceYear: 2027 });
                if (diagA) {
                  diagA.historicalIntensiveClashes.push(
                    `Possible intensive overlap with ${b.unit.code} (overlapped in 2027 draft guide: ${ov.overlapText}) — check ${planYear} dates when published`
                  );
                }
                if (diagB) {
                  diagB.historicalIntensiveClashes.push(
                    `Possible intensive overlap with ${a.unit.code} (overlapped in 2027 draft guide: ${ov.overlapText}) — check ${planYear} dates when published`
                  );
                }
              } else {
                dateClashes.push(ov);
                if (diagA) {
                  diagA.intensiveClashes.push(
                    `2027 Draft Date Clash with ${b.unit.code} (${ov.overlapText}; ${ov.rangeA} vs ${ov.rangeB} — subject to confirmation)`
                  );
                }
                if (diagB) {
                  diagB.intensiveClashes.push(
                    `2027 Draft Date Clash with ${a.unit.code} (${ov.overlapText}; ${ov.rangeB} vs ${ov.rangeA} — subject to confirmation)`
                  );
                }
              }
            }
          }
        }
        const hasDateClash = dateClashes.length > 0;
        const hasHistoricalDateClash = historicalDateClashes.length > 0;
        if (hasDateClash) hasAnyDateClash = true;

        const key = `${yIdx}_${tNum}`;
        trimesterLoads[key] = {
          cp: cpSum,
          effCp: effLoadSum,
          carryOverCp,
          maxLoad: baseMaxLoad,
          isOverloaded,
          planYear,
          isFutureYear,
          intensives,
          tbaIntensives,
          futureGuideIntensives,
          campusConflict: hasCampusConflict,
          hasDateClash,
          dateClashes,
          hasHistoricalDateClash,
          historicalDateClashes,
        };

        if (isOverloaded) {
          hasOverload = true;
          const carryTxt =
            carryOverCp > 0
              ? ` (${directEffSum} CP direct + ${carryOverCp} CP carried from year-long ${(carryUnitsByChrono[chrono] || []).join(", ")})`
              : "";
          const loadLabel = plan.studyLoad === "Part-time" ? "12 CP part-time" : "24 CP full-time";
          globalIssues.push({
            severity: "warning",
            text: `${yr.name} Trimester ${tNum} has ${effLoadSum} CP effective load${carryTxt} (exceeds standard ${loadLabel} load; requires UNE overload approval).`,
          });
        }
        if (hasDateClash) {
          const pairDesc = dateClashes
            .map((dc) => `${dc.unitA} (${dc.rangeA}) ↔ ${dc.unitB} (${dc.rangeB}) [overlap: ${dc.overlapText}]`)
            .join("; ");
          globalIssues.push({
            severity: "warning",
            text: `2027 Draft Intensive Date Clash in ${yr.name} Trimester ${tNum}: ${pairDesc} (provisional Handbook draft dates — subject to confirmation; consider moving one unit).`,
          });
        }
        if (hasHistoricalDateClash) {
          const pairDesc = historicalDateClashes
            .map((dc) => `${dc.unitA} ↔ ${dc.unitB} (2027 draft guide overlap: ${dc.overlapText})`)
            .join("; ");
          globalIssues.push({
            severity: "info",
            text: `Possible Intensive Overlap in ${yr.name} Trimester ${tNum} (${pairDesc}) — ${planYear} intensive dates are TBA; check when published.`,
          });
        }
        if (hasCampusConflict) {
          const desc = Array.from(involvedLocations.entries())
            .map(([loc, codes]) => `${loc} (${Array.from(codes).join(", ")})`)
            .join(" with ");
          globalIssues.push({
            severity: "warning",
            text: `Intensive Campus Clash in ${yr.name} Trimester ${tNum}: mixes ${desc} — attending intensives at different locations in the same trimester may require travel; confirm intensive locations & dates.`,
          });
        }
      }
    });

    // Count total unit errors & warnings (distinguishing soft preferredMode warnings from academic hard warnings!)
    let unitErrorCount = 0;
    let unitWarningCount = 0;
    let hardWarningCount = 0;
    for (const diag of Object.values(slotDiagnostics)) {
      unitErrorCount += diag.errors.length;
      unitWarningCount += diag.warnings.length;
      hardWarningCount += diag.warnings.filter((msg) => !diag.softModeWarnings.includes(msg)).length;
    }

    // Check bucket completion (respecting mutually-exclusive groups AND fixing cpMax === 0 falsy bug!)
    const nonExclusiveMet = resolved.buckets
      .filter((b) => !b.exclusiveGroupId)
      .every(
        (b) =>
          (!b.cpMin || b.plannedCp >= b.cpMin) &&
          (b.cpMax === null || b.cpMax === undefined || b.plannedCp <= b.cpMax)
      );
    const exclusiveMet = (resolved.exclusiveGroups || []).every((grp) => grp.satisfied);
    const allBucketsMet = nonExclusiveMet && exclusiveMet;

    const allLevelsMet = levelChecks.every((l) => l.passed);
    const isAwardReady =
      totalPlannedCp === targetCp &&
      placeholderCp === 0 &&
      unitErrorCount === 0 &&
      hardWarningCount === 0 &&
      allBucketsMet &&
      allLevelsMet &&
      !resolved.incompatiblePairWarning &&
      !missingRequiredAos &&
      !hasMajorCoreUnmet &&
      !hasOverload &&
      !hasAnyDateClash;

    return {
      resolved,
      unitBucketMap: resolved.unitBucketMap,
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
      hardWarningCount,
      isAwardReady,
    };
  }

  /**
   * Smart Auto-Scheduler (Phase 3):
   * - Pre-fills ONLY genuinely mandatory units, Major Core mandatory directives, and uniquely
   *   necessary direct-entry prerequisites/co-requisites (skipping introductory bridging units
   *   like CHEM100/MTHS100/PHYS100 when direct-entry replacements exist!).
   * - Emits crisp, typed, bucket-scoped placeholder slots for every genuine student choice
   *   (Core choices, Major/Minor Prescribed/Listed choices, Course Listed pools, Electives),
   *   carrying bucketId, category, allowedLevels, hintCodes, and eligibleCount.
   * - Schedules chronologically with critical-path DAG depth, rolling-start year gating (2028/2029),
   *   placeholder prerequisite unlocking & trimester feasibility, intensive campus/date clash avoidance,
   *   year-long carry-over, Part-Time loads, 2-CP pairings, and Advanced Standing!
   */
  function autoSchedulePlan(course, plan, data) {
    const nextPlan = JSON.parse(JSON.stringify(plan));
    const resolved = resolveCurriculumBuckets(course, nextPlan, data);
    const targetStudyCp = Math.max(0, (course.totalCp || 144) - resolved.advancedStandingCp);
    const requestedStrategy = nextPlan.t3Strategy || (nextPlan.includeT3InAuto ? "accelerate" : "none");
    const strategy = ["accelerate", "spread"].includes(requestedStrategy) ? requestedStrategy : "none";
    // Only schedule T3-only units when accelerating or commencing in T3 — never let "spread" pick T3-only units that slow T1/T2!
    const allowT3Pick = strategy === "accelerate" || (nextPlan.commencingTrimester || 1) === 3;
    const stdYears = Math.max(1, Math.ceil(targetStudyCp / 48));
    const horizonYears =
      nextPlan.studyLoad === "Part-time" ? Math.max(stdYears, Math.ceil(targetStudyCp / 24)) : stdYears;
    const maxPlanYear = 2026 + horizonYears;

    function ruleAppliesToPlan(r) {
      if (r.isHonoursOnly && course.studyLevel !== "Bachelor Honours") return false;
      if (!r.onlyRules || !r.onlyRules.length) return true;
      return r.onlyRules.some((rn) => rn === nextPlan.admissionRule || matchesRulePattern(nextPlan.admissionRule, rn));
    }

    const activeMaxRules = (course.levelRules || []).filter(
      (r) => r.maxCp !== undefined && r.maxCp !== null && r.levels && r.levels.length > 0 && ruleAppliesToPlan(r)
    );
    const min300Rule = (course.levelRules || []).find(
      (r) => r.levels && r.levels.includes(300) && r.minCp && ruleAppliesToPlan(r)
    );
    const bcomp300Rule = (course.levelRules || []).find(
      (r) => r.special === "BCOMP_300" && ruleAppliesToPlan(r)
    );
    // Only match genuine 500-level-only minimums (NEVER match 300+ combined rules like [300,400,500,600] in Law degrees!)
    const min500Rule = (course.levelRules || []).find(
      (r) =>
        r.levels &&
        r.levels.includes(500) &&
        !r.levels.includes(300) &&
        !r.levels.includes(400) &&
        r.minCp &&
        ruleAppliesToPlan(r)
    );

    function isUnitAvailableForPlan(u) {
      if (!u) return false;
      if (isUnitExcludedForCourse(u, course)) return false;
      return isUnitAvailableForHorizon(u, maxPlanYear);
    }

    const chosenSet = new Set();
    const chosenList = [];
    const chosenPrefixCp = {};
    const chosenLevelCp = {};
    const chosenPrefixLevelCp = {};
    const chosenUnitCpMap = new Map();

    function getLvlCp(lvl) {
      return chosenList.filter((u) => (u.level ?? 100) === lvl).reduce((s, u) => s + (u.cp ?? 6), 0);
    }

    function wouldBreachAnyMaxRule(u, extraLevelCpMap) {
      if (!u || !activeMaxRules.length) return false;
      const uCp = u.cp ?? 6;
      const uLvl = u.level ?? 100;
      for (const mr of activeMaxRules) {
        if (Array.isArray(mr.excludeUnits) && mr.excludeUnits.includes(u.code)) continue;
        if (mr.levels.includes(uLvl)) {
          const exclSet = Array.isArray(mr.excludeUnits) && mr.excludeUnits.length ? new Set(mr.excludeUnits) : null;
          let curSum = 0;
          for (const cu of chosenList) {
            if (exclSet && exclSet.has(cu.code)) continue;
            if (mr.levels.includes(cu.level ?? 100)) curSum += cu.cp ?? 6;
          }
          if (extraLevelCpMap) {
            for (const lvl of mr.levels) curSum += extraLevelCpMap[lvl] || 0;
          }
          if (curSum + uCp > mr.maxCp) return true;
        }
      }
      return false;
    }

    function getApplicableCoreqBranches(u) {
      const cm = u && u.coreqMeta;
      if (!cm) return [];
      const list = Array.isArray(cm.branches) && cm.branches.length > 0 ? cm.branches : [cm];
      return list.filter((br) => {
        const courseApplies = !br.onlyCourses || br.onlyCourses.includes(course.code);
        const ruleApplies = !br.onlyRulePattern || matchesRulePattern(nextPlan.admissionRule, br.onlyRulePattern);
        const waived = br.pgWaiver && isHonoursOrPostgrad(course.studyLevel);
        return courseApplies && ruleApplies && !waived;
      });
    }

    function getApplicableCoreqCodes(u) {
      const codes = [];
      for (const br of getApplicableCoreqBranches(u)) {
        for (const c of br.codes || []) {
          if (!codes.includes(c)) codes.push(c);
        }
      }
      return codes;
    }

    function isCoreqMetBySet(u, unitSet) {
      const branches = getApplicableCoreqBranches(u);
      for (const br of branches) {
        if (br.tokens && br.tokens.length > 0 && !evalPrereqTokens(br.tokens, unitSet)) return false;
      }
      return true;
    }

    function tryPick(code) {
      if (chosenSet.has(code)) return false;
      const u = getUnit(code, data, nextPlan.customUnits);
      if (!isUnitAvailableForPlan(u)) return false;
      // Block ONLY mutual restrictions (never block valid one-way directional bridging if explicitly mandatory)
      for (const existing of chosenList) {
        if (isMutualRestriction(u, existing)) return false;
      }
      const uCp = u.cp ?? 6;
      chosenSet.add(code);
      chosenList.push(u);
      chosenUnitCpMap.set(code, uCp);
      const lvl = u.level ?? 100;
      chosenLevelCp[lvl] = (chosenLevelCp[lvl] || 0) + uCp;
      if (u.prefix) {
        chosenPrefixCp[u.prefix] = (chosenPrefixCp[u.prefix] || 0) + uCp;
        const plk = `${u.prefix}_${lvl}`;
        chosenPrefixLevelCp[plk] = (chosenPrefixLevelCp[plk] || 0) + uCp;
      }
      return true;
    }

    // Computes max compatible CP achievable from a list of codes (respecting internal mutual restrictions)
    function computeMaxCompatibleCp(codes, excludeCode) {
      const picked = [];
      let sum = 0;
      for (const c of codes) {
        if (c === excludeCode) continue;
        const u = getUnit(c, data, nextPlan.customUnits);
        if (!u) continue;
        const clashes = picked.some((pu) => isMutualRestriction(u, pu));
        if (!clashes) {
          picked.push(u);
          sum += u.cp ?? 6;
        }
      }
      return sum;
    }

    let accCp = 0;

    // 0. For each mutually-exclusive Stream / Option / Pathway group, pick ONE winning option!
    //    Checks 2027/rolling availability, internal mutual restrictions, and prefers direct-entry over bridging options.
    const chosenExclusiveOption = new Map(); // groupId -> winning optionId
    for (const grp of resolved.exclusiveGroups || []) {
      let bestOptId = null;
      let bestOptScore = 1e9;
      for (const [optId, optBuckets] of grp.options.entries()) {
        let optScore = 0;
        let optCpMin = 0;
        let offeredShortfall = 0;
        const simPicked = new Set();
        for (const b of optBuckets) {
          const need = b.cpMin || 0;
          optCpMin += need;
          const avail = b.units.filter((c) => {
            const u = getUnit(c, data, nextPlan.customUnits);
            return isUnitAvailableForPlan(u);
          });
          let compatCp = 0;
          for (const c of avail) {
            const u = getUnit(c, data, nextPlan.customUnits);
            if (!u) continue;
            const restrictedWithSim = Array.from(simPicked).some((sCode) =>
              isMutualRestriction(u, getUnit(sCode, data, nextPlan.customUnits))
            );
            if (!restrictedWithSim) {
              simPicked.add(c);
              compatCp += u.cp ?? 6;
            }
          }
          if (compatCp < need) offeredShortfall += need - compatCp;
          for (const c of avail) {
            const u = getUnit(c, data, nextPlan.customUnits);
            if (u && (u.cp ?? 6) > 24 && !u.yearLong) optScore += 15;
            if (u && isIntroductoryBridgingUnit(u)) optScore += 10;
          }
        }
        optScore += offeredShortfall * 50;
        if (optCpMin > targetStudyCp) optScore += 500;
        optScore += optCpMin * 0.1;
        if (optScore < bestOptScore) {
          bestOptScore = optScore;
          bestOptId = optId;
        }
      }
      if (bestOptId) chosenExclusiveOption.set(grp.id, bestOptId);
    }

    const activeBuckets = resolved.buckets.filter(
      (b) => !b.exclusiveGroupId || chosenExclusiveOption.get(b.exclusiveGroupId) === b.exclusiveOptionId
    );
    const allActiveNonElectiveUnitSet = new Set();
    for (const b of activeBuckets) {
      if (b.category === "elective") continue;
      for (const c of b.units || []) allActiveNonElectiveUnitSet.add(c);
    }

    // 1a. Pre-fill Major-required mandatory Core directives (e.g. CHEM110 + CHEM120 for CHEMIM002, MTHS120 for MATHSM001/DATASC003!)
    for (const mCode of Object.keys(resolved.majorCoreHints.mandatory || {})) {
      const u = getUnit(mCode, data, nextPlan.customUnits);
      const uCp = u?.cp ?? 6;
      if (u && isUnitAvailableForPlan(u) && accCp + uCp <= targetStudyCp) {
        if (tryPick(mCode)) accCp += uCp;
      }
    }

    // 1b. Pre-fill ONLY mathematically mandatory units inside active buckets (where removing unit u makes reaching effectiveMin impossible!)
    //     Genuine student-choice pools (offeredPoolCp > effectiveMin) are NOT arbitrarily filled with concrete units!
    const aosMandatoryCp = {};
    for (const b of activeBuckets) {
      if (b.category === "elective" || !b.cpMin) continue;
      const aosCode = b.aosCode || null;
      const aosCap = aosCode && data.aos[aosCode]?.totalCp ? data.aos[aosCode].totalCp : null;
      if (aosCap && !b.exclusiveGroupId && (aosMandatoryCp[aosCode] || 0) >= aosCap) continue;

      const effectiveMin =
        aosCap && !b.exclusiveGroupId
          ? Math.min(b.cpMin, Math.max(0, aosCap - (aosMandatoryCp[aosCode] || 0)))
          : b.cpMin;

      const availUnits = b.units.filter((code) => {
        const u = getUnit(code, data, nextPlan.customUnits);
        if (!isUnitAvailableForPlan(u)) return false;
        if (!chosenSet.has(code) && chosenList.some((ex) => isMutualRestriction(u, ex))) return false;
        return true;
      });
      if (!availUnits.length) continue;

      const totalCompatCp = computeMaxCompatibleCp(availUnits, null);
      const isFullyMandatoryBucket = totalCompatCp <= effectiveMin;

      for (const code of availUnits) {
        const u = getUnit(code, data, nextPlan.customUnits);
        if (!u) continue;
        const uCp = u.cp ?? 6;
        if (chosenSet.has(code)) {
          if (aosCode) aosMandatoryCp[aosCode] = (aosMandatoryCp[aosCode] || 0) + uCp;
          continue;
        }
        // Mandatory 0-CP units (e.g. PRACAGR in BAGR) are picked when the bucket is mandatory
        const isUnavoidable =
          uCp === 0
            ? isFullyMandatoryBucket
            : computeMaxCompatibleCp(availUnits, code) < effectiveMin;
        if (!isUnavoidable) continue;
        if (accCp + uCp > targetStudyCp) continue;
        if (uCp > 0 && wouldBreachAnyMaxRule(u)) continue;
        if (tryPick(code)) {
          accCp += uCp;
          if (aosCode) aosMandatoryCp[aosCode] = (aosMandatoryCp[aosCode] || 0) + uCp;
        }
      }
    }

    // Helper: filter candidate prerequisite/co-requisite codes to direct-entry (non-bridging) spine units
    function getDirectEntryCandidates(rawCodes, tokens, requireInCoursePreferred) {
      const valid = [];
      for (const rc of rawCodes || []) {
        const ru = getUnit(rc, data, nextPlan.customUnits);
        if (!isUnitAvailableForPlan(ru)) continue;
        if (!chosenSet.has(rc) && chosenList.some((ex) => isMutualRestriction(ru, ex))) continue;
        if (
          isUndergradOrPathway(course.studyLevel) &&
          ru.level >= 500 &&
          !isUnitInCourseBuckets(rc, course, nextPlan, data)
        ) {
          continue;
        }
        if (!allowT3Pick && ru.offered2027 !== false && ru.trimesters && ru.trimesters.length === 1 && ru.trimesters[0] === 3) {
          continue;
        }
        valid.push(rc);
      }
      let pool = valid;
      if (requireInCoursePreferred && tokens && tokens.length) {
        const inCourse = valid.filter((c) => allActiveNonElectiveUnitSet.has(c) || chosenSet.has(c));
        if (inCourse.length > 0 && evalPrereqTokens(tokens, new Set([...chosenSet, ...inCourse]))) {
          pool = inCourse;
        }
      }
      // Strip introductory bridging units (CHEM100, MTHS100, PHYS100, MUSI111, AFM219, QMER100) whenever direct-entry alternatives exist!
      const nonBridging = pool.filter((c) => !isIntroductoryBridgingUnit(getUnit(c, data, nextPlan.customUnits)));
      if (nonBridging.length > 0) {
        if (!tokens || !tokens.length || evalPrereqTokens(tokens, new Set([...chosenSet, ...nonBridging]))) {
          pool = nonBridging;
        }
      }
      return pool;
    }

    // 1c. Fixed-point Direct-Entry Prerequisite & Co-Requisite Spine Closure!
    //     Pulls ONLY uniquely necessary prerequisites (e.g. CHEM204 for CHEM302/303, CHEM250 for FSC310,
    //     COSC210 for COSC331 in DATASC003) and uniquely necessary co-requisites — NEVER picks arbitrary
    //     OR-choices or bridging units (CHEM100/MTHS100/PHYS100)!
    for (let iter = 0; iter < 6; iter++) {
      let pickedAnySpine = false;
      for (const u of [...chosenList]) {
        if (accCp >= targetStudyCp) break;

        // Co-requisites of mandatory units
        if (!isCoreqMetBySet(u, chosenSet)) {
          for (const br of getApplicableCoreqBranches(u)) {
            if (!br.tokens || !br.tokens.length || evalPrereqTokens(br.tokens, chosenSet)) continue;
            const cands = getDirectEntryCandidates(br.codes || [], br.tokens, true);
            for (const rc of cands) {
              if (chosenSet.has(rc)) continue;
              const withoutRc = new Set([...chosenSet, ...cands.filter((x) => x !== rc)]);
              if (!evalPrereqTokens(br.tokens, withoutRc)) {
                const ru = getUnit(rc, data, nextPlan.customUnits);
                const ruCp = ru?.cp ?? 6;
                if (ru && accCp + ruCp <= targetStudyCp && !wouldBreachAnyMaxRule(ru)) {
                  if (tryPick(rc)) {
                    accCp += ruCp;
                    pickedAnySpine = true;
                  }
                }
              }
            }
          }
        }

        // Prerequisites of mandatory units (respecting alternatives / PG branches via evaluatePrereqMeta!)
        const pm = u.prereqMeta;
        if (!pm || (pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel))) continue;
        if (!pm.tokens || !pm.tokens.length || evalPrereqTokens(pm.tokens, chosenSet)) continue;
        const spineCtx = {
          units: chosenSet,
          cp: Math.max(targetStudyCp, resolved.advancedStandingCp + accCp),
          prefixCp: chosenPrefixCp,
          levelCp: chosenLevelCp,
          prefixLevelCp: chosenPrefixLevelCp,
          unitCpMap: chosenUnitCpMap,
          course,
          plan: nextPlan,
        };
        if (evaluatePrereqMeta(u, spineCtx, true).ok) continue;

        const cands = getDirectEntryCandidates(pm.codes || [], pm.tokens, true);
        if (!cands.length) continue;

        for (const rc of cands) {
          if (chosenSet.has(rc)) continue;
          // Only pull in-course spine units (never drag foreign units like PHAR360 into MPH01!)
          if (!allActiveNonElectiveUnitSet.has(rc) && !isUnitInCourseBuckets(rc, course, nextPlan, data)) continue;
          const withoutRc = new Set([...chosenSet, ...cands.filter((x) => x !== rc)]);
          if (!evalPrereqTokens(pm.tokens, withoutRc)) {
            const ru = getUnit(rc, data, nextPlan.customUnits);
            const ruCp = ru?.cp ?? 6;
            if (ru && accCp + ruCp <= targetStudyCp && !wouldBreachAnyMaxRule(ru)) {
              if (tryPick(rc)) {
                accCp += ruCp;
                pickedAnySpine = true;
              }
            }
          }
        }
      }
      if (!pickedAnySpine) break;
    }

    // 2. Dry-attribute our mandatory concrete units across activeBuckets to compute exact remaining CP per bucket!
    const priorityOrder = ["core", "major1", "major2", "minor", "capstone", "listed", "elective"];
    const activeBucketsByPriority = [...activeBuckets].sort((a, b) => {
      const catDiff = priorityOrder.indexOf(a.category) - priorityOrder.indexOf(b.category);
      if (catDiff !== 0) return catDiff;
      const aReq = a.cpMin && a.cpMin > 0 ? 0 : 1;
      const bReq = b.cpMin && b.cpMin > 0 ? 0 : 1;
      return aReq - bReq;
    });

    const bucketCoveredCp = {};
    const aosCoveredCp = {};
    for (const b of activeBuckets) bucketCoveredCp[b.id] = 0;

    // Sort concrete units deterministically (matching canonical attribution order!)
    const sortedChosenForAttr = [...chosenList].sort((a, b) => {
      const aM = resolved.majorCoreHints.mandatory[a.code] ? 0 : 1;
      const bM = resolved.majorCoreHints.mandatory[b.code] ? 0 : 1;
      if (aM !== bM) return aM - bM;
      const aCnt = activeBucketsByPriority.filter((bk) => bk.category !== "elective" && bk.units.includes(a.code)).length;
      const bCnt = activeBucketsByPriority.filter((bk) => bk.category !== "elective" && bk.units.includes(b.code)).length;
      if (aCnt !== bCnt) return aCnt - bCnt;
      return a.code.localeCompare(b.code);
    });

    for (const u of sortedChosenForAttr) {
      const uCp = u.cp ?? 6;
      let matched = null;
      for (const b of activeBucketsByPriority) {
        if (b.category === "elective") continue;
        if (b.units.includes(u.code)) {
          const hasCap = b.cpMax !== null && b.cpMax !== undefined;
          if (!hasCap || bucketCoveredCp[b.id] + uCp <= b.cpMax) {
            matched = b;
            break;
          }
        }
      }
      if (!matched) {
        for (const b of activeBucketsByPriority) {
          if (b.category !== "elective" && b.units.includes(u.code)) {
            matched = b;
            break;
          }
        }
      }
      if (matched) {
        bucketCoveredCp[matched.id] = (bucketCoveredCp[matched.id] || 0) + uCp;
        if (matched.aosCode) aosCoveredCp[matched.aosCode] = (aosCoveredCp[matched.aosCode] || 0) + uCp;
      }
    }

    // Helper: clean short display name for a bucket placeholder
    function makeShortBucketName(b) {
      if (!b) return "Listed";
      let raw = b.shortTitle || b.title || "Listed";
      raw = raw
        .replace(/^Rule\s+[A-Z0-9\s/&-]+-\s*/i, "")
        .replace(/^Schedule\s+[A-Z0-9\s/&-]+-\s*/i, "")
        .replace(/^Additional\s+Core\s+Units?\s*-\s*/i, "")
        .replace(/^Listed\s+Units?\s*-\s*/i, "")
        .trim();
      if (b.aosCode && b.aosTitle) {
        const cleanAos = b.aosTitle
          .replace(/^[A-Z0-9]+\s*-\s*/, "")
          .replace(/\s*\((Major|Minor|Specialisation|Pathway)\)\s*$/i, "")
          .trim();
        const subLow = raw.toLowerCase();
        if (subLow === "prescribed units" || subLow === "additional prescribed units") {
          return `${cleanAos} Prescribed`;
        }
        if (subLow === "listed units") {
          return `${cleanAos} Listed`;
        }
        if (cleanAos && !raw.toLowerCase().includes(cleanAos.toLowerCase())) {
          return `${cleanAos} ${raw}`.replace(/\s+Units?$/i, "").trim();
        }
      }
      if (/^mathematics$/i.test(raw) && b.category === "core") return "Core Mathematics";
      return raw.replace(/\s+Units?$/i, "").trim() || "Listed";
    }

    // Internal placeholder entries: { slot, choicePool, targetYearHint }
    // (slot is persisted onto plan.years; choicePool stays lightweight in memory during scheduling!)
    const placeholderEntries = [];
    const guaranteedLvlCp = { 0: 0, 100: 0, 200: 0, 300: 0, 400: 0, 500: 0, 600: 0 };
    for (const u of chosenList) {
      const l = u.level ?? 100;
      guaranteedLvlCp[l] = (guaranteedLvlCp[l] || 0) + (u.cp ?? 6);
    }
    let guaranteedCosc300Cp =
      chosenList.filter((u) => u.prefix === "COSC" && u.level === 300).reduce((s, u) => s + (u.cp ?? 6), 0) +
      (chosenSet.has("STAT330") ? 6 : 0);

    function registerPlaceholder(opts) {
      const cpVal = opts.cp ?? 6;
      const pool = Array.isArray(opts.choicePool) ? opts.choicePool : [];
      const cat = opts.category || "elective";
      let allowedLevels = Array.isArray(opts.allowedLevels) && opts.allowedLevels.length ? [...opts.allowedLevels] : null;
      let levelMin = opts.levelMin ?? (allowedLevels ? Math.min(...allowedLevels) : null);
      let levelMax = opts.levelMax ?? (allowedLevels ? Math.max(...allowedLevels) : null);

      // Infer single-level guarantee from bounded choicePool for accurate 100/300/500-level planning
      let inferredSingleLvl = allowedLevels && allowedLevels.length === 1 ? allowedLevels[0] : null;
      if (inferredSingleLvl === null && pool.length > 0) {
        const poolLvls = new Set(pool.map((c) => getUnit(c, data, nextPlan.customUnits)?.level ?? 100));
        if (poolLvls.size === 1) {
          inferredSingleLvl = Array.from(poolLvls)[0];
        }
      }
      if (inferredSingleLvl !== null) {
        guaranteedLvlCp[inferredSingleLvl] = (guaranteedLvlCp[inferredSingleLvl] || 0) + cpVal;
        if (inferredSingleLvl === 300 && Array.isArray(opts.allowedPrefixes) && opts.allowedPrefixes.includes("COSC")) {
          guaranteedCosc300Cp += cpVal;
        }
      }

      const slot = {
        id: uid("ph"),
        type: "placeholder",
        label: opts.label,
        slotKind: opts.slotKind || cat,
        category: cat,
        bucketId: opts.bucketId || null,
        bucketTitle: opts.bucketTitle || "",
        cp: cpVal,
        hintCodes: Array.isArray(opts.hintCodes) ? opts.hintCodes : [],
        strictHints: Boolean(opts.strictHints),
        eligibleCount: opts.eligibleCount !== undefined ? opts.eligibleCount : (pool.length > 0 ? pool.length : null),
        allowedLevels,
        levelMin,
        levelMax,
        strictPoolOnly: opts.strictPoolOnly !== undefined ? Boolean(opts.strictPoolOnly) : cat !== "elective",
      };
      if (Array.isArray(opts.allowedPrefixes) && opts.allowedPrefixes.length > 0) {
        slot.allowedPrefixes = [...opts.allowedPrefixes];
      }

      const minPoolLvl = pool.length
        ? Math.min(...pool.map((c) => getUnit(c, data, nextPlan.customUnits)?.level ?? 100))
        : (levelMin || 100);
      const targetYearHint =
        opts.targetYearHint ||
        (cat === "capstone"
          ? stdYears
          : cat === "core" && minPoolLvl <= 200
          ? 1
          : minPoolLvl >= 300
          ? Math.min(stdYears, 3)
          : minPoolLvl >= 200
          ? Math.min(stdYears, 2)
          : 1);

      placeholderEntries.push({
        slot,
        choicePool: pool,
        minimumLevel: levelMin || minPoolLvl,
        targetYearHint,
        bucketId: slot.bucketId,
      });
      accCp += cpVal;
    }

    // Helper: check which levels are already capped by activeMaxRules (so we don't emit placeholders that breach a maxCp rule!)
    function getCappedLevelsSet() {
      const capped = new Set();
      for (const mr of activeMaxRules) {
        let sum = 0;
        for (const lvl of mr.levels || []) sum += guaranteedLvlCp[lvl] || 0;
        if (sum + 6 > mr.maxCp) {
          for (const lvl of mr.levels || []) capped.add(lvl);
        }
      }
      return capped;
    }

    // 2a. Emit Major Core Directive Choice Groups (e.g. BIOSCI01 / MEDCHEM001: BIOL110 or PSIO110 in Science Core!)
    const sciCoreBucket = activeBuckets.find(
      (b) => b.category === "core" && b.title.toLowerCase().includes("science core")
    ) || activeBuckets.find((b) => b.category === "core");

    for (const grp of resolved.majorCoreHints.choiceGroups || []) {
      if (grp.codes.some((c) => chosenSet.has(c))) continue;
      const availGrp = grp.codes.filter((c) => isUnitAvailableForPlan(getUnit(c, data, nextPlan.customUnits)));
      if (!availGrp.length || accCp + 6 > targetStudyCp) continue;
      const bId = sciCoreBucket ? sciCoreBucket.id : null;
      const bTitle = sciCoreBucket ? makeShortBucketName(sciCoreBucket) : "Science Core";
      registerPlaceholder({
        label: `Choose ${bTitle} (${availGrp.join(" / ")})`,
        slotKind: "core",
        category: "core",
        bucketId: bId,
        bucketTitle: bTitle,
        cp: 6,
        choicePool: availGrp,
        hintCodes: availGrp,
        strictHints: true,
        eligibleCount: availGrp.length,
        strictPoolOnly: true,
        targetYearHint: 1,
      });
      if (bId) bucketCoveredCp[bId] = (bucketCoveredCp[bId] || 0) + 6;
    }

    // 2b. Check if any mandatory concrete unit STILL has an unmet OR-prerequisite not covered by a small bounded choice bucket
    //     (e.g. an OR-pair living inside a huge 17-unit or 80-unit pool); emit a strictHints choice placeholder for it!
    const smallBucketChoicePools = [];
    for (const b of activeBuckets) {
      if (b.category === "elective" || !b.cpMin) continue;
      const avail = b.units.filter((c) => !chosenSet.has(c) && isUnitAvailableForPlan(getUnit(c, data, nextPlan.customUnits)));
      if (avail.length > 0 && avail.length <= 8) smallBucketChoicePools.push({ bucket: b, pool: avail });
    }
    const existingBoundedPhs = () => [
      ...placeholderEntries.map((pe) => ({ choicePool: pe.choicePool })),
      ...smallBucketChoicePools.map((sb) => ({ choicePool: sb.pool })),
    ];

    for (const u of chosenList) {
      if (accCp + 6 > targetStudyCp) break;
      const pm = u.prereqMeta;
      if (!pm || (pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel))) continue;
      if (!pm.tokens || !pm.tokens.length || evalPrereqTokens(pm.tokens, chosenSet)) continue;
      if (arePrereqTokensGuaranteedByPlaceholders(pm.tokens, pm.codes, chosenSet, existingBoundedPhs())) continue;

      const cands = getDirectEntryCandidates(pm.codes || [], pm.tokens, true).filter((c) => !chosenSet.has(c));
      // Only emit a 1-unit strictHints choice placeholder when >= 2 candidates EACH individually satisfy pm.tokens!
      const singleUnitSatisfiers = cands.filter((c) => {
        const testSet = new Set(chosenSet);
        testSet.add(c);
        return evalPrereqTokens(pm.tokens, testSet);
      });
      if (singleUnitSatisfiers.length >= 2 && singleUnitSatisfiers.length <= 6) {
        const hostBucket =
          activeBucketsByPriority.find((b) => b.category !== "elective" && singleUnitSatisfiers.some((c) => b.units.includes(c))) ||
          null;
        if (hostBucket) {
          const cat = hostBucket.category;
          const bTitle = makeShortBucketName(hostBucket);
          registerPlaceholder({
            label: `Choose ${bTitle} (${singleUnitSatisfiers.slice(0, 4).join(" / ")}${singleUnitSatisfiers.length > 4 ? "…" : ""})`,
            slotKind: cat,
            category: cat,
            bucketId: hostBucket.id,
            bucketTitle: bTitle,
            cp: 6,
            choicePool: singleUnitSatisfiers,
            hintCodes: singleUnitSatisfiers,
            strictHints: true,
            eligibleCount: singleUnitSatisfiers.length,
            strictPoolOnly: true,
            targetYearHint: 1,
          });
          bucketCoveredCp[hostBucket.id] = (bucketCoveredCp[hostBucket.id] || 0) + 6;
          if (hostBucket.aosCode) aosCoveredCp[hostBucket.aosCode] = (aosCoveredCp[hostBucket.aosCode] || 0) + 6;
        }
      }
    }

    function getRuleMinNeed(rule) {
      if (!rule || !rule.minCp) return 0;
      let cur = rule.includeAdvStanding ? resolved.advancedStandingCp : 0;
      for (const lvl of rule.levels || []) cur += guaranteedLvlCp[lvl] || 0;
      return Math.max(0, rule.minCp - cur);
    }

    // 2c. Emit typed bucket-scoped placeholders for every remaining required choice bucket (Core, Major, Minor, Capstone, Listed)!
    for (const b of activeBuckets) {
      if (b.category === "elective" || !b.cpMin) continue;
      const aosCode = b.aosCode || null;
      const aosCap = aosCode && data.aos[aosCode]?.totalCp ? data.aos[aosCode].totalCp : null;
      if (aosCap && !b.exclusiveGroupId && (aosCoveredCp[aosCode] || 0) >= aosCap) continue;

      const already = bucketCoveredCp[b.id] || 0;
      const bucketRem = Math.max(0, b.cpMin - already);
      const aosRem = aosCap && !b.exclusiveGroupId ? Math.max(0, aosCap - (aosCoveredCp[aosCode] || 0)) : Infinity;
      let remNeed = Math.min(bucketRem, aosRem, Math.max(0, targetStudyCp - accCp));
      if (remNeed <= 0) continue;

      const remainingPool = b.units.filter((code) => {
        if (chosenSet.has(code)) return false;
        const u = getUnit(code, data, nextPlan.customUnits);
        if (!isUnitAvailableForPlan(u)) return false;
        if (chosenList.some((ex) => isMutualRestriction(u, ex))) return false;
        return true;
      });
      const shortName = makeShortBucketName(b);
      const poolCps = remainingPool
        .map((c) => getUnit(c, data, nextPlan.customUnits)?.cp ?? 6)
        .filter((v) => v > 0);
      const minPoolCp = poolCps.length > 0 ? Math.min(...poolCps) : 6;
      const unitStepCp =
        poolCps.length > 0 && poolCps.every((v) => v === poolCps[0])
          ? poolCps[0]
          : minPoolCp >= 12
          ? minPoolCp
          : 6;

      // Check how many 300/500-level slots exist in this pool if the course still needs upper-level CP
      const pool300 = remainingPool.filter((c) => (getUnit(c, data, nextPlan.customUnits)?.level ?? 100) === 300);
      const pool500 = remainingPool.filter((c) => (getUnit(c, data, nextPlan.customUnits)?.level ?? 100) === 500);
      const poolCosc300 = pool300.filter((c) => getUnit(c, data, nextPlan.customUnits)?.prefix === "COSC");
      const poolDistinctLvls = Array.from(
        new Set(remainingPool.map((c) => getUnit(c, data, nextPlan.customUnits)?.level ?? 100))
      ).sort((a, z) => a - z);
      const isMultiLevelPool = poolDistinctLvls.length > 1;
      let tagged300InBucket = 0;
      let tagged500InBucket = 0;

      // Cross-year multi-level splitting (Phase 4): when a Major/Minor/Listed bucket emits >= 2 untagged slots
      // from a mixed 200/300 (or 100/200) pool, spread targetYearHint proportionally across Y2 & Y3 (or Y1 & Y2)!
      const plannedSlotsInBucket = Math.max(1, Math.ceil(remNeed / Math.max(1, unitStepCp)));
      const cnt100Pool = remainingPool.filter((c) => (getUnit(c, data, nextPlan.customUnits)?.level ?? 100) === 100).length;
      const cnt200Pool = remainingPool.filter((c) => (getUnit(c, data, nextPlan.customUnits)?.level ?? 100) === 200).length;
      const cnt300PlusPool = remainingPool.filter((c) => (getUnit(c, data, nextPlan.customUnits)?.level ?? 100) >= 300).length;
      let y3QuotaForMixed = 0;
      let y2QuotaForMixed = 0;
      if (plannedSlotsInBucket >= 2 && ["major1", "major2", "minor", "listed"].includes(b.category)) {
        if (stdYears >= 3 && cnt200Pool > 0 && cnt300PlusPool > 0) {
          y3QuotaForMixed = Math.max(
            1,
            Math.min(plannedSlotsInBucket - 1, Math.round(plannedSlotsInBucket * (cnt300PlusPool / (cnt200Pool + cnt300PlusPool))))
          );
        } else if (stdYears >= 2 && cnt100Pool > 0 && cnt200Pool > 0 && cnt300PlusPool === 0) {
          y2QuotaForMixed = Math.max(
            1,
            Math.min(plannedSlotsInBucket - 1, Math.round(plannedSlotsInBucket * (cnt200Pool / (cnt100Pool + cnt200Pool))))
          );
        }
      }
      let emittedInBucketIdx = 0;

      while (remNeed > 0 && accCp < targetStudyCp) {
        const step = Math.min(unitStepCp, remNeed, targetStudyCp - accCp);
        if (step <= 0) break;

        let slotAllowedLevels = null;
        let slotAllowedPrefixes = null;
        let slotPool = remainingPool;

        // If a multi-level bucket has remaining upper-level need (and limited open elective space), scope needed slots to 300/500-level
        const cur300Need = getRuleMinNeed(min300Rule);
        const cur500Need = getRuleMinNeed(min500Rule);
        const curBcompNeed = bcomp300Rule ? Math.max(0, 36 - guaranteedCosc300Cp) : 0;
        const isUpperBucket = ["major1", "major2", "minor", "capstone", "listed"].includes(b.category);

        if (isUpperBucket && isMultiLevelPool && step >= 6) {
          if (curBcompNeed > 0 && poolCosc300.length > tagged300InBucket) {
            slotAllowedLevels = [300];
            slotAllowedPrefixes = ["COSC"];
            slotPool = poolCosc300;
            tagged300InBucket++;
          } else if (cur500Need > 0 && pool500.length > tagged500InBucket) {
            slotAllowedLevels = [500];
            slotPool = pool500;
            tagged500InBucket++;
          } else if (cur300Need > 0 && pool300.length > tagged300InBucket && (b.category !== "listed" || targetStudyCp - accCp <= cur300Need + 18)) {
            slotAllowedLevels = [300];
            slotPool = pool300;
            tagged300InBucket++;
          }
        }

        // Respect maxCp caps (e.g. MDSC 200/300-level <= 12 CP): if capped levels exist in this multi-level pool, restrict to uncapped levels!
        if (!slotAllowedLevels && isMultiLevelPool) {
          const capped = getCappedLevelsSet();
          if (capped.size > 0 && poolDistinctLvls.some((l) => capped.has(l))) {
            const uncappedLvls = poolDistinctLvls.filter((l) => !capped.has(l));
            if (uncappedLvls.length > 0) {
              slotAllowedLevels = uncappedLvls;
              slotPool = remainingPool.filter((c) =>
                uncappedLvls.includes(getUnit(c, data, nextPlan.customUnits)?.level ?? 100)
              );
            }
          }
        }

        const smallHints = slotPool.length > 0 && slotPool.length <= 4 ? slotPool : [];
        let label;
        if (smallHints.length > 0 && smallHints.length <= 3 && !slotAllowedLevels) {
          label = `Choose ${shortName} (${smallHints.join(" / ")})`;
        } else if (slotAllowedLevels && slotAllowedLevels.length === 1) {
          const prefixTxt = slotAllowedPrefixes ? `${slotAllowedPrefixes.join("/")} ` : "";
          label = `Choose ${slotAllowedLevels[0]}-level ${prefixTxt}${shortName} Unit`;
        } else if (slotAllowedLevels && slotAllowedLevels.length > 1) {
          label = `Choose ${slotAllowedLevels.join("/")}-level ${shortName} Unit`;
        } else {
          label = `Choose ${shortName} Unit`;
        }
        if (step !== 6 && !label.includes(`${step} CP`)) {
          label = `${label} (${step} CP)`;
        }

        let explicitYearHint = null;
        if (!slotAllowedLevels) {
          if (y3QuotaForMixed > 0) {
            explicitYearHint =
              emittedInBucketIdx >= plannedSlotsInBucket - y3QuotaForMixed ? Math.min(stdYears, 3) : Math.min(stdYears, 2);
          } else if (y2QuotaForMixed > 0) {
            explicitYearHint =
              emittedInBucketIdx >= plannedSlotsInBucket - y2QuotaForMixed ? Math.min(stdYears, 2) : 1;
          }
        }

        registerPlaceholder({
          label,
          slotKind: b.category,
          category: b.category,
          bucketId: b.id,
          bucketTitle: shortName,
          cp: step,
          choicePool: slotPool,
          hintCodes: smallHints,
          strictHints: false,
          eligibleCount: slotPool.length,
          allowedLevels: slotAllowedLevels,
          allowedPrefixes: slotAllowedPrefixes,
          strictPoolOnly: true,
          targetYearHint: explicitYearHint || undefined,
        });
        emittedInBucketIdx++;
        bucketCoveredCp[b.id] = (bucketCoveredCp[b.id] || 0) + step;
        if (aosCode) aosCoveredCp[aosCode] = (aosCoveredCp[aosCode] || 0) + step;
        remNeed -= step;
      }
    }

    // 3. Emit typed placeholders for remaining open Listed / Elective CP (honoring elective caps, 300/500-level mins, maxCp caps, & 2-CP remainders!)
    let remCp = Math.max(0, targetStudyCp - accCp);
    const electiveBucketObj = activeBuckets.find((b) => b.category === "elective") || null;
    // Only reuse Listed / Capstone buckets that still have remaining cpMax headroom (never reuse a capped 6-CP bucket like BIS Language Listed for 96 CP of open space!)
    const listedBuckets = activeBuckets.filter((b) => {
      if (b.category !== "listed" && b.category !== "capstone") return false;
      const hasCap = b.cpMax !== null && b.cpMax !== undefined;
      if (hasCap && (bucketCoveredCp[b.id] || 0) >= b.cpMax) return false;
      return true;
    });
    const hasElectiveBucket = Boolean(electiveBucketObj);
    const hasListedBucket = listedBuckets.length > 0;
    const listedPoolCodes = [];
    for (const lb of listedBuckets) {
      for (const c of lb.units || []) {
        if (!chosenSet.has(c) && !listedPoolCodes.includes(c) && isUnitAvailableForPlan(getUnit(c, data, nextPlan.customUnits))) {
          listedPoolCodes.push(c);
        }
      }
    }
    const singleListedBucket = listedBuckets.length === 1 ? listedBuckets[0] : null;
    const singleListedName = singleListedBucket ? makeShortBucketName(singleListedBucket) : "Listed";

    // Detect if the course has unselected Majors/Minors/Specialisations (e.g. BIS/BA/BBUS default board before picking a Major)
    const hasUnselectedAos =
      (course.structureConfig.aosMode === "dynamic" &&
        getDynamicAOSGroups(course, nextPlan, data).some(
          (g) => !g.isMandatorySingle && !g.isOptional && !(nextPlan.dynamicAosSelections || {})[g.id]
        )) ||
      (["bsc", "bcomp", "bit01", "single_major"].includes(course.structureConfig.aosMode) &&
        (nextPlan.selectedMajors || []).filter(Boolean).length === 0);

    const maxOpenElectiveCp = hasElectiveBucket
      ? (electiveBucketObj.cpMax !== null && electiveBucketObj.cpMax !== undefined ? electiveBucketObj.cpMax : remCp)
      : 0;
    let openElectiveRemaining = hasUnselectedAos ? remCp : maxOpenElectiveCp;
    let remaining300Need = getRuleMinNeed(min300Rule);
    let remaining500Need = getRuleMinNeed(min500Rule);
    let remainingBcomp300Need = bcomp300Rule ? Math.max(0, 36 - guaranteedCosc300Cp) : 0;

    // Also satisfy 200-level prerequisite CP floors on mandatory concrete units (e.g. ZOOL326 requires 24 CP at 200-level in ZOOLOM002 & BZOOL!)
    let required200Floor = 0;
    for (const cu of chosenList) {
      const cpm = cu.prereqMeta;
      if (!cpm || (cpm.pgWaiver && isHonoursOrPostgrad(course.studyLevel))) continue;
      if (cpm.levelCp && cpm.levelCp.cp > 0 && Array.isArray(cpm.levelCp.levels) && cpm.levelCp.levels.length === 1 && cpm.levelCp.levels[0] === 200 && !cpm.levelCp.prefixes) {
        if (cpm.levelCp.cp > required200Floor) required200Floor = cpm.levelCp.cp;
      }
    }
    let remaining200Need = Math.max(0, required200Floor - (guaranteedLvlCp[200] || 0));

    while (remCp > 0) {
      const step = remCp >= 6 ? 6 : remCp;
      let slotKind = "listed";
      let category = "listed";
      let strictPoolOnly = true;
      let bucketId = singleListedBucket ? singleListedBucket.id : null;
      let bucketTitle = singleListedName;
      let choicePool = listedPoolCodes;
      let eligibleCount = listedPoolCodes.length || null;
      let baseName = singleListedBucket ? `${singleListedName} Unit` : "Listed Unit";

      if (hasUnselectedAos && !hasListedBucket) {
        slotKind = "listed_or_elective";
        category = "elective";
        strictPoolOnly = false;
        bucketId = null;
        bucketTitle = "Major / Elective";
        choicePool = [];
        eligibleCount = null;
        baseName = "Major or Elective Unit";
        openElectiveRemaining = Math.max(0, openElectiveRemaining - step);
      } else if (hasElectiveBucket && !hasListedBucket) {
        slotKind = "elective";
        category = "elective";
        strictPoolOnly = false;
        bucketId = null;
        bucketTitle = "Electives";
        choicePool = [];
        eligibleCount = null;
        baseName = "Elective Unit";
        openElectiveRemaining = Math.max(0, openElectiveRemaining - step);
      } else if (hasElectiveBucket && hasListedBucket) {
        if (remCp > openElectiveRemaining) {
          slotKind = "listed";
          category = "listed";
          strictPoolOnly = true;
          bucketId = singleListedBucket ? singleListedBucket.id : null;
          bucketTitle = singleListedBucket ? singleListedName : "Listed Units";
          choicePool = listedPoolCodes;
          eligibleCount = listedPoolCodes.length || null;
          baseName = singleListedBucket ? `${singleListedName} Unit` : "Listed Unit";
        } else {
          slotKind = "listed_or_elective";
          category = "elective";
          strictPoolOnly = false;
          bucketId = null;
          bucketTitle = "Listed or Elective";
          choicePool = [];
          eligibleCount = null;
          baseName = "Listed or Elective Unit";
          openElectiveRemaining = Math.max(0, openElectiveRemaining - step);
        }
      } else if (!hasElectiveBucket && !hasListedBucket) {
        slotKind = "listed_or_elective";
        category = "elective";
        strictPoolOnly = false;
        bucketId = null;
        bucketTitle = "Major / Listed";
        choicePool = [];
        eligibleCount = null;
        baseName = "Major or Listed Unit";
      }

      let slotAllowedLevels = null;
      let slotAllowedPrefixes = null;
      let targetYearHint = null;

      if (step >= 6) {
        if (remainingBcomp300Need > 0) {
          slotAllowedLevels = [300];
          slotAllowedPrefixes = ["COSC"];
          baseName = `300-level COSC ${baseName}`;
          remainingBcomp300Need = Math.max(0, remainingBcomp300Need - step);
          remaining300Need = Math.max(0, remaining300Need - step);
          targetYearHint = Math.min(stdYears, 3);
        } else if (remaining500Need > 0) {
          slotAllowedLevels = [500];
          baseName = `500-level ${baseName}`;
          remaining500Need = Math.max(0, remaining500Need - step);
          targetYearHint = Math.min(stdYears, 2);
        } else if (remaining300Need > 0) {
          slotAllowedLevels = [300];
          baseName = `300-level ${baseName}`;
          remaining300Need = Math.max(0, remaining300Need - step);
          targetYearHint = Math.min(stdYears, 3);
        } else if (remaining200Need > 0) {
          slotAllowedLevels = [200];
          baseName = `200-level ${baseName}`;
          remaining200Need = Math.max(0, remaining200Need - step);
          targetYearHint = Math.min(stdYears, 2);
        } else {
          // If active maxCp level rules are already saturated (e.g. MDSC 200/300 <= 12 CP), exclude capped levels
          const capped = getCappedLevelsSet();
          if (capped.size > 0 && choicePool.length > 0) {
            const availLvls = Array.from(
              new Set(choicePool.map((c) => getUnit(c, data, nextPlan.customUnits)?.level ?? 100))
            )
              .filter((l) => !capped.has(l))
              .sort((a, z) => a - z);
            if (availLvls.length > 0 && availLvls.length < 4) {
              slotAllowedLevels = availLvls;
              choicePool = choicePool.filter((c) =>
                availLvls.includes(getUnit(c, data, nextPlan.customUnits)?.level ?? 100)
              );
              eligibleCount = choicePool.length;
              baseName = `${availLvls.join("/")}-level ${baseName}`;
            }
          }
        }
      }

      const label = step !== 6 ? `Choose ${baseName} (${step} CP)` : `Choose ${baseName}`;
      registerPlaceholder({
        label,
        slotKind,
        category,
        bucketId,
        bucketTitle,
        cp: step,
        choicePool: slotAllowedLevels && choicePool.length
          ? choicePool.filter((c) => slotAllowedLevels.includes(getUnit(c, data, nextPlan.customUnits)?.level ?? 100))
          : choicePool,
        hintCodes: [],
        strictHints: false,
        eligibleCount:
          slotAllowedLevels && choicePool.length
            ? choicePool.filter((c) => slotAllowedLevels.includes(getUnit(c, data, nextPlan.customUnits)?.level ?? 100)).length
            : eligibleCount,
        allowedLevels: slotAllowedLevels,
        allowedPrefixes: slotAllowedPrefixes,
        strictPoolOnly,
        targetYearHint: targetYearHint || (slotKind === "listed" ? Math.min(stdYears, 2) : Math.min(stdYears, 2)),
      });
      remCp -= step;
    }

    // Helper: compute minimum calendar-trimester distance from taking unit at `fromTri` to dependent `depUnit`
    function minTriStepGap(fromTri, depUnit, allowT3) {
      const depTris = getUnitEffectiveTrimesters(depUnit, maxPlanYear);
      let best = 99;
      for (const dt of depTris) {
        if (dt === 3 && !allowT3 && depTris.length > 1) continue;
        if (allowT3) {
          const diff = dt > fromTri ? dt - fromTri : 3 - fromTri + dt;
          if (diff < best) best = diff;
        } else {
          const a = fromTri === 1 ? 0 : 1;
          const b = dt === 1 ? 0 : 1;
          const diff = b > a ? b - a : 2 - a + b;
          if (diff < best) best = diff;
        }
      }
      return best === 99 ? 1 : best;
    }

    // Compute transitive critical-path span (in active trimesters) for every remaining concrete unit!
    function computeCriticalSpans(remUnits, doneSet, allowT3) {
      const remByCode = new Map(remUnits.map((u) => [u.code, u]));
      const depEdges = new Map();
      for (const v of remUnits) {
        const pm = v.prereqMeta;
        if (pm && pm.codes && pm.codes.length && !(pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel))) {
          if (!(pm.tokens && pm.tokens.length && evalPrereqTokens(pm.tokens, doneSet))) {
            for (const reqCode of pm.codes) {
              if (remByCode.has(reqCode)) {
                if (!depEdges.has(reqCode)) depEdges.set(reqCode, []);
                depEdges.get(reqCode).push(v);
              }
            }
          }
        }
        if (!isCoreqMetBySet(v, doneSet)) {
          for (const reqCode of getApplicableCoreqCodes(v)) {
            if (remByCode.has(reqCode)) {
              if (!depEdges.has(reqCode)) depEdges.set(reqCode, []);
              depEdges.get(reqCode).push(v);
            }
          }
        }
        // Directional bridging precedence (only if both bridging & higher unit somehow remain mandatory together)
        for (const other of remUnits) {
          if (other.code !== v.code && (other.restrictedUnits || []).includes(v.code) && !isMutualRestriction(other, v)) {
            if (!depEdges.has(other.code)) depEdges.set(other.code, []);
            depEdges.get(other.code).push(v);
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
        const uTris = getUnitEffectiveTrimesters(u, maxPlanYear);
        const fromTri = curTriHint || uTris[0] || 1;
        let maxSpan = 1;
        for (const dep of depEdges.get(code) || []) {
          const gap = minTriStepGap(fromTri, dep, allowT3);
          const depTris = getUnitEffectiveTrimesters(dep, maxPlanYear);
          const depFirstTri = depTris.find((t) => allowT3 || t !== 3) || depTris[0] || 1;
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

    // Pool membership is stable across trials. Offering year and prerequisites are
    // evaluated against each simulated trimester before a spread slot is reserved.
    const t3Pools = new Map();
    function getT3Pool(pe) {
      const sl = pe.slot;
      if (t3Pools.has(pe.source)) return t3Pools.get(pe.source);
      // Use the picker scope for a generic Listed slot. Its internal shortlist can
      // omit course-listed choices the student can actually select on the board.
      const spec = parseSlotSpec({ ...sl, replaceSlotId: sl.id }, resolved, course, data);
      let codes = pe.choicePool.length ? pe.choicePool : Array.from(spec.coursePoolMap.keys());
      if (!pe.choicePool.length && (!sl.strictPoolOnly || spec.allowsElectives)) {
        codes = [...Object.keys(data.units), ...Object.keys(nextPlan.customUnits || {})];
      }
      const valid = (u) => u && (!chosenSet.has(u.code) || u.repeatable) && !u.t3RepeatOnly &&
        !isUnitExcludedForCourse(u, course) && getUnitEffectiveTrimesters(u, maxPlanYear).includes(3) &&
        (u.cp ?? 6) === (sl.cp ?? 6) && (!sl.allowedLevels || sl.allowedLevels.includes(u.level)) &&
        (!sl.allowedPrefixes || sl.allowedPrefixes.includes(u.prefix)) &&
        (!isUndergradOrPathway(course.studyLevel) || u.level < 500 || allActiveNonElectiveUnitSet.has(u.code));
      const filterCodes = (pool) => Array.from(new Set(pool), (c) => getUnit(c, data, nextPlan.customUnits)).filter(valid);
      let units = filterCodes(codes);
      if (!units.length && !sl.bucketId && sl.slotKind === "listed" && !spec.isPureHintChoice) {
        units = filterCodes(allActiveNonElectiveUnitSet);
        if (!units.length) units = filterCodes(getCourseUnitIndex(data).get(course.code)?.units || []);
      }
      t3Pools.set(pe.source, units);
      return units;
    }

    // 4. Placeholder-Aware Chronological Trimester Scheduling ('none' | 'spread' | 'accelerate')
    function simulateSchedule(mode, {
      relaxedTris = new Set(), prioritizeLimitedChoices = false, reserveLimit = 12, deferToT3 = false,
    } = {}) {
      const baseMax = nextPlan.studyLoad === "Part-time" ? 12 : 24;
      const remUnits = chosenList.map((u) => u);
      const remPh = placeholderEntries.map((pe) => ({
        source: pe,
        slot: { ...pe.slot, id: uid("ph") },
        choicePool: [...pe.choicePool],
        targetYearHint: pe.targetYearHint,
        bucketId: pe.bucketId,
      }));
      // Keep enough distinct unit choices for every T3 placeholder. An augmenting
      // path lets an earlier flexible slot give its unit to a later constrained one.
      const t3Assignments = new Map();
      function matchT3Choice(choices, seen) {
        for (const u of choices) {
          if (u.repeatable) return true;
          if (seen.has(u.code)) continue;
          seen.add(u.code);
          const previous = t3Assignments.get(u.code);
          if (!previous || matchT3Choice(previous, seen)) {
            t3Assignments.set(u.code, choices);
            return true;
          }
        }
        return false;
      }
      const doneSet = new Set();
      const completedPlaceholders = [];
      let doneCp = resolved.advancedStandingCp;
      const donePrefixCp = {};
      const doneLevelCp = {};
      const donePrefixLevelCp = {};
      const doneUnitCpMap = new Map();
      const carryOverByChrono = {};
      const carrySmallByChrono = {};
      const simYears = [];
      const safetyYears = nextPlan.studyLoad === "Part-time" ? 12 : 8;
      const startTri = nextPlan.commencingTrimester || 1;

      function isUnitReadyWithPh(u, doneCtx) {
        if (isPrereqReady(u, doneSet, doneCp, donePrefixCp, course, doneCtx)) return true;
        const pm = u.prereqMeta;
        if (!pm || (pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel))) return true;
        if (
          pm.tokens &&
          pm.tokens.length > 0 &&
          completedPlaceholders.length > 0 &&
          arePrereqTokensGuaranteedByPlaceholders(pm.tokens, pm.codes, doneSet, completedPlaceholders)
        ) {
          // Verify non-token requirements (minCp, prefixCp, levelCp) via a synthetic token-satisfied unit set!
          const syntheticUnits = new Set(doneSet);
          for (const ph of completedPlaceholders) {
            if (ph.choicePool.length > 0 && ph.choicePool.length <= 8) {
              for (const c of ph.choicePool) syntheticUnits.add(c);
            }
          }
          const synthCtx = { ...doneCtx, units: syntheticUnits };
          return evaluatePrereqMeta(u, synthCtx, true).ok;
        }
        return false;
      }

      // Does placeholder `pe` potentially unlock an unmet prerequisite of any remaining concrete unit?
      function doesPhUnlockRemainingUnit(pe) {
        if (!pe.choicePool || pe.choicePool.length === 0 || pe.choicePool.length > 8) return false;
        return remUnits.some((ru) => {
          const pm = ru.prereqMeta;
          if (!pm || !pm.codes || !pm.codes.length) return false;
          if (pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel)) return false;
          if (pm.tokens && pm.tokens.length && evalPrereqTokens(pm.tokens, doneSet)) return false;
          return pe.choicePool.some((c) => pm.codes.includes(c));
        });
      }

      for (let y = 1; y <= safetyYears; y++) {
        if (remUnits.length === 0 && remPh.length === 0) break;
        const planYear = 2026 + y;
        const yrObj = {
          id: uid("yr"),
          yearNum: y,
          year: planYear,
          name: `Year ${y} (${planYear})`,
          trimesters: { 1: [], 2: [], 3: [] },
        };

        const yearStartCp = doneCp;
        const reservedForT3 = new Set();
        let reservedT3Cp = 0;
        for (const tNum of [1, 2, 3]) {
          if (y === 1 && tNum < startTri) continue;
          if (remUnits.length === 0 && remPh.length === 0) break;

          const chrono = (y - 1) * 3 + (tNum - 1);
          const allowGeneralT3 = mode === "accelerate" || mode === "spread" || (y === 1 && startTri === 3);

          const isSpread = mode === "spread";
          let maxThisTri = baseMax;
          if (isSpread) {
            if (tNum === 3) maxThisTri = 12;
            else if (!relaxedTris.has(chrono)) maxThisTri = Math.min(baseMax, 18);
          }
          const yearCpBeforeTri = doneCp - yearStartCp;
          let directCp = 0;

          let triEffCp = carryOverByChrono[chrono] || 0;
          let triSmallEff = carrySmallByChrono[chrono] || 0;
          const { spans: critSpans, depEdges } = computeCriticalSpans(remUnits, doneSet, allowGeneralT3);
          const hasUnder300Rem =
            remUnits.some((x) => (x.level || 100) < 300) ||
            remPh.some((pe) => !pe.slot.levelMin || pe.slot.levelMin < 300);

          const eligible = remUnits.filter((u) => {
            // Rolling-start gate: do not place before u.rollingStartYear!
            if (u.offered2027 === false && u.rollingStartYear && planYear < u.rollingStartYear) {
              return false;
            }
            const uTris = getUnitEffectiveTrimesters(u, planYear);
            const offeredHere = uTris.length === 0 || uTris.includes(tNum);
            if (!offeredHere) return false;
            if (tNum === 3 && u.t3RepeatOnly) return false;
            // Year-1 300-level guard based on targetStudyCp & doneCp (fixes BEDECE!)
            if (
              course.studyLevel === "Undergraduate" &&
              y === 1 &&
              u.level >= 300 &&
              targetStudyCp >= 96 &&
              doneCp < 48 &&
              hasUnder300Rem
            ) {
              return false;
            }
            if (tNum === 3 && !allowGeneralT3) {
              return uTris.length === 1 && uTris[0] === 3;
            }
            return true;
          });

          const doneCtx = {
            units: doneSet,
            cp: doneCp,
            prefixCp: donePrefixCp,
            levelCp: doneLevelCp,
            prefixLevelCp: donePrefixLevelCp,
            unitCpMap: doneUnitCpMap,
            course,
            plan: nextPlan,
          };

          const otherMainTri = tNum === 1 ? 2 : 1;
          eligible.sort((a, b) => {
            const aReady = isUnitReadyWithPh(a, doneCtx);
            const bReady = isUnitReadyWithPh(b, doneCtx);
            if (aReady !== bReady) return aReady ? -1 : 1;

            const aSpan = critSpans[a.code] || 1;
            const bSpan = critSpans[b.code] || 1;
            if (aSpan !== bSpan) return bSpan - aSpan;

            const aTris = getUnitEffectiveTrimesters(a, planYear);
            const bTris = getUnitEffectiveTrimesters(b, planYear);
            const aLocked = aTris.length > 0 && !aTris.includes(otherMainTri) ? 0 : 1;
            const bLocked = bTris.length > 0 && !bTris.includes(otherMainTri) ? 0 : 1;
            if (tNum !== 3 && aLocked !== bLocked) return aLocked - bLocked;

            if (allowGeneralT3 && tNum !== 3) {
              const aHasT3 = aTris.includes(3) ? 1 : 0;
              const bHasT3 = bTris.includes(3) ? 1 : 0;
              if (!(depEdges.get(a.code)?.length) && !(depEdges.get(b.code)?.length) && aHasT3 !== bHasT3) {
                return aHasT3 - bHasT3;
              }
            }

            if (nextPlan.preferredMode) {
              const aModeOk = getUnitModesForTri(a, tNum).includes(nextPlan.preferredMode) ? 0 : 1;
              const bModeOk = getUnitModesForTri(b, tNum).includes(nextPlan.preferredMode) ? 0 : 1;
              if (aModeOk !== bModeOk) return aModeOk - bModeOk;
            }

            if (a.level !== b.level) return a.level - b.level;
            return (depEdges.get(b.code)?.length || 0) - (depEdges.get(a.code)?.length || 0);
          });

          const totalRemainingCp =
            remUnits.reduce((s, x) => s + (x.cp ?? 6), 0) +
            remPh.reduce((s, x) => s + (x.slot.cp ?? 6), 0);
          const placedThisTri = [];
          const placedPhThisTri = [];
          const placedIntInfos = []; // { code, intInfo }
          const clashDeferred = [];

          function wouldClashIntensive(u) {
            const intU = getUnitIntensiveForTri(u, tNum, nextPlan.preferredMode);
            if (!intU || intU.kind !== "Mandatory" || !intU.applicableForMode) return false;
            for (const other of placedIntInfos) {
              if (doCampusesClash(intU, other.intInfo)) return true;
              if (checkUnitIntensiveDateOverlap(u.code, intU, other.code, other.intInfo)) return true;
            }
            return false;
          }

          function fitsInTri(u) {
            const lSpec = getUnitLoadSpec(u, nextPlan.studyLoad);
            const effCp = lSpec.effCp;
            if (isSpread && yearCpBeforeTri + directCp + (u.cp ?? 6) > 48 && (u.cp ?? 6) <= 12) return false;
            const nextSmall = triSmallEff + (lSpec.isSmallUnit ? effCp : 0);
            const allowance = !isSpread && nextSmall > 0 ? Math.min(3, nextSmall) : 0;
            if (triEffCp + effCp <= maxThisTri + allowance) return true;
            if (triEffCp === 0 && effCp > maxThisTri) return true;
            return false;
          }

          function commitPlacement(u) {
            const lSpec = getUnitLoadSpec(u, nextPlan.studyLoad);
            yrObj.trimesters[tNum].push({ id: uid("u"), type: "unit", code: u.code });
            directCp += u.cp ?? 6;
            triEffCp += lSpec.effCp;
            if (lSpec.isSmallUnit) triSmallEff += lSpec.effCp;
            if (lSpec.spanTris > 1 && lSpec.carryPerTri > 0) {
              for (let k = 1; k < lSpec.spanTris; k++) {
                carryOverByChrono[chrono + k] = (carryOverByChrono[chrono + k] || 0) + lSpec.carryPerTri;
                if (lSpec.isSmallUnit) {
                  carrySmallByChrono[chrono + k] = (carrySmallByChrono[chrono + k] || 0) + lSpec.carryPerTri;
                }
              }
            }
            placedThisTri.push(u);
            const intU = getUnitIntensiveForTri(u, tNum, nextPlan.preferredMode);
            if (intU && intU.kind === "Mandatory" && intU.applicableForMode) {
              placedIntInfos.push({ code: u.code, intInfo: intU });
            }
            const idx = remUnits.findIndex((x) => x.code === u.code);
            if (idx !== -1) remUnits.splice(idx, 1);
          }

          function tryPlaceInTri(u, allowIntensiveClash) {
            if (!remUnits.some((x) => x.code === u.code)) return false;
            if (!fitsInTri(u)) return false;

            const hasPendingBridging = [...remUnits, ...placedThisTri].some(
              (other) =>
                other.code !== u.code &&
                (other.restrictedUnits || []).includes(u.code) &&
                !isMutualRestriction(other, u)
            );
            if (hasPendingBridging) return false;

            const readyNow = isUnitReadyWithPh(u, doneCtx);
            if (!readyNow) {
              const pm = u.prereqMeta;
              const hasFutureCodePrereq = (pm?.codes || []).some(
                (c) =>
                  remUnits.some((x) => x.code === c) ||
                  placedThisTri.some((x) => x.code === c) ||
                  remPh.some((pe) => pe.choicePool.length > 0 && pe.choicePool.length <= 8 && pe.choicePool.includes(c)) ||
                  placedPhThisTri.some((pe) => pe.choicePool.length > 0 && pe.choicePool.length <= 8 && pe.choicePool.includes(c))
              );
              const hasPlaceableHelperForMinCp =
                remPh.length > 0 ||
                placedThisTri.length > 0 ||
                placedPhThisTri.length > 0 ||
                remUnits.some(
                  (x) => x.code !== u.code && !(x.prereqMeta && x.prereqMeta.minCp > doneCp)
                );
              const hasFutureMinCp =
                pm?.minCp > 0 &&
                doneCp < pm.minCp &&
                hasPlaceableHelperForMinCp &&
                doneCp + totalRemainingCp - (u.cp ?? 6) >= pm.minCp;
              let hasFuturePrefixCp = false;
              if (pm?.prefixCp) {
                const prefs = pm.prefixCp.prefixes || [pm.prefixCp.prefix];
                const curP = prefs.reduce((s, pr) => s + (donePrefixCp[pr] || 0), 0);
                const remP = remUnits
                  .filter((x) => x.code !== u.code && prefs.includes(x.prefix))
                  .reduce((s, x) => s + (x.cp ?? 6), 0);
                const curTriP = placedThisTri
                  .filter((x) => prefs.includes(x.prefix))
                  .reduce((s, x) => s + (x.cp ?? 6), 0);
                const remPhP = remPh
                  .filter((pe) => {
                    if (!pe.choicePool.length) return false;
                    const ps = new Set(pe.choicePool.map((c) => getUnit(c, data, nextPlan.customUnits)?.prefix || "").filter(Boolean));
                    return ps.size === 1 && prefs.includes(Array.from(ps)[0]);
                  })
                  .reduce((s, pe) => s + (pe.slot.cp ?? 6), 0);
                if (curP < pm.prefixCp.cp && curP + remP + curTriP + remPhP >= pm.prefixCp.cp) {
                  hasFuturePrefixCp = true;
                }
              }
              let hasFutureLevelCp = false;
              if (pm?.levelCp && pm.levelCp.cp > 0 && Array.isArray(pm.levelCp.levels) && pm.levelCp.levels.length > 0) {
                const lvls = pm.levelCp.levels;
                const curL = lvls.reduce((s, l) => s + (doneLevelCp[l] || 0), 0);
                const remL = remUnits
                  .filter((x) => x.code !== u.code && lvls.includes(x.level ?? 100))
                  .reduce((s, x) => s + (x.cp ?? 6), 0);
                const curTriL = placedThisTri
                  .filter((x) => lvls.includes(x.level ?? 100))
                  .reduce((s, x) => s + (x.cp ?? 6), 0);
                const remPhL = remPh
                  .filter((pe) => {
                    if (pe.slot.allowedLevels && pe.slot.allowedLevels.length === 1) {
                      return lvls.includes(pe.slot.allowedLevels[0]);
                    }
                    if (!pe.choicePool.length) return mode !== "none" &&
                      (!pe.slot.allowedLevels || pe.slot.allowedLevels.some((l) => lvls.includes(l)));
                    const pls = new Set(pe.choicePool.map((c) => getUnit(c, data, nextPlan.customUnits)?.level ?? 100));
                    return pls.size === 1 && lvls.includes(Array.from(pls)[0]);
                  })
                  .reduce((s, pe) => s + (pe.slot.cp ?? 6), 0);
                if (curL < pm.levelCp.cp && curL + remL + curTriL + remPhL >= pm.levelCp.cp) {
                  hasFutureLevelCp = true;
                }
              }
              if (hasFutureCodePrereq || hasFutureMinCp || hasFuturePrefixCp || hasFutureLevelCp) return false;
            }

            // Co-requisite check: co-place missing co-requisite group from remUnits if possible (incl. solo 24-CP pairs in Part-Time!)
            const currentPlusDone = new Set(doneSet);
            placedThisTri.forEach((x) => currentPlusDone.add(x.code));
            if (!isCoreqMetBySet(u, currentPlusDone)) {
              const reqCodes = getApplicableCoreqCodes(u);
              const remCoreqs = reqCodes
                .map((rc) => remUnits.find((x) => x.code === rc))
                .filter(Boolean);
              if (remCoreqs.length > 0) {
                const singleSat = remCoreqs.find((rc) => {
                  const testSet = new Set(currentPlusDone);
                  testSet.add(rc.code);
                  return isCoreqMetBySet(u, testSet);
                });
                const toCoPlace = singleSat ? [singleSat] : remCoreqs;
                const allOk = toCoPlace.every((rc) => {
                  const rcTris = getUnitEffectiveTrimesters(rc, planYear);
                  const reqOffered = rcTris.length === 0 || rcTris.includes(tNum);
                  const reqReady = isUnitReadyWithPh(rc, doneCtx);
                  return reqOffered && reqReady;
                });
                const combinedEff =
                  getUnitLoadSpec(u, nextPlan.studyLoad).effCp +
                  toCoPlace.reduce((s, rc) => s + getUnitLoadSpec(rc, nextPlan.studyLoad).effCp, 0);
                const fitsCoPlace =
                  isSpread ? triEffCp + combinedEff <= maxThisTri &&
                    yearCpBeforeTri + directCp + (u.cp ?? 6) + toCoPlace.reduce((sum, rc) => sum + (rc.cp ?? 6), 0) <= 48 :
                  triEffCp + combinedEff <= maxThisTri + 3 ||
                  (triEffCp === 0 && combinedEff <= 24);
                if (allOk && fitsCoPlace) {
                  if (
                    !allowIntensiveClash &&
                    (toCoPlace.some((rc) => wouldClashIntensive(rc)) || wouldClashIntensive(u))
                  ) {
                    clashDeferred.push(u);
                    return false;
                  }
                  for (const rc of toCoPlace) commitPlacement(rc);
                } else {
                  return false;
                }
              }
            }

            if (!allowIntensiveClash && wouldClashIntensive(u)) {
              clashDeferred.push(u);
              return false;
            }

            commitPlacement(u);
            return true;
          }

          // A flexible terminal unit may be the only task movable out of a crowded
          // trimester. Give constrained choices first access, then backfill unused room.
          const flexibleUnits = new Set();
          if (prioritizeLimitedChoices && tNum < 3) {
            for (const u of eligible) {
              const later = getUnitEffectiveTrimesters(u, planYear).filter((t) => t > tNum && (t !== 3 || !u.t3RepeatOnly));
              if ((isSpread || deferToT3 ? later.length : later.includes(tNum + 1)) && !depEdges.has(u.code) && !getApplicableCoreqCodes(u).length &&
                  !remPh.some((pe) => pe.choicePool.length && pe.choicePool.every((c) =>
                    getUnit(c, data, nextPlan.customUnits)?.prereqMeta?.codes?.includes(u.code)))) {
                if (deferToT3 && later.includes(3) && reservedT3Cp + (u.cp ?? 6) <= baseMax &&
                    !reservedForT3.has(u)) {
                  reservedForT3.add(u);
                  reservedT3Cp += u.cp ?? 6;
                }
                flexibleUnits.add(u);
              }
            }
          }

          // Pass 1: Place ready concrete units while avoiding campus & intensive date clashes
          let placedAnyInPass = true;
          while (placedAnyInPass) {
            placedAnyInPass = false;
            for (const u of eligible) {
              if (!(tNum < 3 && reservedForT3.has(u)) && !flexibleUnits.has(u) && tryPlaceInTri(u, false)) placedAnyInPass = true;
            }
          }

          // Pass 2: Allow intensive clash ONLY in final standard year OR when deferring delays graduation
          const remainingStdActiveTris = Math.max(1, (stdYears - y) * 2 + (tNum === 1 ? 2 : 1));
          for (const u of clashDeferred) {
            if (triEffCp >= maxThisTri) break;
            const uSpan = critSpans[u.code] || 1;
            const mustPlaceNow = y >= stdYears || uSpan >= remainingStdActiveTris;
            if (mustPlaceNow) {
              tryPlaceInTri(u, true);
            }
          }

          // Pass 3: Place typed student-choice placeholders in chronological & pedagogical order!
          // (Also allow T3-only bucket placeholders like GCTSP [BUS500/LLM585] to schedule in T3 even when T3=off!)
          const hasT3OnlyPh =
            tNum === 3 &&
            !allowGeneralT3 &&
            remPh.some((pe) => {
              if (!pe.choicePool || !pe.choicePool.length) return false;
              const allTris = new Set();
              for (const c of pe.choicePool) {
                const cu = getUnit(c, data, nextPlan.customUnits);
                if (!cu) continue;
                for (const tr of getUnitEffectiveTrimesters(cu, planYear)) allTris.add(tr);
              }
              return allTris.size === 1 && allTris.has(3);
            });

          if ((tNum !== 3 || allowGeneralT3 || hasT3OnlyPh) && remPh.length > 0) {
            const readyT3Choices = new Map();
            function t3Choices(pe) {
              if (!readyT3Choices.has(pe)) {
                const choices = [];
                for (const u of getT3Pool(pe)) {
                  if (getUnitEffectiveTrimesters(u, planYear).includes(3) && isUnitReadyWithPh(u, doneCtx)) choices.push(u);
                  // At most one distinct non-repeatable choice is needed per placeholder in the entire plan.
                  if (choices.length >= placeholderEntries.length) break;
                }
                readyT3Choices.set(pe, choices);
              }
              return readyT3Choices.get(pe);
            }
            // Preserve scarce T3 choices only while another eligible slot can fill this trimester.
            const reservable = new Set();
            if (isSpread && tNum !== 3) {
              const readyConcrete = remUnits.filter((u) => !u.t3RepeatOnly &&
                getUnitEffectiveTrimesters(u, planYear).includes(3) && isUnitReadyWithPh(u, doneCtx));
              let capacity = Math.max(0, reserveLimit - reservedT3Cp - readyConcrete
                .filter((u) => !reservedForT3.has(u)).reduce((sum, u) => sum + (u.cp ?? 6), 0));
              const bucketCounts = new Map();
              for (const pe of remPh) {
                if (reservedForT3.has(pe)) {
                  reservable.add(pe);
                  bucketCounts.set(pe.bucketId, (bucketCounts.get(pe.bucketId) || 0) + 1);
                }
              }
              for (const pe of remPh) {
                const cp = pe.slot.cp ?? 6;
                if (!capacity) break;
                if (reservable.has(pe) || cp > capacity || doesPhUnlockRemainingUnit(pe)) continue;
                const poolCount = t3Choices(pe).length;
                if (poolCount <= (bucketCounts.get(pe.bucketId) || 0)) continue;
                reservable.add(pe);
                bucketCounts.set(pe.bucketId, (bucketCounts.get(pe.bucketId) || 0) + 1);
                capacity -= cp;
                if (prioritizeLimitedChoices) {
                  reservedForT3.add(pe);
                  reservedT3Cp += cp;
                }
              }
            }
            const placedBucketPhCount = {}; // bucketId -> count placed in this trimester

            function isPhT3Only(pe) {
              if (!pe.choicePool || !pe.choicePool.length) return false;
              const allTris = new Set();
              for (const c of pe.choicePool) {
                const cu = getUnit(c, data, nextPlan.customUnits);
                if (!cu) continue;
                for (const tr of getUnitEffectiveTrimesters(cu, planYear)) allTris.add(tr);
              }
              return allTris.size === 1 && allTris.has(3);
            }

            // Phase 4: Intra-Year T1 vs T2 Proportional & Offering-Aware Balancing!
            // Prevents T1 from front-loading every constrained placeholder (Major, Minor, Core, Capstone,
            // L300/L200/L500, Bucket Listed) while T2 holds flexible Elective / unlevelled Listed fillers.
            function getPhFlexRank(pe) {
              const sl = pe.slot;
              const hasLvl = (Array.isArray(sl.allowedLevels) && sl.allowedLevels.length > 0) || Boolean(sl.levelMin || sl.levelMax);
              const hasPref = Array.isArray(sl.allowedPrefixes) && sl.allowedPrefixes.length > 0;
              if (!hasLvl && !hasPref && !sl.bucketId && !sl.strictHints && (sl.slotKind === "elective" || sl.slotKind === "listed_or_elective" || sl.category === "elective")) {
                return 0; // open flexible elective / listed-or-elective filler
              }
              if (!hasLvl && !hasPref && !sl.bucketId && !sl.strictHints && sl.slotKind === "listed") {
                return 1; // open unlevelled listed filler
              }
              return 2; // constrained placeholder (Core, Major, Minor, Capstone, L300/L200/L500, Bucket Listed)
            }

            function getPhBalanceGroupKey(pe) {
              const sl = pe.slot;
              const lvls = (sl.allowedLevels || []).join(",");
              const prefs = (sl.allowedPrefixes || []).join(",");
              if (sl.strictHints && Array.isArray(sl.hintCodes) && sl.hintCodes.length) {
                return `strict::${pe.bucketId || sl.slotKind}::${sl.hintCodes.join(",")}`;
              }
              if (pe.bucketId) return `b::${pe.bucketId}::${lvls}::${prefs}`;
              return `k::${sl.slotKind}::${lvls}::${prefs}`;
            }

            function countPoolForSpecificTri(pe, checkTri, ctxForTri, checkPrereqs) {
              if (!pe.choicePool || pe.choicePool.length === 0) return 10; // open catalog slot (balanced T1/T2)
              let cnt = 0;
              for (const c of pe.choicePool) {
                const cu = getUnit(c, data, nextPlan.customUnits);
                if (!cu) continue;
                if (cu.offered2027 === false && cu.rollingStartYear && planYear < cu.rollingStartYear) continue;
                const cTris = getUnitEffectiveTrimesters(cu, planYear);
                if (cTris.length > 0 && !cTris.includes(checkTri)) continue;
                if (checkTri === 3 && cu.t3RepeatOnly) continue;
                if (pe.slot.allowedLevels && !pe.slot.allowedLevels.includes(cu.level ?? 100)) continue;
                if (checkPrereqs && !isUnitReadyWithPh(cu, ctxForTri)) continue;
                cnt++;
              }
              return cnt;
            }

            // Build projected T2 state when scheduling T1 so T1 vs T2 balance sees T2 capacity & T2 readiness accurately!
            const enableT1T2Balance = mode === "none" && tNum === 1 && y <= stdYears;
            let estT2PhCap = 0;
            const t1GroupTarget = {};
            const t1GroupT2Ready = {};
            const placedGroupInT1 = {};
            let totalConstrainedPlacedT1 = 0;
            let maxConstrainedT1 = 999;
            let deferredToT2Cp = 0;
            let projectedT2UnitsForYear = [];

            if (enableT1T2Balance) {
              const projDoneSet = new Set(doneSet);
              const projPrefixCp = { ...donePrefixCp };
              const projLevelCp = { ...doneLevelCp };
              const projPrefixLevelCp = { ...donePrefixLevelCp };
              const projUnitCpMap = new Map(doneUnitCpMap);
              for (const pu of placedThisTri) {
                const pCp = pu.cp ?? 6;
                const pLvl = pu.level ?? 100;
                projDoneSet.add(pu.code);
                projUnitCpMap.set(pu.code, pCp);
                projLevelCp[pLvl] = (projLevelCp[pLvl] || 0) + pCp;
                if (pu.prefix) {
                  projPrefixCp[pu.prefix] = (projPrefixCp[pu.prefix] || 0) + pCp;
                  const plk = `${pu.prefix}_${pLvl}`;
                  projPrefixLevelCp[plk] = (projPrefixLevelCp[plk] || 0) + pCp;
                }
              }
              // Project full completed T1 CP (concrete + T1 placeholders to be filled) so T2 minCp prereqs like ENSC220 (18cp) resolve accurately!
              const projDoneCp = doneCp + Math.min(maxThisTri, Math.max(triEffCp, totalRemainingCp));
              const projT2Ctx = {
                units: projDoneSet,
                cp: projDoneCp,
                prefixCp: projPrefixCp,
                levelCp: projLevelCp,
                prefixLevelCp: projPrefixLevelCp,
                unitCpMap: projUnitCpMap,
                course,
                plan: nextPlan,
              };

              // Estimate T2 concrete load & open placeholder capacity in year y
              const t2Carry = carryOverByChrono[chrono + 1] || 0;
              const t2CapBase = mode === "spread" && capYear1To2At18 && nextPlan.studyLoad !== "Part-time" && maxSingleRemEff <= 18 ? 18 : baseMax;
              projectedT2UnitsForYear = remUnits.filter((u) => {
                if (u.offered2027 === false && u.rollingStartYear && planYear < u.rollingStartYear) return false;
                const ut = getUnitEffectiveTrimesters(u, planYear);
                if (ut.length > 0 && !ut.includes(2)) return false;
                if (course.studyLevel === "Undergraduate" && y === 1 && u.level >= 300 && targetStudyCp >= 96 && projDoneCp < 48 && hasUnder300Rem) return false;
                return true;
              });
              let estT2ConcreteCp = 0;
              for (const u of projectedT2UnitsForYear) {
                if (isUnitReadyWithPh(u, projT2Ctx)) {
                  const eff = getUnitLoadSpec(u, nextPlan.studyLoad).effCp;
                  if (t2Carry + estT2ConcreteCp + eff <= t2CapBase + 3) {
                    estT2ConcreteCp += eff;
                  }
                }
              }
              estT2PhCap = Math.max(0, t2CapBase - t2Carry - estT2ConcreteCp);

              if (estT2PhCap >= 6) {
                const t1RemSlotsEst = Math.max(0, Math.floor((maxThisTri - triEffCp) / 6));
                const t2RemSlotsEst = Math.max(0, Math.floor(estT2PhCap / 6));
                const yearTotalSlotsEst = t1RemSlotsEst + t2RemSlotsEst;

                // Group constrained placeholders eligible for year y
                const yrConstrainedByGroup = new Map();
                let totalT2CapableConstrained = 0;
                for (const pe of remPh) {
                  if (getPhFlexRank(pe) < 2) continue;
                  // Skip slots targeted for a strictly later year unless we're in the final year
                  if (pe.targetYearHint > y && y < stdYears) continue;
                  if (course.studyLevel === "Undergraduate" && y === 1 && pe.slot.levelMin >= 300 && targetStudyCp >= 96 && doneCp < 48) continue;
                  const gKey = getPhBalanceGroupKey(pe);
                  if (!yrConstrainedByGroup.has(gKey)) {
                    const t1R = countPoolForSpecificTri(pe, 1, doneCtx, true);
                    const t2R = countPoolForSpecificTri(pe, 2, projT2Ctx, true);
                    yrConstrainedByGroup.set(gKey, { count: 0, t1R, t2R });
                  }
                  const entry = yrConstrainedByGroup.get(gKey);
                  entry.count++;
                  if (entry.t2R > 0) totalT2CapableConstrained++;
                }

                for (const [gKey, info] of yrConstrainedByGroup.entries()) {
                  const kEff = Math.min(info.count, yearTotalSlotsEst);
                  t1GroupT2Ready[gKey] = info.t2R;
                  if (info.t2R === 0 || kEff <= 0) {
                    t1GroupTarget[gKey] = info.count; // T1-only pool — never defer!
                  } else if (info.t1R === 0) {
                    t1GroupTarget[gKey] = 0;
                  } else if (kEff === 1) {
                    // Single constrained slot in year y: defer to T2 if pool is strictly T2-skewed!
                    t1GroupTarget[gKey] = info.t2R > info.t1R ? 0 : 1;
                  } else {
                    // K >= 2 slots in year y: split proportionally to T1:T2 ready counts, bounded to [1, K-1] when both tris have options!
                    const prop = Math.round(kEff * (info.t1R / Math.max(1, info.t1R + info.t2R)));
                    let tgt = Math.max(1, Math.min(kEff - 1, prop));
                    // Never push more slots to T2 than distinct T2-ready units or T2 slot capacity
                    const maxForT2 = Math.min(info.t2R, t2RemSlotsEst);
                    tgt = Math.max(tgt, kEff - maxForT2);
                    t1GroupTarget[gKey] = tgt;
                  }
                }

                // Overall year-level soft cap so multiple distinct K=1 constrained pools also balance across T1 & T2!
                if (totalT2CapableConstrained >= 2) {
                  maxConstrainedT1 = Math.max(1, Math.ceil(Math.min(totalT2CapableConstrained, yearTotalSlotsEst) / 2));
                }
              }
            }

            // Safety guard: never defer a T1 placeholder that unlocks a concrete unit scheduled for T2 of THIS SAME year!
            function doesPhUnlockSameYearT2Unit(pe) {
              if (!enableT1T2Balance || !pe.choicePool || !pe.choicePool.length || pe.choicePool.length > 8) return false;
              return projectedT2UnitsForYear.some((ru) => {
                const pm = ru.prereqMeta;
                if (!pm || !pm.codes || !pm.codes.length) return false;
                if (pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel)) return false;
                if (pm.tokens && pm.tokens.length && evalPrereqTokens(pm.tokens, doneSet)) return false;
                return pe.choicePool.some((c) => pm.codes.includes(c));
              });
            }

            function countReadyPoolInTri(pe, checkPrereqs) {
              if (!pe.choicePool || pe.choicePool.length === 0) return 999; // open elective always available
              let cnt = 0;
              for (const c of pe.choicePool) {
                const cu = getUnit(c, data, nextPlan.customUnits);
                if (!cu) continue;
                if (cu.offered2027 === false && cu.rollingStartYear && planYear < cu.rollingStartYear) continue;
                const cTris = getUnitEffectiveTrimesters(cu, planYear);
                if (cTris.length > 0 && !cTris.includes(tNum)) continue;
                if (tNum === 3 && cu.t3RepeatOnly) continue;
                if (pe.slot.allowedLevels && !pe.slot.allowedLevels.includes(cu.level ?? 100)) continue;
                const cuSpec = getUnitLoadSpec(cu, nextPlan.studyLoad);
                const cuAllow = triSmallEff + (cuSpec.isSmallUnit ? cuSpec.effCp : 0) > 0 ? Math.min(3, triSmallEff + (cuSpec.isSmallUnit ? cuSpec.effCp : 0)) : 0;
                if (triEffCp + cuSpec.effCp > maxThisTri + cuAllow && !(triEffCp === 0 && cuSpec.effCp > maxThisTri)) continue;
                if (checkPrereqs && !isUnitReadyWithPh(cu, doneCtx)) continue;
                cnt++;
              }
              return cnt;
            }

            function hasReadyFlexFillerForT1(constrainedRank, allowRelaxedFlag) {
              return remPh.some((other) => {
                if (getPhFlexRank(other) >= constrainedRank) return false;
                const oCp = other.slot.cp ?? 6;
                const oSmall = oCp > 0 && oCp <= 3 ? oCp : 0;
                const oAllow = triSmallEff + oSmall > 0 ? Math.min(3, triSmallEff + oSmall) : 0;
                if (triEffCp + oCp > maxThisTri + oAllow) return false;
                if (other.choicePool.length > 0) {
                  const alreadyInB = other.bucketId ? (placedBucketPhCount[other.bucketId] || 0) : 0;
                  if (countReadyPoolInTri(other, !allowRelaxedFlag) <= alreadyInB) return false;
                }
                return true;
              });
            }

            const deferredPhSet = new Set();
            let deferredReservedCp = 0;

            function shouldDeferConstrainedToT2(pe, allowRelaxedFlag) {
              if (!enableT1T2Balance || estT2PhCap < 6) return false;
              const rank = getPhFlexRank(pe);
              if (rank < 2) return false;
              const phCp = pe.slot.cp ?? 6;
              const gKey = getPhBalanceGroupKey(pe);
              const t2R = t1GroupT2Ready[gKey] || 0;
              if (t2R <= 0) return false;
              if (doesPhUnlockSameYearT2Unit(pe)) return false;
              const placedInG = placedGroupInT1[gKey] || 0;
              const targetInG = t1GroupTarget[gKey] !== undefined ? t1GroupTarget[gKey] : 1;
              const overGroupCap = placedInG >= targetInG;
              // Never let year-level cap starve a group that hasn't gotten its first T1 slot yet when targetInG >= 1!
              const overYearCap =
                totalConstrainedPlacedT1 >= maxConstrainedT1 &&
                (placedInG > 0 || targetInG === 0) &&
                !doesPhUnlockRemainingUnit(pe);
              if (!overGroupCap && !overYearCap) return false;
              if (!hasReadyFlexFillerForT1(rank, allowRelaxedFlag)) return false;
              if (deferredPhSet.has(pe)) return true;
              if (deferredReservedCp + phCp > estT2PhCap) return false;
              return true;
            }

            // Rank placeholders for this (y, tNum): prereq-unlocking -> Core -> Major/Minor -> Capstone -> Required/Bucket Listed -> Open Listed -> Elective!
            // Applies a soft +700 defer-to-T2 penalty when T1 has reached its proportional share AND a flexible filler can take T1!
            function scorePlaceholderForTri(pe, allowRelaxedFlag) {
              const sl = pe.slot;
              let sc = 0;
              const unlocks = doesPhUnlockRemainingUnit(pe);
              if (unlocks) sc -= 600;

              if (sl.category === "core") sc -= 320;
              else if (["major1", "major2", "minor"].includes(sl.category)) sc -= 240;
              else if (sl.category === "capstone") sc -= 180;
              else if (sl.slotKind === "listed") sc -= sl.bucketId ? 150 : 110;
              else sc += 40; // open listed_or_elective / elective fills after required bucket slots!

              // Prefer matching targetYearHint (100-lvl Core in Y1, 200-lvl in Y2, 300-lvl in Y3!)
              // without ever letting an open elective jump ahead of a ready bucket-scoped Listed/Major slot!
              if (mode === "accelerate") {
                if (pe.source.minimumLevel >= 300 && doneCp < 48) sc += 240;
              } else if (pe.targetYearHint > y) sc += (pe.targetYearHint - y) * 100;
              else if (pe.targetYearHint < y) sc -= 15;

              // Hold explicit 300-level open placeholders to later years when lower-level slots remain
              if (mode !== "accelerate" && sl.levelMin && sl.levelMin >= 300 && y < Math.min(stdYears, 3)) {
                sc += 240;
              }

              // Soft defer-to-T2 penalty when balanced T1 share is met & T2 has room + flexible filler is ready for T1
              if (shouldDeferConstrainedToT2(pe, allowRelaxedFlag)) {
                sc += 700;
              }
              if (prioritizeLimitedChoices && pe.choicePool.length) {
                // Schedule the narrowest choice first, particularly when no later offering exists.
                const later = [2, 3].filter((t) => t > tNum)
                  .reduce((n, t) => n + countPoolForSpecificTri(pe, t, doneCtx, false), 0);
                sc -= 700 / (1 + later) + 200 / pe.choicePool.length;
              }
              return sc;
            }

            let placedPhAny = true;
            while (placedPhAny && remPh.length > 0) {
              placedPhAny = false;
              const allowRelaxed = y >= stdYears && remUnits.length === 0;
              // Reserve T2 room for each newly deferred constrained placeholder (once per slot, never double-counting!)
              if (enableT1T2Balance && estT2PhCap >= 6) {
                for (const candPe of remPh) {
                  if (!deferredPhSet.has(candPe) && shouldDeferConstrainedToT2(candPe, allowRelaxed)) {
                    deferredPhSet.add(candPe);
                    deferredReservedCp += candPe.slot.cp ?? 6;
                  }
                }
              }
              remPh.sort((a, b) => Number(reservable.has(a)) - Number(reservable.has(b)) ||
                scorePlaceholderForTri(a, allowRelaxed) - scorePlaceholderForTri(b, allowRelaxed));

              for (let i = 0; i < remPh.length; i++) {
                const pe = remPh[i];
                if (tNum === 3 && !allowGeneralT3 && !isPhT3Only(pe)) continue;
                if (prioritizeLimitedChoices && reservable.has(pe)) continue;
                const phCp = pe.slot.cp ?? 6;
                const phSmall = phCp > 0 && phCp <= 3 ? phCp : 0;
                const allowance = !isSpread && triSmallEff + phSmall > 0 ? Math.min(3, triSmallEff + phSmall) : 0;
                if (triEffCp + phCp > maxThisTri + allowance) {
                  if (!(triEffCp === 0 && phCp > maxThisTri)) continue;
                }
                if (isSpread && yearCpBeforeTri + directCp + phCp > 48) {
                  continue;
                }
                // Respect Year-1 300-level guard for 300-level placeholders ONLY when lower-level options are actually placeable in this trimester
                if (
                  course.studyLevel === "Undergraduate" &&
                  y === 1 &&
                  pe.slot.levelMin >= 300 &&
                  targetStudyCp >= 96 &&
                  doneCp < 48 &&
                  remPh.some(
                    (other) =>
                      (!other.slot.levelMin || other.slot.levelMin < 300) &&
                      (other.choicePool.length === 0 || countReadyPoolInTri(other, !allowRelaxed) > (other.bucketId ? (placedBucketPhCount[other.bucketId] || 0) : 0))
                  )
                ) {
                  continue;
                }
                // Ensure at least one distinct offered & ready unit exists in this trimester for bucket-scoped placeholders!
                if (pe.choicePool.length > 0) {
                  const alreadyInBucket = pe.bucketId ? (placedBucketPhCount[pe.bucketId] || 0) : 0;
                  const readyCnt = countReadyPoolInTri(pe, !allowRelaxed);
                  if (readyCnt <= alreadyInBucket) {
                    if (mode !== "none" && tNum === 3 ? t3Choices(pe).length <= alreadyInBucket :
                        (!(y > stdYears && countReadyPoolInTri(pe, false) > 0) && !(y > stdYears + 1))) {
                      continue;
                    }
                  }
                }

                if (isSpread && tNum === 3 && !matchT3Choice(t3Choices(pe), new Set())) continue;
                remPh.splice(i, 1);
                if (deferredPhSet.has(pe)) {
                  deferredPhSet.delete(pe);
                  deferredReservedCp = Math.max(0, deferredReservedCp - phCp);
                }
                yrObj.trimesters[tNum].push(pe.slot);
                placedPhThisTri.push(pe);
                if (pe.bucketId) placedBucketPhCount[pe.bucketId] = (placedBucketPhCount[pe.bucketId] || 0) + 1;
                if (enableT1T2Balance && getPhFlexRank(pe) === 2) {
                  const gKey = getPhBalanceGroupKey(pe);
                  placedGroupInT1[gKey] = (placedGroupInT1[gKey] || 0) + 1;
                  totalConstrainedPlacedT1++;
                }
                directCp += phCp;
                triEffCp += phCp;
                if (phSmall) triSmallEff += phSmall;
                placedPhAny = true;
                break;
              }
            }
          }

          for (const u of flexibleUnits) {
            if (reservedForT3.has(u)) continue;
            if (isSpread && !u.t3RepeatOnly && getUnitEffectiveTrimesters(u, planYear).includes(3) &&
                reservedT3Cp + (u.cp ?? 6) <= reserveLimit && (directCp > 0 || flexibleUnits.size === 1)) {
              reservedForT3.add(u);
              reservedT3Cp += u.cp ?? 6;
            } else {
              tryPlaceInTri(u, false);
            }
          }

          // Commit completed concrete units & typed placeholders at the end of this trimester
          for (const u of placedThisTri) {
            const uCp = u.cp ?? 6;
            const lvl = u.level ?? 100;
            doneSet.add(u.code);
            doneCp += uCp;
            doneUnitCpMap.set(u.code, uCp);
            doneLevelCp[lvl] = (doneLevelCp[lvl] || 0) + uCp;
            if (u.prefix) {
              donePrefixCp[u.prefix] = (donePrefixCp[u.prefix] || 0) + uCp;
              const plk = `${u.prefix}_${lvl}`;
              donePrefixLevelCp[plk] = (donePrefixLevelCp[plk] || 0) + uCp;
            }
          }
          for (const pe of placedPhThisTri) {
            const phCp = pe.slot.cp ?? 6;
            doneCp += phCp;
            completedPlaceholders.push(pe);
            if (pe.slot.allowedLevels && pe.slot.allowedLevels.length === 1) {
              const l0 = pe.slot.allowedLevels[0];
              doneLevelCp[l0] = (doneLevelCp[l0] || 0) + phCp;
            } else if (pe.choicePool.length > 0) {
              const pUnits = pe.choicePool.map((c) => getUnit(c, data, nextPlan.customUnits)).filter(Boolean);
              if (pUnits.length > 0) {
                const lvls = new Set(pUnits.map((x) => x.level ?? 100));
                if (lvls.size === 1) {
                  const l0 = pUnits[0].level ?? 100;
                  doneLevelCp[l0] = (doneLevelCp[l0] || 0) + phCp;
                }
                const prefs = new Set(pUnits.map((x) => x.prefix || "").filter(Boolean));
                if (prefs.size === 1) {
                  const pr0 = pUnits[0].prefix;
                  donePrefixCp[pr0] = (donePrefixCp[pr0] || 0) + phCp;
                  if (lvls.size === 1) {
                    const plk = `${pr0}_${pUnits[0].level ?? 100}`;
                    donePrefixLevelCp[plk] = (donePrefixLevelCp[plk] || 0) + phCp;
                  }
                }
              }
            }
          }
        }

        if ([1, 2, 3].some((t) => yrObj.trimesters[t].length > 0)) {
          simYears.push(yrObj);
        }
      }

      if (remUnits.length > 0 || remPh.length > 0) {
        const lastYr = simYears[simYears.length - 1] || {
          id: uid("yr"),
          yearNum: 1,
          year: 2027,
          name: "Year 1 (2027)",
          trimesters: { 1: [], 2: [], 3: [] },
        };
        if (!simYears.length) simYears.push(lastYr);
        for (const u of remUnits) {
          const uTris = getUnitEffectiveTrimesters(u, lastYr.year || 2027);
          const t = uTris[0] || 1;
          lastYr.trimesters[t].push({ id: uid("u"), type: "unit", code: u.code });
        }
        for (const pe of remPh) {
          lastYr.trimesters[2].push(pe.slot);
        }
      }

      return { ...summarizeSchedule(simYears, nextPlan, data), complete: !remUnits.length && !remPh.length };
    }

    if (strategy === "none") {
      nextPlan.years = simulateSchedule("none").years;
      nextPlan.t3Analysis = null;
      return nextPlan;
    }
    // Acceleration can select T3-only units. Compare it with the actual standard curriculum.
    const stdSim = allowT3Pick && nextPlan.commencingTrimester !== 3
      ? summarizeSchedule(autoSchedulePlan(course, { ...plan, t3Strategy: "none" }, data).years, nextPlan, data)
      : simulateSchedule("none");
    // Count how many prescribed Major/Minor units AND planned course units are offered in T3
    const majorBuckets = activeBuckets.filter((b) => ["major1", "major2", "minor"].includes(b.category));
    const majorUnitSet = new Set();
    majorBuckets.forEach((b) => b.units.forEach((u) => majorUnitSet.add(u)));
    const totalMajorUnits = majorUnitSet.size;
    const offeredInT3 = (u) => u && !u.t3RepeatOnly && getUnitEffectiveTrimesters(u, maxPlanYear).includes(3);
    const t3MajorUnits = Array.from(majorUnitSet).filter((c) => offeredInT3(getUnit(c, data, nextPlan.customUnits))).length;
    const totalCourseUnits = chosenList.length;
    const t3CourseUnits = chosenList.filter(offeredInT3).length;

    const standardYear = Math.floor(stdSim.lastChrono / 3);
    let candidate = simulateSchedule(strategy);
    const spreadFits = (sim) => sim.complete && sim.t3PlacedCount > 0 && Math.floor(sim.lastChrono / 3) <= standardYear;
    if (strategy === "accelerate") {
      for (const deferToT3 of [false, true]) {
        const alternative = simulateSchedule(strategy, { prioritizeLimitedChoices: true, deferToT3 });
        if (alternative.complete && (!candidate.complete || alternative.lastChrono < candidate.lastChrono)) {
          candidate = alternative;
        }
      }
    } else if (!spreadFits(candidate)) {
      // A partial final year or a small intake may only have room for one T3 choice.
      for (const reserveCp of [12, 6]) {
        const alternative = simulateSchedule(strategy, { prioritizeLimitedChoices: true, reserveLimit: reserveCp });
        if (spreadFits(alternative)) {
          candidate = alternative;
          break;
        }
      }
    }
    if (strategy === "spread" && !spreadFits(candidate) && nextPlan.studyLoad !== "Part-time") {
      const mainTris = [];
      for (let y = 0; y <= standardYear; y++) mainTris.push(y * 3, y * 3 + 1);
      for (const limitedFirst of [false, true]) {
        // One constrained offering is often responsible, even if raising every cap
        // at once makes the greedy scheduler choose a worse sequence.
        for (const chrono of mainTris) {
          const trial = simulateSchedule("spread", { relaxedTris: new Set([chrono]), prioritizeLimitedChoices: limitedFirst });
          if (spreadFits(trial)) {
            candidate = trial;
            break;
          }
        }
        if (spreadFits(candidate)) break;
        const relaxed = new Set(mainTris);
        const trial = simulateSchedule("spread", { relaxedTris: relaxed, prioritizeLimitedChoices: limitedFirst });
        if (!spreadFits(trial)) continue;
        candidate = trial;
        for (const chrono of mainTris) {
          relaxed.delete(chrono);
          const tighter = simulateSchedule("spread", { relaxedTris: relaxed, prioritizeLimitedChoices: limitedFirst });
          if (spreadFits(tighter)) candidate = tighter;
          else relaxed.add(chrono);
        }
        break;
      }
    }
    const faster = candidate.complete && candidate.lastChrono < stdSim.lastChrono;
    const useCandidate = strategy === "spread" ? spreadFits(candidate) : faster;
    const active = useCandidate ? candidate : stdSim;
    const status = strategy === "spread" ? (useCandidate ? "spread" : "spread_fallback")
      : (useCandidate ? "accelerated" : "bottlenecked");
    const limitingSchedule = candidate.complete && candidate.lastChrono <= stdSim.lastChrono ? candidate : stdSim;
    const bottleneckUnits = status === "bottlenecked" ? limitingSchedule.finalStageUnits : [];
    const finishDeltaTris = active.lastChrono - stdSim.lastChrono;
    nextPlan.years = active.years;
    nextPlan.t3Analysis = {
      strategy, status, trimestersSaved: Math.max(0, -finishDeltaTris), finishDeltaTris,
      sameCalendarYear: Math.floor(active.lastChrono / 3) === standardYear,
      stdFinishLabel: stdSim.finishLabel, accFinishLabel: active.finishLabel,
      t3PlacedCount: active.t3PlacedCount, peakTriCpStd: stdSim.peakTriCp, peakTriCpActive: active.peakTriCp,
      yearShapeStd: stdSim.yearShape, yearShapeActive: active.yearShape, bottleneckUnits,
      bottleneckChain: traceBottleneck(limitingSchedule.years, bottleneckUnits, course, nextPlan, data),
      t3MajorUnits, totalMajorUnits, t3CourseUnits, totalCourseUnits,
    };
    return nextPlan;
  }

  function summarizeSchedule(years, plan, data) {
    let lastChrono = 0, peakTriCp = 0, t3PlacedCount = 0;
    let finalStageUnits = [];
    const yearShape = years.map((year) => {
      const counts = [], cp = [];
      for (const tri of [1, 2, 3]) {
        const slots = year.trimesters[tri];
        counts.push(slots.length);
        cp.push(slots.reduce((sum, sl) => sum + getSlotCp(sl, getUnit(sl.code, data, plan.customUnits)), 0));
        if (slots.length) {
          lastChrono = (year.yearNum - 1) * 3 + tri - 1;
          finalStageUnits = slots.filter((sl) => sl.type === "unit").map((sl) => sl.code);
        }
      }
      peakTriCp = Math.max(peakTriCp, ...cp);
      t3PlacedCount += counts[2];
      return { yearNum: year.yearNum, counts, cp };
    });
    const finishLabel = `Year ${Math.floor(lastChrono / 3) + 1} · T${lastChrono % 3 + 1}`;
    return { years, lastChrono, finishLabel, yearShape, peakTriCp, t3PlacedCount, finalStageUnits };
  }

  function traceBottleneck(years, finalCodes, course, plan, data) {
    if (!finalCodes.length) return [];
    const paths = new Map();
    for (const year of years) {
      for (const tri of [1, 2, 3]) {
        const current = [];
        for (const sl of year.trimesters[tri]) {
          if (sl.type !== "unit") continue;
          const u = getUnit(sl.code, data, plan.customUnits);
          const pm = u.prereqMeta;
          const branches = pm?.alternatives?.filter((alt) => altMatchesCourse(alt, course, plan.admissionRule));
          const alternatives = branches || (pm ? [pm] : []);
          const tokenLists = alternatives.map((alt) => alt.tokens || []);
          const available = new Set();
          let parent;
          if (tokenLists.length && !tokenLists.some((tokens) => evalPrereqTokens(tokens, available))) {
            // Map insertion order follows completion. Add only tokens used in an applicable branch.
            for (const [code, path] of paths) {
              if (!tokenLists.some((tokens) => tokens.includes(code))) continue;
              available.add(code);
              if (tokenLists.some((tokens) => evalPrereqTokens(tokens, available))) {
                parent = path;
                break;
              }
            }
          }
          const offeredTris = getUnitEffectiveTrimesters(u, year.year).filter((t) => t !== 3 || !u.t3RepeatOnly);
          const entry = { code: u.code, title: u.title, offeredTris, prereqText: u.prereqText || "",
            note: `Scheduled in Year ${year.yearNum} · T${tri}.` };
          current.push([u.code, { chrono: year.yearNum * 3 + tri, chain: [...(parent?.chain || []), entry] }]);
        }
        for (const [code, path] of current) paths.set(code, path);
      }
    }
    return finalCodes.map((c) => paths.get(c)?.chain || []).sort((a, b) => b.length - a.length)[0] || [];
  }

  const previewCache = new WeakMap();
  function previewT3Options(course, plan, data) {
    // The UI edits plan objects in place. Include their contents in the cache key.
    const key = JSON.stringify(plan);
    const cached = previewCache.get(plan);
    if (cached?.key === key && cached.course === course && cached.data === data) return cached.result;
    const run = (t3Strategy) => autoSchedulePlan(course, { ...plan, t3Strategy }, data).t3Analysis;
    const s = run("spread"), a = run("accelerate");
    const result = {
      stdFinishLabel: s.stdFinishLabel, peakTriCpStd: s.peakTriCpStd,
      spread: { feasible: s.status === "spread", status: s.status, finishLabel: s.accFinishLabel,
        peakTriCp: s.peakTriCpActive, t3PlacedCount: s.t3PlacedCount, sameCalendarYear: s.sameCalendarYear,
        yearShape: s.yearShapeActive },
      accelerate: { feasible: a.status === "accelerated", status: a.status, finishLabel: a.accFinishLabel,
        trimestersSaved: a.trimestersSaved, bottleneckUnits: a.bottleneckUnits,
        bottleneckChain: a.bottleneckChain, yearShape: a.yearShapeActive },
    };
    previewCache.set(plan, { key, course, data, result });
    return result;
  }

  function isPrereqReady(u, completedSet, completedCp, completedPrefixCp, course, fullCtx) {
    const pm = u.prereqMeta;
    if (!pm) return true;
    if (pm.pgWaiver && isHonoursOrPostgrad(course.studyLevel)) return true;
    const ctx = fullCtx || {
      units: completedSet,
      cp: completedCp,
      prefixCp: completedPrefixCp || {},
      levelCp: {},
      prefixLevelCp: {},
      unitCpMap: new Map(),
      course,
      plan: null,
    };
    const res = evaluatePrereqMeta(u, ctx, true);
    return res.ok;
  }

  /**
   * Matches an Official Study Plan title (e.g. "Rule (b) - WUXI...", "Rule (a) and (d)", "Schedule B - ...")
   * to the exact Admission Rule name in course.structureConfig.admissionRules.
   */
  function matchAdmissionRuleFromTitle(spTitle, rules) {
    if (!spTitle || !rules || !rules.length) return null;
    const titleLow = spTitle.toLowerCase();
    // 1. Exact substring match (longest first so "Rule A and Rule E - UNE Sydney" beats "Rule A")
    const sortedRules = [...rules].sort((a, b) => b.length - a.length);
    for (const rName of sortedRules) {
      if (titleLow.includes(rName.toLowerCase())) return rName;
    }

    // 2. Match normalized Rule / Schedule letter sets (e.g. "Rule (b)" <-> "Rule B Overseas Articulation Programs")
    const spLetters = extractRuleLetters(spTitle);
    if (spLetters.size === 0) return null;

    let bestRule = null;
    let bestScore = -1;
    const kwHints = ["sydney", "oua", "une", "international", "overseas", "tafe", "defence", "adf", "wuxi", "tvtc", "wsoc", "honours", "music", "science", "primary", "secondary", "special"];

    for (const rName of rules) {
      const rLetters = extractRuleLetters(rName);
      if (rLetters.size === 0) continue;
      let shared = 0;
      for (const l of spLetters) {
        if (rLetters.has(l)) shared++;
      }
      if (shared === 0) continue;

      let score = 0;
      if (shared === spLetters.size && shared === rLetters.size) {
        score = 100; // exact rule-letter set match!
      } else if (shared === spLetters.size) {
        score = 80 - (rLetters.size - shared) * 4; // e.g. "Rule (a)" matches "Rule A or Rule D"
      } else {
        score = 50 + shared * 8 - Math.abs(rLetters.size - spLetters.size) * 4;
      }

      // Tie-breaker for duplicate-letter rules like "Rule A" vs "Rule A and Rule E - UNE Sydney Campus"
      const rLow = rName.toLowerCase();
      for (const kw of kwHints) {
        const spHas = titleLow.includes(kw);
        const rHas = rLow.includes(kw);
        if (spHas && rHas) score += 20;
        else if (!spHas && rHas && (kw === "sydney" || kw === "oua" || kw === "international")) score -= 12;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRule = rName;
      }
    }
    return bestRule;
  }

  /**
   * Finds which Admission Rule container (if any) contains a given AOS code.
   */
  function findAdmissionRuleContainingAOS(course, aosCode, preferredRule) {
    if (!course.structureConfig.hasAdmissionRules || !aosCode) return null;
    function contHasAos(cont) {
      if ((cont.items || []).some((it) => it.kind === "aos" && it.code === aosCode)) return true;
      for (const ch of cont.children || []) {
        if (contHasAos(ch)) return true;
      }
      return false;
    }
    if (preferredRule) {
      const cur = course.containers.find((c) => c.title.trim() === preferredRule);
      if (cur && contHasAos(cur)) return cur.title.trim();
    }
    for (const c of course.containers || []) {
      if (contHasAos(c)) return c.title.trim();
    }
    return null;
  }

  /**
   * Loads an official UNE Study Plan (Progression Map) directly onto the board.
   * Accurately switches Admission Rule (274+ plans), populates dynamicAosSelections (526+ plans),
   * clears stale t3Analysis, and preserves 0-CP units.
   */
  function applyOfficialStudyPlan(studyPlanId, course, plan, data) {
    const sp = data.studyPlans[studyPlanId];
    if (!sp) return plan;
    const nextPlan = JSON.parse(JSON.stringify(plan));
    nextPlan.commencingTrimester = sp.commencementTrimester || 1;
    nextPlan.studyLoad = sp.loadType || "Full-time";
    nextPlan.t3Analysis = null; // Clear any stale T3 Fast-Track / Load-Spread banner!

    const cfg = course.structureConfig;
    const titleLow = (sp.title || "").toLowerCase();

    // 1. Resolve Admission Rule FIRST (before reading AOS options!)
    if (cfg.hasAdmissionRules) {
      const matchedRule = matchAdmissionRuleFromTitle(sp.title, cfg.admissionRules);
      if (matchedRule) {
        nextPlan.admissionRule = matchedRule;
      } else if (sp.ownerType === "aos" && sp.ownerCode) {
        const aosRule = findAdmissionRuleContainingAOS(course, sp.ownerCode, nextPlan.admissionRule);
        if (aosRule) nextPlan.admissionRule = aosRule;
      }
    }

    // Helper: clean AOS display title for title-substring matching
    const cleanAosTitle = (t) =>
      (t || "")
        .replace(/^[A-Z0-9]+\s*-\s*/, "")
        .replace(/\s*\((Major|Minor|Specialisation|Pathway)\)\s*$/i, "")
        .trim()
        .toLowerCase();

    // 2. Match AOS selections for BOTH dynamic AND fixed aosMode courses!
    if (cfg.aosMode === "dynamic") {
      nextPlan.dynamicAosSelections = {};
      const dynGroups = getDynamicAOSGroups(course, nextPlan, data);
      if (sp.ownerType === "aos" && sp.ownerCode) {
        const grp = dynGroups.find((g) => g.items.some((it) => it.code === sp.ownerCode));
        if (grp && !grp.isMandatorySingle) {
          nextPlan.dynamicAosSelections[grp.id] = sp.ownerCode;
        }
      } else {
        // Match longest AOS title mentioned in sp.title for each selectable group
        for (const grp of dynGroups) {
          if (grp.isMandatorySingle) continue;
          const candidates = grp.items
            .map((it) => ({
              code: it.code,
              clean: cleanAosTitle(it.title || data.aos[it.code]?.title || it.code),
              raw: (it.title || "").toLowerCase(),
            }))
            .sort((a, b) => b.clean.length - a.clean.length);
          const hit = candidates.find(
            (cand) =>
              (cand.clean.length >= 3 && titleLow.includes(cand.clean)) ||
              (cand.raw.length >= 3 && titleLow.includes(cand.raw))
          );
          if (hit) {
            nextPlan.dynamicAosSelections[grp.id] = hit.code;
          }
        }
      }
    } else {
      const aosOptions = getAvailableAOSOptions(course, nextPlan, data);
      if (sp.ownerType === "aos") {
        if (aosOptions.majors.some((m) => m.code === sp.ownerCode)) {
          nextPlan.selectedMajors = [sp.ownerCode];
        } else if (
          aosOptions.minors.some((m) => m.code === sp.ownerCode) ||
          aosOptions.pathways.some((p) => p.code === sp.ownerCode)
        ) {
          nextPlan.selectedMinor = sp.ownerCode;
        }
      } else {
        const sortedMajors = [...aosOptions.majors].sort(
          (a, b) => cleanAosTitle(b.title).length - cleanAosTitle(a.title).length
        );
        for (const m of sortedMajors) {
          const ct = cleanAosTitle(m.title);
          if ((ct.length >= 3 && titleLow.includes(ct)) || titleLow.includes(m.title.toLowerCase())) {
            nextPlan.selectedMajors = [m.code];
            break;
          }
        }
        const sortedPathMin = [...aosOptions.pathways, ...aosOptions.minors].sort(
          (a, b) => cleanAosTitle(b.title).length - cleanAosTitle(a.title).length
        );
        for (const p of sortedPathMin) {
          const ct = cleanAosTitle(p.title);
          if ((ct.length >= 3 && titleLow.includes(ct)) || titleLow.includes(p.title.toLowerCase())) {
            nextPlan.selectedMinor = p.code;
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
            return { id: uid("u"), type: "unit", code: s.code, cp: s.cp ?? 6 };
          }
          return {
            id: uid("ph"),
            type: "placeholder",
            label: s.label || "Listed / Elective Unit",
            cp: s.cp ?? 6,
            hintCodes: s.hintCodes || [],
          };
        });
      }
      return {
        id: uid("yr"),
        yearNum: idx + 1,
        year: 2027 + idx,
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

    // 1. Explicit allowedLevels / levelMin / levelMax take precedence, else parse across ENTIRE label
    //    (fixes GCA "100-Level ... or 300-Level ..." & BZOOL "200-Level (or higher)")
    let allowedLevels = null;
    if (Array.isArray(targetSlot?.allowedLevels) && targetSlot.allowedLevels.length > 0) {
      allowedLevels = [...targetSlot.allowedLevels].sort((a, b) => a - b);
    } else if (targetSlot?.levelMin || targetSlot?.levelMax) {
      const lMin = Number(targetSlot.levelMin) || 0;
      const lMax = Number(targetSlot.levelMax) || 999;
      allowedLevels = [100, 200, 300, 400, 500, 600].filter((l) => l >= lMin && l <= lMax);
    } else {
      const mAbove =
        low.match(/\b([1-5]00)\s*(?:-|\s)?level\s*(?:\(\s*)?or\s+(?:above|higher)(?:\s*\))?/i) ||
        low.match(/\b([1-5]00)\+\s*(?:-|\s)?level\b/i);
      if (mAbove) {
        const base = parseInt(mAbove[1], 10);
        allowedLevels = [100, 200, 300, 400, 500, 600].filter((l) => l >= base);
      } else if (/\blevel\b/i.test(low)) {
        const lvls = [];
        const addLvl = (v) => {
          if ([100, 200, 300, 400, 500, 600].includes(v) && !lvls.includes(v)) lvls.push(v);
        };
        for (const m of low.matchAll(/\b([1-5]00)\s*(?:,|\/|\bor\b|\band\b)\s*([1-5]00)\s*(?:-|\s)?level\b/gi)) {
          addLvl(parseInt(m[1], 10));
          addLvl(parseInt(m[2], 10));
        }
        for (const m of low.matchAll(/\b([1-5]00)\s*(?:-|\s)?level\b/gi)) {
          addLvl(parseInt(m[1], 10));
        }
        if (lvls.length > 0) {
          for (const m of low.matchAll(/\b([1-5]00)\s*,\s*([1-5]00)\b/gi)) {
            addLvl(parseInt(m[1], 10));
            addLvl(parseInt(m[2], 10));
          }
          lvls.sort((a, b) => a - b);
          allowedLevels = lvls;
        }
      }
    }

    // 2. Explicit allowedPrefixes or discipline prefix constraints in label
    let allowedPrefixes =
      Array.isArray(targetSlot?.allowedPrefixes) && targetSlot.allowedPrefixes.length > 0
        ? [...targetSlot.allowedPrefixes]
        : null;
    if (!allowedPrefixes && /mathematics,\s*statistic.*computer science/i.test(low)) {
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

    // Recognize major/minor/group A-Z/list 1-3/stream/component/focus area/teaching area!
    const hasGenericPoolKeyword =
      /\b(listed|elective|prescribed|pathway|group\s*[a-z0-9]|list\s*\d|core|specialisation|major|minor|stream|component|focus\s+area|teaching\s+area)\b/i.test(
        low
      );

    // Extract explicit Group / List sub-tags (Group 1/2/3, Group A/B/C, List 1/2/3)
    const explicitGroupTags = [];
    for (const m of low.matchAll(/\b(group\s+[a-z0-9]+|list\s+\d+)\b/gi)) {
      const tag = m[1].toLowerCase().replace(/\s+/g, " ");
      if (!explicitGroupTags.includes(tag)) explicitGroupTags.push(tag);
    }

    const exactBucket =
      isReplacingPlaceholder && targetSlot?.bucketId
        ? resolved.buckets.find((b) => b.id === targetSlot.bucketId) || null
        : null;
    const isStrictHintSlot = isReplacingPlaceholder && Boolean(targetSlot?.strictHints) && hints.length > 0;
    const isPureHintChoice = isStrictHintSlot || (isReplacingPlaceholder && hints.length > 0 && !hasGenericPoolKeyword && !exactBucket);

    if (isPureHintChoice) {
      // Exact bounded choice list, e.g. "MTHS110 or MTHS120", "BIOL110 / PSIO110", "CHEM210 / CHEM220"
      const lbl = exactBucket ? exactBucket.title : "Specified Slot Option";
      for (const h of hints) coursePoolMap.set(h, lbl);
      strictPoolOnly = true;
      scopeSubtitle = `Choose from specified option(s): ${hints.join(", ")}`;
    } else if (exactBucket && exactBucket.category !== "elective" && exactBucket.units && exactBucket.units.length > 0) {
      // Direct typed bucket-scoped placeholder binding!
      for (const uCode of exactBucket.units) {
        coursePoolMap.set(uCode, exactBucket.title);
      }
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, exactBucket.title);
      strictPoolOnly = targetSlot.strictPoolOnly !== undefined ? Boolean(targetSlot.strictPoolOnly) : true;
      allowsElectives = !strictPoolOnly;
      const lvlTxt = allowedLevels ? ` (${allowedLevels.join("/")}-level)` : "";
      scopeSubtitle = `Showing eligible units from ${exactBucket.title}${lvlTxt}`;
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
      addBuckets(
        (b) =>
          b.category === "capstone" &&
          (explicitGroupTags.length === 0 || explicitGroupTags.some((tg) => b.title.toLowerCase().includes(tg)))
      );
      if (coursePoolMap.size === 0) addBuckets((b) => b.category === "capstone");
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, "Specified Capstone Option");
      strictPoolOnly = true;
      scopeSubtitle = "Showing Capstone / Research units for this slot";
    } else if (
      isReplacingPlaceholder &&
      (/\bprescribed\b/i.test(low) || /\b(major|minor|stream|teaching\s+area)\b/i.test(low)) &&
      !low.includes("listed")
    ) {
      const secondOnly = low.includes("second major") || /\bminor\b/i.test(low);
      addBuckets((b) => {
        if (secondOnly && !["major2", "minor"].includes(b.category)) return false;
        if (!secondOnly && !["major1", "major2", "minor"].includes(b.category)) return false;
        if (explicitGroupTags.length > 0 && !explicitGroupTags.some((tg) => b.title.toLowerCase().includes(tg))) {
          return false;
        }
        return true;
      });
      if (coursePoolMap.size === 0) {
        addBuckets((b) => ["major1", "major2", "minor"].includes(b.category));
      }
      // If user hasn't picked a Major/Minor yet (e.g. MECCW "ECON201 or Unit from Major"), seed from course's AOS unit pool!
      if (coursePoolMap.size === 0) {
        const idxEntry = getCourseUnitIndex(data).get(course.code);
        if (idxEntry) {
          for (const uCode of idxEntry.units) {
            if (!coursePoolMap.has(uCode)) coursePoolMap.set(uCode, `${course.code} Major / Stream Pool`);
          }
        }
      }
      for (const h of hints) if (!coursePoolMap.has(h)) coursePoolMap.set(h, "Specified Option");
      allowsElectives = low.includes("elective");
      strictPoolOnly = !allowsElectives;
      scopeSubtitle = allowsElectives
        ? "Showing Major/Minor Prescribed units + eligible Electives"
        : "Showing Prescribed units from your selected Major / Minor";
    } else if (
      slotKind === "listed" ||
      (isReplacingPlaceholder &&
        (/\b(listed|pathway|specialisation|focus\s+area)\b/i.test(low) || explicitGroupTags.length > 0) &&
        !low.includes("elective"))
    ) {
      const subKeywords = [
        ...explicitGroupTags,
        "neuroscience",
        "business",
        "criminology",
        "education",
        "clinical",
        "agriculture",
        "science",
        "law",
        "health",
      ];
      const matchedKw = subKeywords.filter((kw) => low.includes(kw));
      if (matchedKw.length > 0) {
        addBuckets((b) => matchedKw.some((kw) => b.title.toLowerCase().includes(kw)));
      }
      if (low.includes("prescribed") || low.includes("minor") || low.includes("major")) {
        addBuckets((b) => ["major1", "major2", "minor"].includes(b.category));
      }
      if (coursePoolMap.size === 0) {
        addBuckets((b) => b.category === "listed" || b.category === "minor" || b.title.toLowerCase().includes("listed"));
      }
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
      addBuckets((b) => b.category === "listed");
      allowsElectives = true;
      strictPoolOnly = false;
      scopeSubtitle = allowedLevels
        ? `Showing ${allowedLevels.join("/")}-level Elective units`
        : "Showing University-Wide Elective units (eligible units first)";
    } else {
      // "Listed or Elective Unit" OR clicking an empty trimester drop zone!
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
      isPureHintChoice,
      hints,
    };
  }

  /**
   * Evaluates base course-level unit ineligibility when browsing the Catalog without a targetSlot.
   * Accepts optional planYear so rolling-start units (e.g. 2028/2029) are not falsely flagged as archived.
   */
  function getBaseUnitIneligibility(u, course, plan, data, planYear) {
    if (!u) return ["Unknown unit"];
    const reasons = [];
    if (u.offered2027 === false) {
      if (u.rollingStartYear) {
        if (Number.isFinite(planYear) && planYear < u.rollingStartYear) {
          reasons.push(`Rolling-start unit — indicative from ${u.rollingStartYear} (slot is ${planYear})`);
        } else if (!Number.isFinite(planYear)) {
          // Catalog browse without a specific year: allow rolling-start units for multi-year plans!
          const maxYr = plan?.years?.length ? getPlanYear(plan.years[plan.years.length - 1], plan.years.length - 1) : 2029;
          if (maxYr < u.rollingStartYear) {
            reasons.push(`Rolling-start unit — indicative from ${u.rollingStartYear}`);
          }
        }
      } else {
        reasons.push(getNoOfferingLabel(u));
      }
    }
    if (isUnitExcludedForCourse(u, course)) {
      reasons.push(`Not available in ${course.code}${u.courseExclusionNote ? ` (${u.courseExclusionNote})` : ""}`);
    }
    const inCourseBuckets = isUnitInCourseBuckets(u.code, course, plan, data);
    const pm = u.prereqMeta;
    if (isUndergradOrPathway(course.studyLevel) && u.level >= 500 && !inCourseBuckets) {
      reasons.push(`Restricted to Postgraduate candidature (${u.level}-level)`);
    } else if (pm?.pgOnly && !isHonoursOrPostgrad(course.studyLevel) && !inCourseBuckets) {
      reasons.push("Restricted to Postgraduate candidature");
    } else if (pm?.honoursOnly && course.studyLevel !== "Bachelor Honours" && !inCourseBuckets) {
      reasons.push("Restricted to Honours candidature");
    } else if (pm?.courseRestricted && !inCourseBuckets) {
      reasons.push(`Restricted candidature (${pm.courseRestricted})`);
    }
    return reasons;
  }

  /**
   * Evaluates all candidate units for a specific (yearIdx, triNum) target slot,
   * cleanly separating ELIGIBLE units from INELIGIBLE units (with explicit reasons!),
   * and exposing `evaluateAnyUnit(code, opts)` for strict-slot Catalog/Requirements parity (#21).
   */
  function resolveSlotCandidates(targetSlot, course, plan, data, options) {
    const resolved = resolveCurriculumBuckets(course, plan, data);
    const spec = parseSlotSpec(targetSlot, resolved, course, data);
    const yearIdx = targetSlot.yearIdx;
    const triNum = targetSlot.triNum;
    const targetChrono = yearIdx * 3 + (triNum - 1);
    const yearNum = plan.years[yearIdx]?.yearNum || yearIdx + 1;
    const targetPlanYear = getPlanYear(plan.years[yearIdx], yearIdx);
    const isFutureSlotYear = targetPlanYear > 2027;
    const replaceSlotId = targetSlot.replaceSlotId || null;
    const includeAllElectives = options?.forceIncludeElectives || spec.allowsElectives;

    // Build prior & current board state (excluding the placeholder slot being replaced) using ?? 6!
    const placements = getPlannedPlacements(plan, data);
    const bucketById = new Map(resolved.buckets.map((b) => [b.id, b]));
    const alreadyPlannedMap = new Map(); // code -> "Y1 · T1"
    const priorUnits = new Set();
    const sameOrPriorUnits = new Set();
    const priorBoundedPlaceholders = [];
    let priorCp = resolved.advancedStandingCp || 0;
    let sameOrPriorCp = resolved.advancedStandingCp || 0;
    const priorPrefixCp = {};
    const sameOrPriorPrefixCp = {};
    const priorLevelCp = {};
    const sameOrPriorLevelCp = {};
    const priorPrefixLevelCp = {};
    const sameOrPriorPrefixLevelCp = {};
    const priorUnitCpMap = new Map();
    const sameOrPriorUnitCpMap = new Map();
    let curTriCp = 0;
    let curTriDirectEffCp = 0;
    let curTriSmallEff = 0;
    const cpByLevelCurrent = { 0: 0, 100: 0, 200: 0, 300: 0, 400: 0, 500: 0, 600: 0 };

    // Use the exact same timeline carry-over calculation (with start-trimester unused-capacity absorption!)
    const {
      carryOverByChrono: slotCarryMap,
      carrySmallByChrono: slotCarrySmallMap,
    } = computeTimelineCarryOver(plan, data, replaceSlotId);
    const curTriCarryOverCp = slotCarryMap[targetChrono] || 0;
    curTriSmallEff += slotCarrySmallMap[targetChrono] || 0;

    for (const p of placements) {
      if (replaceSlotId && p.slot.id === replaceSlotId) continue;
      const pCp = p.cp ?? 6;

      if (p.yearIdx === yearIdx && p.triNum === triNum) {
        curTriCp += pCp;
        if (p.type === "unit" && p.unit) {
          const ls = getUnitLoadSpec(p.unit, plan.studyLoad);
          curTriDirectEffCp += ls.effCp;
          if (ls.isSmallUnit) curTriSmallEff += ls.effCp;
        } else {
          curTriDirectEffCp += pCp;
          if (pCp > 0 && pCp <= 3) curTriSmallEff += pCp;
        }
      }

      if (p.type === "unit") {
        alreadyPlannedMap.set(p.code, `Y${p.yearNum} · T${p.triNum}`);
        const lvl = p.unit?.level ?? 100;
        cpByLevelCurrent[lvl] = (cpByLevelCurrent[lvl] || 0) + pCp;
      }

      if (p.chrono < targetChrono) {
        priorCp += pCp;
        sameOrPriorCp += pCp;
        if (p.type === "unit") {
          priorUnits.add(p.code);
          sameOrPriorUnits.add(p.code);
          priorUnitCpMap.set(p.code, pCp);
          sameOrPriorUnitCpMap.set(p.code, pCp);
          const pref = p.unit?.prefix || "";
          const lvl = p.unit?.level ?? 100;
          priorLevelCp[lvl] = (priorLevelCp[lvl] || 0) + pCp;
          sameOrPriorLevelCp[lvl] = (sameOrPriorLevelCp[lvl] || 0) + pCp;
          if (pref) {
            priorPrefixCp[pref] = (priorPrefixCp[pref] || 0) + pCp;
            sameOrPriorPrefixCp[pref] = (sameOrPriorPrefixCp[pref] || 0) + pCp;
            const plk = `${pref}_${lvl}`;
            priorPrefixLevelCp[plk] = (priorPrefixLevelCp[plk] || 0) + pCp;
            sameOrPriorPrefixLevelCp[plk] = (sameOrPriorPrefixLevelCp[plk] || 0) + pCp;
          }
        } else if (p.type === "placeholder") {
          const phPool = getPlaceholderChoicePool(p.slot, bucketById);
          let creditedLevel = false;
          if (phPool.length > 0) {
            priorBoundedPlaceholders.push({ slot: p.slot, choicePool: phPool });
            const poolUnits = phPool.map((c) => getUnit(c, data, plan.customUnits)).filter(Boolean);
            if (poolUnits.length > 0) {
              const lvls = new Set(poolUnits.map((x) => x.level ?? 100));
              if (lvls.size === 1) {
                const l0 = poolUnits[0].level ?? 100;
                priorLevelCp[l0] = (priorLevelCp[l0] || 0) + pCp;
                sameOrPriorLevelCp[l0] = (sameOrPriorLevelCp[l0] || 0) + pCp;
                creditedLevel = true;
              }
              const prefs = new Set(poolUnits.map((x) => x.prefix || "").filter(Boolean));
              if (prefs.size === 1) {
                const pr0 = poolUnits[0].prefix;
                priorPrefixCp[pr0] = (priorPrefixCp[pr0] || 0) + pCp;
                sameOrPriorPrefixCp[pr0] = (sameOrPriorPrefixCp[pr0] || 0) + pCp;
                if (lvls.size === 1) {
                  const plk = `${pr0}_${poolUnits[0].level ?? 100}`;
                  priorPrefixLevelCp[plk] = (priorPrefixLevelCp[plk] || 0) + pCp;
                  sameOrPriorPrefixLevelCp[plk] = (sameOrPriorPrefixLevelCp[plk] || 0) + pCp;
                }
              }
            }
          }
          if (!creditedLevel && Array.isArray(p.slot.allowedLevels) && p.slot.allowedLevels.length === 1) {
            const l0 = p.slot.allowedLevels[0];
            priorLevelCp[l0] = (priorLevelCp[l0] || 0) + pCp;
            sameOrPriorLevelCp[l0] = (sameOrPriorLevelCp[l0] || 0) + pCp;
          }
        }
      } else if (p.chrono === targetChrono) {
        sameOrPriorCp += pCp;
        if (p.type === "unit") {
          sameOrPriorUnits.add(p.code);
          sameOrPriorUnitCpMap.set(p.code, pCp);
          const pref = p.unit?.prefix || "";
          const lvl = p.unit?.level ?? 100;
          sameOrPriorLevelCp[lvl] = (sameOrPriorLevelCp[lvl] || 0) + pCp;
          if (pref) {
            sameOrPriorPrefixCp[pref] = (sameOrPriorPrefixCp[pref] || 0) + pCp;
            const plk = `${pref}_${lvl}`;
            sameOrPriorPrefixLevelCp[plk] = (sameOrPriorPrefixLevelCp[plk] || 0) + pCp;
          }
        }
      }
    }

    const curTriEffCp = curTriDirectEffCp + curTriCarryOverCp;
    const baseMaxLoad = plan.studyLoad === "Part-time" ? 12 : 24;

    // Precompute active level caps & minimums on the course
    const ruleMatches = (r) => {
      if (r.isHonoursOnly && course.studyLevel !== "Bachelor Honours") return false;
      if (!r.onlyRules || !r.onlyRules.length) return true;
      return r.onlyRules.some((rn) => rn === plan.admissionRule || matchesRulePattern(plan.admissionRule, rn));
    };
    const activeLevelMaxRules = (course.levelRules || []).filter(
      (r) => r.maxCp !== undefined && r.maxCp !== null && ruleMatches(r)
    );
    const activeLevelMinRules = (course.levelRules || []).filter(
      (r) => r.minCp !== undefined && r.minCp !== null && r.levels && ruleMatches(r)
    );

    // Helper: checks if a unit code is plausibly selectable in this slot BEFORE widening decisions
    // (fixes BLANG 127 slots & BEDK6 68 slots where wrong-level or archived units blocked widening, AND supports rolling-start units!)
    function isPotentiallyAvailableInSlot(code) {
      const u = getUnit(code, data, plan.customUnits);
      if (!u) return false;
      if (!isUnitAvailableInYear(u, targetPlanYear)) return false;
      if (alreadyPlannedMap.has(code) && !u.repeatable) return false;
      if (u.offered2027 !== false) {
        if (u.trimesters && u.trimesters.length > 0 && !u.trimesters.includes(triNum)) return false;
      } else if (Array.isArray(u.indicativeTrimesters) && u.indicativeTrimesters.length > 0 && !u.indicativeTrimesters.includes(triNum)) {
        return false;
      }
      if (triNum === 3 && u.t3RepeatOnly) return false;
      if (spec.allowedLevels && !spec.allowedLevels.includes(u.level)) return false;
      if (spec.allowedPrefixes && !spec.allowedPrefixes.includes(u.prefix)) return false;
      if (isUnitExcludedForCourse(u, course)) return false;
      return true;
    }

    // Collect candidate unit codes
    const candidateCodes = new Set(spec.coursePoolMap.keys());

    // Guardrail: widen gracefully if 0 potentially eligible units exist in a strict Listed/Prescribed pool
    if (spec.strictPoolOnly && !includeAllElectives && !spec.isPureHintChoice) {
      let availInPool = 0;
      for (const code of candidateCodes) {
        if (isPotentiallyAvailableInSlot(code)) availInPool++;
      }
      if (availInPool === 0) {
        for (const b of resolved.buckets) {
          if (b.category === "elective") continue;
          for (const uCode of b.units || []) {
            if (!candidateCodes.has(uCode)) {
              candidateCodes.add(uCode);
              if (!spec.coursePoolMap.has(uCode)) spec.coursePoolMap.set(uCode, b.title);
              if (isPotentiallyAvailableInSlot(uCode)) availInPool++;
            }
          }
        }
      }
      if (availInPool === 0) {
        const idxMap = getCourseUnitIndex(data);
        const courseEntry = idxMap.get(course.code);
        if (courseEntry) {
          for (const uCode of courseEntry.units) {
            if (!candidateCodes.has(uCode)) {
              candidateCodes.add(uCode);
              if (!spec.coursePoolMap.has(uCode)) spec.coursePoolMap.set(uCode, `${course.code} Major / Stream Pool`);
              if (isPotentiallyAvailableInSlot(uCode)) availInPool++;
            }
          }
          if (availInPool > 0) {
            spec.subtitle = "Select a Major / Stream above, or preview units from this course's specialisations";
          }
        }
      }
      if (availInPool === 0) {
        spec.allowsElectives = true;
        spec.strictPoolOnly = false;
        spec.subtitle = "No matching listed units offered in this trimester — showing eligible University units";
      }
    }

    if (includeAllElectives || !spec.strictPoolOnly || spec.allowsElectives) {
      for (const uCode of Object.keys(data.units)) candidateCodes.add(uCode);
      for (const uCode of Object.keys(plan.customUnits || {})) candidateCodes.add(uCode);
    }

    const priorCtx = {
      units: priorUnits,
      cp: priorCp,
      prefixCp: priorPrefixCp,
      levelCp: priorLevelCp,
      prefixLevelCp: priorPrefixLevelCp,
      unitCpMap: priorUnitCpMap,
      course,
      plan,
    };
    const sameOrPriorCtx = {
      units: sameOrPriorUnits,
      cp: sameOrPriorCp,
      prefixCp: sameOrPriorPrefixCp,
      levelCp: sameOrPriorLevelCp,
      prefixLevelCp: sameOrPriorPrefixLevelCp,
      unitCpMap: sameOrPriorUnitCpMap,
      course,
      plan,
    };

    // Single-unit O(1) evaluator shared by Slot Picker AND app.js strict-slot All/Requirements tabs (#21)!
    function evaluateAnyUnit(code, evalOpts) {
      const opts = evalOpts || {};
      const u = getUnit(code, data, plan.customUnits);
      if (!u) return { eligible: false, reasons: ["Unknown unit"], inCoursePool: false, modeWarning: null };

      const inCoursePool = spec.coursePoolMap.has(code);
      const reasons = [];

      if (alreadyPlannedMap.has(code) && !u.repeatable) {
        reasons.push(`Already planned in ${alreadyPlannedMap.get(code)}`);
      }

      // Strict pool check (only when caller hasn't opted out via ignorePool)
      if (!opts.ignorePool && spec.strictPoolOnly && !includeAllElectives && !inCoursePool) {
        reasons.push(`Outside the allowed pool for "${spec.title}"`);
      }

      // Discipline prefix filter if specified by slot label
      if (!opts.ignoreSlotFilters && spec.allowedPrefixes && !spec.allowedPrefixes.includes(u.prefix)) {
        reasons.push(`Slot requires ${spec.allowedPrefixes.join("/")} prefix (${code} is ${u.prefix})`);
      }

      // 1. Year-Aware Availability, Rolling-Start, Trimester Offering & t3RepeatOnly
      if (u.offered2027 === false) {
        if (u.rollingStartYear && targetPlanYear >= u.rollingStartYear) {
          if (u.offeringCycle === "even" && targetPlanYear % 2 !== 0) {
            reasons.push(`Offered in even years only (${targetPlanYear} is odd)`);
          } else if (
            Array.isArray(u.indicativeTrimesters) &&
            u.indicativeTrimesters.length > 0 &&
            !u.indicativeTrimesters.includes(triNum)
          ) {
            reasons.push(
              `Indicatively offered in T${u.indicativeTrimesters.join(", T")} (rolling-start ${u.rollingStartYear})`
            );
          }
        } else if (u.rollingStartYear && targetPlanYear < u.rollingStartYear) {
          reasons.push(`Rolling-start unit — indicative from ${u.rollingStartYear} (slot is ${targetPlanYear})`);
        } else {
          reasons.push(getNoOfferingLabel(u));
        }
      } else if (u.trimesters && u.trimesters.length > 0 && !u.trimesters.includes(triNum)) {
        reasons.push(getSlotPeriodMismatch(u, triNum, targetPlanYear));
      }
      if (triNum === 3 && u.t3RepeatOnly) {
        reasons.push("Trimester 3 is for repeating students only (requires Head of School permission)");
      }

      // 2. Slot-specific level requirement
      if (!opts.ignoreSlotFilters && spec.allowedLevels && !spec.allowedLevels.includes(u.level)) {
        reasons.push(`Slot requires ${spec.allowedLevels.join("/")}-level (${code} is ${u.level}-level)`);
      }

      // 3. Course & Study-Level Exclusions & Candidature restrictions
      if (isUnitExcludedForCourse(u, course)) {
        reasons.push(`Not available in ${course.code}${u.courseExclusionNote ? ` (${u.courseExclusionNote})` : ""}`);
      }
      const inCourseBuckets = inCoursePool || isUnitInCourseBuckets(code, course, plan, data);
      const prereqRes = evaluatePrereqMeta(u, priorCtx, inCourseBuckets, `before Y${yearNum} T${triNum}`);
      for (const pe of prereqRes.errors) reasons.push(pe);

      // 4. Course Level Maximum Caps
      const uCp = u.cp ?? 6;
      for (const mr of activeLevelMaxRules) {
        if (Array.isArray(mr.excludeUnits) && mr.excludeUnits.includes(code)) continue;
        if ((mr.levels || []).includes(u.level)) {
          let curSum = (mr.levels || []).reduce((s, l) => s + (cpByLevelCurrent[l] || 0), 0);
          if (Array.isArray(mr.excludeUnits) && mr.excludeUnits.length) {
            for (const p of placements) {
              if (p.type === "unit" && mr.excludeUnits.includes(p.code) && (mr.levels || []).includes(p.unit?.level)) {
                curSum = Math.max(0, curSum - (p.cp ?? 6));
              }
            }
          }
          if (curSum + uCp > mr.maxCp) {
            reasons.push(`Exceeds ${mr.label} (already at ${curSum} / ${mr.maxCp} CP)`);
          }
        }
      }

      // 5. Directional & Mutual Unit Restrictions / Exclusions
      for (const rCode of u.restrictedUnits || []) {
        if (rCode === code) continue;
        const rUnit = getUnit(rCode, data, plan.customUnits);
        const isMutual = rUnit && (rUnit.restrictedUnits || []).includes(code);
        if (isMutual && alreadyPlannedMap.has(rCode)) {
          reasons.push(`Incompatible / Restricted with ${rCode} (${alreadyPlannedMap.get(rCode)})`);
        } else if (!isMutual && sameOrPriorUnits.has(rCode)) {
          reasons.push(`Cannot take concurrently with or after ${rCode} (${alreadyPlannedMap.get(rCode)})`);
        }
      }
      for (const [plannedCode, locStr] of alreadyPlannedMap.entries()) {
        if (plannedCode === code) continue;
        const pObj = placements.find((x) => x.type === "unit" && x.code === plannedCode);
        if (pObj && pObj.chrono >= targetChrono) {
          const pU = pObj.unit;
          if ((pU?.restrictedUnits || []).includes(code)) {
            reasons.push(`Conflicts with ${plannedCode} planned in ${locStr}`);
          }
        }
      }

      // 6. Prerequisites & Credit-Point Maturity prior to (yearIdx, triNum)
      //    (allowing bounded prior placeholders like Core Maths [MTHS110/MTHS120] to unlock Year 2 slots out-of-order!)
      const pmSlot = u.prereqMeta;
      const slotTokensGuaranteedByPh =
        prereqRes.warnings.length > 0 &&
        pmSlot &&
        pmSlot.tokens &&
        pmSlot.tokens.length > 0 &&
        priorBoundedPlaceholders.length > 0 &&
        arePrereqTokensGuaranteedByPlaceholders(pmSlot.tokens, pmSlot.codes, priorUnits, priorBoundedPlaceholders);
      for (const pw of prereqRes.warnings) {
        if (slotTokensGuaranteedByPh && /^(Missing prerequisite|Prerequisite not satisfied|Required units not satisfied)/i.test(pw)) continue;
        reasons.push(pw);
      }

      // 7. Co-requisites in same or earlier trimester
      const coreqRes = evaluateCoreqMeta(u, sameOrPriorCtx, `in Y${yearNum} T${triNum} or earlier`);
      for (const cw of coreqRes.warnings) reasons.push(cw);

      // 8. Effective Trimester Load Check (honoring Part-Time 12 CP, Year-Long halving & carry-over, >=42-CP units, BZOOL 2-CP pairing!)
      const lSpec = getUnitLoadSpec(u, plan.studyLoad);
      const nextSmall = curTriSmallEff + (lSpec.isSmallUnit ? lSpec.effCp : 0);
      const smallAllowance = nextSmall > 0 ? Math.min(3, nextSmall) : 0;
      const isSoloPtLarge = plan.studyLoad === "Part-time" && curTriEffCp === 0 && lSpec.effCp > baseMaxLoad && lSpec.effCp <= 24;
      if (!isSoloPtLarge && curTriEffCp + lSpec.effCp > baseMaxLoad + smallAllowance) {
        const loadLbl = plan.studyLoad === "Part-time" ? "12 CP part-time" : "24 CP standard";
        reasons.push(
          `Exceeds ${loadLbl} trimester load (${curTriEffCp + lSpec.effCp} CP effective in Y${yearNum} T${triNum})`
        );
      }

      const triModes = getUnitModesForTri(u, triNum);
      const modeWarning =
        triModes.length > 0 && plan.preferredMode && !triModes.includes(plan.preferredMode)
          ? `${triModes.join("/")} only in T${triNum}`
          : null;

      return {
        eligible: reasons.length === 0,
        reasons,
        inCoursePool,
        modeWarning,
      };
    }

    const eligible = [];
    const ineligible = [];
    let alreadyPlannedCount = 0;
    const hintSet = new Set(spec.hints || []);

    for (const code of candidateCodes) {
      const u = getUnit(code, data, plan.customUnits);
      if (!u) continue;

      if (alreadyPlannedMap.has(code) && !u.repeatable) {
        alreadyPlannedCount++;
        continue;
      }

      // Apply hard discipline prefix filter if specified by the slot label itself
      if (spec.allowedPrefixes && !spec.allowedPrefixes.includes(u.prefix)) {
        continue;
      }

      const inCoursePool = spec.coursePoolMap.has(code);
      const poolLabel = spec.coursePoolMap.get(code) || "General Elective";
      const ev = evaluateAnyUnit(code, { ignorePool: true });

      if (ev.eligible) {
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
          modeWarning: ev.modeWarning,
          priority,
        });
      } else {
        ineligible.push({
          code,
          unit: u,
          inCoursePool,
          poolLabel,
          reasons: ev.reasons,
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

    // Phase 4: Sibling-Trimester Auto-Swap Resolution!
    // For constrained placeholders, check other trimesters of the SAME year for a strictly more-flexible
    // placeholder (e.g. Elective / Listed or Elective / unlevelled Listed) that can cleanly swap with this slot,
    // surfacing T2-offered (or T1-offered) units as 1-click "Swap & Add" instead of hiding them under Ineligible!
    const siblingSwapEligible = [];
    const swapSummary = {};

    function getSwapFlexRank(slotObj, specFallback) {
      if (!slotObj || slotObj.type !== "placeholder") return 99;
      const hasLvl =
        (Array.isArray(slotObj.allowedLevels) && slotObj.allowedLevels.length > 0) ||
        Boolean(slotObj.levelMin || slotObj.levelMax) ||
        Boolean(specFallback && specFallback.allowedLevels && specFallback.allowedLevels.length > 0);
      const hasPref =
        (Array.isArray(slotObj.allowedPrefixes) && slotObj.allowedPrefixes.length > 0) ||
        Boolean(specFallback && specFallback.allowedPrefixes && specFallback.allowedPrefixes.length > 0);
      const kind = slotObj.slotKind || "";
      const cat = slotObj.category || "";
      const isStrictHint = Boolean(slotObj.strictHints) || Boolean(specFallback && specFallback.isPureHintChoice);
      const lblLow = (slotObj.label || "").toLowerCase();

      if (
        !hasLvl &&
        !hasPref &&
        !slotObj.bucketId &&
        !isStrictHint &&
        (kind === "elective" || kind === "listed_or_elective" || cat === "elective" || (kind === "" && lblLow.includes("elective")))
      ) {
        return 0;
      }
      if (
        !hasLvl &&
        !hasPref &&
        !slotObj.bucketId &&
        !isStrictHint &&
        (kind === "listed" || cat === "listed" || (kind === "" && lblLow.includes("listed") && !/\b(core|major|minor|prescribed|capstone)\b/.test(lblLow)))
      ) {
        return 1;
      }
      if (!hasLvl && !hasPref && !isStrictHint && (kind === "listed" || cat === "listed")) {
        return 2;
      }
      return 3;
    }

    function getSwapShortLabel(slotObj) {
      if (!slotObj) return "Open Slot";
      if (slotObj.slotKind === "elective") return "Elective";
      if (slotObj.slotKind === "listed_or_elective") return "Listed or Elective";
      if (slotObj.bucketTitle) return slotObj.bucketTitle;
      if (slotObj.slotKind === "listed") return "Listed";
      return (slotObj.label || "Open Slot").replace(/^Choose\s+/i, "").replace(/\s+Unit$/i, "").trim() || "Open Slot";
    }

    if (!options?._skipSiblingSwap && replaceSlotId && plan.years && plan.years[yearIdx] && ineligible.length > 0) {
      const yrObj = plan.years[yearIdx];
      const curArr = (yrObj.trimesters && yrObj.trimesters[triNum]) || [];
      const origSlot = curArr.find((s) => s.id === replaceSlotId && s.type === "placeholder") || null;

      if (origSlot) {
        const origRank = getSwapFlexRank(origSlot, spec);
        const origCp = origSlot.cp ?? 6;

        if (origRank >= 1) {
          const siblingOrder = triNum === 1 ? [2, 3] : triNum === 2 ? [1, 3] : [1, 2];
          const ineligByCode = new Map(ineligible.map((item) => [item.code, item]));
          const swappedCodes = new Set();

          // Bounded pool of origSlot (to guard against breaking a T2 unit that depends on origSlot if moving T1 -> T2)
          const origBoundedPool = getPlaceholderChoicePool(origSlot, bucketById);

          for (const sibTri of siblingOrder) {
            const sibArr = (yrObj.trimesters && yrObj.trimesters[sibTri]) || [];
            if (!sibArr.length) continue;

            // Find the most flexible placeholder in sibTri that is strictly more flexible than origSlot and has matching CP
            let bestSwapPh = null;
            let bestSwapRank = origRank;
            for (const candPh of sibArr) {
              if (candPh.type !== "placeholder") continue;
              if ((candPh.cp ?? 6) !== origCp) continue;
              const cRank = getSwapFlexRank(candPh, null);
              if (cRank >= bestSwapRank) continue;
              // Verify candPh remains valid when moved to triNum
              if (cRank > 0) {
                const swapPool = getPlaceholderChoicePool(candPh, bucketById);
                if (swapPool.length > 0) {
                  const hasValidInFromTri = swapPool.some((uc) => {
                    const uo = getUnit(uc, data, plan.customUnits);
                    if (!uo || !isUnitAvailableInYear(uo, targetPlanYear)) return false;
                    const uTris = getUnitEffectiveTrimesters(uo, targetPlanYear);
                    if (uTris.length > 0 && !uTris.includes(triNum)) return false;
                    if (triNum === 3 && uo.t3RepeatOnly) return false;
                    return true;
                  });
                  if (!hasValidInFromTri) continue;
                }
              }
              bestSwapRank = cRank;
              bestSwapPh = candPh;
            }
            if (!bestSwapPh) continue;

            // Guard: if moving a bounded T1 placeholder later (T1 -> T2/T3), ensure no concrete unit in sibTri depends on it
            if (sibTri > triNum && origBoundedPool.length > 0 && origBoundedPool.length <= 8) {
              const sibBreaksPrereq = sibArr.some((s) => {
                if (s.type !== "unit") return false;
                const su = getUnit(s.code, data, plan.customUnits);
                const spm = su && su.prereqMeta;
                if (!spm || !spm.codes || !spm.codes.length) return false;
                if (spm.pgWaiver && isHonoursOrPostgrad(course.studyLevel)) return false;
                if (!origBoundedPool.some((c) => spm.codes.includes(c))) return false;
                const unitsBeforeSib = new Set(sameOrPriorUnits);
                return !evalPrereqTokens(spm.tokens || [], unitsBeforeSib);
              });
              if (sibBreaksPrereq) continue;
            }

            // Build lightweight virtual swapped plan (origSlot <-> bestSwapPh) to verify exact eligibility in sibTri!
            const simYears = plan.years.map((y, idx) => {
              if (idx !== yearIdx) return y;
              const nextTris = { 1: [...(y.trimesters[1] || [])], 2: [...(y.trimesters[2] || [])], 3: [...(y.trimesters[3] || [])] };
              const fIdx = nextTris[triNum].findIndex((s) => s.id === origSlot.id);
              const tIdx = nextTris[sibTri].findIndex((s) => s.id === bestSwapPh.id);
              if (fIdx !== -1 && tIdx !== -1) {
                nextTris[triNum][fIdx] = bestSwapPh;
                nextTris[sibTri][tIdx] = origSlot;
              }
              return { ...y, trimesters: nextTris };
            });
            const simPlan = { ...plan, years: simYears };
            const sibTarget = { ...targetSlot, triNum: sibTri, replaceSlotId: origSlot.id };
            const sibEval = resolveSlotCandidates(sibTarget, course, simPlan, data, {
              ...(options || {}),
              _skipSiblingSwap: true,
            });

            // Collect confirmed 2027 Mandatory intensives in sibTri so we never suggest a confirmed 2027 date clash
            const sibMandatoryInts = [];
            if (!isFutureSlotYear) {
              for (const s of sibArr) {
                if (s.type !== "unit") continue;
                const su = getUnit(s.code, data, plan.customUnits);
                const si = su ? getUnitIntensiveForTri(su, sibTri, plan.preferredMode, targetPlanYear) : null;
                if (si && si.kind === "Mandatory" && si.applicableForMode) {
                  sibMandatoryInts.push({ code: s.code, intInfo: si });
                }
              }
            }

            const swapShort = getSwapShortLabel(bestSwapPh);
            const swapCat = bestSwapPh.category || (bestSwapPh.slotKind === "listed" ? "listed" : "elective");
            let addedForSib = 0;

            for (const cand of sibEval.eligible) {
              if (swappedCodes.has(cand.code)) continue;
              if (!ineligByCode.has(cand.code)) continue; // only promote units that were ineligible in original triNum!
              // Skip if confirmed 2027 intensive date clash in sibTri
              if (!isFutureSlotYear && sibMandatoryInts.length > 0) {
                const candInt = getUnitIntensiveForTri(cand.unit, sibTri, plan.preferredMode, targetPlanYear);
                if (
                  candInt &&
                  candInt.kind === "Mandatory" &&
                  candInt.applicableForMode &&
                  sibMandatoryInts.some((o) => checkUnitIntensiveDateOverlap(cand.code, candInt, o.code, o.intInfo))
                ) {
                  continue;
                }
              }
              swappedCodes.add(cand.code);
              addedForSib++;
              siblingSwapEligible.push({
                ...cand,
                siblingTri: sibTri,
                swapPlaceholderId: bestSwapPh.id,
                swapPlaceholderLabel: bestSwapPh.label || swapShort,
                swapPlaceholderShort: swapShort,
                swapPlaceholderCategory: swapCat,
                swapReason: `Fits T${sibTri} on the board — swaps with ${swapShort} slot`,
              });
            }

            if (addedForSib > 0) {
              swapSummary[sibTri] = {
                siblingTri: sibTri,
                swapPlaceholderId: bestSwapPh.id,
                swapPlaceholderLabel: bestSwapPh.label || swapShort,
                swapPlaceholderShort: swapShort,
                swapPlaceholderCategory: swapCat,
                count: addedForSib,
              };
            }
          }

          // Exclude promoted sibling-swap units from generic ineligible so there is zero duplication
          if (swappedCodes.size > 0) {
            for (let i = ineligible.length - 1; i >= 0; i--) {
              if (swappedCodes.has(ineligible[i].code)) ineligible.splice(i, 1);
            }
          }
        }
      }
    }

    siblingSwapEligible.sort((a, b) => {
      // Main teaching periods (T1/T2) ahead of T3
      const aT3 = a.siblingTri === 3 ? 1 : 0;
      const bT3 = b.siblingTri === 3 ? 1 : 0;
      if (aT3 !== bT3) return aT3 - bT3;
      if (a.siblingTri !== b.siblingTri) return a.siblingTri - b.siblingTri;
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
      curTriEffCp,
      eligible,
      siblingSwapEligible,
      swapSummary,
      ineligible,
      alreadyPlannedCount,
      evaluateAnyUnit,
    };
  }

  /**
   * Pure helper (Phase 4): executes a 1-click sibling-trimester auto-swap + unit placement.
   * Moves `swapPlaceholderId` from `toTri` into `targetSlotId`'s exact position in `fromTri`,
   * and places `unitCode` into `swapPlaceholderId`'s exact position in `toTri`.
   * Never mutates the input `plan`.
   */
  function applySiblingSwapUnit(course, plan, yearIdx, fromTri, targetSlotId, toTri, swapPlaceholderId, unitCode, data) {
    if (!plan || !Array.isArray(plan.years) || !plan.years[yearIdx]) {
      return { ok: false, plan, error: "Invalid plan year." };
    }
    const fTri = Number(fromTri);
    const tTri = Number(toTri);
    if (![1, 2, 3].includes(fTri) || ![1, 2, 3].includes(tTri) || fTri === tTri) {
      return { ok: false, plan, error: "Invalid sibling trimester swap." };
    }
    const code = String(unitCode || "").trim().toUpperCase();
    if (!code) {
      return { ok: false, plan, error: "Missing unit code." };
    }

    const nextPlan = JSON.parse(JSON.stringify(plan));
    const yr = nextPlan.years[yearIdx];
    const fromArr = (yr.trimesters && yr.trimesters[fTri]) || [];
    const toArr = (yr.trimesters && yr.trimesters[tTri]) || [];
    const targetIdx = fromArr.findIndex((s) => s.id === targetSlotId);
    const swapIdx = toArr.findIndex((s) => s.id === swapPlaceholderId);

    if (targetIdx === -1 || swapIdx === -1) {
      return { ok: false, plan, error: "Target or sibling placeholder slot no longer exists." };
    }

    const swapPh = toArr[swapIdx];
    const swappedLabel =
      swapPh.slotKind === "elective"
        ? "Elective"
        : swapPh.slotKind === "listed_or_elective"
        ? "Listed or Elective"
        : swapPh.bucketTitle || (swapPh.label || "Open").replace(/^Choose\s+/i, "").replace(/\s+Unit$/i, "").trim();

    // Atomic swap: flexible placeholder -> fromTri; chosen unit -> toTri
    fromArr[targetIdx] = swapPh;
    toArr[swapIdx] = { id: uid("u"), type: "unit", code };

    const yNum = yr.yearNum || yearIdx + 1;
    return {
      ok: true,
      plan: nextPlan,
      placedTri: tTri,
      movedToTri: fTri,
      swappedLabel,
      message: `Added ${code} to Year ${yNum}, Trimester ${tTri} (moved ${swappedLabel} slot to Trimester ${fTri})`,
    };
  }

  /**
   * Finds the optimal (yearIdx, triNum) — and best-matching replaceable placeholder if the trimester
   * is already packed with open placeholders — when adding a concrete unit from Requirements or Catalog!
   * Honors trimester offerings, rolling-start year, prerequisites, co-requisites, concrete-only load
   * capacity (so placeholder-filled trimesters like Y1 T2 remain eligible!), and intensive clash avoidance.
   */
  function findBestSmartPlacement(course, plan, unitCode, data) {
    const code = String(unitCode || "").trim().toUpperCase();
    const u = getUnit(code, data, plan.customUnits);
    if (!u) return { yearIdx: 0, triNum: plan.commencingTrimester || 1, replacePlaceholderId: null, replacePlaceholderLabel: null, needsNewYear: false };

    const resolved = resolveCurriculumBuckets(course, plan, data);
    const bucketById = new Map(resolved.buckets.map((b) => [b.id, b]));
    const placements = getPlannedPlacements(plan, data);
    const { carryOverByChrono, carrySmallByChrono } = computeTimelineCarryOver(plan, data, null);
    const baseMax = plan.studyLoad === "Part-time" ? 12 : 24;
    const lSpec = getUnitLoadSpec(u, plan.studyLoad);
    const uCp = u.cp ?? 6;
    const uLvl = u.level ?? 100;
    const startTri = plan.commencingTrimester || 1;
    const allowT3General = (plan.t3Strategy && plan.t3Strategy !== "none") || startTri === 3;
    const uTrisBase = getUnitEffectiveTrimesters(u, 2029);
    const isT3Only = uTrisBase.length === 1 && uTrisBase[0] === 3;
    const inCourseBuckets = isUnitInCourseBuckets(code, course, plan, data);

    // Find canonical bucket(s) that list this unit so we prefer replacing a matching bucket placeholder!
    const unitMatchingBucketIds = new Set();
    const unitMatchingCats = new Set();
    for (const b of resolved.buckets) {
      if (b.category !== "elective" && (b.units || []).includes(code)) {
        unitMatchingBucketIds.add(b.id);
        unitMatchingCats.add(b.category);
      }
    }

    function scorePlaceholderMatch(ph) {
      if (!ph || ph.type !== "placeholder") return 99;
      if (Array.isArray(ph.allowedLevels) && ph.allowedLevels.length > 0 && !ph.allowedLevels.includes(uLvl)) {
        return 50; // wrong level — avoid replacing unless no other choice
      }
      if (Array.isArray(ph.allowedPrefixes) && ph.allowedPrefixes.length > 0 && !ph.allowedPrefixes.includes(u.prefix)) {
        return 50;
      }
      const pool = getPlaceholderChoicePool(ph, bucketById);
      if ((ph.hintCodes || []).includes(code) || (ph.bucketId && unitMatchingBucketIds.has(ph.bucketId)) || pool.includes(code)) {
        return 0; // exact bucket/choice match (e.g. Science Core placeholder for CHEM120!)
      }
      if (ph.strictPoolOnly && pool.length > 0) {
        return 20; // do not clobber a strict bucket placeholder (e.g. Indigenous Knowledge / Core Maths) with an unrelated unit
      }
      if (ph.category && unitMatchingCats.has(ph.category)) return 1;
      if (ph.slotKind === "listed" && unitMatchingCats.has("listed")) return 1;
      if (ph.strictPoolOnly) {
        return 20; // e.g. strict generic Listed slot when unit is an unrelated pure Elective
      }
      if (ph.slotKind === "listed_or_elective" || ph.slotKind === "elective" || ph.category === "elective") return 2;
      if (ph.slotKind === "listed") return 3;
      return 6;
    }

    let bestCandidate = null;
    const years = plan.years || [];

    for (let yIdx = 0; yIdx < years.length; yIdx++) {
      const yr = years[yIdx];
      const planYear = getPlanYear(yr, yIdx);
      if (!isUnitAvailableInYear(u, planYear)) continue;

      const uTris = getUnitEffectiveTrimesters(u, planYear);
      for (const tNum of [1, 2, 3]) {
        if (yIdx === 0 && tNum < startTri) continue;
        if (uTris.length > 0 && !uTris.includes(tNum)) continue;
        if (tNum === 3 && u.t3RepeatOnly) continue;

        const chrono = yIdx * 3 + (tNum - 1);
        const slots = (yr.trimesters && yr.trimesters[tNum]) || [];
        const carry = carryOverByChrono[chrono] || 0;
        const carrySmall = carrySmallByChrono[chrono] || 0;

        // Compute CONCRETE-only effective CP vs TOTAL effective CP (including placeholders!)
        let concreteEffCp = carry;
        let concreteSmallEff = carrySmall;
        let totalEffCp = carry;
        let totalSmallEff = carrySmall;
        const triPlaceholders = [];
        const triMandatoryInts = [];

        for (const s of slots) {
          if (s.type === "unit") {
            const su = getUnit(s.code, data, plan.customUnits);
            const sls = su ? getUnitLoadSpec(su, plan.studyLoad) : { effCp: s.cp ?? 6, isSmallUnit: false };
            concreteEffCp += sls.effCp;
            totalEffCp += sls.effCp;
            if (sls.isSmallUnit) {
              concreteSmallEff += sls.effCp;
              totalSmallEff += sls.effCp;
            }
            const si = su ? getUnitIntensiveForTri(su, tNum, plan.preferredMode, planYear) : null;
            if (si && si.kind === "Mandatory" && si.applicableForMode) {
              triMandatoryInts.push({ code: s.code, intInfo: si });
            }
          } else if (s.type === "placeholder") {
            const pCp = s.cp ?? 6;
            totalEffCp += pCp;
            if (pCp > 0 && pCp <= 3) totalSmallEff += pCp;
            triPlaceholders.push(s);
          }
        }

        // Check CONCRETE load capacity (placeholders can be replaced, so they never block a valid trimester like Y1 T2!)
        const concAllow = concreteSmallEff + (lSpec.isSmallUnit ? lSpec.effCp : 0) > 0 ? Math.min(3, concreteSmallEff + (lSpec.isSmallUnit ? lSpec.effCp : 0)) : 0;
        const isSoloPtLarge = plan.studyLoad === "Part-time" && concreteEffCp === 0 && lSpec.effCp > baseMax && lSpec.effCp <= 24;
        if (!isSoloPtLarge && concreteEffCp + lSpec.effCp > baseMax + concAllow) {
          continue;
        }

        // Determine if adding u needs to replace an open placeholder in this trimester to stay within maxLoad
        const totAllow = totalSmallEff + (lSpec.isSmallUnit ? lSpec.effCp : 0) > 0 ? Math.min(3, totalSmallEff + (lSpec.isSmallUnit ? lSpec.effCp : 0)) : 0;
        let bestPh = null;
        let bestPhScore = 2; // neutral if no placeholder replacement needed
        if (triPlaceholders.length > 0) {
          const sortedPhs = [...triPlaceholders]
            .filter((ph) => (ph.cp ?? 6) >= Math.min(6, uCp) || (ph.cp ?? 6) === uCp)
            .sort((a, b) => scorePlaceholderMatch(a) - scorePlaceholderMatch(b));
          const topPh = sortedPhs[0] || triPlaceholders[0];
          const topSc = scorePlaceholderMatch(topPh);
          const needsReplaceForCap = totalEffCp + lSpec.effCp > baseMax + totAllow;
          // Replace the best-matching placeholder whenever needed for load cap OR when it's an exact bucket match!
          if (needsReplaceForCap || topSc <= 1) {
            bestPh = topPh;
            bestPhScore = topSc;
          }
        }

        // Evaluate prerequisites & co-requisites prior to (yIdx, tNum)
        const priorUnits = new Set();
        const sameOrPriorUnits = new Set();
        const priorBoundedPhs = [];
        let priorCp = resolved.advancedStandingCp || 0;
        let sameOrPriorCp = resolved.advancedStandingCp || 0;
        const priorPrefixCp = {}, sameOrPriorPrefixCp = {};
        const priorLevelCp = {}, sameOrPriorLevelCp = {};
        const priorPrefixLevelCp = {}, sameOrPriorPrefixLevelCp = {};
        const priorUnitCpMap = new Map(), sameOrPriorUnitCpMap = new Map();

        for (const p of placements) {
          if (bestPh && p.slot.id === bestPh.id) continue;
          const pCp = p.cp ?? 6;
          if (p.chrono < chrono) {
            priorCp += pCp;
            sameOrPriorCp += pCp;
            if (p.type === "unit") {
              priorUnits.add(p.code);
              sameOrPriorUnits.add(p.code);
              priorUnitCpMap.set(p.code, pCp);
              sameOrPriorUnitCpMap.set(p.code, pCp);
              const pr = p.unit?.prefix || "";
              const lv = p.unit?.level ?? 100;
              priorLevelCp[lv] = (priorLevelCp[lv] || 0) + pCp;
              sameOrPriorLevelCp[lv] = (sameOrPriorLevelCp[lv] || 0) + pCp;
              if (pr) {
                priorPrefixCp[pr] = (priorPrefixCp[pr] || 0) + pCp;
                sameOrPriorPrefixCp[pr] = (sameOrPriorPrefixCp[pr] || 0) + pCp;
                priorPrefixLevelCp[`${pr}_${lv}`] = (priorPrefixLevelCp[`${pr}_${lv}`] || 0) + pCp;
                sameOrPriorPrefixLevelCp[`${pr}_${lv}`] = (sameOrPriorPrefixLevelCp[`${pr}_${lv}`] || 0) + pCp;
              }
            } else if (p.type === "placeholder") {
              const pp = getPlaceholderChoicePool(p.slot, bucketById);
              if (pp.length > 0) priorBoundedPhs.push({ slot: p.slot, choicePool: pp });
            }
          } else if (p.chrono === chrono) {
            sameOrPriorCp += pCp;
            if (p.type === "unit") {
              sameOrPriorUnits.add(p.code);
              sameOrPriorUnitCpMap.set(p.code, pCp);
              const pr = p.unit?.prefix || "";
              const lv = p.unit?.level ?? 100;
              sameOrPriorLevelCp[lv] = (sameOrPriorLevelCp[lv] || 0) + pCp;
              if (pr) {
                sameOrPriorPrefixCp[pr] = (sameOrPriorPrefixCp[pr] || 0) + pCp;
                sameOrPriorPrefixLevelCp[`${pr}_${lv}`] = (sameOrPriorPrefixLevelCp[`${pr}_${lv}`] || 0) + pCp;
              }
            }
          }
        }

        const pRes = evaluatePrereqMeta(
          u,
          { units: priorUnits, cp: priorCp, prefixCp: priorPrefixCp, levelCp: priorLevelCp, prefixLevelCp: priorPrefixLevelCp, unitCpMap: priorUnitCpMap, course, plan },
          inCourseBuckets
        );
        let prereqOk = pRes.ok;
        if (!prereqOk && pRes.errors.length === 0 && u.prereqMeta?.tokens?.length && priorBoundedPhs.length > 0) {
          if (arePrereqTokensGuaranteedByPlaceholders(u.prereqMeta.tokens, u.prereqMeta.codes, priorUnits, priorBoundedPhs)) {
            prereqOk = true;
          }
        }
        const cRes = evaluateCoreqMeta(
          u,
          { units: sameOrPriorUnits, cp: sameOrPriorCp, prefixCp: sameOrPriorPrefixCp, levelCp: sameOrPriorLevelCp, prefixLevelCp: sameOrPriorPrefixLevelCp, unitCpMap: sameOrPriorUnitCpMap, course, plan }
        );
        const coreqOk = cRes.ok;

        // Check intensive clashes in (yIdx, tNum)
        let hasIntClash = false;
        const uInt = getUnitIntensiveForTri(u, tNum, plan.preferredMode, planYear);
        if (uInt && uInt.kind === "Mandatory" && uInt.applicableForMode && triMandatoryInts.length > 0) {
          hasIntClash = triMandatoryInts.some(
            (o) => doCampusesClash(uInt, o.intInfo) || Boolean(checkUnitIntensiveDateOverlap(code, uInt, o.code, o.intInfo))
          );
        }

        const triModes = getUnitModesForTri(u, tNum);
        const modeOk = !plan.preferredMode || triModes.length === 0 || triModes.includes(plan.preferredMode);

        let sc = 0;
        if (!prereqOk) sc += 1000;
        if (!coreqOk) sc += 500;
        if (hasIntClash) sc += 250;
        if (tNum === 3 && !isT3Only && !allowT3General) sc += 180;
        if (!modeOk) sc += 20;
        sc += bestPhScore * 15;
        sc += chrono * 12;

        if (!bestCandidate || sc < bestCandidate.score) {
          bestCandidate = {
            score: sc,
            yearIdx: yIdx,
            triNum: tNum,
            replacePlaceholderId: bestPh ? bestPh.id : null,
            replacePlaceholderLabel: bestPh ? bestPh.label : null,
            needsNewYear: false,
          };
        }
      }
    }

    if (bestCandidate) return bestCandidate;

    const fallbackTri = uTrisBase.length > 0 ? uTrisBase[0] : 1;
    return {
      yearIdx: years.length,
      triNum: fallbackTri,
      replacePlaceholderId: null,
      replacePlaceholderLabel: null,
      needsNewYear: true,
    };
  }

  /* ================= WHOLE-UNIVERSITY COURSE FINDER SEARCH ENGINE ================= */

  // Primary direct acronym/stem expansions (treated with near-exact title weight!)
  const PRIMARY_SYNONYMS = {
    ai: ["artificial intelligence"],
    ml: ["machine learning"],
    it: ["information technology"],
    cs: ["computer science"],
    compsci: ["computer science"],
    hr: ["human resource", "human resources"],
    rn: ["nursing", "registered nurse"],
    mba: ["business administration"],
    llb: ["laws"],
    jd: ["juris doctor"],
    phd: ["doctor of philosophy"],
    psychology: ["psychological"],
    psychological: ["psychology"],
    psych: ["psychology", "psychological"],
    cyber: ["cybersecurity", "cyber security"],
    ag: ["agriculture", "agribusiness"],
    agri: ["agriculture", "agribusiness"],
    vet: ["veterinary"],
    chem: ["chemistry"],
    bio: ["biology", "biological"],
    math: ["mathematics"],
    maths: ["mathematics"],
    stats: ["statistics"],
    phys: ["physics"],
    econ: ["economics"],
    crim: ["criminology"],
    med: ["medicine", "medical"],
    env: ["environmental"],
    geo: ["geoscience", "geography"],
    biz: ["business"],
    teach: ["teaching", "education"],
    teacher: ["teaching", "education"],
  };

  // Secondary/related conceptual expansions (helpful discovery without overriding primary title hits!)
  const COURSE_SYNONYMS = {
    cs: ["computer science", "information technology", "software", "cosc"],
    compsci: ["computer science", "cosc"],
    it: ["information technology", "computer science", "cybersecurity", "software"],
    computing: ["computer science", "information technology", "cybersecurity", "data science", "artificial intelligence"],
    coding: ["computer science", "information technology", "software", "data science"],
    software: ["computer science", "information technology", "software", "software development"],
    programming: ["computer science", "information technology", "data science"],
    ai: ["artificial intelligence", "machine learning", "intelligent systems", "data science"],
    ml: ["machine learning", "artificial intelligence", "data science", "computer science"],
    cyber: ["cybersecurity", "cyber security", "computer science", "information technology"],
    security: ["cybersecurity", "criminology"],
    hr: ["human resource", "human resources", "employment relations", "management"],
    rn: ["nursing", "registered nurse"],
    vet: ["veterinary", "animal science", "zoology"],
    animal: ["animal science", "zoology", "veterinary"],
    animals: ["animal science", "zoology", "veterinary"],
    psych: ["psychology", "psychological", "counselling", "mental health"],
    psychology: ["psychological", "counselling", "mental health"],
    mental: ["mental health", "psychology", "psychological", "counselling", "neuroscience"],
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
    finance: ["accounting", "economics", "finance", "agribusiness"],
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
    brain: ["neuroscience", "psychology", "psychological"],
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
    resources: ["resource"],
    resource: ["resources"],
  };

  // Multi-word phrase expansions
  const PHRASE_SYNONYMS = {
    "software engineering": ["software development", "computer science", "information technology", "software"],
    "machine learning": ["artificial intelligence", "data science", "computer science", "intelligent systems"],
    "human resources": ["human resource", "human resource management", "employment relations"],
    "information technology": ["computer science", "cybersecurity"],
    "artificial intelligence": ["machine learning", "data science"],
  };

  // Common English pronouns/prepositions that must NEVER match prose (fixes Q="it" returning 62 prose hits!)
  const STOP_PROSE_WORDS = new Set([
    "it", "in", "on", "at", "to", "of", "by", "or", "is", "as", "an", "be", "we", "he", "me", "my", "no", "so", "up", "us", "do", "go", "if",
  ]);

  function matchTerm(haystack, term) {
    if (!haystack || !term) return false;
    const escTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Short terms (<=3 chars like "ai", "it", "hr", "rn", "law", "mba", "cs", "vet") MUST match whole word boundaries
    if (term.length <= 3) {
      return new RegExp(`\\b${escTerm}\\b`, "i").test(haystack);
    }
    return new RegExp(`\\b${escTerm}`, "i").test(haystack);
  }

  /**
   * Damerau-Levenshtein fuzzy matcher (handles typos + adjacent transpositions like "computre" -> "computer",
   * "chemestry" -> "chemistry", "pyshcology" -> "psychology"!).
   */
  function damerauDist(a, b, maxDist) {
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
    for (let i = 0; i <= la; i++) dp[i][0] = i;
    for (let j = 0; j <= lb; j++) dp[0][j] = j;
    for (let i = 1; i <= la; i++) {
      let rowMin = maxDist + 1;
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let val = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          val = Math.min(val, dp[i - 2][j - 2] + 1);
        }
        dp[i][j] = val;
        if (val < rowMin) rowMin = val;
      }
      if (rowMin > maxDist) return maxDist + 1;
    }
    return dp[la][lb];
  }

  function fuzzyWordMatch(queryWord, targetWord) {
    if (!queryWord || !targetWord || queryWord.length < 4 || targetWord.length < 4) return false;
    if (damerauDist(queryWord, targetWord, 1) <= 1) return true;
    // Allow distance 2 for longer words (>= 7 chars) sharing the same first letter (e.g. "pyshcology" <-> "psychology"/"psychological")
    if (queryWord.length >= 7 && targetWord.length >= 7 && queryWord[0] === targetWord[0]) {
      if (damerauDist(queryWord, targetWord, 2) <= 2) return true;
      // Compare against matching-length prefix AND trimmed stem (handles "pyshcology" vs "psychological"!)
      if (targetWord.length > queryWord.length) {
        const pref = targetWord.slice(0, queryWord.length);
        if (damerauDist(queryWord, pref, 2) <= 2) return true;
        const qStem = queryWord.replace(/[yies]+$/, "");
        if (qStem.length >= 6 && damerauDist(qStem, targetWord.slice(0, qStem.length), 2) <= 2) return true;
      }
    }
    if (targetWord.length > queryWord.length && queryWord.length >= 5) {
      if (damerauDist(queryWord, targetWord.slice(0, queryWord.length), 1) <= 1) return true;
    }
    return false;
  }

  let _courseUnitIndexCache = null;
  let _courseUnitIndexData = null;
  function getCourseUnitIndex(data) {
    if (_courseUnitIndexCache && _courseUnitIndexData === data) return _courseUnitIndexCache;
    const map = new Map(); // courseCode -> { units: Set, aosEntries: [{code,title,isMinor,containerTitle}] }
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
    _courseUnitIndexData = data;
    return map;
  }

  /**
   * Scores a single course against a single (non-OR) sub-query string.
   */
  function scoreCourseForSingleQuery(c, subQuery, unitIdxMap) {
    const q = (subQuery || "").trim().toLowerCase();
    if (!q) return { score: 0, matchedMajors: [], matchedUnit: null, matchBadges: [] };

    const qUpper = q.toUpperCase();
    const isUnitCodeQuery = /^(?:[A-Z]{2,4}\d{3,4}[A-Z]?|PRAC[A-Z]+|LANTITE-[LN])$/.test(qUpper);
    const tokens = q.split(/[\s/,&-]+/).filter((t) => t.length >= 2);
    const phraseAlts = PHRASE_SYNONYMS[q] || [];

    const codeLow = c.code.toLowerCase();
    const titleLow = c.title.toLowerCase();
    const schoolLow = (c.school || "").toLowerCase();
    const ascedLow = (c.asced || "").toLowerCase();
    const careersLow = (c.careers || "").toLowerCase();
    const overviewLow = (c.overview || "").toLowerCase();
    const prefixesLow = (c.unitPrefixes || []).map((p) => p.toLowerCase());
    const idxEntry = unitIdxMap.get(c.code) || { units: new Set(), aosEntries: [] };
    const titleWords = titleLow.split(/[^a-z0-9]+/).filter(Boolean);
    const aosWords = [];
    for (const a of idxEntry.aosEntries) {
      for (const w of a.title.toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length >= 4) aosWords.push(w);
      }
    }

    let score = 0;
    const matchBadges = [];
    const matchedMajors = [];
    let matchedUnit = null;

    // 1. Unit Code reverse lookup! (e.g. "CHEM110", "MEDI1101A", "PRACAGR")
    if (isUnitCodeQuery && idxEntry.units.has(qUpper)) {
      score += 110;
      matchedUnit = qUpper;
      matchBadges.push(`Includes unit ${qUpper}`);
    }

    // 2. Exact / prefix Course Code match
    if (codeLow === q) score += 165;
    else if (q.length >= 3 && codeLow.startsWith(q)) score += 95;
    else if (q === "it" && (codeLow === "bit01" || codeLow === "mit" || codeLow === "dit" || codeLow === "gcit" || codeLow === "gdit")) {
      score += 90;
    }

    // 3. Exact phrase OR Primary-Synonym phrase in Title (boosts MAI for "ai", BPSYSC for "psychology", BIT01/DIT/MIT for "it"!)
    const directTitleHit =
      (!STOP_PROSE_WORDS.has(q) && matchTerm(titleLow, q)) ||
      (q.length >= 3 && !q.endsWith("s") && matchTerm(titleLow, `${q}s`)) ||
      (q.length >= 4 && q.endsWith("s") && matchTerm(titleLow, q.slice(0, -1)));
    const primaryTitleAlts = PRIMARY_SYNONYMS[q] || [];
    const primaryTitleHit = !directTitleHit && primaryTitleAlts.some((alt) => matchTerm(titleLow, alt));
    const phraseTitleHit = !directTitleHit && !primaryTitleHit && phraseAlts.some((alt) => matchTerm(titleLow, alt));

    if (directTitleHit) score += 98;
    else if (primaryTitleHit) score += 90;
    else if (phraseTitleHit) score += 62;

    // 4. Double / Combined degree keyword boost
    const isDoubleQuery = /\b(double|combined)\b/i.test(q);
    if (isDoubleQuery && c.isDoubleDegree) {
      score += 65;
      matchBadges.push("Double / Combined Degree");
    }

    // 5. Major / Minor / Specialisation matching (primary vs secondary synonyms weighted cleanly so MAI beats BENSC for "ai"!)
    const expandedGroups = tokens.map((tok) => {
      const alts = new Set([tok]);
      for (const s of PRIMARY_SYNONYMS[tok] || []) alts.add(s);
      for (const s of COURSE_SYNONYMS[tok] || []) alts.add(s);
      return Array.from(alts);
    });

    let majorBonus = 0;
    for (const aos of idxEntry.aosEntries) {
      const aLow = aos.title.toLowerCase();
      const directAos =
        (!STOP_PROSE_WORDS.has(q) && matchTerm(aLow, q)) ||
        (q.length >= 4 && q.endsWith("s") && matchTerm(aLow, q.slice(0, -1)));
      const primaryAos = !directAos && primaryTitleAlts.some((alt) => matchTerm(aLow, alt));
      const phraseAos = !directAos && !primaryAos && phraseAlts.some((alt) => matchTerm(aLow, alt));
      const synAos =
        !directAos &&
        !primaryAos &&
        !phraseAos &&
        expandedGroups.length > 0 &&
        expandedGroups.every((alts) =>
          alts.some((alt) => !(STOP_PROSE_WORDS.has(alt) && alt.length <= 2) && matchTerm(aLow, alt))
        );

      if (directAos || primaryAos || phraseAos || synAos) {
        const bScore = directAos ? 62 : primaryAos ? 52 : phraseAos ? 44 : 26;
        majorBonus = Math.max(majorBonus, bScore);
        if (matchedMajors.length < 4 && !matchedMajors.some((m) => m.title === aos.title)) {
          matchedMajors.push(aos);
        }
      }
    }
    score += majorBonus + Math.min(matchedMajors.length, 3) * 2;

    // 6. Per-token & synonym scoring (NO c.faculty pollution! Stop-words blocked from prose!)
    const FILLER_WITH_DOUBLE = new Set(["degree", "degrees", "course", "courses", "program", "programs", "award"]);
    if (tokens.length > 0) {
      let tokensMatched = 0;
      let titleTokensMatched = 0;

      for (let tIdx = 0; tIdx < expandedGroups.length; tIdx++) {
        const origTok = tokens[tIdx];
        const alts = expandedGroups[tIdx];
        const primSet = new Set(PRIMARY_SYNONYMS[origTok] || []);
        const isStopWord = STOP_PROSE_WORDS.has(origTok);

        let bestTokScore = 0;
        let hitTitle = false;

        // "double degree" / "combined degree": filler word "degree" automatically passes on Double Degrees!
        if (isDoubleQuery && FILLER_WITH_DOUBLE.has(origTok) && c.isDoubleDegree) {
          bestTokScore = 25;
          hitTitle = true;
        }

        // Phrase synonym fallback for multi-word queries like "software engineering", "machine learning"
        if (phraseAlts.length > 0) {
          for (const pa of phraseAlts) {
            if (matchTerm(titleLow, pa)) {
              bestTokScore = Math.max(bestTokScore, 40);
              hitTitle = true;
            } else if (idxEntry.aosEntries.some((a) => matchTerm(a.title.toLowerCase(), pa))) {
              bestTokScore = Math.max(bestTokScore, 34);
            }
          }
        }

        for (const alt of alts) {
          const isDirect = alt === origTok;
          const isPrimary = primSet.has(alt);
          const mult = isDirect ? 1 : isPrimary ? 0.92 : 0.55;

          if (codeLow === alt) {
            bestTokScore = Math.max(bestTokScore, Math.round(62 * mult));
            hitTitle = true;
          } else if (!(isDirect && isStopWord) && matchTerm(titleLow, alt)) {
            bestTokScore = Math.max(bestTokScore, Math.round(48 * mult));
            hitTitle = true;
          } else if (
            isDirect &&
            alt.length >= 4 &&
            titleWords.some((w) => fuzzyWordMatch(alt, w))
          ) {
            bestTokScore = Math.max(bestTokScore, 36);
            hitTitle = true;
          } else if (alt === "double" || alt === "combined") {
            if (c.isDoubleDegree) {
              bestTokScore = Math.max(bestTokScore, 42);
              hitTitle = true;
            }
          } else if (!isStopWord && alt.length >= 4 && prefixesLow.includes(alt)) {
            bestTokScore = Math.max(bestTokScore, Math.round(26 * mult));
          } else if (
            !(isDirect && isStopWord) &&
            idxEntry.aosEntries.some((a) => matchTerm(a.title.toLowerCase(), alt))
          ) {
            bestTokScore = Math.max(bestTokScore, Math.round(28 * mult));
          } else if (
            isDirect &&
            alt.length >= 4 &&
            aosWords.some((w) => fuzzyWordMatch(alt, w))
          ) {
            bestTokScore = Math.max(bestTokScore, 30);
            // Also populate matchedMajors for fuzzy AOS hits like "chemestry" -> Chemistry!
            for (const aos of idxEntry.aosEntries) {
              if (
                aos.title
                  .toLowerCase()
                  .split(/[^a-z0-9]+/)
                  .some((w) => fuzzyWordMatch(alt, w))
              ) {
                if (matchedMajors.length < 4 && !matchedMajors.some((m) => m.title === aos.title)) {
                  matchedMajors.push(aos);
                }
              }
            }
          } else if (!(isDirect && isStopWord) && (isDirect || isPrimary) && matchTerm(ascedLow, alt)) {
            bestTokScore = Math.max(bestTokScore, Math.round(14 * mult));
          } else if (isDirect && !isStopWord && matchTerm(schoolLow, alt)) {
            // Match school name ONLY on direct non-stopword user queries (NEVER c.faculty!)
            bestTokScore = Math.max(bestTokScore, 11);
          } else if (isDirect && !isStopWord && (matchTerm(careersLow, alt) || matchTerm(overviewLow, alt))) {
            bestTokScore = Math.max(bestTokScore, 7);
          }
        }

        if (bestTokScore > 0) {
          tokensMatched++;
          if (hitTitle) titleTokensMatched++;
          score += bestTokScore;
        }
      }

      if (titleTokensMatched === tokens.length) score += 28;
      if (
        tokens.length >= 2 &&
        tokensMatched < tokens.length &&
        !matchedUnit &&
        matchedMajors.length === 0 &&
        !phraseTitleHit
      ) {
        score = 0;
      }
    }

    if (score > 0) {
      if (c.studyLevel === "Undergraduate" && c.totalCp >= 144) score += 4;
      if (!isDoubleQuery && !c.isDoubleDegree) score += 2;
    }

    return { score, matchedMajors, matchedUnit, matchBadges };
  }

  /**
   * Ranked search across ALL 233 UNE courses, their 675 Majors/Minors/Specialisations,
   * 1,720 unit codes, career keywords, schools, faculties, ATAR (decimal-safe), and study modes.
   * Supports explicit OR / | queries (e.g. Hero topic chip "computer science OR data science OR ai OR cyber OR it")
   * and optional filters.anyTerms arrays.
   */
  function searchCourses(rawQuery, filters, data) {
    const q = (rawQuery || "").trim();
    const f = filters || {};
    const unitIdxMap = getCourseUnitIndex(data);

    // Determine OR sub-queries (from explicit "OR" / "|" in query, or filters.anyTerms)
    let subQueries = [];
    if (Array.isArray(f.anyTerms) && f.anyTerms.length > 0) {
      subQueries = f.anyTerms.map((s) => String(s || "").trim()).filter(Boolean);
    }
    if (q) {
      if (/\s+or\s+|\s*\|\s*/i.test(q)) {
        const parts = q.split(/\s+or\s+|\s*\|\s*/i).map((s) => s.trim()).filter(Boolean);
        subQueries = subQueries.concat(parts);
      } else {
        subQueries.push(q);
      }
    }

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
        const atarNum = parseFloat(c.atar);
        if (isNaN(atarNum) || atarNum > parseFloat(f.maxAtar)) continue;
      }

      if (subQueries.length === 0) {
        results.push({ course: c, score: c.code === "BSC" ? 10 : 0, matchedMajors: [], matchedUnit: null, matchBadges: [] });
        continue;
      }

      if (subQueries.length === 1) {
        const res = scoreCourseForSingleQuery(c, subQueries[0], unitIdxMap);
        if (res.score > 0) {
          results.push({ course: c, ...res });
        }
      } else {
        // Multi-term OR query: take best branch score + small bonus per extra matched branch
        let bestScore = 0;
        let branchesMatched = 0;
        const mergedMajors = [];
        const mergedBadges = [];
        let matchedUnit = null;
        for (const sq of subQueries) {
          const res = scoreCourseForSingleQuery(c, sq, unitIdxMap);
          if (res.score > 0) {
            branchesMatched++;
            if (res.score > bestScore) bestScore = res.score;
            if (res.matchedUnit && !matchedUnit) matchedUnit = res.matchedUnit;
            for (const m of res.matchedMajors) {
              if (mergedMajors.length < 4 && !mergedMajors.some((x) => x.title === m.title)) {
                mergedMajors.push(m);
              }
            }
            for (const b of res.matchBadges) {
              if (!mergedBadges.includes(b)) mergedBadges.push(b);
            }
          }
        }
        if (bestScore > 0) {
          const totalScore = bestScore + Math.min(branchesMatched - 1, 3) * 6;
          results.push({
            course: c,
            score: totalScore,
            matchedMajors: mergedMajors,
            matchedUnit,
            matchBadges: mergedBadges,
          });
        }
      }
    }

    // Prune ultra-weak prose-only noise hits (e.g. HBCOMP mentioning "law" in overview) when strong title/code/major matches exist!
    if (subQueries.length > 0 && results.length > 0) {
      const topScore = Math.max(...results.map((r) => r.score));
      if (topScore >= 80) {
        for (let i = results.length - 1; i >= 0; i--) {
          if (results[i].score <= 13 && results[i].matchedMajors.length === 0 && !results[i].matchedUnit) {
            results.splice(i, 1);
          }
        }
      }
    }

    const sortBy = f.sortBy || "relevance";
    results.sort((a, b) => {
      if (sortBy === "az") return a.course.title.localeCompare(b.course.title);
      if (sortBy === "cp_asc") return (a.course.totalCp || 0) - (b.course.totalCp || 0) || a.course.title.localeCompare(b.course.title);
      if (sortBy === "cp_desc") return (b.course.totalCp || 0) - (a.course.totalCp || 0) || a.course.title.localeCompare(b.course.title);
      if (sortBy === "atar") {
        const aA = parseFloat(a.course.atar) || 999;
        const bA = parseFloat(b.course.atar) || 999;
        return aA - bA || a.course.title.localeCompare(b.course.title);
      }
      if (b.score !== a.score) return b.score - a.score;
      return a.course.title.localeCompare(b.course.title);
    });

    return results;
  }

  /**
   * Pre-selects a matched AOS (Major/Minor/Specialisation/Pathway) on a course plan,
   * automatically switching plan.admissionRule when the AOS belongs to a non-default Rule/Schedule
   * (fixes 52/55 failures + 3 BACC Rule B/C failures). Returns boolean success!
   */
  function preselectAOS(course, plan, aosEntry, data) {
    if (!aosEntry || !aosEntry.code) return false;
    const cfg = course.structureConfig;
    const targetCode = String(aosEntry.code).trim();

    // Switch Admission Rule automatically if targetCode lives in a different Rule/Schedule!
    if (cfg.hasAdmissionRules) {
      const targetRule = findAdmissionRuleContainingAOS(course, targetCode, plan.admissionRule);
      if (targetRule && targetRule !== plan.admissionRule) {
        plan.admissionRule = targetRule;
        plan.dynamicAosSelections = {};
        plan.selectedMajors = [];
        plan.selectedMinor = "";
      }
    }

    if (cfg.aosMode === "dynamic") {
      plan.dynamicAosSelections = plan.dynamicAosSelections || {};
      const groups = getDynamicAOSGroups(course, plan, data);
      const matchGrp =
        groups.find((g) => g.items.some((it) => it.code === targetCode)) ||
        groups.find((g) => g.id === aosEntry.containerTitle);
      if (!matchGrp) return false;
      if (!matchGrp.isMandatorySingle) {
        plan.dynamicAosSelections[matchGrp.id] = targetCode;
      }
      return true;
    }

    const opts = getAvailableAOSOptions(course, plan, data);
    if (opts.majors.some((m) => m.code === targetCode)) {
      if (!plan.selectedMajors.includes(targetCode)) {
        plan.selectedMajors = [targetCode];
      }
      return true;
    }
    if (opts.minors.some((m) => m.code === targetCode)) {
      if (cfg.aosMode === "bsc") plan.aosStructure = "1m1n";
      else if (cfg.aosMode === "bcomp") plan.aosStructure = "opt2";
      else if (cfg.aosMode === "bbiosc") plan.aosStructure = "minor";
      plan.selectedMinor = targetCode;
      return true;
    }
    if (opts.pathways.some((p) => p.code === targetCode)) {
      plan.selectedMinor = targetCode;
      return true;
    }
    if (opts.mandatoryComponents.some((mc) => mc.code === targetCode)) {
      return true;
    }
    return false;
  }

  global.UNEPlannerEngine = {
    uid,
    getUnit,
    getPlanYear,
    getUnitModesForTri,
    getUnitOfferingPeriods,
    getNoOfferingLabel,
    getSlotPeriodMismatch,
    getUnitLoadSpec,
    getUnitIntensiveForTri,
    doCampusesClash,
    checkUnitIntensiveDateOverlap,
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
    previewT3Options,
    applyOfficialStudyPlan,
    getAvailableStudyPlans,
    getBaseUnitIneligibility,
    parseSlotSpec,
    resolveSlotCandidates,
    applySiblingSwapUnit,
    findBestSmartPlacement,
    searchCourses,
    preselectAOS,
  };
})(typeof window !== "undefined" ? window : globalThis);
