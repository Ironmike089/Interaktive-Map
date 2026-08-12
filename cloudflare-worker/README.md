# Automatische Infosheet-Recherche (Gemini)

Dieser kleine Cloudflare Worker hält deinen Gemini-API-Key sicher auf dem
Server und lässt die echte Karte (`index.html`) beim Klick auf
„Infosheet erstellen" automatisch eine Websuche über Gemini machen und die
Ergebnisse ins Infosheet eintragen.

**Wichtig:** Der Key darf niemals direkt im Programmcode der Website stehen —
der ist für jeden Besucher im Browser einsehbar. Der Worker ist die einzige
Stelle, die den Key kennt.

**Der Globus (Claude-Artefakt) kann das nicht nutzen** — Anthropics
Artefakt-Sandbox erlaubt keine Aufrufe an beliebige externe APIs. Das ist
eine bewusste Design-Entscheidung von uns: nur die echte Karte bekommt diese
Funktion.

## Einrichtung (einmalig, ca. 5 Minuten)

1. Gehe zu [dash.cloudflare.com](https://dash.cloudflare.com) und logg dich
   ein (oder erstelle kostenlos ein Konto — kein Zahlungsmittel nötig).
2. Links im Menü: **Workers & Pages** → **Create** → **Create Worker**.
3. Gib dem Worker einen Namen, z.B. `medipulse-infosheet-research`, und
   klicke auf **Deploy** (der Standard-„Hello World"-Code wird erstmal
   deployed, das ist ok).
4. Klicke danach auf **Edit code** (oder „Code bearbeiten").
5. Lösche den vorhandenen Code komplett und füge den Inhalt von
   `infosheet-research.js` (in diesem Ordner) ein.
6. Klicke oben rechts auf **Deploy** um die Änderung zu speichern.
7. Gehe zu **Settings** (Einstellungen) des Workers → **Variables and
   Secrets**.
8. Füge eine neue Variable hinzu:
   - Name: `GEMINI_API_KEY`
   - Wert: dein Gemini-API-Key
   - Typ: **Secret** (nicht „Text" — Secret wird verschlüsselt gespeichert
     und ist danach nicht mehr einsehbar)
9. Speichern. Die Worker-URL steht oben auf der Übersichtsseite, z.B.:
   `https://medipulse-infosheet-research.DEIN-KONTONAME.workers.dev`

## In der App eintragen

1. Öffne die echte Karte, klicke auf ⚙️ **Einstellungen**.
2. Trage die Worker-URL aus Schritt 9 oben in das Feld
   „Automatische Infosheet-Recherche" ein.
3. Fertig. Ab jetzt macht ein Klick auf „Infosheet erstellen" automatisch
   eine Recherche, bevor das Infosheet gespeichert wird (dauert ein paar
   Sekunden, während der „Recherchiere …" angezeigt wird).

Bleibt das Feld leer, wird das Infosheet wie bisher sofort nur mit dem
Steckbrief aus den vorhandenen Praxisdaten erstellt — kein Fehler, einfach
die einfachere Variante ohne Recherche.

## Dokumente als Zusatzkontext (optional)

Ist die Worker-URL eingetragen, erscheint in der Infothek jeder Praxis ein
Upload-Feld „Dokumente zur Recherche" (PDF/PNG/JPG, max. 4 MB, max. 3
Dateien). Hochgeladene Dokumente werden beim nächsten Recherche-Lauf als
zusätzlicher Kontext an Gemini mitgeschickt (z.B. ein Praxisflyer oder ein
Screenshot der Leistungsübersicht) — Gemini bezieht sie zusätzlich zur
Websuche in die Antwort mit ein. Die Dokumente selbst bleiben nur lokal im
Browser gespeichert (localStorage), nicht auf dem Worker.

Existiert schon ein Infosheet und werden danach neue Dokumente
hochgeladen, erscheint ein Button „Mit Dokumenten neu recherchieren" —
das überschreibt die bisherigen recherchierten Felder (nicht aber die
Steckbrief-Daten), daher fragt die App vorher noch einmal nach.

## Kosten

- Cloudflare Workers: kostenloses Kontingent reicht für normalen
  Vertriebsgebrauch bei weitem (100.000 Aufrufe/Tag gratis).
- Gemini API: nutzungsbasiert nach deinem Google-Konto, aktuell bei
  `gemini-3.6-flash` günstig pro Anfrage. Ein kostenloses Kontingent ist bei
  Google AI Studio verfügbar, für dauerhafte Nutzung im Team ist ein
  bezahltes Google-Cloud-Konto sinnvoll.

## Wenn es nicht funktioniert

Öffne die Entwicklerkonsole des Browsers (F12 → „Console") nach einem
Klick auf „Infosheet erstellen". Fehler von diesem Worker erscheinen dort
mit einer kurzen Fehlermeldung (z.B. falscher/fehlender API-Key,
Gemini-Anfrage fehlgeschlagen). Das Infosheet wird in jedem Fall trotzdem
mit dem Steckbrief gespeichert, auch wenn die Recherche fehlschlägt.
