// api/watchlist.js
// Liefert die Watchlist ("noch zu sehen").
// Quelle: Tabellenblatt "Watchlist" des Google Sheets (befüllt via !watch),
// veröffentlicht als eigener CSV-Link (SHEET_WATCH_CSV_URL).

const { lookupMovie } = require("../lib/tmdb");
const { loadSheetEntries } = require("../lib/sheet");

const MAX_MOVIES = 18;

module.exports = async function handler(req, res) {
  try {
    const sheetUrl = process.env.SHEET_WATCH_CSV_URL;
    if (!sheetUrl) {
      return res
        .status(500)
        .json({ error: "SHEET_WATCH_CSV_URL ist nicht gesetzt." });
    }

    const entries = await loadSheetEntries(sheetUrl, MAX_MOVIES);

    const watchlist = await Promise.all(
      entries.map(async (e) => {
        const info = await lookupMovie(e.rawTitle);
        return { ...info, addedBy: e.addedBy, date: e.date };
      })
    );

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ watchlist });
  } catch (err) {
    console.error("Fehler in /api/watchlist:", err);
    return res
      .status(500)
      .json({ error: "Watchlist konnte nicht geladen werden." });
  }
};
