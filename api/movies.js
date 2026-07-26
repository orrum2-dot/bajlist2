// api/movies.js
// Liefert die Historie, getrennt nach Filmen und Serien ("Recently watched").
// Quelle: erstes Tabellenblatt des Google Sheets (befüllt via !addfilm).
// Serien-Fortschritt steht im Titel als Suffix, z. B. "Severance S2E5".

const { lookupTitle, mapLimit } = require("../lib/tmdb");
const { loadSheetEntries } = require("../lib/sheet");

const MAX_ENTRIES = 80;

// Trennt einen evtl. vorhandenen "S2E5"-Fortschritt vom Titel ab.
function splitProgress(raw) {
  const m = String(raw).match(/^(.*?)[\s\-–]*[sS](\d{1,2})\s*[eE](\d{1,3})\s*$/);
  if (m) {
    return {
      title: m[1].trim(),
      progress: { season: parseInt(m[2], 10), episode: parseInt(m[3], 10) },
    };
  }
  return { title: String(raw).trim(), progress: null };
}

module.exports = async function handler(req, res) {
  try {
    const sheetUrl = process.env.SHEET_CSV_URL;
    if (!sheetUrl) {
      return res.status(500).json({ error: "SHEET_CSV_URL ist nicht gesetzt." });
    }

    const entries = await loadSheetEntries(sheetUrl, MAX_ENTRIES);

    const items = await mapLimit(entries, 8, async (e) => {
      const { title, progress } = splitProgress(e.rawTitle);
      const info = await lookupTitle(title, progress);
      return { ...info, addedBy: e.addedBy, date: e.date };
    });

    const movies = items.filter((i) => i.type === "movie");
    const shows = items.filter((i) => i.type === "tv");

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ movies, shows });
  } catch (err) {
    console.error("Fehler in /api/movies:", err);
    return res
      .status(500)
      .json({ error: "Historie konnte nicht geladen werden." });
  }
};
