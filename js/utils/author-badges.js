/**
 * js/utils/author-badges.js
 * Shared author-role badge helpers for Library + Profile cards.
 * Loaded as a plain script (not a module) so app.js can consume it
 * via window.__authorBadges. profile.js (ES module) also reads from
 * the same global.
 */
(function (window) {
  "use strict";

  function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return "th";
    const last = n % 10;
    return last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  }

  function totalAuthorCount(paper) {
    if (!paper || !paper.authors) return 0;
    return paper.authors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length;
  }

  // Derives a canonical position key from paper fields.
  // Returns: "1st" | "co-1st" | "2nd" | "3rd" | "nth" | "Last" | ""
  function positionKey(paper) {
    if (!paper) return "";
    if (paper.isLast) return "Last";
    if (paper.isCoFirst) return "co-1st";
    if (paper.authorOrder === 1) return "1st";
    if (paper.authorOrder === 2) return "2nd";
    if (paper.authorOrder === 3) return "3rd";
    if (paper.authorOrder != null) return "nth";
    if (paper.isMine) return "nth";  // toggled on but no position set
    return "";
  }

  // Legacy label for mobile circles (returns ordinal string or "last")
  function authorRoleLabel(paper) {
    if (!paper) return "";
    const key = positionKey(paper);
    if (!key) return "";
    if (key === "Last") return "last";
    if (key === "co-1st") return "co-1st";
    if (key === "1st") return "1st";
    if (key === "2nd") return "2nd";
    if (key === "3rd") return "3rd";
    // nth: fall back to authorOrder ordinal if available
    if (paper.authorOrder != null) return paper.authorOrder + ordinalSuffix(paper.authorOrder);
    return "";
  }

  function correspondingLabel(paper) {
    if (!paper) return "";
    if (paper.correspondingRole && paper.correspondingRole !== "none") return "corresp";
    return "";
  }

  // Does the paper count as "mine"?
  function isMyPaper(paper) {
    if (!paper) return false;
    if (paper.isMine) return true;
    // Legacy fallback for pre-migration records
    if (paper.authorOrder != null) return true;
    if (paper.isCoFirst) return true;
    if (paper.correspondingRole && paper.correspondingRole !== "none") return true;
    return false;
  }

  // Position label config for SVG rendering
  // co-1st: "1′" as single string (prime U+2032 glued to digit)
  // nth: plain "n"
  const POSITION_LABEL = {
    "1st":    { main: "1",    size: 16 },
    "co-1st": { main: "1\u2032", size: 15 },
    "2nd":    { main: "2",    size: 16 },
    "3rd":    { main: "3",    size: 16 },
    "nth":    { main: "n",    size: 14 },
    "Last":   { main: "L",    size: 14 },
    "":       { main: "n",    size: 14 },
  };

  // Role class for shield body color
  function roleClass(key) {
    if (key === "1st" || key === "co-1st") return "is-first";
    if (key === "Last") return "is-last";
    return "is-middle";
  }

  // Desktop "견장" (epaulette): SVG shield with two bands.
  // Top band: position label (1, co¹, 2, 3, N, L)
  // Bottom band: corresponding marker (star or co+star)
  // Returns an HTMLElement or null.
  function renderMyEpaulette(paper) {
    if (!isMyPaper(paper)) return null;

    const key = positionKey(paper);
    const corrLabel = correspondingLabel(paper);
    const rClass = roleClass(key);
    const labelCfg = POSITION_LABEL[key] || POSITION_LABEL["nth"];

    // Build tooltip
    const tipParts = ["You are an author"];
    if (key && key !== "nth") tipParts.push(key + " author");
    if (corrLabel) tipParts.push(corrLabel === "co-corresp" ? "co-corresponding" : "corresponding");
    const tooltip = tipParts.join(" · ");

    const wrap = document.createElement("span");
    wrap.className = "my-epaulette " + rClass + (corrLabel ? " has-corresp" : "");
    wrap.title = tooltip;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "my-epaulette-svg");
    svg.setAttribute("viewBox", "0 0 44 52");
    svg.setAttribute("width", "32");
    svg.setAttribute("height", "38");
    svg.setAttribute("aria-hidden", "true");

    // Shield body (rounded top, V-point bottom)
    const body = document.createElementNS(NS, "path");
    body.setAttribute("class", "epaulette-body");
    body.setAttribute("d", "M3 0 Q0 0 0 3 L0 38 L22 50 L44 38 L44 3 Q44 0 41 0 Z");
    svg.appendChild(body);

    // Divider line between top and bottom bands
    const divider = document.createElementNS(NS, "line");
    divider.setAttribute("class", "epaulette-divider");
    divider.setAttribute("x1", "6");
    divider.setAttribute("y1", "27");
    divider.setAttribute("x2", "38");
    divider.setAttribute("y2", "27");
    svg.appendChild(divider);

    // Main position label (top band, centered)
    const mainText = document.createElementNS(NS, "text");
    mainText.setAttribute("class", "epaulette-label epaulette-label-main");
    mainText.setAttribute("x", "22");
    mainText.setAttribute("y", "22");
    mainText.setAttribute("text-anchor", "middle");
    mainText.setAttribute("dominant-baseline", "auto");
    mainText.style.fontSize = labelCfg.size + "px";
    mainText.textContent = labelCfg.main;
    svg.appendChild(mainText);

    // Bottom band: asterisk for corresponding, nothing for none
    if (corrLabel === "corresp") {
      const asterisk = document.createElementNS(NS, "text");
      asterisk.setAttribute("class", "epaulette-label epaulette-mark epaulette-star");
      asterisk.setAttribute("x", "22");
      asterisk.setAttribute("y", "48");
      asterisk.setAttribute("text-anchor", "middle");
      asterisk.setAttribute("dominant-baseline", "auto");
      asterisk.style.fontSize = "22px";
      asterisk.textContent = "*";
      svg.appendChild(asterisk);
    }

    wrap.appendChild(svg);
    return wrap;
  }

  // Mobile horizontal epaulette: pill with position (left) and corresponding (right).
  // Layout: [ label | * ]  or  [ label ] when no corresponding.
  // Returns an HTMLElement or null.
  function renderMyEpauletteHorizontal(paper) {
    if (!isMyPaper(paper)) return null;

    const key = positionKey(paper);
    const corrLabel = correspondingLabel(paper);
    const rClass = roleClass(key);
    const labelCfg = POSITION_LABEL[key] || POSITION_LABEL["nth"];
    const hasCorr = corrLabel === "corresp";

    const tipParts = ["You are an author"];
    if (key && key !== "nth") tipParts.push(key + " author");
    if (hasCorr) tipParts.push("corresponding");
    const tooltip = tipParts.join(" \u00B7 ");

    const wrap = document.createElement("span");
    wrap.className = "my-epaulette-h " + rClass + (hasCorr ? " has-corresp" : "");
    wrap.title = tooltip;

    const NS = "http://www.w3.org/2000/svg";
    const W = hasCorr ? 44 : 24;
    const H = 22;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "my-epaulette-h-svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("aria-hidden", "true");

    const body = document.createElementNS(NS, "rect");
    body.setAttribute("class", "epaulette-body");
    body.setAttribute("x", "0");
    body.setAttribute("y", "0");
    body.setAttribute("width", W);
    body.setAttribute("height", H);
    body.setAttribute("rx", "4");
    body.setAttribute("ry", "4");
    svg.appendChild(body);

    if (hasCorr) {
      const divider = document.createElementNS(NS, "line");
      divider.setAttribute("class", "epaulette-divider");
      divider.setAttribute("x1", "22");
      divider.setAttribute("y1", "4");
      divider.setAttribute("x2", "22");
      divider.setAttribute("y2", "18");
      svg.appendChild(divider);
    }

    const mainText = document.createElementNS(NS, "text");
    mainText.setAttribute("class", "epaulette-label epaulette-label-main");
    mainText.setAttribute("x", "12");
    mainText.setAttribute("y", "16");
    mainText.setAttribute("text-anchor", "middle");
    mainText.setAttribute("dominant-baseline", "auto");
    mainText.style.fontSize = Math.max(12, labelCfg.size - 2) + "px";
    mainText.textContent = labelCfg.main;
    svg.appendChild(mainText);

    if (hasCorr) {
      const asterisk = document.createElementNS(NS, "text");
      asterisk.setAttribute("class", "epaulette-label epaulette-mark epaulette-star");
      asterisk.setAttribute("x", "33");
      asterisk.setAttribute("y", "19");
      asterisk.setAttribute("text-anchor", "middle");
      asterisk.setAttribute("dominant-baseline", "auto");
      asterisk.style.fontSize = "18px";
      asterisk.textContent = "*";
      svg.appendChild(asterisk);
    }

    wrap.appendChild(svg);
    return wrap;
  }

  // Mobile circle badges: inline row, text inside circle with superscript suffix.
  // Returns a DocumentFragment (possibly empty).
  function renderRoleCircles(paper) {
    const frag = document.createDocumentFragment();
    if (!isMyPaper(paper)) return frag;

    const roleLabel = authorRoleLabel(paper);
    if (roleLabel) {
      const circle = document.createElement("span");
      const isCoFirst = roleLabel === "co-1st";
      const isLast = roleLabel === "last" || paper.isLast;
      let cls = "role-circle";
      if (roleLabel === "1st" || isCoFirst) cls += " is-first";
      if (isCoFirst) cls += " is-co";
      if (isLast) cls += " is-last";
      circle.className = cls;
      circle.title = roleLabelTooltip(roleLabel, paper);

      if (isLast) {
        const word = document.createElement("span");
        word.className = "role-word";
        word.textContent = "last";
        circle.appendChild(word);
      } else {
        const m = roleLabel.replace("co-", "").match(/^(\d+)(st|nd|rd|th)$/);
        if (m) {
          const num = document.createElement("span");
          num.className = "role-num";
          num.textContent = m[1];
          const suf = document.createElement("sup");
          suf.className = "role-suf";
          suf.textContent = m[2];
          circle.appendChild(num);
          circle.appendChild(suf);
        } else {
          circle.textContent = roleLabel;
        }
      }
      frag.appendChild(circle);
    }

    const corrLabel = correspondingLabel(paper);
    if (corrLabel) {
      const circle = document.createElement("span");
      circle.className = "role-circle is-corresp";
      circle.title = "Corresponding author";
      circle.textContent = "\u2709"; // ✉
      frag.appendChild(circle);
    }

    return frag;
  }

  function roleLabelTooltip(label, paper) {
    if (label === "1st") return "First author";
    if (label === "co-1st") return "Co-first author";
    if (label === "last") return "Last author";
    return label + " author";
  }

  window.__authorBadges = {
    ordinalSuffix,
    totalAuthorCount,
    authorRoleLabel,
    correspondingLabel,
    isMyPaper,
    positionKey,
    renderMyEpaulette,
    renderMyEpauletteHorizontal,
    renderRoleCircles,
  };
})(window);
