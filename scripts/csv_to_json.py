import csv
import gzip
import json
import sys

def load_part(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        return list(reader)

def clean(s):
    return (s or "").strip()

# Bucketet die ~70 unterschiedlichen "fachrichtung"-Werte aus der AOK-Liste in
# die Kategorien, für die es eigene Pin-Icons/Filter gibt (siehe js/app.js
# KATEGORIE_COLORS/KATEGORIE_LABELS). ist_mvz übersteuert das Fachgebiet: eine
# MVZ-Praxis wird immer als "mvz" kategorisiert (unabhängig vom Fachgebiet),
# da das für den Vertrieb die relevantere Unterscheidung ist. Der eigentliche
# Fachrichtungs-Text bleibt trotzdem unverändert im Feld "fachrichtung"
# erhalten und wird z.B. im Popup weiter angezeigt.
FACHGEBIET_MAP = {
    "Hausarzt": "hausarzt",
    "Allgemeinmedizin": "hausarzt",
    "Praktischer Arzt/Praktische Ärztin, Arzt/Ärztin": "hausarzt",

    "Innere Medizin": "innere",
    "Innere Medizin und Kardiologie": "innere",
    "Innere Medizin und Nephrologie": "innere",
    "Innere Medizin und Gastroenterologie": "innere",
    "Innere Medizin und Hämatologie und Onkologie": "innere",
    "Innere Medizin und Pneumologie": "innere",
    "Innere Medizin und Rheumatologie": "innere",
    "Innere Medizin und Endokrinologie und Diabetologie": "innere",
    "Innere Medizin und Angiologie": "innere",
    "Innere Medizin und Geriatrie": "innere",

    "Allgemeinchirurgie": "chirurgie",
    "Plastische, Rekonstruktive und Ästhetische Chirurgie": "chirurgie",
    "Plastische Chirurgie": "chirurgie",
    "Gefäßchirurgie": "chirurgie",
    "Bauchchirurgie (Viszeralchirurgie)": "chirurgie",
    "Herzchirurgie": "chirurgie",
    "Brustkorb-Chirurgie (Thoraxchirurgie)": "chirurgie",
    "Kinderchirurgie": "chirurgie",

    "Orthopädie und Unfallchirurgie": "orthopaedie",
    "Orthopädie": "orthopaedie",

    "Psychologischer Psychotherapeut/Psychotherapeutin": "psychotherapie",
    "Kinder- und Jugendlichenpsychotherapeut/-in": "psychotherapie",
    "Psychiatrie und Psychotherapie": "psychotherapie",
    "Psychosomatische Medizin und Psychotherapie": "psychotherapie",
    "Kinder-/Jugendpsychiatrie und -psychotherapie": "psychotherapie",
    "Psychotherapeutische Medizin": "psychotherapie",
    "Fachpsychotherapeut/in": "psychotherapie",

    "Zahnmedizin": "zahnmedizin",
    "Kieferorthopädie": "zahnmedizin",
    "Oralchirurgie": "zahnmedizin",
    "Mund-Kiefer-Gesichtschirurgie": "zahnmedizin",
    "Parodontologie": "zahnmedizin",

    "Frauenheilkunde und Geburtshilfe": "frauenheilkunde",

    "Kinderheilkunde / Kinder- und Jugendmedizin": "kinderheilkunde",

    "Augenheilkunde": "augenheilkunde",

    "Hals-Nasen-Ohrenheilkunde": "hno",
    "Phoniatrie und Pädaudiologie": "hno",

    "Haut- und Geschlechtskrankheiten": "hautarzt",

    "Urologie": "urologie",

    "Radiologie": "radiologie",
    "Nuklearmedizin": "radiologie",
    "Strahlentherapie": "radiologie",

    "Laboratoriumsmedizin": "labor",
    "Humangenetik": "labor",
    "Transfusionsmedizin": "labor",
    "Mikrobiologie, Virologie und Infektionsepidemiologie": "labor",
    "Pathologie": "labor",
    "Neuropathologie": "labor",
    "Biochemie": "labor",
    "Physiologie": "labor",
    "Pharmakologie und Toxikologie": "labor",
    "Pharmakologie, Klinische": "labor",
    "Anatomie": "labor",
    "Rechtsmedizin": "labor",

    "Neurologie": "neurologie",
    "Neurochirurgie": "neurologie",
    "Nervenheilkunde": "neurologie",
    "Neurologie und Psychiatrie": "neurologie",
}

def kategorisiere(fachrichtung, ist_mvz):
    if ist_mvz:
        return "mvz"
    return FACHGEBIET_MAP.get(fachrichtung, "sonstige")

def convert(rows):
    out = []
    skipped_no_geo = 0
    seen_ids = set()
    dupes = 0
    for r in rows:
        lat = clean(r.get("lat"))
        lon = clean(r.get("lon"))
        if not lat or not lon:
            skipped_no_geo += 1
            continue
        rid = clean(r.get("id"))
        if rid in seen_ids:
            dupes += 1
            continue
        seen_ids.add(rid)

        strasse = clean(r.get("street"))
        addition = clean(r.get("streetAddition"))
        if addition:
            strasse = f"{strasse}, {addition}"

        kette = clean(r.get("kette"))
        konzern = clean(r.get("konzern"))
        ist_mvz = clean(r.get("ist_mvz")).upper() == "TRUE"
        fachrichtung = clean(r.get("fachrichtung")) or clean(r.get("subjectArea"))
        notiz_parts = []
        if kette:
            notiz_parts.append(f"Teil von {kette}" + (f" ({konzern})" if konzern and konzern != kette else ""))
        if ist_mvz:
            notiz_parts.append("MVZ")

        out.append({
            "id": int(rid) if rid.isdigit() else rid,
            "name": clean(r.get("name")),
            "fachrichtung": fachrichtung,
            "kategorie": kategorisiere(fachrichtung, ist_mvz),
            "einrichtung": clean(r.get("cooperation")),
            "strasse": strasse,
            "plz": clean(r.get("zip")),
            "stadt": clean(r.get("city")),
            "land": "Deutschland",
            "lat": round(float(lat), 6),
            "lng": round(float(lon), 6),
            "telefon": clean(r.get("phone")),
            "website": clean(r.get("website")),
            "kette": kette,
            "status": "lead",
            "ansprechpartner": clean(r.get("name")),
            "email": "",
            "notizen": " · ".join(notiz_parts),
            "_src": r.get("_src", 0),
        })
    return out, skipped_no_geo, dupes

def compute_groesse(records):
    # Die AOK-Liste hat kein Feld "Anzahl Ärzte pro Praxis". Näherung: alle
    # Ärzte-Zeilen mit derselben Einrichtung + Adresse zählen als eine Praxis;
    # deren Team-Größe = Anzahl solcher Zeilen. Muss über ALLE Teile hinweg
    # gerechnet werden (nicht pro Datei), sonst werden Praxen unterzählt,
    # deren Ärzte über mehrere CSV-Teile verteilt sind.
    from collections import Counter
    def key_of(rec):
        return (rec["einrichtung"].strip().lower(), rec["plz"], rec["strasse"].strip().lower())
    counts = Counter(key_of(rec) for rec in records if rec["einrichtung"])
    for rec in records:
        k = key_of(rec)
        rec["groesse"] = counts[k] if rec["einrichtung"] else 1

def run_multi(pairs):
    # python3 csv_to_json.py teil1.csv=out1.json.gz teil2.csv=out2.json.gz ...
    # Team-Größe (siehe compute_groesse) wird ÜBER ALLE angegebenen Dateien
    # hinweg berechnet, jede Datei aber weiterhin in ihre eigene Ausgabedatei
    # geschrieben (gleiche Aufteilung wie die Eingabe-CSVs).
    all_rows = []
    for i, pair in enumerate(pairs):
        csv_path, _ = pair.split("=", 1)
        rows = load_part(csv_path)
        for r in rows:
            r["_src"] = i
        all_rows.extend(rows)
        print(f"loaded {len(rows)} raw rows from {csv_path}")

    data, skipped, dupes = convert(all_rows)
    compute_groesse(data)
    print(f"converted: {len(data)} kept, {skipped} skipped (no lat/lon), {dupes} duplicate ids")

    by_src = {}
    for rec in data:
        by_src.setdefault(rec.pop("_src"), []).append(rec)

    for i, pair in enumerate(pairs):
        _, out_path = pair.split("=", 1)
        subset = by_src.get(i, [])
        payload = json.dumps(subset, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        with gzip.open(out_path, "wb", compresslevel=9) as f:
            f.write(payload)
        print("wrote", out_path, "-", len(subset), "records")

def run_single(in_paths, out_path):
    all_rows = []
    for p in in_paths:
        all_rows.extend(load_part(p))
    print(f"loaded {len(all_rows)} raw rows from {len(in_paths)} file(s)")
    data, skipped, dupes = convert(all_rows)
    compute_groesse(data)
    for rec in data:
        rec.pop("_src", None)
    print(f"converted: {len(data)} kept, {skipped} skipped (no lat/lon), {dupes} duplicate ids")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(out_path, "wb", compresslevel=9) as f:
        f.write(payload)
    print("wrote", out_path)

if __name__ == "__main__":
    args = sys.argv[1:]
    if any("=" in a for a in args):
        run_multi(args)
    else:
        run_single(args[:-1], args[-1])
