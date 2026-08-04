/**
 * Ärzte-Datensatz für die Medipulse Interaktive Weltkarte.
 *
 * Dies sind BEISPIELDATEN zur Demonstration. Ersetze das Array unten
 * mit euren echten Ärzte-Daten. Jedes Objekt braucht mindestens:
 *
 *   id          – eindeutige ID (Zahl oder String)
 *   name        – Name der Praxis / des Arztes
 *   fachrichtung– Fachrichtung, z.B. "Kardiologie"
 *   strasse     – Straße + Hausnummer
 *   plz         – Postleitzahl
 *   stadt       – Stadt
 *   land        – Land
 *   lat, lng    – Koordinaten (WGS84, z.B. von Google Maps oder
 *                 https://nominatim.openstreetmap.org kostenlos abrufbar)
 *   status      – "kunde" | "interessent" | "lead" | "inaktiv"
 *   ansprechpartner – Name der Kontaktperson (optional)
 *   telefon     – Telefonnummer (optional)
 *   email       – E-Mail (optional)
 *   notizen     – Freitext für Vertriebsnotizen (optional)
 *
 * Tipp: Wenn ihr eine Excel-/CSV-Liste habt, sag mir Bescheid – ich baue
 * dir einen Import, der die Liste automatisch in dieses Format bringt.
 */

