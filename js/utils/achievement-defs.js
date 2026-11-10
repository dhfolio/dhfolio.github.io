/**
 * js/utils/achievement-defs.js
 * All achievement definitions (~98). Each series shares a slot;
 * only the highest unlocked tier is shown.
 *
 * tier: 1 (wood) → 2 (bronze) → 3 (silver) → 4 (gold) → 5 (diamond)
 */
(function (window) {
  "use strict";

  const DEFS = [
    // ── Total Papers ──────────────────────────────────────────────────────
    { id:"total-papers-1",    series:"total-papers", category:"papers", metric:"totalPapers", threshold:1,    tier:1, title:"First Step into Academia", desc:"Your very first paper" },
    { id:"total-papers-5",    series:"total-papers", category:"papers", metric:"totalPapers", threshold:5,    tier:1, title:"Handful of Findings",    desc:"5+ papers published" },
    { id:"total-papers-10",   series:"total-papers", category:"papers", metric:"totalPapers", threshold:10,   tier:2, title:"Double Digits",          desc:"Papers in the double digits" },
    { id:"total-papers-15",   series:"total-papers", category:"papers", metric:"totalPapers", threshold:15,   tier:2, title:"Building Momentum",      desc:"15+ papers and growing" },
    { id:"total-papers-20",   series:"total-papers", category:"papers", metric:"totalPapers", threshold:20,   tier:2, title:"Score!",                  desc:"20+ papers to your name" },
    { id:"total-papers-25",   series:"total-papers", category:"papers", metric:"totalPapers", threshold:25,   tier:3, title:"Quarter Century",         desc:"25+ papers strong" },
    { id:"total-papers-50",   series:"total-papers", category:"papers", metric:"totalPapers", threshold:50,   tier:3, title:"Half-Century Scholar",    desc:"50+ papers and counting" },
    { id:"total-papers-75",   series:"total-papers", category:"papers", metric:"totalPapers", threshold:75,   tier:3, title:"Diamond Jubilee",         desc:"75+ papers published" },
    { id:"total-papers-100",  series:"total-papers", category:"papers", metric:"totalPapers", threshold:100,  tier:4, title:"Centurion",               desc:"A hundred papers. Serious." },
    { id:"total-papers-150",  series:"total-papers", category:"papers", metric:"totalPapers", threshold:150,  tier:4, title:"Sesquicentennial",        desc:"150+ papers. Dedicated." },
    { id:"total-papers-200",  series:"total-papers", category:"papers", metric:"totalPapers", threshold:200,  tier:4, title:"Bicentennial",            desc:"200+ papers to your name" },
    { id:"total-papers-250",  series:"total-papers", category:"papers", metric:"totalPapers", threshold:250,  tier:4, title:"Prolific",                desc:"Chairs take note" },
    { id:"total-papers-500",  series:"total-papers", category:"papers", metric:"totalPapers", threshold:500,  tier:5, title:"Walking Bibliography",    desc:"You ARE the literature" },
    { id:"total-papers-750",  series:"total-papers", category:"papers", metric:"totalPapers", threshold:750,  tier:5, title:"Living Encyclopedia",     desc:"750+ papers. Astounding." },
    { id:"total-papers-1000", series:"total-papers", category:"papers", metric:"totalPapers", threshold:1000, tier:5, title:"Library of Alexandria",   desc:"Legendary status" },

    // ── First Author (max 50) ─────────────────────────────────────────────
    { id:"first-1",  series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:1,  tier:1, title:"Lead Investigator",     desc:"First first-author paper" },
    { id:"first-3",  series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:3,  tier:1, title:"Taking the Wheel",       desc:"3+ first-author papers" },
    { id:"first-5",  series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:5,  tier:1, title:"Principal Contributor",  desc:"5+ first-author papers" },
    { id:"first-10", series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:10, tier:2, title:"Seasoned Lead",          desc:"Led the charge 10+ times" },
    { id:"first-15", series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:15, tier:2, title:"Trailblazer",            desc:"15+ first-author papers" },
    { id:"first-20", series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:20, tier:3, title:"Frontrunner",            desc:"20+ papers at the helm" },
    { id:"first-25", series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:25, tier:3, title:"PI Energy",              desc:"Grant applications incoming" },
    { id:"first-35", series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:35, tier:4, title:"Relentless First",       desc:"35+ first-author papers" },
    { id:"first-50", series:"first-author", category:"authorship", metric:"firstAuthorPapers", threshold:50, tier:5, title:"Titan of Authorship",    desc:"50+ first-author papers" },

    // ── Second Author (Helper, max 100) ───────────────────────────────────
    { id:"second-1",   series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:1,   tier:1, title:"Right-Hand Researcher",  desc:"First second-author paper" },
    { id:"second-3",   series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:3,   tier:1, title:"Reliable Wingman",        desc:"3+ second-author papers" },
    { id:"second-5",   series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:5,   tier:2, title:"Trusted Helper",          desc:"5+ second-author papers" },
    { id:"second-10",  series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:10,  tier:2, title:"Go-To Collaborator",      desc:"10+ second-author papers" },
    { id:"second-20",  series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:20,  tier:3, title:"Indispensable Helper",    desc:"20+ second-author papers" },
    { id:"second-30",  series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:30,  tier:3, title:"Backbone of the Team",    desc:"30+ second-author papers" },
    { id:"second-50",  series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:50,  tier:4, title:"Master Collaborator",     desc:"50+ second-author papers" },
    { id:"second-100", series:"second-author", category:"authorship", metric:"secondAuthorPapers", threshold:100, tier:5, title:"The Helper Prime",        desc:"100+ second-author papers" },

    // ── Corresponding Author (max 500) ────────────────────────────────────
    { id:"corr-1",   series:"corresponding", category:"authorship", metric:"corrPapers", threshold:1,   tier:1, title:"The Responsible One",    desc:"First corresponding paper" },
    { id:"corr-5",   series:"corresponding", category:"authorship", metric:"corrPapers", threshold:5,   tier:1, title:"Regular Correspondent",   desc:"5+ corresponding papers" },
    { id:"corr-10",  series:"corresponding", category:"authorship", metric:"corrPapers", threshold:10,  tier:2, title:"Inbox Veteran",           desc:"10+ corresponding papers" },
    { id:"corr-20",  series:"corresponding", category:"authorship", metric:"corrPapers", threshold:20,  tier:2, title:"Correspondence Expert",   desc:"20+ papers, many emails" },
    { id:"corr-30",  series:"corresponding", category:"authorship", metric:"corrPapers", threshold:30,  tier:3, title:"Senior Correspondent",    desc:"30+ corresponding papers" },
    { id:"corr-50",  series:"corresponding", category:"authorship", metric:"corrPapers", threshold:50,  tier:3, title:"Letter Writer",           desc:"50+ corresponding papers" },
    { id:"corr-75",  series:"corresponding", category:"authorship", metric:"corrPapers", threshold:75,  tier:3, title:"Mailroom Chief",          desc:"75+ corresponding papers" },
    { id:"corr-100", series:"corresponding", category:"authorship", metric:"corrPapers", threshold:100, tier:4, title:"Postmaster General",      desc:"100+ corresponding papers" },
    { id:"corr-150", series:"corresponding", category:"authorship", metric:"corrPapers", threshold:150, tier:4, title:"Dispatch Commander",      desc:"150+ corresponding papers" },
    { id:"corr-200", series:"corresponding", category:"authorship", metric:"corrPapers", threshold:200, tier:5, title:"Chief Correspondent",     desc:"200+ papers stewarded" },
    { id:"corr-500", series:"corresponding", category:"authorship", metric:"corrPapers", threshold:500, tier:5, title:"The Gatekeeper",          desc:"500+ corresponding papers" },

    // ── Co-Corresponding ──────────────────────────────────────────────────
    { id:"cocorr-1",   series:"co-corresponding", category:"authorship", metric:"coCorrPapers", threshold:1,   tier:1, title:"Shared Duty",          desc:"First co-corresponding paper" },
    { id:"cocorr-2",   series:"co-corresponding", category:"authorship", metric:"coCorrPapers", threshold:2,   tier:1, title:"Tandem Stewards",      desc:"2+ co-corresponding papers" },
    { id:"cocorr-5",   series:"co-corresponding", category:"authorship", metric:"coCorrPapers", threshold:5,   tier:2, title:"Joint Responsibility",  desc:"5+ co-corresponding" },
    { id:"cocorr-10",  series:"co-corresponding", category:"authorship", metric:"coCorrPapers", threshold:10,  tier:3, title:"Co-Pilot",              desc:"10+ co-corresponding papers" },
    { id:"cocorr-20",  series:"co-corresponding", category:"authorship", metric:"coCorrPapers", threshold:20,  tier:3, title:"Dual Command",          desc:"20+ co-corresponding" },
    { id:"cocorr-50",  series:"co-corresponding", category:"authorship", metric:"coCorrPapers", threshold:50,  tier:4, title:"Allied Leadership",     desc:"50+ co-corresponding" },
    { id:"cocorr-100", series:"co-corresponding", category:"authorship", metric:"coCorrPapers", threshold:100, tier:5, title:"Diplomatic Corps",      desc:"100+ co-corresponding" },

    // ── Solo Author ───────────────────────────────────────────────────────
    { id:"solo-1",   series:"solo-author", category:"team", metric:"soloPapers", threshold:1,   tier:2, title:"Lone Wolf",           desc:"A paper all by yourself" },
    { id:"solo-2",   series:"solo-author", category:"team", metric:"soloPapers", threshold:2,   tier:3, title:"Repeat Soloist",       desc:"2+ solo papers" },
    { id:"solo-5",   series:"solo-author", category:"team", metric:"soloPapers", threshold:5,   tier:4, title:"Self-Sufficient",      desc:"5+ solo-authored papers" },
    { id:"solo-10",  series:"solo-author", category:"team", metric:"soloPapers", threshold:10,  tier:5, title:"One-Person Army",      desc:"10+ solo papers" },
    { id:"solo-50",  series:"solo-author", category:"team", metric:"soloPapers", threshold:50,  tier:5, title:"Solo Artist",          desc:"50+ solo papers" },
    { id:"solo-100", series:"solo-author", category:"team", metric:"soloPapers", threshold:100, tier:6, title:"One-Person Legend",    desc:"100+ solo papers" },

    // ── Duo Author ────────────────────────────────────────────────────────
    { id:"duo-1",   series:"duo-author", category:"team", metric:"duoPapers", threshold:1,   tier:1, title:"Dynamic Duo",       desc:"First paper with just two" },
    { id:"duo-2",   series:"duo-author", category:"team", metric:"duoPapers", threshold:2,   tier:2, title:"Partner in Crime",   desc:"2+ duo papers" },
    { id:"duo-5",   series:"duo-author", category:"team", metric:"duoPapers", threshold:5,   tier:3, title:"Power Pair",         desc:"5+ duo papers" },
    { id:"duo-10",  series:"duo-author", category:"team", metric:"duoPapers", threshold:10,  tier:4, title:"Inseparable",        desc:"10+ duo papers" },
    { id:"duo-50",  series:"duo-author", category:"team", metric:"duoPapers", threshold:50,  tier:4, title:"Duo Regulars",        desc:"50+ duo papers" },
    { id:"duo-100", series:"duo-author", category:"team", metric:"duoPapers", threshold:100, tier:5, title:"Twin Flames",         desc:"100+ duo papers" },
    { id:"duo-150", series:"duo-author", category:"team", metric:"duoPapers", threshold:150, tier:5, title:"Paired Legends",      desc:"150+ duo papers" },
    { id:"duo-200", series:"duo-author", category:"team", metric:"duoPapers", threshold:200, tier:6, title:"Soulmates",           desc:"200+ duo papers" },

    // ── Trio Author ───────────────────────────────────────────────────────
    { id:"trio-1",   series:"trio-author", category:"team", metric:"trioPapers", threshold:1,   tier:1, title:"Three Musketeers",   desc:"First three-author paper" },
    { id:"trio-2",   series:"trio-author", category:"team", metric:"trioPapers", threshold:2,   tier:2, title:"Triple Threat",       desc:"2+ trio papers" },
    { id:"trio-5",   series:"trio-author", category:"team", metric:"trioPapers", threshold:5,   tier:3, title:"Triumvirate",         desc:"5+ trio papers" },
    { id:"trio-10",  series:"trio-author", category:"team", metric:"trioPapers", threshold:10,  tier:4, title:"Trident Force",       desc:"10+ trio papers" },
    { id:"trio-50",  series:"trio-author", category:"team", metric:"trioPapers", threshold:50,  tier:4, title:"Trifecta Regulars",   desc:"50+ trio papers" },
    { id:"trio-100", series:"trio-author", category:"team", metric:"trioPapers", threshold:100, tier:5, title:"Trinity Elite",       desc:"100+ trio papers" },
    { id:"trio-200", series:"trio-author", category:"team", metric:"trioPapers", threshold:200, tier:5, title:"Triad Dynasty",       desc:"200+ trio papers" },
    { id:"trio-300", series:"trio-author", category:"team", metric:"trioPapers", threshold:300, tier:6, title:"Tri-Force Eternal",   desc:"300+ trio papers" },

    // ── Co-First Author ───────────────────────────────────────────────────
    { id:"cofirst-1",  series:"co-first", category:"team", metric:"coFirstPapers", threshold:1,  tier:1, title:"Equal Footing",          desc:"First co-first paper" },
    { id:"cofirst-2",  series:"co-first", category:"team", metric:"coFirstPapers", threshold:2,  tier:2, title:"Balanced Act",            desc:"2+ co-first papers" },
    { id:"cofirst-5",  series:"co-first", category:"team", metric:"coFirstPapers", threshold:5,  tier:3, title:"Collaboration Maestro",   desc:"5+ co-first papers" },
    { id:"cofirst-10", series:"co-first", category:"team", metric:"coFirstPapers", threshold:10, tier:4, title:"Tandem Expert",           desc:"10+ co-first papers" },

    // ── Large Teams (one-off flags, tier-less like thesis) ────────────────
    { id:"team-20",  series:"large-team-20",  category:"team", metric:"largeTeam20",  threshold:1, shape:"flag", title:"Department Outing",    desc:"A paper with 20+ co-authors" },
    { id:"team-50",  series:"large-team-50",  category:"team", metric:"largeTeam50",  threshold:1, shape:"flag", title:"Consortium Member",    desc:"A paper with 50+ co-authors" },
    { id:"team-100", series:"large-team-100", category:"team", metric:"largeTeam100", threshold:1, shape:"flag", title:"Mega-Collaboration",   desc:"100+ authors on one paper" },

    // ── Total Citations ───────────────────────────────────────────────────
    { id:"cit-1",       series:"total-citations", category:"citations", metric:"totalCitations", threshold:1,       tier:1, title:"First Nod",           desc:"Your first citation" },
    { id:"cit-10",      series:"total-citations", category:"citations", metric:"totalCitations", threshold:10,      tier:1, title:"Getting Traction",    desc:"10+ total citations" },
    { id:"cit-50",      series:"total-citations", category:"citations", metric:"totalCitations", threshold:50,      tier:2, title:"Gaining Ground",      desc:"50+ total citations" },
    { id:"cit-100",     series:"total-citations", category:"citations", metric:"totalCitations", threshold:100,     tier:2, title:"Getting Noticed",     desc:"100+ total citations" },
    { id:"cit-200",     series:"total-citations", category:"citations", metric:"totalCitations", threshold:200,     tier:2, title:"Getting Cited",       desc:"200+ total citations" },
    { id:"cit-500",     series:"total-citations", category:"citations", metric:"totalCitations", threshold:500,     tier:3, title:"Making Waves",        desc:"500+ total citations" },
    { id:"cit-1k",      series:"total-citations", category:"citations", metric:"totalCitations", threshold:1000,    tier:3, title:"Thousand Strong",     desc:"1k+ total citations" },
    { id:"cit-2500",    series:"total-citations", category:"citations", metric:"totalCitations", threshold:2500,    tier:3, title:"Scholarly Voice",     desc:"2.5k+ total citations" },
    { id:"cit-5k",      series:"total-citations", category:"citations", metric:"totalCitations", threshold:5000,    tier:4, title:"Heavy Hitter",        desc:"5k+ total citations" },
    { id:"cit-10k",     series:"total-citations", category:"citations", metric:"totalCitations", threshold:10000,   tier:4, title:"Citation Magnet",     desc:"10k+ total citations" },
    { id:"cit-25k",     series:"total-citations", category:"citations", metric:"totalCitations", threshold:25000,   tier:4, title:"Citation Powerhouse", desc:"25k+ total citations" },
    { id:"cit-50k",     series:"total-citations", category:"citations", metric:"totalCitations", threshold:50000,   tier:4, title:"Academic Celebrity",  desc:"50k+ total citations" },
    { id:"cit-100k",    series:"total-citations", category:"citations", metric:"totalCitations", threshold:100000,  tier:5, title:"Citation Royalty",    desc:"100k+ total citations" },
    { id:"cit-500k",    series:"total-citations", category:"citations", metric:"totalCitations", threshold:500000,  tier:5, title:"Citation Dreams",     desc:"500k+ total citations" },
    { id:"cit-1m",      series:"total-citations", category:"citations", metric:"totalCitations", threshold:1000000, tier:6, title:"Forces of Nature",    desc:"1M+ total citations" },

    // ── Single Paper Max Citations (lead-authored research papers only) ───
    { id:"single-1",    series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:1,       tier:1, title:"First Spark",             desc:"A paper you led got its first citation" },
    { id:"single-5",    series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:5,       tier:1, title:"Catching On",             desc:"A paper you led cited 5+ times" },
    { id:"single-10",   series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:10,      tier:2, title:"Conversation Starter",   desc:"A paper you led cited 10+ times" },
    { id:"single-50",   series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:50,      tier:2, title:"Talking Point",           desc:"A paper you led cited 50+ times" },
    { id:"single-100",  series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:100,     tier:3, title:"Seminal Work",            desc:"A paper you led cited 100+ times" },
    { id:"single-200",  series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:200,     tier:3, title:"Reference Standard",      desc:"A paper you led cited 200+ times" },
    { id:"single-500",  series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:500,     tier:3, title:"Pillar of Knowledge",     desc:"A paper you led cited 500+ times" },
    { id:"single-1k",   series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:1000,    tier:4, title:"Landmark Paper",          desc:"A paper you led cited 1k+ times" },
    { id:"single-5k",   series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:5000,    tier:4, title:"Magnum Opus",             desc:"A paper you led cited 5k+ times" },
    { id:"single-10k",  series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:10000,   tier:5, title:"Timeless Classic",        desc:"A paper you led cited 10k+ times" },
    { id:"single-50k",  series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:50000,   tier:5, title:"Once in a Generation",    desc:"A paper you led cited 50k+ times" },
    { id:"single-100k", series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:100000,  tier:5, title:"Epoch-Defining",          desc:"A paper you led cited 100k+ times" },
    { id:"single-200k", series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:200000,  tier:5, title:"Beyond Measure",          desc:"A paper you led cited 200k+ times" },
    { id:"single-500k", series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:500000,  tier:6, title:"Immortal",                desc:"A paper you led cited 500k+ times" },
    { id:"single-1m",   series:"single-paper-cit", category:"citations", metric:"maxSingleCitation", threshold:1000000, tier:6, title:"The Paper",               desc:"A paper you led cited 1M+ times" },

    // ── Papers Cited 10+ Times ────────────────────────────────────────────
    { id:"cited10-10",   series:"papers-cited-10plus", category:"citations", metric:"papersCited10", threshold:10,   tier:2, title:"Solid Portfolio",       desc:"10+ papers with 10+ cites" },
    { id:"cited10-20",   series:"papers-cited-10plus", category:"citations", metric:"papersCited10", threshold:20,   tier:2, title:"Proven Track Record",   desc:"20+ papers with 10+ cites" },
    { id:"cited10-50",   series:"papers-cited-10plus", category:"citations", metric:"papersCited10", threshold:50,   tier:3, title:"Impact Portfolio",      desc:"50+ papers with 10+ cites" },
    { id:"cited10-75",   series:"papers-cited-10plus", category:"citations", metric:"papersCited10", threshold:75,   tier:3, title:"Impact Crescendo",      desc:"75+ papers with 10+ cites" },
    { id:"cited10-100",  series:"papers-cited-10plus", category:"citations", metric:"papersCited10", threshold:100,  tier:4, title:"Unstoppable",           desc:"100+ papers with 10+ cites" },
    { id:"cited10-200",  series:"papers-cited-10plus", category:"citations", metric:"papersCited10", threshold:200,  tier:4, title:"Unrelenting",           desc:"200+ papers with 10+ cites" },
    { id:"cited10-500",  series:"papers-cited-10plus", category:"citations", metric:"papersCited10", threshold:500,  tier:5, title:"Citation Machine",      desc:"500+ papers with 10+ cites" },

    // ── Papers Cited 100+ Times ───────────────────────────────────────────
    { id:"cited100-10",   series:"papers-cited-100plus", category:"citations", metric:"papersCited100", threshold:10,   tier:3, title:"Elite Researcher",   desc:"10+ papers with 100+ cites" },
    { id:"cited100-20",   series:"papers-cited-100plus", category:"citations", metric:"papersCited100", threshold:20,   tier:3, title:"Distinguished",      desc:"20+ papers with 100+ cites" },
    { id:"cited100-50",   series:"papers-cited-100plus", category:"citations", metric:"papersCited100", threshold:50,   tier:4, title:"Hall of Fame",       desc:"50+ papers with 100+ cites" },
    { id:"cited100-100",  series:"papers-cited-100plus", category:"citations", metric:"papersCited100", threshold:100,  tier:4, title:"Living Legend",      desc:"100+ papers with 100+ cites" },
    { id:"cited100-300",  series:"papers-cited-100plus", category:"citations", metric:"papersCited100", threshold:300,  tier:5, title:"Transcendent",       desc:"300+ papers with 100+ cites" },

    // ── Thesis (shield shape, tier-less) ──────────────────────────────────
    { id:"thesis-1", series:"thesis", category:"papers", metric:"thesisPapers", threshold:1, shape:"shield", shieldStack:1, title:"Dissertation Defended!",  desc:"First thesis on record" },
    { id:"thesis-2", series:"thesis", category:"papers", metric:"thesisPapers", threshold:2, shape:"shield", shieldStack:2, title:"Twice Defended!!",         desc:"Two theses on record" },
    { id:"thesis-3", series:"thesis", category:"papers", metric:"thesisPapers", threshold:3, shape:"shield", shieldStack:3, title:"Thrice Defended!!!",       desc:"Three theses on record" },

    // ── Review Author (max 50) ────────────────────────────────────────────
    { id:"review-1",  series:"review-author", category:"papers", metric:"reviewPapers", threshold:1,  tier:1, title:"Field Surveyor",      desc:"First review paper" },
    { id:"review-3",  series:"review-author", category:"papers", metric:"reviewPapers", threshold:3,  tier:1, title:"Synthesizer",          desc:"3+ review papers" },
    { id:"review-5",  series:"review-author", category:"papers", metric:"reviewPapers", threshold:5,  tier:2, title:"Literature Weaver",    desc:"5+ review papers" },
    { id:"review-10", series:"review-author", category:"papers", metric:"reviewPapers", threshold:10, tier:3, title:"State-of-the-Art",     desc:"10+ review papers" },
    { id:"review-20", series:"review-author", category:"papers", metric:"reviewPapers", threshold:20, tier:4, title:"Review Sage",          desc:"20+ review papers" },
    { id:"review-50", series:"review-author", category:"papers", metric:"reviewPapers", threshold:50, tier:5, title:"The Encyclopedist",    desc:"50+ review papers" },

    // ── Article Author (max 500) ──────────────────────────────────────────
    { id:"article-1",   series:"article-author", category:"papers", metric:"articlePapers", threshold:1,   tier:1, title:"Cub Reporter",           desc:"First article" },
    { id:"article-5",   series:"article-author", category:"papers", metric:"articlePapers", threshold:5,   tier:1, title:"Beat Writer",             desc:"5+ articles" },
    { id:"article-10",  series:"article-author", category:"papers", metric:"articlePapers", threshold:10,  tier:2, title:"Staff Writer",            desc:"10+ articles" },
    { id:"article-25",  series:"article-author", category:"papers", metric:"articlePapers", threshold:25,  tier:2, title:"Bylined",                 desc:"25+ articles" },
    { id:"article-50",  series:"article-author", category:"papers", metric:"articlePapers", threshold:50,  tier:3, title:"Columnist",               desc:"50+ articles" },
    { id:"article-100", series:"article-author", category:"papers", metric:"articlePapers", threshold:100, tier:4, title:"Senior Correspondent",    desc:"100+ articles" },
    { id:"article-250", series:"article-author", category:"papers", metric:"articlePapers", threshold:250, tier:4, title:"Bureau Chief",            desc:"250+ articles" },
    { id:"article-500", series:"article-author", category:"papers", metric:"articlePapers", threshold:500, tier:5, title:"Editor-in-Chief",         desc:"500+ articles" },

    // ══════════════════════════════════════════════════════════════════════
    // ATLAS ACHIEVEMENTS — App usage activity (current state based)
    // All have group:"atlas". Scholarly defs above have implicit group:"scholarly".
    // ══════════════════════════════════════════════════════════════════════

    // ── Cataloging — series: "cataloged" ──────────────────────────────────
    { id:"atlas-cat-1",    group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:1,    tier:1, title:"First Entry",      desc:"First paper added to your library" },
    { id:"atlas-cat-10",   group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:10,   tier:1, title:"Collector",         desc:"10+ papers in your library" },
    { id:"atlas-cat-25",   group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:25,   tier:2, title:"Shelfbuilder",      desc:"25+ papers cataloged" },
    { id:"atlas-cat-50",   group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:50,   tier:2, title:"Curator",           desc:"50+ papers in collection" },
    { id:"atlas-cat-100",  group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:100,  tier:3, title:"Archivist",         desc:"100+ papers in your library" },
    { id:"atlas-cat-250",  group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:250,  tier:3, title:"Librarian",         desc:"250+ papers cataloged" },
    { id:"atlas-cat-500",  group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:500,  tier:4, title:"Head Archivist",    desc:"500+ papers collected" },
    { id:"atlas-cat-1000", group:"atlas", series:"cataloged", category:"cataloging", metric:"cataloged", threshold:1000, tier:5, title:"The Archive",       desc:"1,000+ papers in your library" },

    // ── Starring — series: "starred" ──────────────────────────────────────
    { id:"atlas-star-1",   group:"atlas", series:"starred", category:"curating", metric:"starred", threshold:1,   tier:1, title:"First Favorite",   desc:"Starred your first paper" },
    { id:"atlas-star-5",   group:"atlas", series:"starred", category:"curating", metric:"starred", threshold:5,   tier:1, title:"Taste-Maker",       desc:"5+ starred papers" },
    { id:"atlas-star-10",  group:"atlas", series:"starred", category:"curating", metric:"starred", threshold:10,  tier:2, title:"Curator's Eye",     desc:"10+ starred papers" },
    { id:"atlas-star-25",  group:"atlas", series:"starred", category:"curating", metric:"starred", threshold:25,  tier:3, title:"Connoisseur",       desc:"25+ favorites" },
    { id:"atlas-star-50",  group:"atlas", series:"starred", category:"curating", metric:"starred", threshold:50,  tier:4, title:"Star Collector",    desc:"50+ starred papers" },
    { id:"atlas-star-100", group:"atlas", series:"starred", category:"curating", metric:"starred", threshold:100, tier:5, title:"Hall of Stars",     desc:"100+ starred papers" },

    // ── Pinning — series: "pinned" ────────────────────────────────────────
    { id:"atlas-pin-1",  group:"atlas", series:"pinned", category:"curating", metric:"pinned", threshold:1,  tier:1, title:"First Pin",       desc:"1+ paper currently pinned" },
    { id:"atlas-pin-3",  group:"atlas", series:"pinned", category:"curating", metric:"pinned", threshold:3,  tier:2, title:"Trinity",          desc:"3+ papers currently pinned" },
    { id:"atlas-pin-5",  group:"atlas", series:"pinned", category:"curating", metric:"pinned", threshold:5,  tier:3, title:"Priority Stack",   desc:"5+ papers currently pinned" },
    { id:"atlas-pin-10", group:"atlas", series:"pinned", category:"curating", metric:"pinned", threshold:10, tier:4, title:"Top Shelf",        desc:"10+ papers currently pinned" },
    { id:"atlas-pin-50", group:"atlas", series:"pinned", category:"curating", metric:"pinned", threshold:50, tier:5, title:"Command Center",   desc:"50+ papers currently pinned" },

    // ── Reading — series: "read" ──────────────────────────────────────────
    { id:"atlas-read-1",   group:"atlas", series:"read", category:"reading", metric:"readPapers", threshold:1,   tier:1, title:"First Read",           desc:"Marked your first paper as read" },
    { id:"atlas-read-5",   group:"atlas", series:"read", category:"reading", metric:"readPapers", threshold:5,   tier:1, title:"Page-Turner",           desc:"5+ papers read" },
    { id:"atlas-read-10",  group:"atlas", series:"read", category:"reading", metric:"readPapers", threshold:10,  tier:2, title:"Active Reader",         desc:"10+ papers read" },
    { id:"atlas-read-25",  group:"atlas", series:"read", category:"reading", metric:"readPapers", threshold:25,  tier:2, title:"Bookworm",              desc:"25+ papers read" },
    { id:"atlas-read-50",  group:"atlas", series:"read", category:"reading", metric:"readPapers", threshold:50,  tier:3, title:"Well-Read",             desc:"50+ papers read" },
    { id:"atlas-read-100", group:"atlas", series:"read", category:"reading", metric:"readPapers", threshold:100, tier:4, title:"Devourer",              desc:"100+ papers read" },
    { id:"atlas-read-250", group:"atlas", series:"read", category:"reading", metric:"readPapers", threshold:250, tier:5, title:"Unstoppable Reader",    desc:"250+ papers read" },

    // ── Note-Taking — series: "noted" ─────────────────────────────────────
    { id:"atlas-note-1",   group:"atlas", series:"noted", category:"reading", metric:"noted", threshold:1,   tier:1, title:"First Annotation",    desc:"Your first paper note" },
    { id:"atlas-note-5",   group:"atlas", series:"noted", category:"reading", metric:"noted", threshold:5,   tier:1, title:"Margin Scribbler",    desc:"5+ notes written" },
    { id:"atlas-note-10",  group:"atlas", series:"noted", category:"reading", metric:"noted", threshold:10,  tier:2, title:"Thoughtful Reader",   desc:"10+ papers annotated" },
    { id:"atlas-note-25",  group:"atlas", series:"noted", category:"reading", metric:"noted", threshold:25,  tier:3, title:"Annotator",           desc:"25+ notes written" },
    { id:"atlas-note-50",  group:"atlas", series:"noted", category:"reading", metric:"noted", threshold:50,  tier:4, title:"Scholar's Hand",      desc:"50+ papers annotated" },
    { id:"atlas-note-100", group:"atlas", series:"noted", category:"reading", metric:"noted", threshold:100, tier:5, title:"Master Annotator",    desc:"100+ notes written" },

    // ── Organizing — series: "categories-created" ─────────────────────────
    { id:"atlas-cats-1",  group:"atlas", series:"categories-created", category:"organizing", metric:"categoriesCreated", threshold:1,  tier:1, title:"First Tag",         desc:"Created your first tag" },
    { id:"atlas-cats-5",  group:"atlas", series:"categories-created", category:"organizing", metric:"categoriesCreated", threshold:5,  tier:1, title:"Organizer",          desc:"5+ tags" },
    { id:"atlas-cats-10", group:"atlas", series:"categories-created", category:"organizing", metric:"categoriesCreated", threshold:10, tier:2, title:"Taxonomist",         desc:"10+ tags" },
    { id:"atlas-cats-25", group:"atlas", series:"categories-created", category:"organizing", metric:"categoriesCreated", threshold:25, tier:3, title:"System Builder",     desc:"25+ tags" },
    { id:"atlas-cats-50", group:"atlas", series:"categories-created", category:"organizing", metric:"categoriesCreated", threshold:50, tier:4, title:"Master Classifier",  desc:"50+ tags" },

    // ── Deep Categorization — series: "paper-many-cats" ───────────────────
    { id:"atlas-deep-3",  group:"atlas", series:"paper-many-cats", category:"organizing", metric:"maxCatsOnPaper", threshold:3,  tier:1, title:"Cross-Referencer",  desc:"Tagged a paper with 3+ tags" },
    { id:"atlas-deep-5",  group:"atlas", series:"paper-many-cats", category:"organizing", metric:"maxCatsOnPaper", threshold:5,  tier:2, title:"Deep Thinker",       desc:"5+ tags on one paper" },
    { id:"atlas-deep-10", group:"atlas", series:"paper-many-cats", category:"organizing", metric:"maxCatsOnPaper", threshold:10, tier:3, title:"Multi-Dimensional",  desc:"10+ tags on one paper" },

    // ── Bin (current) — series: "binned" ──────────────────────────────────
    { id:"atlas-bin-1",  group:"atlas", series:"binned", category:"organizing", metric:"binned", threshold:1,  tier:1, title:"First Discard",    desc:"Moved a paper to Bin" },
    { id:"atlas-bin-10", group:"atlas", series:"binned", category:"organizing", metric:"binned", threshold:10, tier:2, title:"Spring Cleaning",  desc:"10+ papers in Bin" },
    { id:"atlas-bin-50", group:"atlas", series:"binned", category:"organizing", metric:"binned", threshold:50, tier:3, title:"Marie Kondo",      desc:"50+ papers in Bin" },

    // ── Source Diversity — series: "source-diversity" ─────────────────────
    { id:"atlas-src-3",  group:"atlas", series:"source-diversity", category:"cataloging", metric:"sourceDiversity", threshold:3,  tier:1, title:"Explorer",  desc:"Papers from 3+ different sources" },
    { id:"atlas-src-5",  group:"atlas", series:"source-diversity", category:"cataloging", metric:"sourceDiversity", threshold:5,  tier:2, title:"Wide Net",   desc:"5+ different sources" },
    { id:"atlas-src-10", group:"atlas", series:"source-diversity", category:"cataloging", metric:"sourceDiversity", threshold:10, tier:3, title:"Omnivore",   desc:"10+ different sources" },

    // ── Public Sharing — series: "public-papers" ──────────────────────────
    { id:"atlas-pub-1",  group:"atlas", series:"public-papers", category:"curating", metric:"publicPapers", threshold:1,  tier:1, title:"Going Public",     desc:"First publicly shared paper" },
    { id:"atlas-pub-5",  group:"atlas", series:"public-papers", category:"curating", metric:"publicPapers", threshold:5,  tier:2, title:"Public Curator",   desc:"5+ public papers" },
    { id:"atlas-pub-25", group:"atlas", series:"public-papers", category:"curating", metric:"publicPapers", threshold:25, tier:3, title:"Open Scholar",     desc:"25+ public papers" },
    { id:"atlas-pub-50", group:"atlas", series:"public-papers", category:"curating", metric:"publicPapers", threshold:50, tier:4, title:"Public Portfolio", desc:"50+ public papers" },
  ];

  // Ensure all defs have an explicit group (defaults to "scholarly")
  for (const def of DEFS) {
    if (!def.group) def.group = "scholarly";
  }

  // Category labels for UI pills — per group
  const SCHOLARLY_CATEGORIES = [
    { key: "all",        label: "All" },
    { key: "papers",     label: "Papers" },
    { key: "authorship", label: "Authorship" },
    { key: "team",       label: "Team" },
    { key: "citations",  label: "Citations" },
  ];

  const ATLAS_CATEGORIES = [
    { key: "all",         label: "All" },
    { key: "cataloging",  label: "Cataloging" },
    { key: "curating",    label: "Curating" },
    { key: "reading",     label: "Reading" },
    { key: "organizing",  label: "Organizing" },
  ];

  // Legacy export (backwards compat with v0.5.0)
  const CATEGORIES = SCHOLARLY_CATEGORIES;

  // Group-level metadata
  const GROUPS = [
    { key: "scholarly", label: "Scholarly", showSummary: false, showProgress: false },
    { key: "atlas",     label: "Atlas",     showSummary: true,  showProgress: true  },
  ];

  // Tier metadata
  const TIERS = {
    1: { name: "Wood",    color: "#c4a882" },
    2: { name: "Bronze",  color: "#cd7f32" },
    3: { name: "Silver",  color: "#a0a0a8" },
    4: { name: "Gold",    color: "#d4a017" },
    5: { name: "Diamond", color: "#7dd3fc" },
    6: { name: "Mythic",  color: "#d946ef" },
  };

  window.__achievementDefs = {
    DEFS,
    CATEGORIES,
    SCHOLARLY_CATEGORIES,
    ATLAS_CATEGORIES,
    GROUPS,
    TIERS,
  };
})(window);
