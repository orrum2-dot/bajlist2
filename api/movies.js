// api/movies.js
// Liefert die KOMPLETTE Historie, getrennt nach Filmen und Serien ("Recently watched").
// Quelle: erstes Tabellenblatt des Google Sheets (befüllt via !addfilm).
// Serien-Fortschritt steht im Titel als Suffix, z. B. "Severance S2E5".
//
// Filme, die mehrfach geschaut wurden, werden zu EINER Karte zusammengefasst:
//   timesWatched = Anzahl, date = letztes Mal, dates = alle Termine (neueste zuerst).
// Die Seitenfunktion passiert im Frontend – hier kommt alles auf einmal.

const { lookupTitle, mapLimit } = require("../lib/tmdb");
const { loadSheetEntries } = require("../lib/sheet");

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

// Fallback-Schlüssel, wenn TMDB nichts findet: Titel klein, ohne "(1999)".
function normTitle(title) {
  return String(title)
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s+/g, " ");
}

module.exports = async function handler(req, res) {
  try {
    const sheetUrl = process.env.SHEET_CSV_URL;
    if (!sheetUrl) {
      return res.status(500).json({ error: "SHEET_CSV_URL ist nicht gesetzt." });
    }

    // Alle Einträge, neueste zuerst
    const entries = (await loadSheetEntries(sheetUrl)).map((e) => ({
      ...e,
      ...splitProgress(e.rawTitle),
    }));

    // Jeden Titel nur EINMAL bei TMDB nachschlagen (Rewatches teilen sich den Lookup)
    const uniqueTitles = [...new Set(entries.map((e) => e.title))];
    const infos = await mapLimit(uniqueTitles, 8, (t) => lookupTitle(t, null));
    const infoByTitle = new Map(uniqueTitles.map((t, i) => [t, infos[i]]));

    const movies = [];
    const shows = [];
    const movieByKey = new Map();

    for (const e of entries) {
      const info = infoByTitle.get(e.title);

      if (info.type === "tv") {
        shows.push({ ...info, progress: e.progress, addedBy: e.addedBy, date: e.date });
        continue;
      }

      // Filme: Rewatches zusammenfassen. Da "entries" neueste zuerst ist,
      // bestimmt der erste Treffer Position, Datum und "added by".
      const key = info.found && info.id ? `id:${info.id}` : `t:${normTitle(e.title)}`;
      const existing = movieByKey.get(key);
      if (existing) {
        existing.timesWatched++;
        existing.dates.push(e.date);
      } else {
        const movie = {
          ...info,
          addedBy: e.addedBy,
          date: e.date,
          dates: [e.date],
          timesWatched: 1,
        };
        movieByKey.set(key, movie);
        movies.push(movie);
      }
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
    return res.status(200).json({ movies, shows, total: entries.length });
  } catch (err) {
    console.error("Fehler in /api/movies:", err);
    return res
      .status(500)
      .json({ error: "Historie konnte nicht geladen werden." });
  }
};
