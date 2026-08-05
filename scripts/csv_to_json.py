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
        notiz_parts = []
        if kette:
            notiz_parts.append(f"Teil von {kette}" + (f" ({konzern})" if konzern and konzern != kette else ""))
        if clean(r.get("ist_mvz")).upper() == "TRUE":
            notiz_parts.append("MVZ")

        out.append({
            "id": int(rid) if rid.isdigit() else rid,
            "name": clean(r.get("name")),
            "fachrichtung": clean(r.get("fachrichtung")) or clean(r.get("subjectArea")),
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
        })
    return out, skipped_no_geo, dupes

if __name__ == "__main__":
    in_paths = sys.argv[1:-1]
    out_path = sys.argv[-1]
    all_rows = []
    for p in in_paths:
        all_rows.extend(load_part(p))
    print(f"loaded {len(all_rows)} raw rows from {len(in_paths)} file(s)")
    data, skipped, dupes = convert(all_rows)
    print(f"converted: {len(data)} kept, {skipped} skipped (no lat/lon), {dupes} duplicate ids")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(out_path, "wb", compresslevel=9) as f:
        f.write(payload)
    print("wrote", out_path)
