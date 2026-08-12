---
name: medipulse-infosheet
description: Recherchiert eine Arztpraxis, ein MVZ oder eine Praxisklinik (Name, Adresse/Stadt, Fachrichtung, ggf. Website) über eine echte Websuche und erstellt daraus ein fertiges MediPulse-Infosheet zum Reinkopieren in die MediPulse-App (Felder Trigger, Was die Praxis verkauft, Firmografie, Struktur, Produkt, Der Aufhänger). Nutze diesen Skill IMMER, wenn jemand aus dem MediPulse-Vertriebsteam eine Praxis/ein MVZ recherchiert haben möchte oder ein Infosheet braucht — auch wenn die Worte "Skill" oder "Infosheet" nicht fallen, z.B. bei "kannst du mir was zu [Praxisname] raussuchen", "recherchier mal die MVZ XY in Aachen", "was für Trigger gibt's bei einer Kieferorthopädie-Praxis gerade", "brauch nen Aufhänger für die Praxisklinik in Bamberg".
---

# MediPulse Infosheet-Recherche

## Warum es diesen Skill gibt

MediPulse-Vertriebsmitarbeiter:innen sprechen Arztpraxen und MVZ kalt an.
Ein gutes Infosheet gibt ihnen einen sachlich fundierten, nicht plumpen
Gesprächseinstieg: Was macht diese Praxis, was hat sich in ihrem Umfeld
gerade geändert, und welche 1-3 Vermutungen sind daraus ein legitimer
Gesprächsaufhänger. Das Infosheet landet direkt in der "Infothek" der
Praxis in der MediPulse-App (echte Karte oder Globus-Ansicht) und wird von
dort auch als PDF exportiert.

Die App selbst kann nicht automatisch im Web recherchieren (aus
Sicherheits- und Kostengründen läuft das nur über eine optionale, separat
eingerichtete Automatisierung). Dieser Skill ist der Weg, das manuell mit
Claude zu tun — schnell, mit echter Websuche, im richtigen Format.

## Ablauf

### 1. Eingaben prüfen

Du brauchst mindestens **Name der Praxis/des Ansprechpartners + Stadt oder
Adresse**, um sicher die richtige Einrichtung zu finden (es gibt in
Deutschland oft mehrere Praxen mit ähnlichen Namen). Fachrichtung und
Website sind hilfreich, aber nicht zwingend.

Fehlt die Stadt/Adresse komplett und der Name ist nicht eindeutig
identifizierbar (z.B. nur "Dr. Müller" ohne weitere Angabe), frag kurz
nach, statt zu raten — eine falsch zugeordnete Recherche ist schlimmer als
eine Rückfrage.

### 2. Recherchieren

Nutze die Websuche, um öffentlich zugängliche Informationen zusammenzutragen:

- **Eigene Website der Praxis** (falls vorhanden): "Über uns"/Team-Seite,
  Leistungsspektrum, Impressum (Rechtsträger, Adresse, Ansprechpartner),
  ggf. veröffentlichte Statistiken oder Zahlen.
- **Aktueller Trigger für die Fachrichtung**: suche gezielt nach kürzlich
  beschlossenen oder anstehenden regulatorischen/wirtschaftlichen
  Änderungen, die für genau diese Fachrichtung relevant sind — EBM-Reformen,
  Vergütungsänderungen, Gesetzesänderungen (z.B. TSVG-Nachfolge,
  Laborreform, Hygienezuschläge, GKV-Beitragssatzstabilisierung). Sucht
  z.B. nach "[Fachrichtung] Vergütung [aktuelles Jahr] Änderung" oder
  "[Fachrichtung] EBM Reform". Ein Trigger, der wirklich zur Fachrichtung
  passt, macht das Infosheet um Längen glaubwürdiger als ein generischer.

Wenn eine Website gefunden wurde, lohnt es sich, sie direkt zu öffnen
(nicht nur die Suchergebnis-Snippets zu lesen) — Team-Seiten und
Leistungsverzeichnisse stehen oft nicht vollständig in den Suchtreffern.

### 3. Die Vorsichtsregeln — und warum sie wichtig sind

Das Infosheet wird als Gesprächsgrundlage gegenüber echten Ärzt:innen und
Praxisinhaber:innen benutzt. Eine falsche oder übergriffige Behauptung
kostet nicht nur diesen einen Termin, sondern das Vertrauen in MediPulse
insgesamt. Deshalb:

