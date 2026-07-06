// lib/tmdb.js
// Gemeinsamer Helper: Sucht einen Film bei TMDB und liefert Poster, Jahr, Genres,
// Beschreibung, Bewertung und Laufzeit. Läuft NUR serverseitig.

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";

// Sprache der Beschreibungen/Genres – passend zur englischen UI.
const LANG = process.env.TMDB_LANGUAGE || "en-US";

async function tmdbFetch(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  url.searchParams.set("language", LANG);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB antwortet mit Status ${res.status}`);
  }
  return res.json();
}

/**
 * Sucht einen Film anhand des Titels und lädt anschließend die Detail-Daten.
 * Unterstützt optional "Titel (1999)" – das Jahr verbessert die Trefferquote.
 * Gibt IMMER ein Objekt zurück, auch wenn TMDB nichts findet.
 */
async function lookupMovie(rawTitle) {
  const fallback = {
    title: rawTitle,
    year: null,
    poster: null,
    genres: [],
    overview: null,
    rating: null,
    runtime: null,
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

    const search = await tmdbFetch("/search/movie", params);
    const results = search.results || [];

    // Exakten Titel-Treffer bevorzugen (auch gegen den Originaltitel),
    // sonst den populärsten Treffer nehmen. Verhindert z. B., dass
    // "Stolz der Nation" auf Inglourious Basterds mappt.
    const wanted = query.toLowerCase();
    const hit =
      results.find((r) =>
        [r.title, r.original_title].some(
          (t) => t && t.trim().toLowerCase() === wanted
        )
      ) || results[0];

    if (!hit) return fallback;

    // Zweiter Call: Details (liefert Laufzeit, Beschreibung, volle Genres)
    const details = await tmdbFetch(`/movie/${hit.id}`);

    return {
      title: details.title || query,
      year: details.release_date ? details.release_date.slice(0, 4) : null,
      poster: details.poster_path ? IMG_BASE + details.poster_path : null,
      genres: (details.genres || []).map((g) => g.name).slice(0, 3),
      overview: details.overview || null,
      rating:
        typeof details.vote_average === "number" && details.vote_average > 0
          ? Math.round(details.vote_average * 10) / 10
          : null,
      runtime: details.runtime || null,
      found: true,
    };
  } catch (err) {
    console.error(`TMDB-Lookup fehlgeschlagen für "${rawTitle}":`, err.message);
    return fallback;
  }
}

module.exports = { lookupMovie };
