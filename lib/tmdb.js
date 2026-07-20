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
  const raw = String(rawTitle).trim();
  if (!raw) return null;

  // Jahr am Ende erkennen - sowohl "Titel (1999)" als auch "Titel 1999".
  // Nur plausible Filmjahre (1888 bis naechstes Jahr) zaehlen als Jahr, damit
  // Titel wie "Blade Runner 2049" oder "1917" nicht zerlegt werden.
  const maxYear = new Date().getFullYear() + 1;
  const yearMatch = raw.match(/^(.+?)\s*\(?((?:18|19|20)\d{2})\)?$/);
  let query = raw;
  let year = null;
  if (yearMatch) {
    const y = parseInt(yearMatch[2], 10);
    if (y >= 1888 && y <= maxYear) {
      query = yearMatch[1].trim();
      year = String(y);
    }
  }
  if (!query) return null;

  const rawLower = raw.toLowerCase();
  const queryLower = query.toLowerCase();
  const titleEquals = (r, val) =>
    [r.title, r.original_title].some(
      (t) => t && t.trim().toLowerCase() === val
    );

  const pick = (results) =>
    // 1. exakter Titel-Treffer MIT passendem Jahr
    (year &&
      results.find(
        (r) => titleEquals(r, queryLower) && (r.release_date || "").slice(0, 4) === year
      )) ||
    // 2. exakter Treffer auf den kompletten Rohstring (z. B. "Death Race 2000")
    results.find((r) => titleEquals(r, rawLower)) ||
    // 3. exakter Titel-Treffer ohne Jahr-Pruefung
    results.find((r) => titleEquals(r, queryLower)) ||
    // 4. sonst bester Suchtreffer
    results[0] ||
    null;

  // Versuch 1: mit Jahr (praeziser primary_release_year-Filter)
  let params = { query, include_adult: "false" };
  if (year) params.primary_release_year = year;
  let hit = pick((await tmdbFetch("/search/movie", params)).results || []);

  // Versuch 2: ohne Jahr - fuer Faelle, in denen TMDB das Jahr regional
  // anders fuehrt.
  if (!hit && year) {
    hit = pick(
      (await tmdbFetch("/search/movie", { query, include_adult: "false" }))
        .results || []
    );
  }

  // Versuch 3: kompletter Rohstring als Query - falls die Jahres-Abtrennung
  // doch danebenlag (Titel enthaelt selbst eine Jahreszahl).
  if (!hit && query !== raw) {
    hit = pick(
      (await tmdbFetch("/search/movie", { query: raw, include_adult: "false" }))
        .results || []
    );
  }

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
  // Alle YouTube-Trailer/-Teaser nach Eignung sortieren und als Liste liefern,
  // damit das Frontend bei einer Laendersperre auf den naechsten ausweichen kann.
  // Deutschsprachige zuerst (bessere Chance, in DE nicht gesperrt zu sein),
  // dann offizielle, dann Trailer vor Teaser.
  const score = (v) =>
    (v.type === "Trailer" ? 100 : v.type === "Teaser" ? 50 : 0) +
    (v.official ? 10 : 0) +
    (v.iso_639_1 === "de" ? 5 : v.iso_639_1 === "en" ? 2 : 0);
  const seen = new Set();
  const trailers = yt
    .filter((v) => v.type === "Trailer" || v.type === "Teaser")
    .sort((a, b) => score(b) - score(a))
    .map((v) => v.key)
    .filter((k) => (seen.has(k) ? false : seen.add(k)));

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
    trailer: trailers[0] || null,
    trailers,
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
    trailers: [],
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
