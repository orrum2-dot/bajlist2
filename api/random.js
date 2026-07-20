// api/random.js
// Zufallsfilm für den Random Picker: /api/random?genre=28&from=1990&to=1999
// Antwort wird NICHT gecacht (jeder Aufruf = neuer Wurf).

const { randomDiscover, movieFromId } = require("../lib/tmdb");

function toYear(value, fallbackMin, fallbackMax) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(Math.max(n, fallbackMin), fallbackMax);
}

module.exports = async function handler(req, res) {
  try {
    const q = req.query || {};
    const genre = /^\d+$/.test(String(q.genre || "")) ? q.genre : null;
    const from = toYear(q.from, 1900, 2100);
    const to = toYear(q.to, 1900, 2100);

    const hit = await randomDiscover({ genre, from, to });
    if (!hit) {
      res.setHeader("Cache-Control", "no-store");
      return res
        .status(200)
        .json({ movie: null, message: "No movies found for these filters." });
    }

    const movie = await movieFromId(hit.id);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ movie });
  } catch (err) {
    console.error("Fehler in /api/random:", err);
    return res.status(500).json({ error: "Random pick failed." });
  }
};
