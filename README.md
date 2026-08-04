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

## Eigene Ärzte-Daten einpflegen

Die Beispieldaten liegen in [`js/data.js`](js/data.js) im Array
`AERZTE_DATA`. Jeder Eintrag braucht mindestens:

```js
{
  id: 1,
  name: "Praxis Mustermann",
  fachrichtung: "Allgemeinmedizin",
  strasse: "Musterstraße 1",
  plz: "12345",
  stadt: "Musterstadt",
  land: "Deutschland",
  lat: 52.5200,
  lng: 13.4050,
  status: "kunde", // "kunde" | "interessent" | "lead" | "inaktiv"
  ansprechpartner: "Dr. Max Mustermann",
  telefon: "+49 30 0000000",
  email: "kontakt@praxis.de",
  notizen: "",
}
```

Koordinaten (lat/lng) lassen sich kostenlos ermitteln über
[Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap-Suche) oder
Google Maps (Rechtsklick auf einen Ort → Koordinaten kopieren).

Wenn ihr eine größere Liste (Excel/CSV/CRM-Export) habt, kann daraus auch ein
automatischer Import gebaut werden, statt die Daten von Hand einzutragen.

## Nächste mögliche Schritte

- Anbindung an eine echte Datenquelle/API statt der statischen `data.js`
- Rollen/Gebiete pro Vertriebler farblich abgrenzen
- Umsatz-/Potenzial-Kennzahlen pro Praxis im Popup
- Deployment z. B. via GitHub Pages für einen teilbaren Link
