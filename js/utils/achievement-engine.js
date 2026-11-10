/**
 * js/utils/achievement-engine.js
 * Single-pass computation: papers[] → achievement slots grouped by scholarly/atlas.
 * Depends on window.__achievementDefs and window.__authorBadges.
 *
 * Output shape:
 *   {
 *     scholarly: { slots: [...], summary: {unlocked, total, percentage} },
 *     atlas:     { slots: [...], summary: {unlocked, total, percentage} },
 *     // Legacy top-level (backwards compat with v0.5.0 callers):
 *     slots:     [...scholarly only...],
 *     summary:   {...scholarly only...}
 *   }
 */
(function (window) {
  "use strict";

  // Atlas metrics that represent "ever achieved" state — these are merged
  // with caller-supplied history so unlocked tiers persist even if current
  // values drop (e.g., user unpins papers).
  const ATLAS_PERSISTENT_METRICS = [
    "cataloged", "starred", "pinned", "readPapers", "noted",
    "binned", "publicPapers", "categoriesCreated",
    "maxCatsOnPaper", "sourceDiversity",
  ];

  function compute(papers, options) {
    const opts = options || {};
    const atlasHistory = opts.atlasHistory || {};
    const { DEFS } = window.__achievementDefs;
    const { totalAuthorCount, positionKey } = window.__authorBadges;

    // ── 1. Single-pass counter accumulation ──────────────────────────────
    const c = {
      // Scholarly counters — paper/review only (isMine, not deleted)
      totalPapers: 0,
      firstAuthorPapers: 0,
      secondAuthorPapers: 0,
      corrPapers: 0,
      coCorrPapers: 0,
      coFirstPapers: 0,
      soloPapers: 0,
      duoPapers: 0,
      trioPapers: 0,
      totalCitations: 0,
      maxSingleCitation: 0,
      _mainAuthorResearchPapers: [],
      papersCited10: 0,
      papersCited100: 0,
      largeTeam20: 0,
      largeTeam50: 0,
      largeTeam100: 0,

      // Type-specific scholarly counters (isMine, not deleted, specific type)
      reviewPapers: 0,
      thesisPapers: 0,
      articlePapers: 0,

      // Atlas counters (all papers, not just isMine)
      cataloged: 0,
      starred: 0,
      pinned: 0,
      readPapers: 0,
      noted: 0,
      binned: 0,
      publicPapers: 0,
      categoriesCreated: 0,   // unique category names across all papers
      maxCatsOnPaper: 0,
      sourceDiversity: 0,     // unique sourceName values
    };

    const uniqueCats = new Set();
    const uniqueSources = new Set();

    for (const p of papers) {
      const isDeleted = !!p.deletedAt;

      // ── Atlas counters (library papers only; deletedAt tracked separately)
      if (!isDeleted) {
        // In-library (inLibrary=true) counts as cataloged
        if (p.inLibrary !== false) c.cataloged++;

        if (p.starred)  c.starred++;
        if (p.pinned)   c.pinned++;
        if (p.isRead || p.status === "read") c.readPapers++;
        if (p.notes && String(p.notes).trim() !== "") c.noted++;
        if (p.isPublic) c.publicPapers++;

        const cats = Array.isArray(p.tags) ? p.tags : [];
        for (const name of cats) uniqueCats.add(name);
        if (cats.length > c.maxCatsOnPaper) c.maxCatsOnPaper = cats.length;

        if (p.sourceName && String(p.sourceName).trim() !== "") {
          uniqueSources.add(String(p.sourceName).trim());
        }
      } else {
        c.binned++;
      }

      // ── Scholarly counters (isMine only, exclude deleted)
      if (isDeleted) continue;
      if (!p.isMine) continue;

      const type = p.type || "other";

      // Type-specific counters (own series, independent of totalPapers bucket)
      if (type === "review")  c.reviewPapers++;
      if (type === "thesis")  c.thesisPapers++;
      if (type === "article") c.articlePapers++;

      // Existing scholarly series count only paper/review
      if (type !== "paper" && type !== "review") continue;

      c.totalPapers++;

      const key = positionKey(p);
      const authors = totalAuthorCount(p);
      const cit = p.citationCount || 0;

      if (key === "1st") c.firstAuthorPapers++;
      if (key === "2nd" && p.correspondingRole !== "corresponding") c.secondAuthorPapers++;
      if (p.isCoFirst || key === "co-1st") c.coFirstPapers++;
      if (p.correspondingRole === "corresponding")    c.corrPapers++;
      if (p.correspondingRole === "co-corresponding") c.coCorrPapers++;

      if (authors === 1) c.soloPapers++;
      if (authors === 2) c.duoPapers++;
      if (authors === 3) c.trioPapers++;
      if (authors > 20)  c.largeTeam20++;
      if (authors > 50)  c.largeTeam50++;
      if (authors > 100) c.largeTeam100++;

      c.totalCitations += cit;
      // maxSingleCitation: only research papers (not reviews) where user is a main author
      // (1st, co-1st, corresponding, or co-corresponding).
      const isMainAuthor = (
        key === "1st" ||
        key === "co-1st" ||
        p.isCoFirst === true ||
        p.correspondingRole === "corresponding" ||
        p.correspondingRole === "co-corresponding"
      );
      if (type === "paper" && isMainAuthor) {
        c._mainAuthorResearchPapers.push(p);
        if (cit > c.maxSingleCitation) c.maxSingleCitation = cit;
      }
      if (cit >= 10)  c.papersCited10++;
      if (cit >= 100) c.papersCited100++;
    }

    c.categoriesCreated = uniqueCats.size;
    c.sourceDiversity   = uniqueSources.size;

    // ── Merge Atlas metrics with historical max (persistence) ────────────
    // Scholarly metrics intentionally skip this — those reflect the current
    // set of papers in the profile (users can remove fake papers).
    const atlasEffective = {};
    for (const k of ATLAS_PERSISTENT_METRICS) {
      const current = c[k] || 0;
      const histVal = Number(atlasHistory[k]) || 0;
      const merged = current > histVal ? current : histVal;
      c[k] = merged;
      atlasEffective[k] = merged;
    }

    // ── 2. Build slots grouped by scholarly/atlas ────────────────────────
    const scholarly = buildGroup(DEFS.filter(d => (d.group || "scholarly") === "scholarly"), c);
    const atlas     = buildGroup(DEFS.filter(d => d.group === "atlas"),                    c);

    return {
      scholarly,
      atlas,
      atlasEffective,
      // Legacy top-level for backwards compat
      slots: scholarly.slots,
      summary: scholarly.summary,
    };
  }

  // Helper: group defs by series, pick highest unlocked, compute progress
  function buildGroup(defs, counters) {
    const seriesMap = new Map();
    for (const def of defs) {
      if (!seriesMap.has(def.series)) seriesMap.set(def.series, []);
      seriesMap.get(def.series).push(def);
    }
    for (const arr of seriesMap.values()) {
      arr.sort((a, b) => a.threshold - b.threshold);
    }

    const slots = [];
    let totalAchievements = 0;
    let unlockedCount = 0;

    for (const [series, sDefs] of seriesMap) {
      totalAchievements += sDefs.length;
      const value = counters[sDefs[0].metric] || 0;

      let best = null;
      let bestIdx = -1;
      for (let i = sDefs.length - 1; i >= 0; i--) {
        if (value >= sDefs[i].threshold) {
          best = sDefs[i];
          bestIdx = i;
          break;
        }
      }

      if (!best) continue;

      for (let i = 0; i <= bestIdx; i++) unlockedCount++;

      const nextDef = bestIdx < sDefs.length - 1 ? sDefs[bestIdx + 1] : null;

      const slot = {
        series,
        category: best.category,
        current: {
          id: best.id,
          title: best.title,
          desc: best.desc,
          tier: best.tier,
          threshold: best.threshold,
          shape: best.shape || null,
          shieldStack: best.shieldStack || 0,
        },
        next: nextDef ? { title: nextDef.title, threshold: nextDef.threshold } : null,
        progress: {
          value,
          nextTarget: nextDef ? nextDef.threshold : best.threshold,
        },
        isMax: !nextDef,
      };
      if (series === "single-paper-cit") {
        const threshold = best.threshold;
        const qualifying = (counters._mainAuthorResearchPapers || [])
          .filter(p => (p.citationCount || 0) >= threshold);
        slot.detail = { papers: qualifying };
      }
      slots.push(slot);
    }

    slots.sort((a, b) => {
      const at = a.current.tier;
      const bt = b.current.tier;
      if (at == null && bt == null) return a.series.localeCompare(b.series);
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt - at || a.series.localeCompare(b.series);
    });

    return {
      slots,
      summary: {
        unlocked: unlockedCount,
        total: totalAchievements,
        percentage: totalAchievements ? Math.round((unlockedCount / totalAchievements) * 100) : 0,
      },
    };
  }

  window.__achievementEngine = { compute, ATLAS_PERSISTENT_METRICS };
})(window);
