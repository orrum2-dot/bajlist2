// api/wishes.js
// Liefert die Community-Wunschliste.
// Quelle: StreamElements Store-Redemptions (Item "Filmwunsch" mit Zuschauer-Eingabe).
// Der SE-JWT-Token bleibt serverseitig in den Environment Variables.

const { lookupMovie } = require("../lib/tmdb");

const MAX_WISHES = 12;

module.exports = async function handler(req, res) {
  try {
    const channelId = process.env.SE_CHANNEL_ID;
    const jwt = process.env.SE_JWT_TOKEN;
    const itemName = process.env.SE_WISH_ITEM_NAME || "Filmwunsch";

    if (!channelId || !jwt) {
      return res
        .status(500)
        .json({ error: "SE_CHANNEL_ID oder SE_JWT_TOKEN ist nicht gesetzt." });
    }

    const url = new URL(
      `https://api.streamelements.com/kappa/v2/store/${channelId}/redemptions`
    );
    url.searchParams.set("limit", "50"); // genug Puffer, wir filtern gleich

    const seRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
      },
    });
    if (!seRes.ok) {
      throw new Error(`StreamElements antwortet mit Status ${seRes.status}`);
    }
    const data = await seRes.json();

    // SE liefert { docs: [...] } – wir nehmen nur Einlösungen des Filmwunsch-Items.
    const redemptions = (data.docs || [])
      .filter((r) => r.item && r.item.name === itemName)
      .map((r) => ({
        rawTitle:
          Array.isArray(r.input) && r.input[0]
            ? String(r.input[0]).trim()
            : "",
        user:
          (r.redeemer && (r.redeemer.username || r.redeemer.displayName)) ||
          "Unbekannt",
        date: r.createdAt || null,
        completed: r.completed === true,
      }))
      .filter((r) => r.rawTitle)
      .slice(0, MAX_WISHES);

    const wishes = await Promise.all(
      redemptions.map(async (r) => {
        const info = await lookupMovie(r.rawTitle);
        return { ...info, user: r.user, date: r.date, completed: r.completed };
      })
    );

    // Wünsche ändern sich öfter -> nur 60 Sekunden CDN-Cache.
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ wishes });
  } catch (err) {
    console.error("Fehler in /api/wishes:", err);
    return res
      .status(500)
      .json({ error: "Wunschliste konnte nicht geladen werden." });
  }
};
