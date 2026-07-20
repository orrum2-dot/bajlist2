// lib/tmdb.js
// TMDB-Helper: Suche, Details (inkl. Trailer) und Empfehlungen.
// Läuft NUR serverseitig – der Key bleibt in den Environment Variables.

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
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
 * Sucht einen Film und gibt den besten Treffer zurück ({ id, title }) oder null.
 * Bevorzugt exakte Titel-Treffer (auch Originaltitel), versteht "Titel (1999)".
 */
async function searchMovie(rawTitle) {
  const yearMatch = String(rawTitle).match(/^(.*?)\s*\((\d{4})\)\s*$/);
  const query = (yearMatch ? yearMatch[1] : String(rawTitle)).trim();
  const year = yearMatch ? yearMatch[2] : null;
  if (!query) return null;

  const params = { query, include_adult: "false" };
  if (year) params.year = year;

  const search = await tmdbFetch("/search/movie", params);
  const results = search.results || [];
  const wanted = query.toLowerCase();
  const hit =
    results.find((r) =>
      [r.title, r.original_title].some(
        (t) => t && t.trim().toLowerCase() === wanted
      )
    ) || results[0];

  return hit ? { id: hit.id, title: hit.title || query } : null;
}

/**
 * Lädt die vollen Details (inkl. Trailer) zu einer TMDB-ID und
 * gibt das fertige Filmobjekt fürs Frontend zurück.
 */
async function movieFromId(id) {
  const details = await tmdbFetch(`/movie/${id}`, {
    append_to_response: "videos",
    include_video_language: "en,de,null",
  });

  const vids = (details.videos && details.videos.results) || [];
  const yt = vids.filter((v) => v.site === "YouTube" && v.key);
  const trailer =
    yt.find((v) => v.type === "Trailer" && v.official) ||
    yt.find((v) => v.type === "Trailer") ||
    yt.find((v) => v.type === "Teaser") ||
    null;

  return {
    id: details.id,
    title: details.title || "",
    year: details.release_date ? details.release_date.slice(0, 4) : null,
    poster: details.poster_path ? IMG_BASE + details.poster_path : null,
    genres: (details.genres || []).map((g) => g.name).slice(0, 3),
    overview: details.overview || null,
    rating:
      typeof details.vote_average === "number" && details.vote_average > 0
        ? Math.round(details.vote_average * 10) / 10
        : null,
    runtime: details.runtime || null,
    trailer: trailer ? trailer.key : null,
    found: true,
  };
}

/**
 * Titel -> fertiges Filmobjekt. Gibt IMMER ein Objekt zurück
 * (Fallback ohne Poster, wenn TMDB nichts findet).
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
    trailer: null,
    found: false,
  };

  try {
    const hit = await searchMovie(rawTitle);
    if (!hit) return fallback;
    return await movieFromId(hit.id);
  } catch (err) {
    console.error(`TMDB-Lookup fehlgeschlagen für "${rawTitle}":`, err.message);
    return fallback;
  }
}

/**
 * "Wer das mochte, mochte auch": TMDB-Empfehlungen zu einer Film-ID.
 * Gibt die rohe Ergebnisliste zurück (id, title, release_date, ...).
 */
async function recommendationsForId(id) {
  const data = await tmdbFetch(`/movie/${id}/recommendations`);
  return data.results || [];
}

module.exports = { lookupMovie, searchMovie, movieFromId, recommendationsForId };

/**
 * Zufallsfilm über TMDB-Discover: optional Genre-ID und Jahresbereich.
 * Filtert Kleinstkram über vote_count und wählt Seite + Treffer zufällig.
 * Gibt das rohe Discover-Objekt zurück (oder null).
 */
async function randomDiscover({ genre, from, to } = {}) {
  const params = {
    include_adult: "false",
    include_video: "false",
    sort_by: "popularity.desc",
    "vote_count.gte": "100",
  };
  if (genre) params.with_genres = String(genre);
  if (from) params["primary_release_date.gte"] = `${from}-01-01`;
  if (to) params["primary_release_date.lte"] = `${to}-12-31`;

  const first = await tmdbFetch("/discover/movie", { ...params, page: "1" });
  const totalPages = Math.min(first.total_pages || 1, 40);
  if (!first.results || !first.results.length) return null;

  const page = 1 + Math.floor(Math.random() * totalPages);
  const data =
    page === 1
      ? first
      : await tmdbFetch("/discover/movie", { ...params, page: String(page) });

  const results = data.results || [];
  if (!results.length) return null;
  return results[Math.floor(Math.random() * results.length)];
}

module.exports.randomDiscover = randomDiscover;
