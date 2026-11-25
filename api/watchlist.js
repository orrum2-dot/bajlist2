// api/watchlist.js
// Liefert die KOMPLETTE Watchlist ("noch zu sehen").
// Quelle: Tabellenblatt "Watchlist" des Google Sheets (befüllt via !addlist),
// veröffentlicht als eigener CSV-Link (SHEET_WATCH_CSV_URL).
// Die Seitenfunktion passiert im Frontend.

const { lookupMovie, mapLimit } = require("../lib/tmdb");
const { loadSheetEntries } = require("../lib/sheet");

module.exports = async function handler(req, res) {
  try {
    const sheetUrl = process.env.SHEET_WATCH_CSV_URL;
    if (!sheetUrl) {
      return res
        .status(500)
        .json({ error: "SHEET_WATCH_CSV_URL ist nicht gesetzt." });
    }

    const entries = await loadSheetEntries(sheetUrl);

    // Jeden Titel nur einmal nachschlagen, max. 8 TMDB-Lookups gleichzeitig
    const uniqueTitles = [...new Set(entries.map((e) => e.rawTitle))];
    const infos = await mapLimit(uniqueTitles, 8, (t) => lookupMovie(t));
    const infoByTitle = new Map(uniqueTitles.map((t, i) => [t, infos[i]]));

    const watchlist = entries.map((e) => ({
      ...infoByTitle.get(e.rawTitle),
      addedBy: e.addedBy,
      date: e.date,
    }));

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
    return res.status(200).json({ watchlist });
  } catch (err) {
    console.error("Fehler in /api/watchlist:", err);
    return res
      .status(500)
      .json({ error: "Watchlist konnte nicht geladen werden." });
  }
};
