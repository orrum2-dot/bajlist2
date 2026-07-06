// api/movies.js
// Liefert die Film-Historie ("Zuletzt im Stream gesehen").
// Quelle: Google Sheet, das per !addfilm-Command (StreamElements -> Apps Script) befüllt wird.
// Das Sheet wird als CSV gelesen (Datei -> Freigeben -> Im Web veröffentlichen -> CSV).

const { lookupMovie } = require("../lib/tmdb");

const MAX_MOVIES = 18; // wie viele Filme maximal ans Frontend gehen

// Sehr kleiner CSV-Parser, der auch Titel mit Kommas ("Ich, einfach unverbesserlich") übersteht.
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

module.exports = async function handler(req, res) {
  try {
    const sheetUrl = process.env.SHEET_CSV_URL;
    if (!sheetUrl) {
      return res.status(500).json({ error: "SHEET_CSV_URL ist nicht gesetzt." });
    }

    const csvRes = await fetch(sheetUrl, { redirect: "follow" });
    if (!csvRes.ok) {
      throw new Error(`Google Sheet antwortet mit Status ${csvRes.status}`);
    }
    const csvText = await csvRes.text();

    // Erwartetes Sheet-Format pro Zeile: Titel | Hinzugefügt von | Datum
    let rows = parseCsv(csvText);

    // Kopfzeile überspringen, falls vorhanden
    if (rows.length && /titel|title/i.test(rows[0][0] || "")) {
      rows = rows.slice(1);
    }

    // Neueste zuerst, dann begrenzen
    const entries = rows
      .map((r) => ({
        rawTitle: (r[0] || "").trim(),
        addedBy: (r[1] || "").trim() || null,
        date: (r[2] || "").trim() || null,
      }))
      .filter((e) => e.rawTitle)
      .reverse()
      .slice(0, MAX_MOVIES);

    const movies = await Promise.all(
      entries.map(async (e) => {
        const info = await lookupMovie(e.rawTitle);
        return { ...info, addedBy: e.addedBy, date: e.date };
      })
    );

    // Vercel-CDN darf die Antwort 5 Minuten cachen -> schont TMDB-Quota und ist schnell.
    res.setHeader(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600"
    );
    return res.status(200).json({ movies });
  } catch (err) {
    console.error("Fehler in /api/movies:", err);
    return res
      .status(500)
      .json({ error: "Film-Historie konnte nicht geladen werden." });
  }
};