- **Nichts zur medizinischen Seite.** Keine Bewertung von Behandlungsqualität,
  Indikation, Operationstechnik oder Ergebnissen. Das ist nicht unser
  Kompetenzbereich und steht der Praxis nicht zu, von uns beurteilt zu werden.
- **Keine Spekulation über die wirtschaftliche Lage** (Umsatz, Gewinn,
  Auslastung), außer die Praxis hat eine Zahl selbst öffentlich gemacht —
  dann mit Quelle zitieren, nicht hochrechnen oder schätzen.
- **Nur belegbare Fakten.** Jede Tatsachenbehauptung sollte auf eine
  Quelle zurückführbar sein, die du in der Recherche gefunden hast.
- **Findest du zu einem Feld nichts Verlässliches, lass es leer** statt
  etwas Plausibles zu raten. Ein leeres Feld ist im Editor der App völlig
  normal und fällt nicht negativ auf — eine falsche Angabe schon.
- **Die Thesen in "Der Aufhänger" sind ausdrücklich Vermutungen**, keine
  Tatsachenbehauptungen. Formuliere sie entsprechend vorsichtig
  ("vermutlich", "wir vermuten", "das legt nahe, dass …") und mach an der
  Ausgabe deutlich, dass es sich um Gesprächseinstiege handelt, die sich
  im Gespräch bestätigen oder erledigen können — nicht um recherchierte
  Fakten.

### 4. Ausgabeformat

Gib die Ausgabe **immer** in genau dieser Struktur, damit sie sich direkt
in die passenden Felder im Infosheet-Formular der App kopieren lässt (die
App hat exakt diese sechs Felder):

```
**Trigger:**
[1-2 Sätze]

**Was die Praxis verkauft:**
[1-2 Sätze]

**Firmografie:**
[Rechtsträger, Adresse, Ansprechpartner — oder leer lassen]

**Struktur:**
[Team-/Organisationsstruktur — oder leer lassen]

**Produkt:**
[Leistungen, Statistiken, Besonderheiten — oder leer lassen]

**Der Aufhänger:**
1. [These 1]
2. [optional: These 2]
3. [optional: These 3]
```

Nach den sechs Feldern kurz erklären, wie es weitergeht: die Blöcke lassen
sich 1:1 in die "Bearbeiten"-Ansicht des Infosheets in der App einfügen
(vorher muss dort einmal auf "Infosheet erstellen" geklickt worden sein,
das legt den Grund-Datensatz mit Steckbrief an; "Bearbeiten" öffnet dann
das Formular für diese sechs Felder).

Schließe wie bei jeder Websuche mit den Quellen ab (Titel + Link), damit
im Vertriebsgespräch bei Bedarf nachvollzogen werden kann, worauf eine
Aussage beruht.

### 5. Immer zusätzlich als PDF ausgeben

Gib das fertige Infosheet **immer zusätzlich als PDF-Datei** aus, nicht
nur als Text im Chat — Vertriebler:innen sollen es direkt weiterreichen
oder ablegen können, ohne selbst etwas nachzubauen.

**In dieser Umgebung (Claude Code mit Datei-/Terminalzugriff auf dieses
Repo):** Nutze exakt das Layout der App, indem du die echte
`buildInfosheetPdf(d, sheet)`-Funktion aus `js/app.js` wiederverwendest,
statt das PDF neu zu bauen — sonst driften Skill-Ausgabe und App-Export
optisch auseinander. Dafür liegt in diesem Skill-Ordner ein fertiges,
eigenständiges Skript: `scripts/generate_infosheet_pdf.js`. Es startet
selbstständig einen temporären lokalen Server im Repo-Root, lädt
`index.html` per Headless-Browser (Playwright), ruft dort
`buildInfosheetPdf(d, sheet)` für die gegebene Doctor-ID auf und schreibt
das Ergebnis als PDF-Datei:

```
node skills/medipulse-infosheet/scripts/generate_infosheet_pdf.js <doctorId> <outputPath> <sheetJsonPath>
```

- `<doctorId>`: numerische ID aus `data/aerzte-teil*.json.gz` (Praxis über
  Name/Stadt in den Rohdaten identifizieren, siehe Schritt 1 oben).
