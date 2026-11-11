/**
 * js/localapi/owner/export-csv.js
 * GET /api/exports/csv: the original's 20-column CSV of all active papers
 * (services/imports.py export_csv + api/routes/exports.py): UTF-8 BOM, CRLF,
 * Python csv QUOTE_MINIMAL, ordered by updated_at DESC, title ASC.
 * Returned as {raw, contentType}; boot.js turns that into a text Response.
 */

import { sqlTextCompare } from "./routes-read.js?v=1.0.5";

const HEADERS = ["id", "title", "authors", "affiliations", "year", "journal", "type", "doi", "url", "pdf_path", "tags",
  "starred", "is_read", "status", "note", "summary", "source_type", "source_name", "added_at", "updated_at"];

/** csv.writer default dialect: quote only when the field holds , " \r or \n; double the quotes. */
export function csvField(value) {
  const v = value == null ? "" : String(value);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function papersCsv(papers) {
  const rows = papers
    .filter((p) => p && !p.deletedAt)
    .sort((a, b) => (a.updatedAt !== b.updatedAt ? (String(a.updatedAt) < String(b.updatedAt) ? 1 : -1) : sqlTextCompare(a.title, b.title)))
    .map((p) => [p.id, p.title, p.authors, p.affiliations, p.year, p.journal, p.type, p.doi, p.url, p.pdfPath,
      (p.tags || []).join("|"), p.starred ? "true" : "false", p.isRead ? "true" : "false", p.status, p.notes, p.summary,
      p.sourceType, p.sourceName, p.addedAt, p.updatedAt]);
  return `﻿${[HEADERS, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`;
}

export async function ownerExportCsv(ctx) {
  if (ctx.method !== "GET" || ctx.pathname !== "/api/exports/csv" || !ctx.owner) return null;
  const ds = await ctx.owner.dataset();
  return { status: 200, raw: papersCsv(ds.papers), contentType: "text/csv; charset=utf-8" };
}
