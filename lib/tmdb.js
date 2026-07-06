// lib/tmdb.js
// Gemeinsamer Helper: Sucht einen Film bei TMDB und liefert Poster, Jahr & Genres.
// Läuft NUR serverseitig – der TMDB-Key bleibt in den Environment Variables.

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";

// Genre-Liste wird pro warmer Lambda-Instanz nur einmal geladen.
let genreMapPromise = null;

async function tmdbFetch(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  url.searchParams.set("language", "de-DE");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB antwortet mit Status ${res.status}`);
  }
  return res.json();
}

function getGenreMap() {
  if (!genreMapPromise) {
    genreMapPromise = tmdbFetch("/genre/movie/list")
      .then((data) => {
        const map = new Map();
        for (const g of data.genres || []) map.set(g.id, g.name);
        return map;
      })
      .catch((err) => {
        genreMapPromise = null; // beim nächsten Aufruf erneut versuchen
        throw err;
      });
  }
  return genreMapPromise;
}

/**
 * Sucht einen Film anhand des Titels.
 * Unterstützt optional "Titel (1999)" – das Jahr verbessert die Trefferquote.
 * Gibt IMMER ein Objekt zurück, auch wenn TMDB nichts findet (Fallback ohne Poster).
 */
async function lookupMovie(rawTitle) {
  const fallback = {
    title: rawTitle,
    year: null,
    poster: null,
    genres: [],
    found: false,
  };

  try {
    // "Inception (2010)" -> Titel + Jahr trennen
    const yearMatch = rawTitle.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    const query = yearMatch ? yearMatch[1].trim() : rawTitle.trim();
    const year = yearMatch ? yearMatch[2] : null;

    if (!query) return fallback;

    const params = { query, include_adult: "false" };
    if (year) params.year = year;

    const [search, genreMap] = await Promise.all([
      tmdbFetch("/search/movie", params),
      getGenreMap(),
    ]);

    const hit = search.results && search.results[0];
    if (!hit) return fallback;

    return {
      title: hit.title || query,
      year: hit.release_date ? hit.release_date.slice(0, 4) : null,
      poster: hit.poster_path ? IMG_BASE + hit.poster_path : null,
      genres: (hit.genre_ids || [])
        .map((id) => genreMap.get(id))
        .filter(Boolean)
        .slice(0, 2),
      found: true,
    };
  } catch (err) {
    console.error(`TMDB-Lookup fehlgeschlagen für "${rawTitle}":`, err.message);
    return fallback;
  }
}

module.exports = { lookupMovie };
