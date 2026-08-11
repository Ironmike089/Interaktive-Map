/**
 * MediPulse — Infosheet-Recherche über Gemini (mit Google-Search-Grounding)
 *
 * Läuft als Cloudflare Worker. Hält den Gemini-API-Key serverseitig geheim
 * (als Secret, nie im Code) und reicht Anfragen der echten Karte
 * (index.html / js/app.js) an die Gemini API weiter.
 *
 * Deployment: siehe cloudflare-worker/README.md im selben Ordner.
 */

const MODEL = "gemini-3.6-flash";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildPrompt(d) {
  return `Du bist Vertriebsrechercheur für MediPulse, einen Anbieter für Software für Arztpraxen und MVZ. Recherchiere über eine Websuche öffentlich zugängliche Informationen zu folgender Praxis/Einrichtung.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, kein Codeblock, keine Erklärung davor oder danach) mit genau diesen Feldern:

{
  "trigger": "1-2 Sätze: ein aktuelles regulatorisches oder wirtschaftliches Thema, das für diese Fachrichtung gerade jetzt relevant ist",
  "verkauft": "1-2 Sätze: was die Praxis/Einrichtung anbietet",
  "firmografie": "Rechtsträger, Adresse, Ansprechpartner — nur was öffentlich auffindbar ist",
  "struktur": "Team- bzw. Organisationsstruktur — nur was öffentlich auffindbar ist",
  "produkt": "Leistungen, Statistiken, Besonderheiten — nur was öffentlich auffindbar ist",
  "aufhaenger": ["These 1", "These 2", "optional: These 3"]
}

Einrichtung: ${d.einrichtung || d.name}
Fachrichtung: ${d.fachrichtung || "unbekannt"}
Adresse: ${d.strasse || ""}, ${d.plz || ""} ${d.stadt || ""}, ${d.bundesland || ""}
Website (falls bekannt): ${d.website || "keine bekannt"}

Wichtig:
- Behaupte nichts, das du nicht über die Suche belegen kannst.
- Formuliere die Thesen in "aufhaenger" vorsichtig als Vermutung ("vermutlich", "wir vermuten").
- Findest du zu einem Feld nichts Verlässliches, lasse es leer ("" bzw. []).
- Nichts zur medizinischen Seite (Indikation, Behandlungsqualität) behaupten.
- Antworte NUR mit dem JSON-Objekt.`;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }
    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: "missing_api_key", detail: "GEMINI_API_KEY ist im Worker nicht als Secret gesetzt." }, 500);
    }

    let doctor;
    try {
      doctor = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    if (!doctor || !doctor.name) {
      return jsonResponse({ error: "missing_name" }, 400);
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    let geminiRes;
    try {
      geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(doctor) }] }],
          tools: [{ google_search: {} }],
        }),
      });
    } catch (err) {
      return jsonResponse({ error: "gemini_unreachable", detail: String(err) }, 502);
    }

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return jsonResponse({ error: "gemini_error", status: geminiRes.status, detail }, 502);
    }

    const geminiData = await geminiRes.json();
    const text = (geminiData?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("");

    let result;
    try {
      result = extractJson(text);
    } catch {
      return jsonResponse({ error: "parse_failed", raw: text }, 502);
    }

    return jsonResponse({
      result: {
        trigger: result.trigger || "",
        verkauft: result.verkauft || "",
        firmografie: result.firmografie || "",
        struktur: result.struktur || "",
        produkt: result.produkt || "",
        aufhaenger: Array.isArray(result.aufhaenger) ? result.aufhaenger.slice(0, 3) : [],
      },
    });
  },
};
