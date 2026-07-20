// api/recommendations.js
// "You might like": Empfehlungen auf Basis der letzten geschauten Filme
// (stark gewichtet) und der Watchlist (schwach gewichtet).
// Quelle der Vorschläge: TMDB-Recommendations ("Wer das mochte, mochte auch").
// Bereits Geschautes und Watchlist-Einträge werden herausgefiltert.

const {
  searchMovie,
  movieFromId,
  recommendationsForId,
  mapLimit,
} = require("../lib/tmdb");
const { loadSheetEntries } = require("../lib/sheet");

const RECENT_SEEDS = 5; // wie viele zuletzt geschaute Filme als Basis dienen
const WATCH_SEEDS = 3; // wie viele Watchlist-Filme zusätzlich einfließen
const MAX_RESULTS = 6; // wie viele Empfehlungen ans Frontend gehen

// Titel-Normalisierung fürs Herausfiltern: klein, ohne " (1999)" am Ende.
function norm(title) {
  return String(title)
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, "");
}

module.exports = async function handler(req, res) {
  try {
    const historyUrl = process.env.SHEET_CSV_URL;
    if (!historyUrl) {
      return res.status(500).json({ error: "SHEET_CSV_URL ist nicht gesetzt." });
    }

    // 1) Historie laden (großzügig viele, fürs Filtern) + Watchlist (optional)
    const history = await loadSheetEntries(historyUrl, 100);
    let watchlist = [];
    if (process.env.SHEET_WATCH_CSV_URL) {
      try {
        watchlist = await loadSheetEntries(process.env.SHEET_WATCH_CSV_URL, 50);
      } catch (err) {
        console.error("Watchlist für Empfehlungen nicht ladbar:", err.message);
      }
    }

    if (!history.length) {
      return res.status(200).json({ recommendations: [] });
    }

    // Alles, was schon bekannt ist, darf nicht empfohlen werden.
    const known = new Set(
      [...history, ...watchlist].map((e) => norm(e.rawTitle))
    );

    // 2) Seeds: neueste Historie stark, Watchlist schwach gewichtet.
    const seeds = [
      ...history.slice(0, RECENT_SEEDS).map((e, i) => ({
        rawTitle: e.rawTitle,
        weight: RECENT_SEEDS - i, // neuester Film = höchstes Gewicht
      })),
      ...watchlist.slice(0, WATCH_SEEDS).map((e) => ({
        rawTitle: e.rawTitle,
        weight: 1,
      })),
    ];

    // 3) Seeds bei TMDB auflösen und ihre Empfehlungen einsammeln.
    const scores = new Map(); // tmdbId -> { score, because, raw }
    const seedIds = new Set();

    await mapLimit(seeds, 4, async (seed) => {
        try {
          const hit = await searchMovie(seed.rawTitle);
          if (!hit) return;
          seedIds.add(hit.id);

          const recs = await recommendationsForId(hit.id);
          recs.forEach((rec, index) => {
            if (!rec || !rec.id) return;
            // Positions-Bonus: frühe Empfehlungen zählen mehr.
            const points = seed.weight * (recs.length - index);
            const entry = scores.get(rec.id) || {
              score: 0,
              because: seed.rawTitle,
              becausePoints: 0,
              raw: rec,
            };
            entry.score += points;
            if (points > entry.becausePoints) {
              entry.becausePoints = points;
              entry.because = seed.rawTitle;
            }
            scores.set(rec.id, entry);
          });
        } catch (err) {
          console.error(`Seed "${seed.rawTitle}" übersprungen:`, err.message);
        }
    });

    // 4) Bekanntes und die Seeds selbst herausfiltern, dann Top-N wählen.
    const ranked = [...scores.entries()]
      .filter(([id, entry]) => {
        if (seedIds.has(id)) return false;
        const raw = entry.raw;
        const names = [raw.title, raw.original_title].filter(Boolean);
        return !names.some((n) => known.has(norm(n)));
      })
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, MAX_RESULTS);

    // 5) Volle Details (Poster, Laufzeit, Trailer ...) für die Finalisten.
    const recommendations = await mapLimit(ranked, 4, async ([id, entry]) => {
      const movie = await movieFromId(id);
      return { ...movie, because: entry.because };
    });

    // Empfehlungen ändern sich nur mit der Historie -> 30 Minuten CDN-Cache.
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("Fehler in /api/recommendations:", err);
    return res
      .status(500)
      .json({ error: "Empfehlungen konnten nicht geladen werden." });
  }
};
