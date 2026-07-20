// api/movies.js
// Liefert die Film-Historie ("Recently watched").
// Quelle: erstes Tabellenblatt des Google Sheets (befüllt via !addfilm).

const { lookupMovie, mapLimit } = require("../lib/tmdb");
const { loadSheetEntries } = require("../lib/sheet");

const MAX_MOVIES = 60;

module.exports = async function handler(req, res) {
  try {
    const sheetUrl = process.env.SHEET_CSV_URL;
    if (!sheetUrl) {
      return res.status(500).json({ error: "SHEET_CSV_URL ist nicht gesetzt." });
    }

    const entries = await loadSheetEntries(sheetUrl, MAX_MOVIES);

    // Max. 8 TMDB-Lookups gleichzeitig, um das Rate-Limit nicht zu reißen
    const movies = await mapLimit(entries, 8, async (e) => {
      const info = await lookupMovie(e.rawTitle);
      return { ...info, addedBy: e.addedBy, date: e.date };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ movies });
  } catch (err) {
    console.error("Fehler in /api/movies:", err);
    return res
      .status(500)
      .json({ error: "Film-Historie konnte nicht geladen werden." });
  }
};