const AERZTE_DATA = [
  { id: 1, name: "Praxis Dr. Hoffmann", fachrichtung: "Allgemeinmedizin", strasse: "Friedrichstraße 12", plz: "10117", stadt: "Berlin", land: "Deutschland", lat: 52.5200, lng: 13.4050, status: "kunde", ansprechpartner: "Dr. Julia Hoffmann", telefon: "+49 30 1234567", email: "kontakt@praxis-hoffmann.de", notizen: "Nutzt Medipulse seit 2023, sehr zufrieden." },
  { id: 2, name: "Herzzentrum Alster", fachrichtung: "Kardiologie", strasse: "Alsterufer 5", plz: "20354", stadt: "Hamburg", land: "Deutschland", lat: 53.5511, lng: 9.9937, status: "kunde", ansprechpartner: "Dr. Markus Petersen", telefon: "+49 40 2345678", email: "info@herzzentrum-alster.de", notizen: "Jahresvertrag, Ansprechpartner sehr reaktionsschnell." },
  { id: 3, name: "Orthopädie am Marienplatz", fachrichtung: "Orthopädie", strasse: "Marienplatz 3", plz: "80331", stadt: "München", land: "Deutschland", lat: 48.1351, lng: 11.5820, status: "interessent", ansprechpartner: "Dr. Stefan Bauer", telefon: "+49 89 3456789", email: "praxis@ortho-marienplatz.de", notizen: "Demo im Q3 geplant." },
  { id: 4, name: "Hautzentrum Rheinufer", fachrichtung: "Dermatologie", strasse: "Rheinuferstraße 21", plz: "50667", stadt: "Köln", land: "Deutschland", lat: 50.9375, lng: 6.9603, status: "lead", ansprechpartner: "Dr. Anna Weber", telefon: "+49 221 4567890", email: "info@hautzentrum-rhein.de", notizen: "Über Messe-Kontakt (MEDICA) generiert." },
  { id: 5, name: "Frauenarztpraxis Westend", fachrichtung: "Gynäkologie", strasse: "Bockenheimer Landstr. 44", plz: "60323", stadt: "Frankfurt am Main", land: "Deutschland", lat: 50.1109, lng: 8.6821, status: "kunde", ansprechpartner: "Dr. Sabine Klein", telefon: "+49 69 5678901", email: "team@frauenarzt-westend.de", notizen: "Zwei Standorte, beide aktiv." },
  { id: 6, name: "Chirurgie Zentrum Stuttgart", fachrichtung: "Chirurgie", strasse: "Königstraße 8", plz: "70173", stadt: "Stuttgart", land: "Deutschland", lat: 48.7758, lng: 9.1829, status: "interessent", ansprechpartner: "Dr. Thomas Fischer", telefon: "+49 711 6789012", email: "info@chirurgie-stuttgart.de", notizen: "Wartet auf Freigabe durch Klinikleitung." },
  { id: 7, name: "Radiologie Praxis Düsseldorf", fachrichtung: "Radiologie", strasse: "Königsallee 60", plz: "40212", stadt: "Düsseldorf", land: "Deutschland", lat: 51.2277, lng: 6.7735, status: "lead", ansprechpartner: "Dr. Nina Schröder", telefon: "+49 211 7890123", email: "kontakt@radiologie-duesseldorf.de", notizen: "Erstkontakt per E-Mail letzte Woche." },
  { id: 8, name: "Neurologie Leipzig City", fachrichtung: "Neurologie", strasse: "Grimmaische Straße 10", plz: "04109", stadt: "Leipzig", land: "Deutschland", lat: 51.3397, lng: 12.3731, status: "kunde", ansprechpartner: "Dr. Michael Wolf", telefon: "+49 341 8901234", email: "info@neurologie-leipzig.de", notizen: "Verlängerung läuft Ende des Jahres." },
  { id: 9, name: "Zahnarztpraxis Dortmund Mitte", fachrichtung: "Zahnmedizin", strasse: "Westenhellweg 55", plz: "44137", stadt: "Dortmund", land: "Deutschland", lat: 51.5136, lng: 7.4653, status: "interessent", ansprechpartner: "Dr. Laura Krüger", telefon: "+49 231 9012345", email: "praxis@zahn-dortmund.de", notizen: "" },
  { id: 10, name: "Augenzentrum Essen", fachrichtung: "Augenheilkunde", strasse: "Kettwiger Straße 30", plz: "45127", stadt: "Essen", land: "Deutschland", lat: 51.4556, lng: 7.0116, status: "lead", ansprechpartner: "Dr. Peter Zimmermann", telefon: "+49 201 0123456", email: "info@augenzentrum-essen.de", notizen: "" },
  { id: 11, name: "Kinderarztpraxis Bremen", fachrichtung: "Pädiatrie", strasse: "Sögestraße 15", plz: "28195", stadt: "Bremen", land: "Deutschland", lat: 53.0793, lng: 8.8017, status: "kunde", ansprechpartner: "Dr. Katrin Neumann", telefon: "+49 421 1234098", email: "team@kinderarzt-bremen.de", notizen: "" },
  { id: 12, name: "Innere Medizin Dresden", fachrichtung: "Innere Medizin", strasse: "Prager Straße 2", plz: "01069", stadt: "Dresden", land: "Deutschland", lat: 51.0504, lng: 13.7373, status: "inaktiv", ansprechpartner: "Dr. Frank Richter", telefon: "+49 351 2345098", email: "info@innere-dresden.de", notizen: "Vertrag ausgelaufen, kein Interesse an Verlängerung." },
  { id: 13, name: "HNO Praxis Hannover", fachrichtung: "HNO", strasse: "Georgstraße 18", plz: "30159", stadt: "Hannover", land: "Deutschland", lat: 52.3759, lng: 9.7320, status: "interessent", ansprechpartner: "Dr. Christine Lange", telefon: "+49 511 3456098", email: "praxis@hno-hannover.de", notizen: "" },
  { id: 14, name: "Urologie Nürnberg", fachrichtung: "Urologie", strasse: "Königstraße 40", plz: "90402", stadt: "Nürnberg", land: "Deutschland", lat: 49.4521, lng: 11.0767, status: "kunde", ansprechpartner: "Dr. Andreas Schmid", telefon: "+49 911 4567098", email: "info@urologie-nuernberg.de", notizen: "" },
  { id: 15, name: "Psychiatrie Zentrum Duisburg", fachrichtung: "Psychiatrie", strasse: "Königstraße 25", plz: "47051", stadt: "Duisburg", land: "Deutschland", lat: 51.4344, lng: 6.7623, status: "lead", ansprechpartner: "Dr. Sophie Braun", telefon: "+49 203 5678098", email: "kontakt@psych-duisburg.de", notizen: "" },
  { id: 16, name: "Allgemeinmedizin Bochum", fachrichtung: "Allgemeinmedizin", strasse: "Kortumstraße 90", plz: "44787", stadt: "Bochum", land: "Deutschland", lat: 51.4818, lng: 7.2162, status: "interessent", ansprechpartner: "Dr. Jonas Vogel", telefon: "+49 234 6789098", email: "praxis@allgemein-bochum.de", notizen: "" },
  { id: 17, name: "Kardiologie Wuppertal", fachrichtung: "Kardiologie", strasse: "Friedrich-Ebert-Str. 5", plz: "42103", stadt: "Wuppertal", land: "Deutschland", lat: 51.2562, lng: 7.1508, status: "kunde", ansprechpartner: "Dr. Elisabeth Hartmann", telefon: "+49 202 7890098", email: "info@kardio-wuppertal.de", notizen: "" },
  { id: 18, name: "Orthopädie Bielefeld", fachrichtung: "Orthopädie", strasse: "Niedernstraße 12", plz: "33602", stadt: "Bielefeld", land: "Deutschland", lat: 52.0302, lng: 8.5325, status: "lead", ansprechpartner: "Dr. Robert Keller", telefon: "+49 521 8901098", email: "kontakt@ortho-bielefeld.de", notizen: "" },
  { id: 19, name: "Dermatologie Bonn", fachrichtung: "Dermatologie", strasse: "Sternstraße 8", plz: "53111", stadt: "Bonn", land: "Deutschland", lat: 50.7374, lng: 7.0982, status: "kunde", ansprechpartner: "Dr. Martina Huber", telefon: "+49 228 9012098", email: "info@haut-bonn.de", notizen: "" },
  { id: 20, name: "Gynäkologie Münster", fachrichtung: "Gynäkologie", strasse: "Prinzipalmarkt 4", plz: "48143", stadt: "Münster", land: "Deutschland", lat: 51.9607, lng: 7.6261, status: "interessent", ansprechpartner: "Dr. Verena Winter", telefon: "+49 251 0123098", email: "praxis@gyn-muenster.de", notizen: "" },
  { id: 21, name: "Chirurgie Mannheim", fachrichtung: "Chirurgie", strasse: "Planken 22", plz: "68161", stadt: "Mannheim", land: "Deutschland", lat: 49.4875, lng: 8.4660, status: "kunde", ansprechpartner: "Dr. Daniel Schuster", telefon: "+49 621 1230987", email: "info@chirurgie-mannheim.de", notizen: "" },
  { id: 22, name: "Augenarzt Augsburg", fachrichtung: "Augenheilkunde", strasse: "Maximilianstraße 30", plz: "86150", stadt: "Augsburg", land: "Deutschland", lat: 48.3705, lng: 10.8978, status: "lead", ansprechpartner: "Dr. Carolin Berger", telefon: "+49 821 2341098", email: "kontakt@auge-augsburg.de", notizen: "" },
  { id: 23, name: "Praxisklinik Freiburg", fachrichtung: "Innere Medizin", strasse: "Kaiser-Joseph-Str. 10", plz: "79098", stadt: "Freiburg im Breisgau", land: "Deutschland", lat: 47.9990, lng: 7.8421, status: "kunde", ansprechpartner: "Dr. Felix Maurer", telefon: "+49 761 3452098", email: "info@praxisklinik-freiburg.de", notizen: "" },
  { id: 24, name: "Kardiologie Wien Zentrum", fachrichtung: "Kardiologie", strasse: "Kärntner Straße 15", plz: "1010", stadt: "Wien", land: "Österreich", lat: 48.2082, lng: 16.3738, status: "interessent", ansprechpartner: "Dr. Lukas Gruber", telefon: "+43 1 2345678", email: "info@kardio-wien.at", notizen: "Erste Expansion außerhalb DE." },
  { id: 25, name: "Orthopädie Zürich", fachrichtung: "Orthopädie", strasse: "Bahnhofstrasse 20", plz: "8001", stadt: "Zürich", land: "Schweiz", lat: 47.3769, lng: 8.5417, status: "lead", ansprechpartner: "Dr. Nadine Frei", telefon: "+41 44 1234567", email: "praxis@ortho-zuerich.ch", notizen: "" },
];