- `<sheetJsonPath>`: JSON-Datei mit den sechs recherchierten Feldern
  (`trigger`, `verkauft`, `firmografie`, `struktur`, `produkt`,
  `aufhaenger` als Array), plus `createdBy`/`createdAt`/`updatedAt`.

Danach die erzeugte PDF-Datei an die Person senden, die die Recherche
angefragt hat.

**In einer reinen claude.ai-Skill-Umgebung ohne Repo-Zugriff** (z.B. wenn
ein:e Kolleg:in den Skill über den Team-Account nutzt): Erzeuge das PDF
stattdessen über die verfügbare Code-Ausführung mit einer PDF-Bibliothek
(z.B. reportlab/fpdf2 in Python) und bilde das Layout der App möglichst
nah nach: blaues Kopfband mit "MEDIPULSE" / "INFOSHEET", Titel + Status,
Steckbrief-Block, dann die sechs Felder in derselben Reihenfolge, Fußzeile
mit Erstellungsdatum. Es muss keine Pixel-genaue Kopie sein, aber
erkennbar demselben Corporate Design folgen.

### 6. Immer zusätzlich eine .txt-Datei mit demselben Text ausgeben

Speichere den kompletten Ausgabetext aus Schritt 4 (die sechs Blöcke,
also von `**Trigger:**` bis zum Ende von `**Der Aufhänger:**`, wahlweise
mit den Quellen darunter) zusätzlich unverändert als `.txt`-Datei und
sende sie zusammen mit der PDF. Die App hat in der Infothek/im
Infosheet-Editor ein Datei-Upload-Feld, das genau dieses Format erkennt
(dieselben `**Feldname:**`-Überschriften wie im Ausgabeformat oben) und
die Felder daraus automatisch befüllt — dafür muss die Textdatei exakt
diese Überschriften unverändert enthalten, keine zusammengefasste oder
umformulierte Version.

Dateiname z.B. `Infosheet_<Praxisname>.txt` (gleiches Namensschema wie
die PDF, nur mit `.txt`-Endung).

## Beispiel

**Eingabe:** "Recherchier mir mal die MVZ am Bruderwald in Bamberg,
Laboratoriumsmedizin, für ein Infosheet."

**Ausgabe (gekürzt):**

```
**Trigger:**
Zum 01.01.2025 wurde im EBM die Mindestquote für den Basislabor-Anteil
von 89 % auf 85 % abgesenkt — eine spürbare Kürzung der garantierten
Vergütung für Labore und ihre Zuweiser-Praxen.

**Was die Praxis verkauft:**
Institut für Labordiagnostik, Mikrobiologie und Transfusionsmedizin, das
sowohl das Klinikum der Sozialstiftung Bamberg als auch die
angeschlossenen MVZ-Praxen mit Laborleistungen und Blutprodukten versorgt.

**Firmografie:**
MVZ am Bruderwald gGmbH, Buger Straße 80, 96049 Bamberg. Tel. 0951
700-36212, E-Mail mvz-labor@sozialstiftung-bamberg.de. Teil der
Sozialstiftung Bamberg.

**Struktur:**
Eingebettet ins Ärztliche Praxiszentrum am Bruderwald mit breitem
Fachspektrum unter einem Dach (Chirurgie, Dermatologie, Gefäßmedizin, HNO,
Gynäkologie, Zahnmedizin u.a.), dazu das eigene Institut für
Labordiagnostik als zentrale Versorgungseinheit.

**Produkt:**
Laborleistungen und Blutprodukte für Klinikum und angeschlossene Praxen
im MVZ-Verbund.

**Der Aufhänger:**
1. Die Absenkung der Basislabor-Mindestquote auf 85 % trifft die
   Vergütung direkt — vermutlich zeigt sich das zuerst in den
   Sammelabrechnungen mit den Zuweiser-Praxen.
2. Als Teil eines großen Praxiszentrums mit vielen Fachrichtungen unter
   einem Dach vermuten wir, dass Laborkosten und Zuweiserstruktur heute
   nicht getrennt je Fachbereich ausgewertet werden.

Quellen: [...]
```

Das ist die Zielqualität — konkret, mit echten Fakten aus der Websuche
belegt, nichts Erfundenes, direkt einsatzbereit für die App.
