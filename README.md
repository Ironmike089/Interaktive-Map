# Interaktive-Map – Medipulse Ärzte-Weltkarte

Eine interaktive 3D-Weltkugel für den Vertrieb: herauszoomen zeigt den ganzen
Globus (frei drehbar), hineinzoomen geht fließend in eine normale Straßenkarte
über. Ärzte/Praxen werden als farbige Marker angezeigt (Kunde / Interessent /
Lead / Inaktiv), gruppiert (Clustering) bei vielen Punkten in einer Region.

## Tech-Stack

- **[MapLibre GL JS](https://maplibre.org/)** – Open-Source-Kartenbibliothek
  (Fork von Mapbox GL, keine Lizenzkosten, keine Nutzungsgrenzen). Wird lokal
  aus `vendor/maplibre-gl/` geladen, kein CDN-Abhängigkeit.
- **[OpenFreeMap](https://openfreemap.org/)** – kostenlose Vektor-Kartenkacheln
  auf Basis von **OpenStreetMap**-Daten, ohne API-Key und ohne Nutzungslimit.
- Reines HTML/CSS/JavaScript, kein Build-Prozess nötig.

## Starten

Einfach `index.html` im Browser öffnen. Für die beste Kompatibilität
(manche Browser blockieren `fetch` bei `file://`) empfiehlt sich ein
einfacher lokaler Server, z. B.:

```bash
python3 -m http.server 8080
# dann im Browser: http://localhost:8080
```

Für die Kartenkacheln wird eine Internetverbindung benötigt (OpenFreeMap).

## Funktionen

- 🌐 3D-Globus mit freier Rotation, Zoom & Kippen (Drag = drehen, Scroll = zoomen)
- ▶️/⏸ automatische Rotation, pausiert automatisch bei Interaktion
- 🔍 Suche über Name, Stadt, Fachrichtung, Land
- 🎯 Filter nach Status (Kunde/Interessent/Lead/Inaktiv)
- 📍 Cluster-Marker, die sich beim Reinzoomen auflösen
- 🗂️ Seitenliste aller Ärzte mit Klick-zu-Standort
- 💬 Popup pro Praxis mit Adresse, Ansprechpartner, Telefon/E-Mail-Links und
  Routen-Link
- 📊 Live-Statistik-Leiste oben (Anzahl je Status)

## Echte Ärzte-Daten (AOK-Import)

Die App lädt echte Daten aus `data/aerzte-teil1.json.gz`,
`data/aerzte-teil2.json.gz`, `data/aerzte-teil3.json.gz` (gzip-komprimiert,
per `fetch()` + `DecompressionStream` im Browser entpackt — spart ca. 80%
Dateigröße gegenüber reinem JSON). Fehlende Teile werden beim Laden
stillschweigend übersprungen; sind **keine** Teile vorhanden, springt die App
auf die Beispieldaten aus [`js/data.js`](js/data.js) zurück.

Diese Dateien werden aus den gelieferten AOK-CSV-Exporten erzeugt:

```bash
python3 scripts/csv_to_json.py <CSV-Datei> data/aerzte-teilN.json.gz
# mehrere CSVs zu einer Datei zusammenführen:
python3 scripts/csv_to_json.py teil1.csv teil2.csv data/aerzte-teil1.json.gz
```

Das Skript entfernt Duplikate (per `id`), überspringt Zeilen ohne
Koordinaten und mappt die AOK-Spalten auf unser Schema (siehe unten).

**Wichtig — Status-Feld:** Die AOK-Liste enthält keine CRM-Beziehung, daher
bekommt jeder importierte Eintrag aktuell den Status `"lead"` (unklassifizierter
Kontakt). Ob ein Arzt tatsächlich Kunde/Interessent ist, müsst ihr separat aus
eurem CRM einspielen (z. B. per `id`-Abgleich) — dafür gibt es aktuell noch
keine Automatik.

**Aktueller Stand:** Teil 1+2/3 sind eingespielt (**205.340 Praxen/Ärzte**,
Deutschland). Teil 3 folgt und wird nach Lieferung genauso verarbeitet.

**Performance-Hinweis:** Bei >300 Treffern zeigt die Seitenliste nur die
ersten 300 an (mit Hinweis auf die Anzahl der ausgeblendeten Treffer) — die
Karte selbst zeigt weiterhin alle passenden Punkte über Clustering an, nur
das Rendern von hunderttausenden Listen-Einträgen im DOM würde den Browser
ausbremsen.

### Datenschema

```js
{
  id: 182480,
  name: "Berno Christian Albus",
  fachrichtung: "Orthopädie und Unfallchirurgie",
  einrichtung: "HELIOS Medizinisches Versorgungszentrum Lengerich",
  kette: "Helios",              // Praxiskette/Konzern, falls vorhanden
  strasse: "Kirchplatz 9",
  plz: "49525",
  stadt: "Lengerich",
  land: "Deutschland",
  lat: 52.189816,
  lng: 7.851624,
  status: "lead",                // "kunde" | "interessent" | "lead" | "inaktiv"
  ansprechpartner: "Berno Christian Albus",
  telefon: "+49548198886",
  email: "",
  website: "https://...",
  notizen: "Teil von Helios (Fresenius Helios) · MVZ",
}
```

Für **manuell** ergänzte Einzeleinträge (z. B. eigene Testdaten) funktioniert
weiterhin das gleiche Schema direkt in `js/data.js` als Fallback.

## Nächste mögliche Schritte

- Teil 2/3 der AOK-Daten einspielen, sobald geliefert
- Echten CRM-Status (Kunde/Interessent) mit den AOK-Datensätzen abgleichen
- Rollen/Gebiete pro Vertriebler farblich abgrenzen
- Umsatz-/Potenzial-Kennzahlen pro Praxis im Popup
- Deployment z. B. via GitHub Pages für einen teilbaren Link (Hinweis: aktuell
  privates Repo — Pages bräuchte einen bezahlten Plan oder ein öffentliches Repo)
