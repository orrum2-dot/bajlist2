// api/emotes.js
// Lädt das aktive 7TV-Emote-Set eines Twitch-Channels serverseitig
// und liefert die Emote-Bild-URLs. So umgeht die Seite Adblocker/CORS,
// weil der Browser nur die eigene Domain (/api/emotes) anfragt.

const CHANNEL = process.env.SEVENTV_CHANNEL || "bazingaahpunk";

module.exports = async function handler(req, res) {
  try {
    const r = await fetch("https://7tv.io/v3/users/twitch/" + CHANNEL, {
      headers: { "User-Agent": "bajlist/1.0" },
    });
    if (!r.ok) throw new Error("7TV HTTP " + r.status);
    const data = await r.json();
    const set = (data.emote_set && data.emote_set.emotes) || [];
    const emotes = set.map((e) => "https://cdn.7tv.app/emote/" + e.id + "/2x.webp");

    // Emote-Set ändert sich selten -> 6 Stunden CDN-Cache.
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ emotes });
  } catch (err) {
    console.error("Fehler in /api/emotes:", err);
    return res.status(200).json({ emotes: [] });
  }
};
