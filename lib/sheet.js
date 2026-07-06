// lib/sheet.js
// Gemeinsamer Helper: liest ein als CSV veröffentlichtes Google Sheet
// und liefert die Einträge (neueste zuerst).

// Kleiner CSV-Parser, der auch Titel mit Kommas übersteht.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * Lädt ein veröffentlichtes Sheet (CSV-Link) und gibt Einträge zurück:
 * [{ rawTitle, addedBy, date }, ...] – neueste zuerst, begrenzt auf maxEntries.
 */
async function loadSheetEntries(sheetUrl, maxEntries) {
  const res = await fetch(sheetUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Google Sheet antwortet mit Status ${res.status}`);
  }
  let rows = parseCsv(await res.text());

  // Kopfzeile überspringen, falls vorhanden
  if (rows.length && /titel|title/i.test(rows[0][0] || "")) {
    rows = rows.slice(1);
  }

  return rows
    .map((r) => ({
      rawTitle: (r[0] || "").trim(),
      addedBy: (r[1] || "").trim() || null,
      date: (r[2] || "").trim() || null,
    }))
    .filter((e) => e.rawTitle)
    .reverse()
    .slice(0, maxEntries);
}

module.exports = { loadSheetEntries };
