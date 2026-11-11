// Gate G3 fixture: an atlas-data repository whose every text and link field
// carries an injection attempt. Each payload, if it ever ran, would set
// window.__pwned; with the CSP in place it would also log a violation.
const j = (v) => `${JSON.stringify(v, null, 1)}\n`;
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
// The PNG's real name (sha256 prefix), so the store's media path is genuine.
const MEDIA = "media/497790947d466676.png";

export const TAG = `x"><img src=x onerror="window.__pwned='tag'">`;
const html = (where) => `"'><img src=x onerror="window.__pwned='${where}'"><script>window.__pwned='${where}-s'</script>`;
const js = (where) => `javascript:window.__pwned='${where}'`;
const attr = (where) => `x" autofocus onfocus="window.__pwned='${where}'" data-x="`;

function paper(id, o = {}) {
  return {
    id, title: html(`${id}-title`) + attr(`${id}-title-attr`), authors: `${html(`${id}-authors`)}, B. Author`,
    affiliations: html(`${id}-aff`), year: "2024/05/01", journal: html(`${id}-journal`), shortJournal: html(`${id}-sj`),
    volume: "", pages: "", citationCount: 3, citationSource: "crossref", type: "paper", doi: `10.9999/${id}`,
    url: js(`${id}-url`), pdfPath: js(`${id}-pdf`), tags: [TAG], starred: false, pinned: false, isRead: false, status: "unread",
    notes: `see https://a.example/"onmouseover="window.__pwned='${id}-note' and ${html(`${id}-note2`)}`,
    summary: `<jats:p>${html(`${id}-summary`)}</jats:p>`, sourceType: "manual", sourceName: html(`${id}-src`),
    addedAt: "2026-01-01T00:00:00", updatedAt: "2026-01-02T00:00:00", deletedAt: null, authorOrder: 1, isCoFirst: false,
    correspondingRole: "none", isPublic: false, isMine: false, isLast: false, isSelected: false, inLibrary: true, showOnProfile: true,
    extraLinks: [{ label: html(`${id}-xlabel`), url: js(`${id}-xurl`) }], authorAnnotations: {}, profileTags: [TAG], ...o,
  };
}

export function g3Files() {
  return {
    "atlas.json": j({ schema: 1, ownerSlug: "dukhyun" }),
    "profile.json": j({
      name: html("name"), bio: html("bio"), about: `## ${html("about")}\n- [link](${js("about-link")})`, affiliation: html("affiliation"),
      scholarUrl: js("scholar"), websiteUrl: js("website"), linkedinUrl: "https://www.linkedin.com/in/x", githubUrl: js("github"),
      facebookUrl: "", instagramUrl: "", xUrl: "", youtubeUrl: "", akaNames: "", slug: "dukhyun", picture: MEDIA,
      pictureCaption: html("caption"), journalOrder: [], tagOrder: [], pubViewPrefs: { showAllPubs: true, sortMode: "year", showNumbering: null, positionFilters: [] },
      profilePublic: true, achievementsPublic: true, notes: html("profile-notes"), createdAt: "", updatedAt: "",
    }),
    "papers/lib1.json": j(paper("lib1")),
    "papers/mine1.json": j(paper("mine1", { isMine: true, inLibrary: false, isPublic: true })),
    "papers/web1.json": j(paper("web1", { doi: "", url: js("web1-url") })),
    "papers/binned1.json": j(paper("binned1", { deletedAt: "2026-02-01T00:00:00" })),
    "references/lib1.json": j({ paperId: "lib1", rows: [{ doi: "10.9999/mine1", title: html("ref"), year: "2023", authors: html("ref-authors"), journal: html("ref-journal"), source: "crossref", fetchedAt: "" }] }),
    "manual-links/L1.json": j({ id: "L1", paperA: "lib1", paperB: "web1", createdAt: "2026-01-03T00:00:00" }),
    "talks/t1.json": j({
      id: "t1", title: html("talk"), speakers: html("speakers"), year: "2024", date: "2024-05-01", venue: html("venue"), location: html("location"),
      talkType: "Invited", talkLink: js("talk-link"), venueUrl: js("venue-url"), pdfPath: js("talk-pdf"), inviter: html("inviter"), inviterUrl: js("inviter-url"),
      tags: [TAG], starred: false, pinned: false, notes: html("talk-notes"), summary: html("talk-summary"), sourceType: "manual", sourceName: "",
      addedAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00", deletedAt: null, isPublic: false, isMine: true, isSelected: false,
      showOnProfile: true, extraLinks: [{ label: "x", url: js("talk-xurl") }], profileTags: [TAG],
    }),
    "recognitions/r1.json": j({
      id: "r1", title: html("rec"), authors: html("rec-authors"), year: "2024", journal: html("rec-journal"), type: "paper", doi: "", url: js("rec-url"),
      pdfPath: "", tags: [], starred: false, pinned: false, notes: "", summary: html("rec-summary"), sourceType: "manual", sourceName: "",
      addedAt: "", updatedAt: "", deletedAt: null, isPublic: false, isMine: true, isSelected: false, showOnProfile: true, extraLinks: [], profileTags: [],
    }),
    "news/n1.json": j({
      id: "n1", dateLabel: html("datelabel"), sortDate: "2026-01-01", endDate: "", title: html("news-title"),
      body: `${html("news-body")}\n- [click](${js("news-md-link")})\n- https://x.example/"onmouseover="window.__pwned='news-url'`,
      links: [{ label: html("news-link-label"), url: js("news-link"), children: [] }],
      images: [{ src: MEDIA, caption: html("news-caption") }], isPublic: true, addedAt: "", updatedAt: "", deletedAt: null,
    }),
    "tags/1.json": j({ id: 1, name: TAG, createdAt: "", updatedAt: "" }),
    "profile-tags/2.json": j({ id: 2, name: TAG, scope: "general", createdAt: "", updatedAt: "" }),
    [MEDIA]: PNG,
  };
}
