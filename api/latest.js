// api/latest.js
// Digitale Releases (Stream/Kauf/Leihe) aus TMDB.
// /api/latest?page=1  -> neueste zuerst, angereichert mit Postern/Trailern.

const { digitalReleases, movieFromId, mapLimit } = require("../lib/tmdb");

const PER_PAGE = 18;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  try {
    const page = Math.max(1, parseInt((req.query && req.query.page) || "1", 10) || 1);

    // Fenster: von heute bis ~120 Tage zurück (frische Digital-Releases)
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 120);

    const { results, totalPages } = await digitalReleases({
      from: ymd(from),
      to: ymd(to),
      page,
    });

    // Nur die ersten PER_PAGE mit vollen Details (Poster, Trailer ...) anreichern
    const slice = results.slice(0, PER_PAGE);
    const movies = await mapLimit(slice, 8, async (r) => {
      const movie = await movieFromId(r.id);
      return movie;
    });

    // Digital-Releases ändern sich langsam -> 1 Stunde CDN-Cache
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      movies: movies.filter((m) => m.found),
      page,
      totalPages,
    });
  } catch (err) {
    console.error("Fehler in /api/latest:", err);
    return res.status(500).json({ error: "Latest releases failed." });
  }
};
