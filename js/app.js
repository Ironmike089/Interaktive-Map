/**
 * Medipulse Interaktive Weltkarte
 * Basiert auf MapLibre GL JS (Open Source) + OpenFreeMap Kartendaten
 * (freie Vektor-Kacheln auf Basis von OpenStreetMap, kein API-Key nötig).
 */

const STATUS_COLORS = {
  kunde: "#2ecc71",
  interessent: "#f5a623",
  lead: "#4f8cff",
  inaktiv: "#6b7893",
};

const STATUS_LABELS = {
  kunde: "Kunde",
  interessent: "Interessent",
  lead: "Lead",
  inaktiv: "Inaktiv",
};

// Fachrichtung/MVZ-Kategorie — bestimmt Pin-Farbe auf der Karte und ist die
// zweite, unabhängige Filter-Dimension neben dem Status (siehe
// scripts/csv_to_json.py für die Zuordnung der rohen AOK-Fachrichtungen).
const KATEGORIE_COLORS = {
  mvz: "#1d4ed8",
  hausarzt: "#0d9488",
  innere: "#dc2626",
  chirurgie: "#16a34a",
  orthopaedie: "#7c3aed",
  psychotherapie: "#ea580c",
  zahnmedizin: "#0891b2",
  frauenheilkunde: "#db2777",
  kinderheilkunde: "#ca8a04",
  augenheilkunde: "#4338ca",
  hno: "#0e7490",
  hautarzt: "#92400e",
  urologie: "#65a30d",
  radiologie: "#1e3a8a",
  labor: "#a21caf",
  neurologie: "#6d28d9",
  sonstige: "#64748b",
};
const KATEGORIE_LABELS = {
  mvz: "MVZ",
  hausarzt: "Hausarzt",
  innere: "Innere Medizin",
  chirurgie: "Chirurgie",
  orthopaedie: "Orthopädie",
  psychotherapie: "Psychotherapie",
  zahnmedizin: "Zahnmedizin",
  frauenheilkunde: "Frauenheilkunde",
  kinderheilkunde: "Kinderheilkunde",
  augenheilkunde: "Augenheilkunde",
  hno: "HNO",
  hautarzt: "Hautarzt",
  urologie: "Urologie",
  radiologie: "Radiologie",
  labor: "Labor",
  neurologie: "Neurologie",
  sonstige: "Sonstige",
};
const KATEGORIE_KEYS = Object.keys(KATEGORIE_LABELS);

const BUNDESLAND_LIST = [
  "Baden-Württemberg",
  "Bayern",
  "Berlin",
  "Brandenburg",
  "Bremen",
  "Hamburg",
  "Hessen",
  "Mecklenburg-Vorpommern",
  "Niedersachsen",
  "Nordrhein-Westfalen",
  "Rheinland-Pfalz",
  "Saarland",
  "Sachsen",
  "Sachsen-Anhalt",
  "Schleswig-Holstein",
  "Thüringen",
];

let activeStatuses = new Set(["kunde", "interessent", "lead", "inaktiv"]);
let activeKategorien = new Set(KATEGORIE_KEYS);
let activeBundeslaender = new Set(BUNDESLAND_LIST);
let searchTerm = "";
let autoRotate = true;
let userInteracting = false;
let rotateFrame = null;
let selectedId = null;
let currentPopupDoctor = null;

let gewinnProArzt = Number(localStorage.getItem("medipulse_gpa")) || 50;
let geminiWorkerUrl = (localStorage.getItem("medipulse_gemini_worker_url") || "").trim();
let minGroesse = 0;
let maxGroesseInData = 1;

let AERZTE_DATA = [];
const MAX_LIST_ITEMS = 300;

// Der Status (kunde/interessent/lead/inaktiv) kommt ursprünglich aus den
// statischen AOK-Rohdaten und lässt sich dort nicht ändern. Manuelle
// Statusänderungen (aktuell nur "zum Kunden machen") werden separat in
// localStorage abgelegt und beim Laden direkt auf die Datensätze
// angewendet — so funktionieren Filter, Zähler, PDF-Export usw. unverändert
// weiter, ohne dass jede Stelle den Override extra nachschlagen muss.
function getStatusOverrides() {
  try {
    return JSON.parse(localStorage.getItem("medipulse_status_overrides") || "{}");
  } catch {
    return {};
  }
}
function saveStatusOverrides(overrides) {
  localStorage.setItem("medipulse_status_overrides", JSON.stringify(overrides));
}
function applyStatusOverrides(data) {
  const overrides = getStatusOverrides();
  data.forEach((d) => {
    const ov = overrides[d.id];
    if (!ov) return;
    // Ältere Overrides wurden als reiner String ("kunde") gespeichert, bevor
    // "Kein Kunde mehr" dazukam — beide Formen bleiben lesbar.
    d.status = typeof ov === "string" ? ov : ov.status;
  });
}
function markDoctorAsKunde(d) {
  if (d.status === "kunde") return;
  const overrides = getStatusOverrides();
  overrides[d.id] = { status: "kunde", revertTo: d.status };
  saveStatusOverrides(overrides);
  d.status = "kunde";
  bumpStat("kunden", 1);
  updateStats();
  renderList();
  refreshPopupFor(d.id);
}
function unmarkDoctorAsKunde(d) {
  if (d.status !== "kunde") return;
  const overrides = getStatusOverrides();
  const prev = overrides[d.id];
  const revertTo = (prev && typeof prev === "object" && prev.revertTo) || "interessent";
  overrides[d.id] = { status: revertTo };
  saveStatusOverrides(overrides);
  d.status = revertTo;
  bumpStat("kunden", -1);
  updateStats();
  renderList();
  refreshPopupFor(d.id);
}

// Die E-Mail-Adresse kommt normalerweise aus den AOK-Rohdaten und fehlt dort
// bei vielen Praxen. Damit man sie trotzdem für die Erstansprache/Follow-up
// nutzen kann, lässt sie sich manuell nachtragen — genau wie beim Status
// separat in localStorage abgelegt (überschreibt/ergänzt nie die Rohdaten
// selbst) und beim Laden auf die Datensätze angewendet.
function getEmailOverrides() {
  try {
    return JSON.parse(localStorage.getItem("medipulse_email_overrides") || "{}");
  } catch {
    return {};
  }
}
function saveEmailOverrides(overrides) {
  localStorage.setItem("medipulse_email_overrides", JSON.stringify(overrides));
}
function applyEmailOverrides(data) {
  const overrides = getEmailOverrides();
  data.forEach((d) => {
    d.emailOriginal = d.email || "";
    if (overrides[d.id]) d.email = overrides[d.id];
  });
}
function setDoctorEmail(d, email) {
  const overrides = getEmailOverrides();
  const trimmed = email.trim();
  if (trimmed) {
    overrides[d.id] = trimmed;
    d.email = trimmed;
  } else {
    delete overrides[d.id];
    d.email = d.emailOriginal || "";
  }
  saveEmailOverrides(overrides);
  renderList();
  refreshPopupFor(d.id);
}

// Echte Ärzte-Daten liegen gzip-komprimiert unter data/aerzte-teil*.json.gz
// (siehe scripts/csv_to_json.py). Fehlende Teile (noch nicht geliefert) werden
// stillschweigend übersprungen; ohne jeden Teil greift die Beispiel-Liste aus
// js/data.js.
const DATA_PARTS = ["data/aerzte-teil1.json.gz", "data/aerzte-teil2.json.gz", "data/aerzte-teil3.json.gz"];

async function fetchGzipJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

async function loadAerzteData() {
  const results = await Promise.allSettled(DATA_PARTS.map(fetchGzipJSON));
  const merged = [];
  const seen = new Set();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      console.info(`Kein Datensatz unter ${DATA_PARTS[i]} gefunden (noch nicht geliefert?).`);
      return;
    }
    for (const d of r.value) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      merged.push(d);
    }
  });
  if (merged.length === 0 && typeof SAMPLE_AERZTE_DATA !== "undefined") {
    console.info("Keine echten Ärztedaten gefunden — nutze Beispieldaten.");
    return SAMPLE_AERZTE_DATA.map((d) => ({ ...d, kategorie: d.kategorie || guessKategorie(d.fachrichtung) }));
  }
  return merged;
}

// Grobe Fachrichtung->Kategorie-Zuordnung nur für die Beispieldaten (die
// echten AOK-Daten bringen "kategorie" bereits fertig aus scripts/csv_to_json.py mit).
function guessKategorie(fachrichtung) {
  const map = {
    "Allgemeinmedizin": "hausarzt",
    "Innere Medizin": "innere",
    "Kardiologie": "innere",
    "Chirurgie": "chirurgie",
    "Orthopädie": "orthopaedie",
    "Psychiatrie": "psychotherapie",
    "Zahnmedizin": "zahnmedizin",
    "Gynäkologie": "frauenheilkunde",
    "Pädiatrie": "kinderheilkunde",
    "Augenheilkunde": "augenheilkunde",
    "HNO": "hno",
    "Dermatologie": "hautarzt",
    "Urologie": "urologie",
    "Radiologie": "radiologie",
    "Neurologie": "neurologie",
  };
  return map[fachrichtung] || "sonstige";
}

function toGeoJSON(data) {
  return {
    type: "FeatureCollection",
    features: data.map((d) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [d.lng, d.lat] },
      properties: { ...d },
    })),
  };
}

function getFilteredData() {
  const term = searchTerm.trim().toLowerCase();
  return AERZTE_DATA.filter((d) => {
    if (!activeStatuses.has(d.status)) return false;
    if (!activeKategorien.has(d.kategorie || "sonstige")) return false;
    if (d.bundesland && !activeBundeslaender.has(d.bundesland)) return false;
    if ((d.groesse || 1) < minGroesse) return false;
    if (!term) return true;
    return (
      d.name.toLowerCase().includes(term) ||
      d.stadt.toLowerCase().includes(term) ||
      d.fachrichtung.toLowerCase().includes(term) ||
      (d.land || "").toLowerCase().includes(term)
    );
  });
}

// Start zentriert auf Deutschland (die Ärzte-Daten sind aktuell fast
// ausschließlich dort) statt einer Weltraum-Ansicht — die lässt sich per
// GlobeControl/Herauszoomen trotzdem jederzeit erreichen.
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [10.45, 51.16],
  zoom: 5.4,
  pitch: 0,
  attributionControl: { compact: true },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.FullscreenControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
if (typeof maplibregl.GlobeControl === "function") {
  map.addControl(new maplibregl.GlobeControl(), "top-right");
}

// Zwei-Finger-Geste soll NUR zoomen, nicht gleichzeitig drehen — sonst
// fühlt sich Pinch-Zoom auf Touch-Geräten "kaputt"/unvorhersehbar an.
if (map.touchZoomRotate && typeof map.touchZoomRotate.disableRotation === "function") {
  map.touchZoomRotate.disableRotation();
}

let popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "300px" });

let mapReady = false;
let dataReady = false;

function maybeInit() {
  if (mapReady && dataReady) setupMapLayers();
}

setLoadingState(true);
loadAerzteData().then((data) => {
  applyStatusOverrides(data);
  applyEmailOverrides(data);
  AERZTE_DATA = data;
  dataReady = true;
  maxGroesseInData = data.reduce((max, d) => Math.max(max, d.groesse || 1), 1);
  setLoadingState(false);
  // Liste/Statistik sofort anzeigen, unabhängig davon ob die Kartenkacheln
  // (externe Netzwerkabfrage) schon geladen sind.
  renderList();
  updateStats();
  updateNotificationBell();
  maybeInit();
});
setInterval(updateNotificationBell, 5 * 60 * 1000);

map.on("load", () => {
  // Globus-Projektion aktivieren: beim Herauszoomen erscheint eine Weltkugel,
  // beim Hineinzoomen geht sie fließend in eine flache Karte über.
  if (typeof map.setProjection === "function") {
    map.setProjection({ type: "globe" });
  }

  // Sternenhimmel / Atmosphäre für den Weltraum-Look, falls unterstützt.
  if (typeof map.setSky === "function") {
    try {
      map.setSky({
        "sky-color": "#0b1120",
        "sky-horizon-blend": 0.5,
        "horizon-color": "#16213a",
        "horizon-fog-blend": 0.5,
        "fog-color": "#0b1120",
        "fog-ground-blend": 0.5,
      });
    } catch (e) {
      /* ältere MapLibre-Version ohne setSky – kein Problem */
    }
  }

  mapReady = true;
  maybeInit();
});

function setLoadingState(loading) {
  const search = document.getElementById("search");
  const list = document.getElementById("doctor-list");
  const checkboxes = document.querySelectorAll('.filters input[type="checkbox"]');
  search.disabled = loading;
  checkboxes.forEach((cb) => (cb.disabled = loading));
  if (loading) {
    search.placeholder = "Lade Ärztedaten …";
    list.innerHTML = `<li class="doctor-list-hint">Ärztedaten werden geladen …</li>`;
  } else {
    search.placeholder = "Suche nach Name, Stadt, Fachrichtung…";
  }
}

function renderKategorieFilters() {
  const container = document.getElementById("kategorie-list");
  container.innerHTML = KATEGORIE_KEYS.map((key) => `
    <label class="kategorie-chip" style="border-color: color-mix(in srgb, ${KATEGORIE_COLORS[key]} 55%, var(--border))">
      <input type="checkbox" data-kategorie="${key}" checked>
      <span class="dot" style="background:${KATEGORIE_COLORS[key]}"></span>
      ${escapeHtml(KATEGORIE_LABELS[key])}
    </label>
  `).join("");
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const key = cb.dataset.kategorie;
      if (cb.checked) activeKategorien.add(key);
      else activeKategorien.delete(key);
      applyFilters();
    });
  });
}
renderKategorieFilters();

document.getElementById("kategorie-all").addEventListener("click", () => {
  activeKategorien = new Set(KATEGORIE_KEYS);
  document.querySelectorAll('#kategorie-list input[type="checkbox"]').forEach((cb) => (cb.checked = true));
  applyFilters();
});
document.getElementById("kategorie-none").addEventListener("click", () => {
  activeKategorien = new Set();
  document.querySelectorAll('#kategorie-list input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  applyFilters();
});

function renderBundeslandFilters() {
  const container = document.getElementById("bundesland-list");
  container.innerHTML = BUNDESLAND_LIST.map((name) => `
    <label class="kategorie-chip">
      <input type="checkbox" data-bundesland="${escapeHtml(name)}" checked>
      ${escapeHtml(name)}
    </label>
  `).join("");
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const name = cb.dataset.bundesland;
      if (cb.checked) activeBundeslaender.add(name);
      else activeBundeslaender.delete(name);
      applyFilters();
    });
  });
}
renderBundeslandFilters();

document.getElementById("bundesland-all").addEventListener("click", () => {
  activeBundeslaender = new Set(BUNDESLAND_LIST);
  document.querySelectorAll('#bundesland-list input[type="checkbox"]').forEach((cb) => (cb.checked = true));
  applyFilters();
});
document.getElementById("bundesland-none").addEventListener("click", () => {
  activeBundeslaender = new Set();
  document.querySelectorAll('#bundesland-list input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  applyFilters();
});

// Zeichnet je Kategorie ein kleines, wiedererkennbares Symbol (angelehnt an
// die Icon-Vorlage) in Weiß auf die Pin-Form. Bewusst einfache Formen statt
// Detailgrafik — bei der winzigen Darstellungsgröße auf der Karte zählt vor
// allem die Silhouette.
const KATEGORIE_GLYPHS = {
  mvz(ctx, cx, cy, r) {
    ctx.fillRect(cx - r * 0.55, cy - r * 0.35, r * 1.1, r * 0.95);
    ctx.fillRect(cx - r * 0.12, cy - r * 0.7, r * 0.24, r * 0.24);
    line(ctx, cx - r * 0.55, cy + r * 0.15, cx + r * 0.55, cy + r * 0.15, r * 0.12);
    plus(ctx, cx, cy + r * 0.05, r * 0.28, r * 0.1);
  },
  hausarzt(ctx, cx, cy, r) { plus(ctx, cx, cy, r * 0.6, r * 0.22); },
  innere(ctx, cx, cy, r) { heart(ctx, cx, cy, r * 0.65); },
  chirurgie(ctx, cx, cy, r) {
    line(ctx, cx - r * 0.5, cy + r * 0.5, cx + r * 0.35, cy - r * 0.35, r * 0.12);
    tri(ctx, cx + r * 0.15, cy - r * 0.15, cx + r * 0.55, cy - r * 0.55, cx + r * 0.5, cy - r * 0.05);
  },
  orthopaedie(ctx, cx, cy, r) {
    line(ctx, cx - r * 0.45, cy - r * 0.45, cx + r * 0.45, cy + r * 0.45, r * 0.22);
    circle(ctx, cx - r * 0.5, cy - r * 0.5, r * 0.28);
    circle(ctx, cx + r * 0.5, cy + r * 0.5, r * 0.28);
  },
  psychotherapie(ctx, cx, cy, r) {
    circle(ctx, cx - r * 0.28, cy - r * 0.05, r * 0.42);
    circle(ctx, cx + r * 0.3, cy - r * 0.05, r * 0.42);
    circle(ctx, cx, cy + r * 0.28, r * 0.4);
  },
  zahnmedizin(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 0.15, r * 0.42, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    tri(ctx, cx - r * 0.22, cy + r * 0.1, cx - r * 0.04, cy + r * 0.1, cx - r * 0.12, cy + r * 0.65);
    tri(ctx, cx + r * 0.04, cy + r * 0.1, cx + r * 0.22, cy + r * 0.1, cx + r * 0.12, cy + r * 0.65);
  },
  frauenheilkunde(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.2, r * 0.35, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    line(ctx, cx, cy + r * 0.1, cx, cy + r * 0.7, r * 0.14);
    line(ctx, cx - r * 0.22, cy + r * 0.45, cx + r * 0.22, cy + r * 0.45, r * 0.14);
  },
  kinderheilkunde(ctx, cx, cy, r) {
    circle(ctx, cx - r * 0.42, cy - r * 0.5, r * 0.22);
    circle(ctx, cx + r * 0.42, cy - r * 0.5, r * 0.22);
    circle(ctx, cx, cy + r * 0.05, r * 0.55);
  },
  augenheilkunde(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6, cy);
    ctx.quadraticCurveTo(cx, cy - r * 0.5, cx + r * 0.6, cy);
    ctx.quadraticCurveTo(cx, cy + r * 0.5, cx - r * 0.6, cy);
    ctx.lineWidth = r * 0.14;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    circle(ctx, cx, cy, r * 0.2);
  },
  hno(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, Math.PI * 0.15, Math.PI * 1.55);
    ctx.lineWidth = r * 0.18;
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.stroke();
  },
  hautarzt(ctx, cx, cy, r) { drop(ctx, cx, cy, r * 0.5); },
  urologie(ctx, cx, cy, r) {
    bean(ctx, cx - r * 0.28, cy, r * 0.4);
    bean(ctx, cx + r * 0.28, cy, r * 0.4);
  },
  radiologie(ctx, cx, cy, r) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      circle(ctx, cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, r * 0.22);
    }
    circle(ctx, cx, cy, r * 0.16);
  },
  labor(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.22, cy - r * 0.6);
    ctx.lineTo(cx - r * 0.22, cy + r * 0.3);
    ctx.arc(cx, cy + r * 0.3, r * 0.22, Math.PI, 0, true);
    ctx.lineTo(cx + r * 0.22, cy - r * 0.6);
    ctx.closePath();
    ctx.lineWidth = r * 0.12;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillRect(cx - r * 0.22, cy, r * 0.44, r * 0.32);
  },
  neurologie(ctx, cx, cy, r) {
    circle(ctx, cx, cy, r * 0.2);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      line(ctx, cx, cy, cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, r * 0.08);
    }
  },
  sonstige(ctx, cx, cy, r) {
    [-0.35, 0, 0.35].forEach((dx) => circle(ctx, cx + dx * r, cy, r * 0.12));
  },
};

function line(ctx, x1, y1, x2, y2, w) {
  ctx.lineWidth = w;
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}
function tri(ctx, x1, y1, x2, y2, x3, y3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
}
function plus(ctx, cx, cy, len, w) {
  line(ctx, cx - len, cy, cx + len, cy, w);
  line(ctx, cx, cy - len, cx, cy + len, w);
}
function heart(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.7);
  ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.3, cx - r * 0.4, cy - r * 1.1, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.4, cy - r * 1.1, cx + r * 1.3, cy - r * 0.3, cx, cy + r * 0.7);
  ctx.closePath();
  ctx.fill();
}
function drop(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + r, cy - r * 0.1, cx + r * 0.6, cy + r, cx, cy + r);
  ctx.bezierCurveTo(cx - r * 0.6, cy + r, cx - r, cy - r * 0.1, cx, cy - r);
  ctx.closePath();
  ctx.fill();
}
function bean(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.6, r, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function createCategoryPinIcon(key) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const color = KATEGORIE_COLORS[key] || KATEGORIE_COLORS.sonstige;
  const cx = size / 2, cy = size * 0.36, r = size * 0.26;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(size * 0.28, size * 0.42);
  ctx.lineTo(size * 0.72, size * 0.42);
  ctx.lineTo(size * 0.5, size * 0.92);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.clip();
  (KATEGORIE_GLYPHS[key] || KATEGORIE_GLYPHS.sonstige)(ctx, cx, cy, r);
  ctx.restore();

  return ctx.getImageData(0, 0, size, size);
}

function setupMapLayers() {
  KATEGORIE_KEYS.forEach((key) => {
    map.addImage(`pin-${key}`, createCategoryPinIcon(key));
  });

  map.addSource("aerzte", {
    type: "geojson",
    data: toGeoJSON(getFilteredData()),
    cluster: true,
    clusterMaxZoom: 9,
    clusterRadius: 45,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "aerzte",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#4f8cff",
      "circle-opacity": 0.85,
      "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 15, 26],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#0b1120",
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "aerzte",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
    },
    paint: { "text-color": "#ffffff" },
  });

  // Verbindungslinien zu anderen Standorten derselben Kette (z.B. Helios,
  // Sana) — leer bis eine Praxis mit "kette" ausgewählt wird, siehe
  // updateConnections(). Vor dem eigentlichen Pin-Layer eingefügt, damit die
  // Pins über den Linien/Ringen liegen statt darunter zu verschwinden.
  map.addSource("connections", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "connections-lines",
    type: "line",
    source: "connections",
    layout: { "line-cap": "round" },
    paint: {
      "line-color": "#ffb347",
      "line-width": 1.6,
      "line-opacity": 0.7,
      "line-dasharray": [2, 1.5],
    },
  });
  map.addSource("connections-targets", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "connections-targets-circles",
    type: "circle",
    source: "connections-targets",
    paint: {
      "circle-radius": 12,
      "circle-color": "#ffb347",
      "circle-opacity": 0.22,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffb347",
      "circle-stroke-opacity": 0.9,
    },
  });

  // Heatmap (optional, per Einstellungen umschaltbar). MapLibres eingebauter
  // "heatmap"-Layer-Typ braucht Float-Texturen, die auf manchen WebGL-
  // Implementierungen (u.a. Software-Rendering) gar nicht rendern — deshalb
  // bewusst ein eigenes Dichte-Raster als normaler "circle"-Layer (mit
  // circle-blur für den weichen Rand), der überall zuverlässig funktioniert.
  map.addSource("heatmap-source", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "heatmap-layer",
    type: "circle",
    source: "heatmap-source",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        4, ["interpolate", ["linear"], ["get", "density"], 0, 5, 1, 24],
        9, ["interpolate", ["linear"], ["get", "density"], 0, 12, 1, 60],
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "density"],
        0, "#2ecc71",
        0.5, "#f5d020",
        1, "#e74c3c",
      ],
      "circle-opacity": ["interpolate", ["linear"], ["get", "density"], 0, 0.25, 1, 0.7],
      "circle-blur": 0.7,
    },
  });

  map.addLayer({
    id: "unclustered-point",
    type: "symbol",
    source: "aerzte",
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": [
        "match",
        ["get", "kategorie"],
        ...KATEGORIE_KEYS.flatMap((key) => [key, `pin-${key}`]),
        "pin-sonstige",
      ],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.32, 12, 0.55, 16, 0.75],
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  map.on("click", "clusters", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource("aerzte").getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });
  });

  map.on("click", "unclustered-point", (e) => {
    const feature = e.features[0];
    if (routePlan && routePlan.picking) {
      addRoutePickedDoctor(feature.properties.id);
      return;
    }
    openDoctorPopup(feature.properties, feature.geometry.coordinates.slice());
    selectDoctor(feature.properties.id, false);
  });

  ["clusters", "unclustered-point"].forEach((layer) => {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  });

  startAutoRotate();
}

function refreshSource() {
  const src = map.getSource("aerzte");
  if (src) src.setData(toGeoJSON(getFilteredData()));
}

// --- Verbindungen zwischen Standorten derselben Kette (z.B. Helios, Sana) ---
const EMPTY_FC = { type: "FeatureCollection", features: [] };
const MAX_CONNECTIONS = 80;

function getConnectedDoctors(d) {
  if (!d || !d.kette) return { kette: "", items: [], total: 0 };
  const ownKey = `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
  const seen = new Set([ownKey]);
  const items = [];
  for (const other of AERZTE_DATA) {
    if (other.kette !== d.kette) continue;
    const key = `${other.lat.toFixed(4)},${other.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(other);
  }
  return { kette: d.kette, items: items.slice(0, MAX_CONNECTIONS), total: items.length };
}

function updateConnections(d) {
  const lineSrc = map.getSource("connections");
  const targetSrc = map.getSource("connections-targets");
  if (!lineSrc || !targetSrc) return { total: 0 };
  const { items, total } = getConnectedDoctors(d);
  if (!items.length) {
    lineSrc.setData(EMPTY_FC);
    targetSrc.setData(EMPTY_FC);
    return { total: 0 };
  }
  lineSrc.setData({
    type: "FeatureCollection",
    features: items.map((t) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[d.lng, d.lat], [t.lng, t.lat]] },
      properties: {},
    })),
  });
  targetSrc.setData({
    type: "FeatureCollection",
    features: items.map((t) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [t.lng, t.lat] },
      properties: { id: t.id },
    })),
  });
  return { total, shown: items.length };
}

// Grobe Näherung für die "Praxisgröße": Anzahl Ärzte, die laut Datensatz an
// derselben Einrichtung/Adresse hängen (siehe scripts/csv_to_json.py
// compute_groesse — die AOK-Liste hat kein direktes Feld dafür). Balken läuft
// grün (klein) -> rot (groß) auf einer Log-Skala, weil die meisten Praxen
// 1-5 Ärzte haben und eine lineare Skala das kaum unterscheidbar machen würde.
function sizePercent(n) {
  const maxSize = 60;
  const p = Math.log((n || 1) + 1) / Math.log(maxSize + 1);
  return Math.max(4, Math.min(100, p * 100));
}

// Umkehrung von sizePercent für den Größen-Filter-Regler: aus einem
// Schieberegler-Wert (0-100) wird die Mindest-Praxisgröße, ab der ein Arzt
// noch angezeigt wird — auf derselben Log-Skala wie der Größen-Balken im
// Popup, damit sich der Regler proportional zur tatsächlichen Verteilung
// "anfühlt" statt am unteren Ende (wo die meisten Praxen liegen) zu grob zu sein.
function groesseThresholdFromPercent(pct) {
  if (pct <= 0) return 0;
  const maxSize = Math.max(1, maxGroesseInData);
  return Math.round(Math.exp((pct / 100) * Math.log(maxSize + 1)) - 1);
}

// Umkehrung von groesseThresholdFromPercent, damit sich der Regler
// mitbewegt, wenn die Mindestgröße direkt eingetippt wird.
function groessePercentFromThreshold(n) {
  if (n <= 0) return 0;
  const maxSize = Math.max(1, maxGroesseInData);
  return Math.max(0, Math.min(100, (Math.log(n + 1) / Math.log(maxSize + 1)) * 100));
}

function sizeGaugeHtml(groesse) {
  if (!groesse || groesse < 1) return "";
  const pct = sizePercent(groesse);
  const label = groesse === 1 ? "1 Arzt/Ärztin an diesem Standort" : `${groesse} Ärzte/-innen an diesem Standort`;
  return `
    <div class="popup-row size-row">
      <div class="size-label">${escapeHtml(label)}</div>
      <div class="size-bar"><div class="size-arrow" style="left:${pct}%"></div></div>
    </div>`;
}

// Bei bereits gewonnenen Kunden ist "möglicher Umsatz" irreführend — die
// Praxis ist ja schon Kunde, keine Chance mehr, die man verkaufsseitig
// bewerten müsste.
function earningsRowHtml(d) {
  if (d.status === "kunde") return "";
  const groesse = d.groesse || 1;
  const total = groesse * gewinnProArzt;
  return `<div class="popup-row earnings-row">💰 ${total.toLocaleString("de-DE")} € möglicher Umsatz</div>`;
}

// --- Infosheet je Praxis (lokal auf diesem Gerät, geräteweit geteilt —
// im Gegensatz zur Statistik nicht an einen Account gebunden, da die
// Infothek für das ganze Team zur selben Praxis gehören soll). ---
function loadInfosheets() {
  try {
    return JSON.parse(localStorage.getItem("medipulse_infosheets") || "{}");
  } catch {
    return {};
  }
}
function saveInfosheets(sheets) {
  localStorage.setItem("medipulse_infosheets", JSON.stringify(sheets));
}
function getInfosheet(doctorId) {
  return loadInfosheets()[doctorId] || null;
}
function saveInfosheet(doctorId, sheet) {
  const sheets = loadInfosheets();
  sheets[doctorId] = sheet;
  saveInfosheets(sheets);
}
function deleteInfosheet(doctorId) {
  const sheets = loadInfosheets();
  delete sheets[doctorId];
  saveInfosheets(sheets);
}

// "Infosheet erstellen" legt sofort ein Infosheet an (Steckbrief aus den
// AOK-Basisdaten ist damit direkt in der Infothek als PDF vorhanden) statt
// erst ein leeres Formular zu zeigen. Ist eine Gemini-Worker-URL in den
// Einstellungen hinterlegt, wird währenddessen automatisch recherchiert und
// Trigger/Firmografie/Struktur/Produkt/Painpoints gleich mit befüllt; ohne
// URL (oder bei einem Fehler) bleibt es beim Steckbrief-Infosheet — die
// recherchierten Zusatzfelder lassen sich danach jederzeit über
// "Bearbeiten" von Hand ergänzen.
let infosheetResearchPending = null;

// Optionale Dokumente (PDF/Bild) je Praxis, die vor/nach der Recherche
// hochgeladen werden können — fließen als Zusatzkontext in die
// Gemini-Recherche ein (siehe createInfosheet). Nur lokal in localStorage
// gespeichert, daher bewusst klein gehalten (Größen-/Anzahl-Limit).
const INFOSHEET_DOC_MAX_BYTES = 4 * 1024 * 1024;
const INFOSHEET_DOC_MAX_COUNT = 3;
const INFOSHEET_DOC_ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

function infosheetDocsKey(doctorId) {
  return `medipulse_infosheet_docs_${doctorId}`;
}
function getInfosheetDocs(doctorId) {
  try {
    return JSON.parse(localStorage.getItem(infosheetDocsKey(doctorId)) || "[]");
  } catch {
    return [];
  }
}
function saveInfosheetDocs(doctorId, docs) {
  localStorage.setItem(infosheetDocsKey(doctorId), JSON.stringify(docs));
}
function removeInfosheetDoc(doctorId, index) {
  const docs = getInfosheetDocs(doctorId);
  docs.splice(index, 1);
  saveInfosheetDocs(doctorId, docs);
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}
async function addInfosheetDoc(doctorId, file) {
  if (!INFOSHEET_DOC_ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Nur PDF, PNG oder JPG werden unterstützt.");
  }
  if (file.size > INFOSHEET_DOC_MAX_BYTES) {
    throw new Error("Datei ist zu groß (max. 4 MB).");
  }
  const docs = getInfosheetDocs(doctorId);
  if (docs.length >= INFOSHEET_DOC_MAX_COUNT) {
    throw new Error(`Maximal ${INFOSHEET_DOC_MAX_COUNT} Dokumente pro Praxis.`);
  }
  const dataUrl = await readFileAsDataUrl(file);
  docs.push({ name: file.name, mimeType: file.type, dataUrl });
  saveInfosheetDocs(doctorId, docs);
}

async function createInfosheet(d) {
  const today = new Date().toLocaleDateString("de-DE");
  const sheet = {
    createdBy: currentUser || "Unbekannt",
    createdAt: today,
    updatedAt: today,
    trigger: "",
    verkauft: "",
    firmografie: "",
    struktur: "",
    produkt: "",
    aufhaenger: [],
  };

  if (!geminiWorkerUrl) {
    saveInfosheet(d.id, sheet);
    refreshPopupFor(d.id);
    return;
  }

  infosheetResearchPending = d.id;
  refreshPopupFor(d.id);

  try {
    const docs = getInfosheetDocs(d.id).map((doc) => ({
      name: doc.name,
      mimeType: doc.mimeType,
      data: doc.dataUrl.split(",")[1],
    }));
    const res = await fetch(geminiWorkerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: d.name,
        einrichtung: d.einrichtung,
        strasse: d.strasse,
        plz: d.plz,
        stadt: d.stadt,
        bundesland: d.bundesland,
        fachrichtung: d.fachrichtung,
        website: d.website,
        files: docs,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const r = data.result || {};
    Object.assign(sheet, {
      trigger: r.trigger || "",
      verkauft: r.verkauft || "",
      firmografie: r.firmografie || "",
      struktur: r.struktur || "",
      produkt: r.produkt || "",
      aufhaenger: Array.isArray(r.aufhaenger) ? r.aufhaenger.slice(0, 2) : [],
    });
  } catch (err) {
    console.warn("Gemini-Recherche fehlgeschlagen, Infosheet nur mit Steckbrief gespeichert:", err);
  } finally {
    infosheetResearchPending = null;
    saveInfosheet(d.id, sheet);
    refreshPopupFor(d.id);
  }
}

let infothekExpandedFor = null;

function slugifyFilename(text) {
  const slug = String(text || "praxis")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "praxis";
}

// Baut das Infosheet clientseitig als echtes PDF (jsPDF, vendored — keine
// Server-Anbindung nötig), immer frisch aus den gespeicherten Feldern, statt
// die Bytes selbst zu persistieren. So bleibt die Datei automatisch mit den
// zuletzt gespeicherten Angaben synchron.
const PDF_STATUS_COLORS = {
  kunde: [46, 204, 113],
  interessent: [245, 166, 35],
  lead: [79, 140, 255],
  inaktiv: [107, 120, 147],
};
const PDF_ACCENT = [79, 140, 255];

function buildInfosheetPdf(d, sheet) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 18;
  const maxWidth = pageWidth - marginX * 2;
  let y;

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - 16) {
      doc.addPage();
      y = 20;
    }
  };

  // Kopfband
  doc.setFillColor(...PDF_ACCENT);
  doc.rect(0, 0, pageWidth, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("MEDIPULSE", marginX, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(225, 235, 255);
  doc.text("INFOSHEET", marginX, 20.5);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" }), pageWidth - marginX, 15, { align: "right" });

  // Titel + Status-Badge + Subtitel
  y = 38;
  doc.setTextColor(20, 20, 25);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text(d.name, marginX, y);
  y += 7.5;

  const statusColor = PDF_STATUS_COLORS[d.status] || PDF_STATUS_COLORS.inaktiv;
  const statusLabel = STATUS_LABELS[d.status] || d.status || "";
  let subtitleX = marginX;
  if (statusLabel) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    const badgeTextWidth = doc.getTextWidth(statusLabel);
    const badgeWidth = badgeTextWidth + 6;
    doc.setFillColor(...statusColor);
    doc.roundedRect(marginX, y - 4.2, badgeWidth, 5.6, 1.4, 1.4, "F");
    doc.setTextColor(255, 255, 255);
    doc.text(statusLabel, marginX + 3, y - 0.4);
    subtitleX = marginX + badgeWidth + 4;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(`${d.fachrichtung || ""} · ${d.stadt || ""}`, subtitleX, y);
  y += 6;

  doc.setDrawColor(220, 226, 238);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;

  const section = (label, text) => {
    if (!text) return;
    ensureSpace(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...PDF_ACCENT);
    doc.text(label.toUpperCase(), marginX, y);
    y += 5.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(25);
    doc.splitTextToSize(text, maxWidth).forEach((line) => {
      ensureSpace(5.2);
      doc.text(line, marginX, y);
      y += 5.2;
    });
    y += 4;
  };

  // Steckbrief aus den vorhandenen AOK-Basisdaten (nicht nur die
  // manuell recherchierten Felder) — macht das Infosheet auch ohne
  // ausgefüllte Trigger/Painpoints-Felder informativ.
  const factRows = [];
  if (d.einrichtung) factRows.push(["Einrichtung", d.einrichtung + (d.kette ? ` (Teil von ${d.kette})` : "")]);
  factRows.push(["Adresse", `${d.strasse || ""}, ${d.plz || ""} ${d.stadt || ""}`.trim()]);
  if (d.bundesland) factRows.push(["Bundesland", d.bundesland]);
  if (d.ansprechpartner && d.ansprechpartner !== d.name) factRows.push(["Ansprechpartner", d.ansprechpartner]);
  if (d.telefon) factRows.push(["Telefon", d.telefon]);
  if (d.email) factRows.push(["E-Mail", d.email]);
  if (d.website) factRows.push(["Website", d.website.replace(/^https?:\/\//, "")]);
  if (d.groesse) factRows.push(["Praxisgröße", d.groesse === 1 ? "1 Arzt/Ärztin" : `${d.groesse} Ärzte/-innen`]);

  if (factRows.length) {
    ensureSpace(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...PDF_ACCENT);
    doc.text("STECKBRIEF", marginX, y);
    y += 6;
    doc.setFontSize(9.5);
    factRows.forEach(([label, value]) => {
      if (!value) return;
      ensureSpace(5.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(70, 78, 95);
      doc.text(`${label}:`, marginX, y);
      const labelWidth = doc.getTextWidth(`${label}: `);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(25);
      const lines = doc.splitTextToSize(value, maxWidth - labelWidth);
      doc.text(lines[0] || "", marginX + labelWidth, y);
      y += 5.2;
      for (let i = 1; i < lines.length; i++) {
        ensureSpace(5.2);
        doc.text(lines[i], marginX + labelWidth, y);
        y += 5.2;
      }
    });
    y += 4;
  }

  section("Trigger", sheet.trigger);
  section("Was die Praxis verkauft", sheet.verkauft);
  section("Firmografie", sheet.firmografie);
  section("Struktur", sheet.struktur);
  section("Produkt", sheet.produkt);

  const theses = (sheet.aufhaenger || []).filter((t) => t && t.trim());
  if (theses.length) {
    ensureSpace(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...PDF_ACCENT);
    doc.text("GRÖSSTE PAINPOINTS", marginX, y);
    y += 5.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(25);
    theses.forEach((t, i) => {
      doc.splitTextToSize(`${i + 1}. ${t}`, maxWidth).forEach((line) => {
        ensureSpace(5.2);
        doc.text(line, marginX, y);
        y += 5.2;
      });
      y += 1.5;
    });
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...PDF_ACCENT);
    doc.setLineWidth(0.8);
    doc.line(0, pageHeight - 10, pageWidth, pageHeight - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Erstellt von ${sheet.createdBy || "Unbekannt"} · zuletzt aktualisiert am ${sheet.updatedAt || sheet.createdAt || ""}`,
      marginX,
      pageHeight - 5
    );
    if (pageCount > 1) doc.text(`${p} / ${pageCount}`, pageWidth - marginX, pageHeight - 5, { align: "right" });
  }

  return doc;
}

function infosheetFileName(d) {
  return `Infosheet_${slugifyFilename(d.name)}.pdf`;
}

// data:-URIs im <a href> waren unzuverlässig (blockiert je nach Browser/
// Sandbox die Kombination aus download-Attribut + target="_blank", vor
// allem in eingebetteten/eingeschränkten Kontexten). Blob-URLs + ein
// tatsächlicher Klick auf ein <a download> sind der robustere,
// browserübergreifend unterstützte Weg, eine Datei zu öffnen/speichern.
function openOrDownloadInfosheetPdf(d) {
  const sheet = getInfosheet(d.id);
  if (!sheet) return;
  const blob = buildInfosheetPdf(d, sheet).output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = infosheetFileName(d);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function renderInfosheetContent(sheet) {
  const rows = [];
  const section = (label, text) =>
    text ? `<div class="infosheet-section"><div class="infosheet-label">${escapeHtml(label)}</div><div class="infosheet-text">${escapeHtml(text)}</div></div>` : "";
  rows.push(section("Trigger", sheet.trigger));
  rows.push(section("Was die Praxis verkauft", sheet.verkauft));
  rows.push(section("Firmografie", sheet.firmografie));
  rows.push(section("Struktur", sheet.struktur));
  rows.push(section("Produkt", sheet.produkt));
  const theses = (sheet.aufhaenger || []).filter((t) => t && t.trim());
  if (theses.length) {
    rows.push(
      `<div class="infosheet-section"><div class="infosheet-label">Größte Painpoints</div>${theses
        .map((t, i) => `<div class="infosheet-thesis">${i + 1}. ${escapeHtml(t)}</div>`)
        .join("")}</div>`
    );
  }
  const content = rows.filter(Boolean).join("");
  return content || `<div class="infothek-empty">Infosheet ist noch leer.</div>`;
}

// Nur sinnvoll, wenn die Gemini-Recherche eingerichtet ist — ohne sie
// würde ein hochgeladenes Dokument nirgendwo ausgewertet, nur gespeichert.
function infosheetDocsHtml(d) {
  if (!geminiWorkerUrl) return "";
  const docs = getInfosheetDocs(d.id);
  const rows = docs
    .map(
      (doc, i) => `
      <div class="infosheet-doc-row">
        <span class="infosheet-doc-name">📎 ${escapeHtml(doc.name)}</span>
        <button type="button" class="infosheet-doc-remove" data-id="${d.id}" data-index="${i}" title="Entfernen">×</button>
      </div>`
    )
    .join("");
  return `
    <div class="infosheet-docs">
      <div class="infosheet-docs-label">Dokumente zur Recherche (PDF/Bild, optional)</div>
      ${rows}
      ${docs.length < INFOSHEET_DOC_MAX_COUNT ? `<button type="button" class="infosheet-doc-upload-btn" data-id="${d.id}">+ Dokument hochladen</button>` : ""}
      <input type="file" class="infosheet-doc-input" data-id="${d.id}" accept="application/pdf,image/png,image/jpeg" hidden>
      <div class="infosheet-doc-error" data-id="${d.id}" hidden></div>
    </div>`;
}

function infothekHtml(d) {
  const sheet = getInfosheet(d.id);
  const expanded = infothekExpandedFor === d.id;
  let body;
  if (infosheetResearchPending === d.id) {
    body = `<div class="infothek-empty">🔎 Recherchiere Praxis-Infos …</div>`;
  } else if (sheet) {
    const fileName = infosheetFileName(d);
    body = `
      <button type="button" class="infosheet-file" data-id="${d.id}">
        <span class="infosheet-file-icon">📄</span>
        <span class="infosheet-file-info">
          <span class="infosheet-file-name">${escapeHtml(fileName)}</span>
          <span class="infosheet-file-hint">PDF öffnen / herunterladen</span>
        </span>
      </button>
      ${renderInfosheetContent(sheet)}
      <div class="infosheet-meta">Erstellt von ${escapeHtml(sheet.createdBy || "Unbekannt")} · zuletzt aktualisiert am ${escapeHtml(sheet.updatedAt || sheet.createdAt || "")}</div>
      <div class="infosheet-actions">
        <button type="button" class="infosheet-edit-btn" data-id="${d.id}">Bearbeiten</button>
        <button type="button" class="infosheet-delete-btn" data-id="${d.id}">Löschen</button>
      </div>
      ${infosheetDocsHtml(d)}
      ${geminiWorkerUrl && getInfosheetDocs(d.id).length ? `<button type="button" class="infosheet-reresearch-btn" data-id="${d.id}">🔄 Mit Dokumenten neu recherchieren</button>` : ""}`;
  } else {
    body = `
      <div class="infothek-empty">Noch kein Infosheet vorhanden.</div>
      <button type="button" class="infosheet-create-btn" data-id="${d.id}">+ Infosheet erstellen</button>
      ${infosheetDocsHtml(d)}`;
  }
  return `
    <div class="infothek">
      <button type="button" class="infothek-toggle" data-id="${d.id}">📄 Infothek <span class="infothek-chevron">${expanded ? "▴" : "▾"}</span></button>
      <div class="infothek-body" ${expanded ? "" : "hidden"}>${body}</div>
    </div>`;
}

// --- Automatisierte Erstansprache-E-Mail ---
// Holt sich die 2 größten Painpoints der Praxis aus dem Infosheet, falls
// eins existiert. Name oben (Anrede) und unten (Unterschrift) bleiben
// bewusst Platzhalter: die Anrede könnte sonst das falsche Geschlecht/
// Titel treffen (unsere Daten enthalten keine verlässliche Anrede-
// Information), und wer die Mail tatsächlich verschickt, soll die App
// nicht raten.
function emailIssuePoints(d) {
  const sheet = getInfosheet(d.id);
  if (!sheet) return [];
  return (sheet.aufhaenger || []).filter((t) => t && t.trim()).slice(0, 2);
}

function buildOutreachEmail(d) {
  const orgLabel = d.einrichtung || d.name;
  const points = emailIssuePoints(d);
  const pointsBlock = points.length
    ? points.map((p, i) => `${i + 1}. ${p}`).join("\n")
    : "[Hier die größten Painpoints aus der Infothek einfügen]";
  const subject = `Kurze Einschätzung zu ${orgLabel}`;
  const body = [
    "Guten Tag [Name],",
    "",
    `im Rahmen unserer Marktbeobachtung sind wir auf Ihre ${orgLabel} aufmerksam geworden und haben ${points.length > 1 ? "zwei Painpoints" : "einen Painpoint"} identifiziert, die aus unserer Sicht aktuell auf Ihre Praxis zutreffen könnten:`,
    "",
    pointsBlock,
    "",
    "Gerne ordnen wir das in einem kurzen, unverbindlichen Gespräch für Sie ein — oder Sie lassen uns kurz wissen, falls das Thema aktuell keine Priorität hat.",
    "",
    "MediPulse hilft Arztpraxen und MVZ dabei, ihre Abläufe effizienter zu steuern, Potenziale zu erkennen und bessere Entscheidungen auf Basis ihrer Daten zu treffen — so sparen Teams Zeit, verbessern Prozesse und können sich stärker auf ihre Patienten konzentrieren.",
    "",
    "Einen kurzen Überblick über MediPulse finden Sie hier: https://www.medipulse.de",
    "",
    "Viele Grüße",
    currentUser || "[Ihr Name]",
    "MediPulse",
  ].join("\n");
  return { subject, body };
}

function buildOutreachMailto(d) {
  const { subject, body } = buildOutreachEmail(d);
  return `mailto:${d.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// --- Follow-up-Erinnerung ---
// Die App kann nur erkennen, dass auf "E-Mail" geklickt wurde (der
// E-Mail-Client des Geräts öffnet sich mit vorausgefülltem Entwurf) —
// nicht, ob die E-Mail im Client tatsächlich abgeschickt wurde. Der Klick
// ist trotzdem das einzige verfügbare Signal und wird als "E-Mail
// gesendet" gewertet. 24 Stunden danach erscheint ein roter Punkt an der
// Glocke, bis die Person entweder ein Follow-up bekommt oder die
// Erinnerung manuell gelöscht wird.
const FOLLOWUP_DELAY_MS = 24 * 60 * 60 * 1000;

function getSentEmails() {
  try {
    return JSON.parse(localStorage.getItem("medipulse_sent_emails") || "{}");
  } catch {
    return {};
  }
}
function saveSentEmails(map) {
  localStorage.setItem("medipulse_sent_emails", JSON.stringify(map));
}
function recordEmailSent(doctorId) {
  const map = getSentEmails();
  map[doctorId] = { sentAt: Date.now() };
  saveSentEmails(map);
  updateNotificationBell();
}
function dismissFollowUp(doctorId) {
  const map = getSentEmails();
  delete map[doctorId];
  saveSentEmails(map);
  updateNotificationBell();
  renderNotificationPanel();
}
function getDueFollowUps() {
  const map = getSentEmails();
  const now = Date.now();
  return Object.entries(map)
    .filter(([, rec]) => now - rec.sentAt >= FOLLOWUP_DELAY_MS)
    .map(([id, rec]) => ({ doctorId: Number(id), sentAt: rec.sentAt }))
    .filter((r) => AERZTE_DATA.some((d) => d.id === r.doctorId));
}
function buildFollowUpEmail(d) {
  const orgLabel = d.einrichtung || d.name;
  const subject = `Kurze Rückfrage zu Ihrer ${orgLabel}`;
  const body = [
    "Guten Tag [Name],",
    "",
    `vor Kurzem hatte ich Ihnen eine kurze Einschätzung zu Ihrer ${orgLabel} geschickt. Ich wollte kurz nachfragen, ob das Thema für Sie relevant ist oder ob sich zwischenzeitlich etwas geändert hat.`,
    "",
    `Über eine kurze Rückmeldung würde ich mich freuen, auch wenn das für Sie aktuell noch kein Thema ist.`,
    "",
    "Viele Grüße",
    currentUser || "[Ihr Name]",
    "MediPulse",
  ].join("\n");
  return { subject, body };
}
function buildFollowUpMailto(d) {
  const { subject, body } = buildFollowUpEmail(d);
  return `mailto:${d.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function updateNotificationBell() {
  document.getElementById("notif-dot").hidden = getDueFollowUps().length === 0;
}
function renderNotificationPanel() {
  const due = getDueFollowUps().sort((a, b) => a.sentAt - b.sentAt);
  const list = document.getElementById("notif-list");
  if (!due.length) {
    list.innerHTML = `<div class="infothek-empty">Keine offenen Follow-ups.</div>`;
    return;
  }
  list.innerHTML = due
    .map((r) => {
      const d = AERZTE_DATA.find((x) => x.id === r.doctorId);
      return `
      <div class="notif-row">
        <div class="notif-info">
          <div class="notif-name">${escapeHtml(d.name)}</div>
          <div class="notif-sub">E-Mail gesendet am ${new Date(r.sentAt).toLocaleDateString("de-DE")}</div>
        </div>
        <div class="notif-actions">
          <a class="notif-followup-btn" data-id="${d.id}" href="${escapeHtml(buildFollowUpMailto(d))}">Follow-up senden</a>
          <button type="button" class="notif-delete-btn" data-id="${d.id}" title="Entfernen">×</button>
        </div>
      </div>`;
    })
    .join("");
}

let popupCollapsed = false;
let popupCollapsedForId = null;

function openDoctorPopup(d, coords) {
  const kategorie = d.kategorie || "sonstige";
  // Neue Praxis -> Popup startet immer aufgeklappt; nur ein Refresh
  // derselben Praxis (z.B. nach Infosheet-Recherche) behält den
  // Klappzustand bei.
  if (popupCollapsedForId !== d.id) {
    popupCollapsed = false;
    popupCollapsedForId = d.id;
  }
  // Nur die Info berechnen (keine Kartenänderung) — das tatsächliche Zeichnen
  // passiert erst NACH addTo(), siehe unten: MapLibre entfernt beim
  // Wiederverwenden desselben Popup-Objekts intern kurz das alte (feuert
  // "close"), was currentPopupDoctor/die Verbindungslinien sonst sofort
  // wieder zurücksetzen würde.
  const conn = getConnectedDoctors(d);
  const html = `
    <div class="popup-header-row">
      <div class="popup-title">${escapeHtml(d.name)}</div>
      <button type="button" class="popup-collapse-btn" title="Ein-/Ausklappen">${popupCollapsed ? "▾" : "▴"}</button>
    </div>
    <div class="popup-collapsible" ${popupCollapsed ? "hidden" : ""}>
      <div class="popup-sub">
        <span class="dot" style="background:${KATEGORIE_COLORS[kategorie]}"></span>
        ${escapeHtml(KATEGORIE_LABELS[kategorie])} · ${escapeHtml(d.fachrichtung)} · ${escapeHtml(d.stadt)}
      </div>
      ${d.einrichtung ? `<div class="popup-row">🏥 ${escapeHtml(d.einrichtung)}${d.kette ? ` <span style="color:var(--text-dim)">(${escapeHtml(d.kette)})</span>` : ""}</div>` : ""}
      ${conn.total > 0 ? `<div class="popup-row connections-row">🔗 ${conn.total.toLocaleString("de-DE")} weitere Standorte der Kette ${escapeHtml(d.kette)} auf der Karte hervorgehoben${conn.total > conn.items.length ? ` (${conn.items.length} angezeigt)` : ""}</div>` : ""}
      ${sizeGaugeHtml(d.groesse)}
      ${earningsRowHtml(d)}
      ${
        d.status === "kunde"
          ? `<button type="button" class="popup-unmake-kunde-btn" data-id="${d.id}">↩ Kein Kunde mehr</button>`
          : `<button type="button" class="popup-make-kunde-btn" data-id="${d.id}">→ Zum Kunden machen</button>`
      }
      <div class="popup-row">📍 ${escapeHtml(d.strasse)}, ${escapeHtml(d.plz)} ${escapeHtml(d.stadt)}</div>
      ${d.ansprechpartner && d.ansprechpartner !== d.name ? `<div class="popup-row">👤 ${escapeHtml(d.ansprechpartner)}</div>` : ""}
      ${d.telefon ? `<div class="popup-row">📞 ${escapeHtml(d.telefon)}</div>` : ""}
      <div class="popup-row popup-email-row">
        ${d.email ? `✉️ ${escapeHtml(d.email)}` : `<span class="popup-email-missing">✉️ Keine E-Mail hinterlegt</span>`}
        <button type="button" class="popup-email-edit-btn" data-id="${d.id}" title="${d.email ? "E-Mail bearbeiten" : "E-Mail eintragen"}">✏️</button>
      </div>
      ${d.website ? `<div class="popup-row">🔗 <a href="${escapeHtml(d.website)}" target="_blank" rel="noopener">${escapeHtml(d.website.replace(/^https?:\/\//, ""))}</a></div>` : ""}
      ${d.notizen ? `<div class="popup-row" style="color:var(--text-dim)">📝 ${escapeHtml(d.notizen)}</div>` : ""}
      <div class="popup-actions">
        ${d.telefon ? `<a href="tel:${escapeHtml(d.telefon)}">Anrufen</a>` : ""}
        ${d.email ? `<a class="popup-email-btn" data-id="${d.id}" href="${escapeHtml(buildOutreachMailto(d))}">E-Mail</a>` : ""}
        <button type="button" class="popup-route-btn">Route</button>
      </div>
      ${infothekHtml(d)}
    </div>
  `;
  popup.setLngLat(coords).setHTML(html).addTo(map);
  currentPopupDoctor = d;
  updateConnections(d);
}

function refreshOpenPopup() {
  if (currentPopupDoctor) {
    openDoctorPopup(currentPopupDoctor, popup.getLngLat());
  }
}

// Wie refreshOpenPopup(), aber sicher für asynchrone Aufrufer (z.B. nach
// einer Gemini-Recherche): falls der Nutzer inzwischen eine andere Praxis
// geöffnet oder das Popup geschlossen hat, darf das NICHT versehentlich
// deren Popup mit den (falschen) Ergebnissen überschreiben.
function refreshPopupFor(doctorId) {
  if (currentPopupDoctor && currentPopupDoctor.id === doctorId) {
    openDoctorPopup(currentPopupDoctor, popup.getLngLat());
  }
}

// Der medipulse-infosheet-Skill gibt seine Recherche immer nach demselben
// Schema aus (**Trigger:**, **Was die Praxis verkauft:**, **Firmografie:**,
// **Struktur:**, **Produkt:**, **Größte Painpoints:**). Weil das Format
// fest ist, lässt sich der komplette Skill-Text hier einfach einfügen,
// statt jedes Feld einzeln von Hand zu übertragen — die Überschriften
// werden erkannt und der jeweilige Absatz landet automatisch im
// passenden Feld. Die alten "Aufhänger"-Überschriften werden zusätzlich
// erkannt, damit älterer Skill-Text weiterhin funktioniert.
const INFOSHEET_PASTE_HEADERS = {
  trigger: "trigger",
  "was die praxis verkauft": "verkauft",
  firmografie: "firmografie",
  struktur: "struktur",
  produkt: "produkt",
  "größte painpoints": "aufhaenger",
  "die größten painpoints": "aufhaenger",
  painpoints: "aufhaenger",
  "der aufhänger": "aufhaenger",
  aufhänger: "aufhaenger",
};
const INFOSHEET_PASTE_STOP_HEADERS = ["quellen", "quelle"];

function normalizeInfosheetHeaderLine(line) {
  return line
    .trim()
    .replace(/^\*+/, "")
    .replace(/\*+$/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
}

function parseInfosheetText(raw) {
  const sections = { trigger: [], verkauft: [], firmografie: [], struktur: [], produkt: [], aufhaenger: [] };
  let current = null;
  String(raw || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const norm = normalizeInfosheetHeaderLine(line);
      if (INFOSHEET_PASTE_HEADERS[norm]) {
        current = INFOSHEET_PASTE_HEADERS[norm];
        return;
      }
      if (INFOSHEET_PASTE_STOP_HEADERS.some((h) => norm.startsWith(h))) {
        current = null;
        return;
      }
      if (current) sections[current].push(line);
    });
  const joined = (key) => sections[key].join("\n").trim();
  const theses = joined("aufhaenger")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 2);
  return {
    trigger: joined("trigger"),
    verkauft: joined("verkauft"),
    firmografie: joined("firmografie"),
    struktur: joined("struktur"),
    produkt: joined("produkt"),
    aufhaenger: theses,
  };
}

function applyInfosheetPasteText() {
  const raw = document.getElementById("infosheet-paste-all").value;
  if (!raw.trim()) return;
  const parsed = parseInfosheetText(raw);
  document.getElementById("infosheet-trigger").value = parsed.trigger;
  document.getElementById("infosheet-verkauft").value = parsed.verkauft;
  document.getElementById("infosheet-firmografie").value = parsed.firmografie;
  document.getElementById("infosheet-struktur").value = parsed.struktur;
  document.getElementById("infosheet-produkt").value = parsed.produkt;
  document.getElementById("infosheet-these-1").value = parsed.aufhaenger[0] || "";
  document.getElementById("infosheet-these-2").value = parsed.aufhaenger[1] || "";
}
document.getElementById("infosheet-paste-apply").addEventListener("click", applyInfosheetPasteText);
document.getElementById("infosheet-paste-all").addEventListener("paste", () => {
  setTimeout(applyInfosheetPasteText, 0);
});
document.getElementById("infosheet-paste-upload-btn").addEventListener("click", () => {
  document.getElementById("infosheet-paste-file-input").click();
});
document.getElementById("infosheet-paste-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const text = await file.text();
  document.getElementById("infosheet-paste-all").value = text;
  applyInfosheetPasteText();
});

let infosheetEditingDoctorId = null;
function openInfosheetEditor(d) {
  infosheetEditingDoctorId = d.id;
  const sheet = getInfosheet(d.id) || {};
  document.getElementById("infosheet-editor-title").textContent = `Infosheet: ${d.name}`;
  document.getElementById("infosheet-paste-all").value = "";
  document.getElementById("infosheet-trigger").value = sheet.trigger || "";
  document.getElementById("infosheet-verkauft").value = sheet.verkauft || "";
  document.getElementById("infosheet-firmografie").value = sheet.firmografie || "";
  document.getElementById("infosheet-struktur").value = sheet.struktur || "";
  document.getElementById("infosheet-produkt").value = sheet.produkt || "";
  const theses = sheet.aufhaenger || [];
  document.getElementById("infosheet-these-1").value = theses[0] || "";
  document.getElementById("infosheet-these-2").value = theses[1] || "";
  document.getElementById("infosheet-editor-backdrop").hidden = false;
}
function closeInfosheetEditor() {
  document.getElementById("infosheet-editor-backdrop").hidden = true;
  infosheetEditingDoctorId = null;
}
document.getElementById("infosheet-editor-close").addEventListener("click", closeInfosheetEditor);
document.getElementById("infosheet-editor-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "infosheet-editor-backdrop") closeInfosheetEditor();
});
document.getElementById("infosheet-editor-save").addEventListener("click", () => {
  if (!infosheetEditingDoctorId) return;
  const existing = getInfosheet(infosheetEditingDoctorId);
  const today = new Date().toLocaleDateString("de-DE");
  const sheet = {
    createdBy: (existing && existing.createdBy) || currentUser || "Unbekannt",
    createdAt: (existing && existing.createdAt) || today,
    updatedAt: today,
    trigger: document.getElementById("infosheet-trigger").value.trim(),
    verkauft: document.getElementById("infosheet-verkauft").value.trim(),
    firmografie: document.getElementById("infosheet-firmografie").value.trim(),
    struktur: document.getElementById("infosheet-struktur").value.trim(),
    produkt: document.getElementById("infosheet-produkt").value.trim(),
    aufhaenger: [
      document.getElementById("infosheet-these-1").value.trim(),
      document.getElementById("infosheet-these-2").value.trim(),
    ],
  };
  saveInfosheet(infosheetEditingDoctorId, sheet);
  infothekExpandedFor = infosheetEditingDoctorId;
  closeInfosheetEditor();
  refreshOpenPopup();
});

popup.on("close", () => {
  currentPopupDoctor = null;
  updateConnections(null);
});

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function selectDoctor(id, flyTo = true) {
  selectedId = id;
  document.querySelectorAll(".doctor-item").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.id) === Number(id));
  });
  if (flyTo) {
    const d = AERZTE_DATA.find((x) => x.id === id);
    if (d) {
      map.flyTo({ center: [d.lng, d.lat], zoom: 11, essential: true });
      setTimeout(() => openDoctorPopup(d, [d.lng, d.lat]), 600);
    }
  }
}

function renderList() {
  if (!dataReady) return;
  const list = document.getElementById("doctor-list");
  const data = getFilteredData();
  list.innerHTML = "";

  if (data.length === 0) {
    list.innerHTML = `<li class="doctor-list-hint">Keine Treffer.</li>`;
    return;
  }

  const shown = data.length > MAX_LIST_ITEMS ? data.slice(0, MAX_LIST_ITEMS) : data;
  shown.forEach((d) => {
    const li = document.createElement("li");
    li.className = "doctor-item";
    li.dataset.id = d.id;
    const kategorie = d.kategorie || "sonstige";
    li.innerHTML = `
      <div class="doctor-item-top">
        <span class="dot" style="background:${KATEGORIE_COLORS[kategorie]}" title="${escapeHtml(KATEGORIE_LABELS[kategorie])}"></span>
        <span class="doctor-name">${escapeHtml(d.name)}</span>
        <span class="status-badge ${d.status}" title="${escapeHtml(STATUS_LABELS[d.status] || d.status)}"></span>
      </div>
      <div class="doctor-meta">${escapeHtml(KATEGORIE_LABELS[kategorie])} · ${escapeHtml(d.fachrichtung)} · ${escapeHtml(d.stadt)}</div>
      ${d.einrichtung ? `<div class="doctor-meta doctor-einrichtung">${escapeHtml(d.einrichtung)}</div>` : ""}
      ${
        d.status === "kunde"
          ? `<button type="button" class="doctor-unmake-kunde-btn" data-id="${d.id}">↩ Kein Kunde mehr</button>`
          : `<div class="doctor-meta doctor-earnings">💰 ${((d.groesse || 1) * gewinnProArzt).toLocaleString("de-DE")} € möglich</div>
             <button type="button" class="doctor-make-kunde-btn" data-id="${d.id}">→ Zum Kunden machen</button>`
      }
    `;
    li.addEventListener("click", () => selectDoctor(d.id, true));
    const makeKundeBtn = li.querySelector(".doctor-make-kunde-btn");
    if (makeKundeBtn) {
      makeKundeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        markDoctorAsKunde(d);
      });
    }
    const unmakeKundeBtn = li.querySelector(".doctor-unmake-kunde-btn");
    if (unmakeKundeBtn) {
      unmakeKundeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        unmarkDoctorAsKunde(d);
      });
    }
    list.appendChild(li);
  });

  if (data.length > MAX_LIST_ITEMS) {
    const hint = document.createElement("li");
    hint.className = "doctor-list-hint";
    hint.textContent = `${(data.length - MAX_LIST_ITEMS).toLocaleString("de-DE")} weitere Treffer ausgeblendet — bitte Suche/Filter eingrenzen.`;
    list.appendChild(hint);
  }
}

function updateStats() {
  const data = getFilteredData();
  const fmt = (n) => n.toLocaleString("de-DE");
  document.getElementById("stat-total").textContent = fmt(data.length);
  document.getElementById("stat-kunde").textContent = fmt(data.filter((d) => d.status === "kunde").length);
  document.getElementById("stat-interessent").textContent = fmt(data.filter((d) => d.status === "interessent").length);
  document.getElementById("stat-lead").textContent = fmt(data.filter((d) => d.status === "lead").length);
}

let heatmapEnabled = false;

// Rasterisiert die aktuell gefilterten Praxen zu einem Dichte-Grid (statt
// jeden Rohpunkt einzeln zu zeichnen) — Zellgröße richtet sich nach der
// tatsächlichen Ausdehnung der Daten, damit es bei einer Bundesland-
// Auswahl genauso gut auflöst wie bundesweit.
const HEATMAP_GRID_SIZE = 55;

function heatmapGeoJSON() {
  const data = getFilteredData();
  if (data.length === 0) return EMPTY_FC;

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const d of data) {
    if (d.lat < minLat) minLat = d.lat;
    if (d.lat > maxLat) maxLat = d.lat;
    if (d.lng < minLng) minLng = d.lng;
    if (d.lng > maxLng) maxLng = d.lng;
  }
  const latStep = (maxLat - minLat || 1) / HEATMAP_GRID_SIZE;
  const lngStep = (maxLng - minLng || 1) / HEATMAP_GRID_SIZE;

  const cells = new Map();
  for (const d of data) {
    const gx = Math.min(HEATMAP_GRID_SIZE - 1, Math.floor((d.lng - minLng) / lngStep));
    const gy = Math.min(HEATMAP_GRID_SIZE - 1, Math.floor((d.lat - minLat) / latStep));
    const key = gx + "," + gy;
    const weight = Math.max(1, d.groesse || 1);
    const entry = cells.get(key);
    if (entry) {
      entry.count++;
      entry.sumLat += d.lat;
      entry.sumLng += d.lng;
      entry.weight += weight;
    } else {
      cells.set(key, { count: 1, sumLat: d.lat, sumLng: d.lng, weight });
    }
  }

  let maxWeight = 0;
  for (const c of cells.values()) if (c.weight > maxWeight) maxWeight = c.weight;

  const features = [];
  for (const c of cells.values()) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.sumLng / c.count, c.sumLat / c.count] },
      properties: { density: maxWeight ? c.weight / maxWeight : 0 },
    });
  }
  return { type: "FeatureCollection", features };
}

function updateHeatmap() {
  const src = map.getSource("heatmap-source");
  if (src) src.setData(heatmapGeoJSON());
}

function setHeatmapVisible(visible) {
  heatmapEnabled = visible;
  const vis = visible ? "visible" : "none";
  const pinsVis = visible ? "none" : "visible";
  if (map.getLayer("heatmap-layer")) map.setLayoutProperty("heatmap-layer", "visibility", vis);
  ["clusters", "cluster-count", "unclustered-point"].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", pinsVis);
  });
  if (visible) updateHeatmap();
}

// Kunde/Lead/Alle ist kein separater Heatmap-Filter, sondern setzt direkt
// den normalen Status-Filter (inkl. Checkboxen in der Seitenleiste) — die
// Heatmap zeigt danach automatisch dieselbe gefilterte Menge wie die Karte.
document.getElementById("settings-heatmap-toggle").addEventListener("change", (e) => {
  document.getElementById("heatmap-scope-row").hidden = !e.target.checked;
  setHeatmapVisible(e.target.checked);
});
document.querySelectorAll('input[name="heatmap-scope"]').forEach((r) => {
  r.addEventListener("change", () => {
    const scope = r.value;
    activeStatuses = scope === "alle" ? new Set(["kunde", "interessent", "lead", "inaktiv"]) : new Set([scope]);
    document.querySelectorAll('.filters input[data-status]').forEach((cb) => {
      cb.checked = activeStatuses.has(cb.dataset.status);
    });
    applyFilters();
  });
});

function applyFilters() {
  refreshSource();
  renderList();
  updateStats();
  if (heatmapEnabled) updateHeatmap();
}

let searchDebounceTimer = null;
document.getElementById("search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  // Bei großen Datenmengen (100k+ Punkte) ist ein Re-Clustering pro
  // Tastendruck spürbar träge — daher kurz entprellen.
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(applyFilters, 200);
});

document.querySelectorAll('.filters input[type="checkbox"]').forEach((cb) => {
  cb.addEventListener("change", () => {
    const status = cb.dataset.status;
    if (cb.checked) activeStatuses.add(status);
    else activeStatuses.delete(status);
    applyFilters();
  });
});

document.getElementById("sidebar-toggle").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("collapsed");
  setTimeout(() => map.resize(), 220);
});

// --- Automatische Rotation des Globus, solange keine Interaktion stattfindet ---
function startAutoRotate() {
  const rotateStep = () => {
    if (autoRotate && !userInteracting && map.getZoom() < 4) {
      const center = map.getCenter();
      center.lng -= 0.06;
      map.setCenter(center);
    }
    rotateFrame = requestAnimationFrame(rotateStep);
  };
  rotateFrame = requestAnimationFrame(rotateStep);
}

["mousedown", "touchstart", "wheel", "dragstart"].forEach((evt) => {
  map.getCanvas().addEventListener(evt, () => (userInteracting = true));
});
map.on("moveend", () => {
  clearTimeout(window.__resumeTimer);
  window.__resumeTimer = setTimeout(() => (userInteracting = false), 2500);
});

// Rotation lässt sich bewusst nur über die Einstellungen steuern (kein
// zusätzlicher Schnellzugriff auf der Karte), damit es nicht zwei Stellen
// gibt, die denselben Zustand halten müssen.
function setAutoRotate(value) {
  autoRotate = value;
  document.getElementById("settings-rotate-toggle").checked = autoRotate;
}

document.getElementById("settings-rotate-toggle").addEventListener("change", (e) => {
  setAutoRotate(e.target.checked);
});

// --- Einstellungen: Rad oben rechts, Rotation + GPA (Gewinn pro Arzt) ---
document.getElementById("settings-toggle").addEventListener("click", () => {
  const panel = document.getElementById("settings-panel");
  const willOpen = panel.hidden;
  closeAllOverlayPanels();
  panel.hidden = !willOpen;
});
document.getElementById("settings-close").addEventListener("click", () => {
  document.getElementById("settings-panel").hidden = true;
});
document.getElementById("notif-bell").addEventListener("click", () => {
  const panel = document.getElementById("notif-panel");
  const willOpen = panel.hidden;
  closeAllOverlayPanels();
  panel.hidden = !willOpen;
  if (willOpen) renderNotificationPanel();
});
document.getElementById("notif-close").addEventListener("click", () => {
  document.getElementById("notif-panel").hidden = true;
});
document.addEventListener("click", (e) => {
  const followUpBtn = e.target.closest(".notif-followup-btn");
  if (followUpBtn) dismissFollowUp(Number(followUpBtn.dataset.id));
  const deleteFollowUpBtn = e.target.closest(".notif-delete-btn");
  if (deleteFollowUpBtn) dismissFollowUp(Number(deleteFollowUpBtn.dataset.id));
});
document.addEventListener("click", (e) => {
  // composedPath() statt e.target: Klicks, die das Panel per innerHTML
  // neu rendern (z.B. Statistik-Zähler), hängen ihr Ziel-Element dabei
  // aus, sodass panel.contains(e.target) danach fälschlich "außerhalb"
  // meldet und das Panel sofort wieder schließt. composedPath() bildet
  // den DOM-Pfad zum Zeitpunkt des Klicks ab und bleibt davon unberührt.
  const path = e.composedPath();
  // Klicks im Notiz-Editor, Infosheet-Editor oder der Tour (eigene Overlays
  // über anderen Panels) dürfen das dahinterliegende Panel nicht schließen —
  // sonst schließt z.B. ein Klick auf "Weiter" während der Tour sofort wieder
  // das Panel, das der gerade angezeigte Schritt extra geöffnet hat.
  if (path.includes(document.getElementById("note-editor-backdrop"))) return;
  if (path.includes(document.getElementById("infosheet-editor-backdrop"))) return;
  if (path.includes(document.getElementById("tour-overlay"))) return;
  [
    ["settings-panel", "settings-toggle"],
    ["auth-panel", "user-badge"],
    ["sales-stats-panel", "sales-stats-toggle"],
    ["notif-panel", "notif-bell"],
  ].forEach(([panelId, toggleId]) => {
    const panel = document.getElementById(panelId);
    const toggleBtn = document.getElementById(toggleId);
    if (!panel.hidden && !path.includes(panel) && !path.includes(toggleBtn)) {
      panel.hidden = true;
    }
  });
});

function setGewinnProArzt(value) {
  gewinnProArzt = Math.max(0, Number(value) || 0);
  localStorage.setItem("medipulse_gpa", String(gewinnProArzt));
  document.getElementById("gpa-slider").value = gewinnProArzt;
  document.getElementById("gpa-input").value = gewinnProArzt;
  renderList();
  if (currentPopupDoctor) openDoctorPopup(currentPopupDoctor, [currentPopupDoctor.lng, currentPopupDoctor.lat]);
}

document.getElementById("gpa-slider").addEventListener("input", (e) => setGewinnProArzt(e.target.value));
document.getElementById("gpa-input").addEventListener("input", (e) => setGewinnProArzt(e.target.value));
document.getElementById("gpa-slider").value = gewinnProArzt;
document.getElementById("gpa-input").value = gewinnProArzt;

document.getElementById("settings-gemini-worker-url").value = geminiWorkerUrl;
document.getElementById("settings-gemini-worker-url").addEventListener("input", (e) => {
  geminiWorkerUrl = e.target.value.trim();
  localStorage.setItem("medipulse_gemini_worker_url", geminiWorkerUrl);
});

// --- Filter-Kacheln auf-/zuklappen (Status, Fachrichtung & MVZ, Größe) ---
document.querySelectorAll(".chevron-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const body = document.getElementById(btn.dataset.target);
    const collapsed = body.classList.toggle("collapsed");
    btn.setAttribute("aria-expanded", String(!collapsed));
  });
});

// --- Größen-Filter (dritte Filter-Kategorie): Regler mit Punkt, Log-Skala,
// plus Zahlenfeld zum direkten Eintippen (bidirektional mit dem Regler synchron) ---
document.getElementById("groesse-slider").addEventListener("input", (e) => {
  minGroesse = groesseThresholdFromPercent(Number(e.target.value));
  document.getElementById("groesse-value-label").textContent = minGroesse <= 1 ? "1" : minGroesse;
  document.getElementById("groesse-input").value = minGroesse <= 1 ? 1 : minGroesse;
  applyFilters();
});

document.getElementById("groesse-input").addEventListener("input", (e) => {
  const n = Math.max(0, Math.round(Number(e.target.value) || 0));
  minGroesse = n;
  document.getElementById("groesse-value-label").textContent = minGroesse <= 1 ? "1" : minGroesse;
  document.getElementById("groesse-slider").value = groessePercentFromThreshold(n);
  applyFilters();
});

// --- Routenplaner: von einer Praxis aus optional mehrere weitere Stopps in
// eine gemeinsame Google-Maps-Route mit Zwischenstopps einbinden ---
const ROUTE_MAX_STOPS = 8;
let routePlan = null; // { start, count, stops: [], suggestions: [], picking }

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Google-Maps-Universal-Link (https://developers.google.com/maps/documentation/urls/get-started):
// öffnet auf dem Handy die echte Google-Maps-App mit Turn-by-Turn-Navigation
// inkl. Zwischenstopps, am Desktop die Google-Maps-Website mit fertiger
// Route. Eigenes Routing nachzubauen wäre ohne eigene Verkehrsdaten nicht
// möglich, daher der Deep-Link.
function openGoogleMapsRoute(doctors) {
  if (doctors.length === 1) {
    const d = doctors[0];
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`, "_blank", "noopener");
    return;
  }
  const origin = doctors[0];
  const destination = doctors[doctors.length - 1];
  const waypoints = doctors.slice(1, -1).map((d) => `${d.lat},${d.lng}`).join("|");
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  window.open(url, "_blank", "noopener");
}

function openRoutePlanner(doctor) {
  routePlan = { start: doctor, count: 1, stops: [], suggestions: [], picking: false };
  document.getElementById("route-planner-backdrop").hidden = false;
  renderRouteConfirmStep();
}

function closeRoutePlanner() {
  routePlan = null;
  document.getElementById("route-planner-backdrop").hidden = true;
  document.getElementById("route-picking-bar").hidden = true;
}

function renderRouteConfirmStep() {
  const body = document.getElementById("route-planner-body");
  body.innerHTML = `
    <div class="route-planner-title">Möchtest du weitere Praxen in die Route zu <strong>${escapeHtml(routePlan.start.name)}</strong> einbinden?</div>
    <div class="route-planner-actions">
      <button type="button" id="route-confirm-no">Nein, direkt öffnen</button>
      <button type="button" class="primary" id="route-confirm-yes">Ja, mehrere einbinden</button>
    </div>
  `;
  document.getElementById("route-confirm-no").addEventListener("click", () => {
    openGoogleMapsRoute([routePlan.start]);
    closeRoutePlanner();
  });
  document.getElementById("route-confirm-yes").addEventListener("click", renderRouteCountStep);
}

function renderRouteCountStep() {
  const body = document.getElementById("route-planner-body");
  body.innerHTML = `
    <div class="route-planner-title">Wie viele weitere Praxen sollen in die Route?</div>
    <div class="route-count-row">
      <input type="range" id="route-count-slider" class="route-count-slider" min="1" max="${ROUTE_MAX_STOPS}" step="1" value="${routePlan.count}">
      <input type="number" id="route-count-input" class="route-count-input" min="1" max="${ROUTE_MAX_STOPS}" step="1" value="${routePlan.count}">
    </div>
    <div class="route-count-hint">max. ${ROUTE_MAX_STOPS} zusätzliche Stopps</div>
    <div class="route-planner-actions">
      <button type="button" id="route-count-back">Zurück</button>
      <button type="button" class="primary" id="route-count-next">Weiter</button>
    </div>
  `;
  const slider = document.getElementById("route-count-slider");
  const input = document.getElementById("route-count-input");
  slider.addEventListener("input", () => { input.value = slider.value; });
  input.addEventListener("input", () => {
    const v = Math.max(1, Math.min(ROUTE_MAX_STOPS, Math.round(Number(input.value) || 1)));
    slider.value = v;
  });
  document.getElementById("route-count-back").addEventListener("click", renderRouteConfirmStep);
  document.getElementById("route-count-next").addEventListener("click", () => {
    routePlan.count = Math.max(1, Math.min(ROUTE_MAX_STOPS, Math.round(Number(input.value) || 1)));
    renderRouteSelectStep();
  });
}

function suggestNearbyDoctors() {
  const pool = getFilteredData().filter((d) => d.id !== routePlan.start.id);
  return pool
    .map((d) => ({ doctor: d, dist: haversineKm(routePlan.start, d) }))
    // Kollegen an derselben Adresse (dieselben Koordinaten) sind als Route-
    // Zwischenstopp sinnlos — Google Maps würde ohnehin dieselbe Adresse
    // ansteuern, daher nur echte, andere Standorte vorschlagen.
    .filter((s) => s.dist > 0.05)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, routePlan.count);
}

function renderRouteSelectStep() {
  routePlan.suggestions = suggestNearbyDoctors();
  routePlan.stops = routePlan.suggestions.map((s) => s.doctor);
  renderRouteSelectBody();
}

function renderRouteSelectBody() {
  const body = document.getElementById("route-planner-body");
  const items = routePlan.suggestions
    .map(({ doctor, dist }) => {
      const checked = routePlan.stops.some((s) => s.id === doctor.id) ? "checked" : "";
      return `
        <li class="route-stop-item">
          <input type="checkbox" data-id="${doctor.id}" ${checked}>
          <span class="route-stop-name">${escapeHtml(doctor.name)} · ${escapeHtml(doctor.stadt)}</span>
          <span class="route-stop-dist">${dist.toFixed(1)} km</span>
        </li>`;
    })
    .join("");
  body.innerHTML = `
    <div class="route-planner-title">Vorschläge in der Nähe von <strong>${escapeHtml(routePlan.start.name)}</strong> (bis zu ${routePlan.count}):</div>
    <ul class="route-stop-list">${items || '<li class="route-stop-item">Keine weiteren Praxen in der aktuellen Ansicht gefunden.</li>'}</ul>
    <button type="button" class="route-manual-link" id="route-manual-pick">Stattdessen auf der Karte auswählen</button>
    <div class="route-planner-actions">
      <button type="button" id="route-select-back">Zurück</button>
      <button type="button" class="primary" id="route-select-done">Route erstellen</button>
    </div>
  `;
  body.querySelectorAll('.route-stop-item input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) {
        if (!routePlan.stops.some((s) => s.id === id)) {
          const found = routePlan.suggestions.find((s) => s.doctor.id === id);
          if (found) routePlan.stops.push(found.doctor);
        }
      } else {
        routePlan.stops = routePlan.stops.filter((s) => s.id !== id);
      }
    });
  });
  document.getElementById("route-select-back").addEventListener("click", renderRouteCountStep);
  document.getElementById("route-manual-pick").addEventListener("click", startRoutePicking);
  document.getElementById("route-select-done").addEventListener("click", () => {
    openGoogleMapsRoute([routePlan.start, ...routePlan.stops]);
    closeRoutePlanner();
  });
}

function startRoutePicking() {
  document.getElementById("route-planner-backdrop").hidden = true;
  routePlan.picking = true;
  routePlan.stops = [];
  updateRoutePickingBar();
  document.getElementById("route-picking-bar").hidden = false;
}

function updateRoutePickingBar() {
  document.getElementById("route-picking-status").textContent =
    `${routePlan.stops.length} von ${routePlan.count} ausgewählt — auf der Karte klicken`;
}

function addRoutePickedDoctor(id) {
  if (!routePlan || !routePlan.picking) return;
  if (id === routePlan.start.id) return;
  if (routePlan.stops.some((s) => s.id === id)) return;
  if (routePlan.stops.length >= routePlan.count) return;
  const full = AERZTE_DATA.find((d) => d.id === id);
  if (!full) return;
  routePlan.stops.push(full);
  updateRoutePickingBar();
}

document.getElementById("route-picking-cancel").addEventListener("click", closeRoutePlanner);
document.getElementById("route-picking-done").addEventListener("click", () => {
  if (!routePlan || routePlan.stops.length === 0) { closeRoutePlanner(); return; }
  openGoogleMapsRoute([routePlan.start, ...routePlan.stops]);
  closeRoutePlanner();
});
document.getElementById("route-planner-close").addEventListener("click", closeRoutePlanner);

// Buttons im Popup (Route, Infothek) werden per Event-Delegation behandelt,
// weil das Popup-HTML bei jedem Öffnen neu erzeugt wird (siehe openDoctorPopup).
document.addEventListener("click", (e) => {
  if (e.target.closest(".popup-route-btn") && currentPopupDoctor) {
    openRoutePlanner(currentPopupDoctor);
  }
  const collapseBtn = e.target.closest(".popup-collapse-btn");
  if (collapseBtn && currentPopupDoctor) {
    popupCollapsed = !popupCollapsed;
    popupCollapsedForId = currentPopupDoctor.id;
    refreshOpenPopup();
  }
  const makeKundeBtn = e.target.closest(".popup-make-kunde-btn");
  if (makeKundeBtn && currentPopupDoctor) {
    markDoctorAsKunde(currentPopupDoctor);
  }
  const unmakeKundeBtn = e.target.closest(".popup-unmake-kunde-btn");
  if (unmakeKundeBtn && currentPopupDoctor) {
    unmarkDoctorAsKunde(currentPopupDoctor);
  }
  const emailBtn = e.target.closest(".popup-email-btn");
  if (emailBtn) {
    recordEmailSent(Number(emailBtn.dataset.id));
  }
  const emailEditBtn = e.target.closest(".popup-email-edit-btn");
  if (emailEditBtn && currentPopupDoctor) {
    const input = prompt("E-Mail-Adresse der Praxis:", currentPopupDoctor.email || "");
    if (input !== null) setDoctorEmail(currentPopupDoctor, input);
  }
  const infothekToggle = e.target.closest(".infothek-toggle");
  if (infothekToggle) {
    const body = infothekToggle.parentElement.querySelector(".infothek-body");
    const willOpen = body.hidden;
    body.hidden = !willOpen;
    infothekToggle.querySelector(".infothek-chevron").textContent = willOpen ? "▴" : "▾";
    infothekExpandedFor = willOpen ? infothekToggle.dataset.id : null;
  }
  const createBtn = e.target.closest(".infosheet-create-btn");
  if (createBtn && currentPopupDoctor) {
    infothekExpandedFor = currentPopupDoctor.id;
    createInfosheet(currentPopupDoctor);
  }
  const fileBtn = e.target.closest(".infosheet-file");
  if (fileBtn && currentPopupDoctor) openOrDownloadInfosheetPdf(currentPopupDoctor);
  const editBtn = e.target.closest(".infosheet-edit-btn");
  if (editBtn && currentPopupDoctor) openInfosheetEditor(currentPopupDoctor);
  const deleteBtn = e.target.closest(".infosheet-delete-btn");
  if (deleteBtn && currentPopupDoctor) {
    deleteInfosheet(currentPopupDoctor.id);
    infothekExpandedFor = currentPopupDoctor.id;
    refreshOpenPopup();
  }
  const docUploadBtn = e.target.closest(".infosheet-doc-upload-btn");
  if (docUploadBtn) {
    docUploadBtn.parentElement.querySelector(".infosheet-doc-input").click();
  }
  const docRemoveBtn = e.target.closest(".infosheet-doc-remove");
  if (docRemoveBtn && currentPopupDoctor) {
    removeInfosheetDoc(currentPopupDoctor.id, Number(docRemoveBtn.dataset.index));
    infothekExpandedFor = currentPopupDoctor.id;
    refreshOpenPopup();
  }
  const reresearchBtn = e.target.closest(".infosheet-reresearch-btn");
  if (reresearchBtn && currentPopupDoctor) {
    if (confirm("Das überschreibt Trigger, Firmografie, Struktur, Produkt und die Painpoints mit einer neuen Recherche. Fortfahren?")) {
      infothekExpandedFor = currentPopupDoctor.id;
      createInfosheet(currentPopupDoctor);
    }
  }
});

document.addEventListener("change", async (e) => {
  const docInput = e.target.closest(".infosheet-doc-input");
  if (!docInput || !currentPopupDoctor) return;
  const file = docInput.files[0];
  docInput.value = "";
  if (!file) return;
  try {
    await addInfosheetDoc(currentPopupDoctor.id, file);
    infothekExpandedFor = currentPopupDoctor.id;
    refreshOpenPopup();
  } catch (err) {
    const errorEl = docInput.parentElement.querySelector(".infosheet-doc-error");
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

// --- Konten (nur lokal im Browser, kein echtes Backend) ---
// Dient ausschließlich der Zuordnung "wessen Statistik ist das", keine
// echte Zugriffskontrolle — die App bleibt komplett statisch (GitHub
// Pages), daher kein Server, der Passwörter sicher prüfen könnte.
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem("medipulse_users") || "[]");
  } catch {
    return [];
  }
}
function saveUsers(users) {
  localStorage.setItem("medipulse_users", JSON.stringify(users));
}

let currentUser = localStorage.getItem("medipulse_current_user") || null;
let authMode = "login"; // "login" | "register"

async function registerUser(name, password) {
  name = name.trim();
  if (!name) throw new Error("Bitte einen Namen eingeben.");
  if (password.length < 4) throw new Error("Passwort muss mindestens 4 Zeichen haben.");
  const users = loadUsers();
  if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Dieser Name ist bereits vergeben.");
  }
  const salt = randomSalt();
  const hash = await sha256Hex(salt + password);
  users.push({ name, salt, hash });
  saveUsers(users);
  setCurrentUser(name);
}

async function loginUser(name, password) {
  name = name.trim();
  const users = loadUsers();
  const user = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  if (!user) throw new Error("Unbekannter Name — noch nicht registriert?");
  const hash = await sha256Hex(user.salt + password);
  if (hash !== user.hash) throw new Error("Falsches Passwort.");
  setCurrentUser(user.name);
}

function setCurrentUser(name) {
  currentUser = name;
  localStorage.setItem("medipulse_current_user", name);
  updateUserBadge();
}

function logoutUser() {
  currentUser = null;
  authMode = "login";
  localStorage.removeItem("medipulse_current_user");
  updateUserBadge();
}

function deleteAccount(name) {
  const users = loadUsers().filter((u) => u.name.toLowerCase() !== name.toLowerCase());
  saveUsers(users);
  localStorage.removeItem(statsKey(name));
  localStorage.removeItem(avatarKey(name));
  if (currentUser && currentUser.toLowerCase() === name.toLowerCase()) {
    logoutUser();
  }
}

// Profilbild je Account: als kleines, quadratisch zugeschnittenes JPEG
// (Data-URL) in localStorage, damit es im Vergleich (Rankings) neben dem
// Namen erscheinen kann — ohne Upload auf einen Server.
function avatarKey(user) {
  return `medipulse_avatar_${user}`;
}
function getAvatar(user) {
  return localStorage.getItem(avatarKey(user));
}
function setAvatar(user, dataUrl) {
  localStorage.setItem(avatarKey(user), dataUrl);
}

function resizeImageFile(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function updateUserBadge() {
  const label = document.getElementById("user-badge-label");
  label.textContent = currentUser || "Anmelden";
  const badge = document.getElementById("user-badge");
  const iconEl = document.getElementById("user-badge-icon");
  const avatar = currentUser ? getAvatar(currentUser) : null;
  let img = badge.querySelector(".user-badge-avatar");
  if (avatar) {
    iconEl.hidden = true;
    if (!img) {
      img = document.createElement("img");
      img.className = "user-badge-avatar";
      badge.insertBefore(img, iconEl);
    }
    img.src = avatar;
  } else {
    iconEl.hidden = false;
    if (img) img.remove();
  }
  renderAuthPanel();
  if (!document.getElementById("sales-stats-panel").hidden) renderSalesStatsPanel();
}

function closeAllOverlayPanels() {
  document.getElementById("settings-panel").hidden = true;
  document.getElementById("auth-panel").hidden = true;
  document.getElementById("sales-stats-panel").hidden = true;
  document.getElementById("notif-panel").hidden = true;
}

function renderAuthPanel() {
  const loggedInBox = document.getElementById("auth-logged-in");
  const formWrap = document.getElementById("auth-form-wrap");
  const title = document.getElementById("auth-panel-title");
  document.getElementById("auth-error").hidden = true;
  if (currentUser) {
    loggedInBox.hidden = false;
    formWrap.hidden = true;
    title.textContent = "Konto";
    document.getElementById("auth-current-name-label").textContent = currentUser;
    const avatar = getAvatar(currentUser);
    document.getElementById("auth-avatar-preview").innerHTML = avatar ? `<img src="${avatar}" alt="">` : "👤";
  } else {
    loggedInBox.hidden = true;
    formWrap.hidden = false;
    title.textContent = authMode === "login" ? "Anmelden" : "Registrieren";
    document.getElementById("auth-submit").textContent = authMode === "login" ? "Anmelden" : "Registrieren";
    document.getElementById("auth-switch-mode").textContent =
      authMode === "login" ? "Noch kein Konto? Registrieren" : "Schon registriert? Anmelden";
  }
}

document.getElementById("user-badge").addEventListener("click", () => {
  const panel = document.getElementById("auth-panel");
  const willOpen = panel.hidden;
  closeAllOverlayPanels();
  panel.hidden = !willOpen;
  if (willOpen) renderAuthPanel();
});
document.getElementById("auth-close").addEventListener("click", () => {
  document.getElementById("auth-panel").hidden = true;
});
document.getElementById("auth-avatar-btn").addEventListener("click", () => {
  document.getElementById("auth-avatar-input").click();
});
document.getElementById("auth-avatar-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !currentUser) return;
  try {
    const dataUrl = await resizeImageFile(file, 96);
    setAvatar(currentUser, dataUrl);
    updateUserBadge();
  } catch (err) {
    console.warn("Profilbild konnte nicht gesetzt werden:", err);
  }
});
document.getElementById("auth-switch-mode").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  document.getElementById("auth-name").value = "";
  document.getElementById("auth-password").value = "";
  renderAuthPanel();
});
document.getElementById("auth-submit").addEventListener("click", async () => {
  const name = document.getElementById("auth-name").value;
  const password = document.getElementById("auth-password").value;
  const errorEl = document.getElementById("auth-error");
  try {
    if (authMode === "login") await loginUser(name, password);
    else await registerUser(name, password);
    document.getElementById("auth-name").value = "";
    document.getElementById("auth-password").value = "";
    errorEl.hidden = true;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});
document.getElementById("auth-logout").addEventListener("click", () => {
  logoutUser();
});
document.getElementById("auth-delete-account").addEventListener("click", () => {
  if (!currentUser) return;
  const ok = confirm(
    `Konto "${currentUser}" wirklich unwiderruflich löschen? Deine Statistik verschwindet und du fällst aus den Rankings raus.`
  );
  if (!ok) return;
  deleteAccount(currentUser);
  document.getElementById("auth-panel").hidden = true;
});

// --- Statistik (pro Konto, nur lokal, mit Tagesverlauf & Streaks) ---
const STAT_CATEGORIES = [
  { key: "anrufe", label: "Anrufe", emoji: "📞" },
  { key: "termine", label: "Vor-Ort-Termine", emoji: "🚗" },
  { key: "kunden", label: "Neue Kunden", emoji: "🤝" },
  { key: "emails", label: "E-Mails", emoji: "✉️" },
];
const STAT_RANGES = [
  { key: "day", label: "Tag" },
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
  { key: "year", label: "Jahr" },
];
const STAT_RANGE_HINT = {
  day: "letzte 14 Tage",
  week: "letzte 8 Wochen",
  month: "letzte 12 Monate",
  year: "letzte 5 Jahre",
};

let statsRange = "week";
let statsMetric = "total";
let pendingStreakPop = null;
let statsView = "mine"; // "mine" | "rankings"

function statsKey(user) {
  return `medipulse_stats_${user}`;
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadStats(user) {
  let stats;
  try {
    stats = JSON.parse(localStorage.getItem(statsKey(user)) || "null");
  } catch {
    stats = null;
  }
  if (!stats) stats = { history: {}, notes: [] };
  if (!stats.history) stats.history = {};
  if (!stats.notes) stats.notes = [];
  if (stats.counters) {
    // Migration von der alten reinen Zähler-Version auf den Tagesverlauf
    const today = dateStr(new Date());
    if (!stats.history[today]) stats.history[today] = {};
    STAT_CATEGORIES.forEach((c) => {
      if (stats.counters[c.key] && !stats.history[today][c.key]) {
        stats.history[today][c.key] = stats.counters[c.key];
      }
    });
    delete stats.counters;
    saveStats(user, stats);
  }
  return stats;
}
function saveStats(user, stats) {
  localStorage.setItem(statsKey(user), JSON.stringify(stats));
}

function todayValue(history, key) {
  const day = history[dateStr(new Date())];
  return (day && day[key]) || 0;
}

function currentStreak(history, key) {
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!((history[dateStr(cursor)] || {})[key] > 0)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while ((history[dateStr(cursor)] || {})[key] > 0) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function longestStreakCount(history, key) {
  const days = Object.keys(history)
    .filter((d) => (history[d][key] || 0) > 0)
    .sort();
  if (!days.length) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const diffDays = Math.round((new Date(days[i]) - new Date(days[i - 1])) / 86400000);
    run = diffDays === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

let streakCelebrationTimer = null;
function celebrateStreak(categoryLabel, streak) {
  const overlay = document.getElementById("streak-celebration");
  const flame = overlay.querySelector(".streak-celebration-flame");
  const textEl = document.getElementById("streak-celebration-text");
  textEl.textContent = `${categoryLabel} · ${streak}-Tage-Streak`;
  overlay.hidden = false;
  // Animation neu starten, falls kurz hintereinander mehrfach ausgelöst
  flame.style.animation = "none";
  textEl.style.animation = "none";
  void overlay.offsetWidth;
  flame.style.animation = "";
  textEl.style.animation = "";
  clearTimeout(streakCelebrationTimer);
  streakCelebrationTimer = setTimeout(() => {
    overlay.hidden = true;
  }, 1750);
}

function bumpStat(key, delta) {
  if (!currentUser) return;
  const stats = loadStats(currentUser);
  const today = dateStr(new Date());
  if (!stats.history[today]) stats.history[today] = {};
  const before = stats.history[today][key] || 0;
  const after = Math.max(0, before + delta);
  stats.history[today][key] = after;
  if (before === 0 && after > 0) {
    pendingStreakPop = key;
    const cat = STAT_CATEGORIES.find((c) => c.key === key);
    celebrateStreak(cat.label, currentStreak(stats.history, key));
  }
  saveStats(currentUser, stats);
  renderSalesStatsPanel();
}

function addStatNote(title, text) {
  if (!currentUser || !title.trim()) return;
  const stats = loadStats(currentUser);
  stats.notes.unshift({ date: new Date().toLocaleDateString("de-DE"), title: title.trim(), text: text.trim() });
  saveStats(currentUser, stats);
  renderSalesStatsPanel();
}

function deleteStatNote(index) {
  if (!currentUser) return;
  const stats = loadStats(currentUser);
  stats.notes.splice(index, 1);
  saveStats(currentUser, stats);
  renderSalesStatsPanel();
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function buildBuckets(range, offset) {
  const shift = offset || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  if (range === "day") {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i - shift);
      buckets.push({
        label: d.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", ""),
        dates: [dateStr(d)],
      });
    }
  } else if (range === "week") {
    const thisMonday = mondayOf(today);
    for (let i = 7; i >= 0; i--) {
      const monday = new Date(thisMonday);
      monday.setDate(monday.getDate() - (i + shift) * 7);
      const dates = [];
      for (let j = 0; j < 7; j++) {
        const d = new Date(monday);
        d.setDate(d.getDate() + j);
        dates.push(dateStr(d));
      }
      buckets.push({ label: `KW${isoWeekNumber(monday)}`, dates });
    }
  } else if (range === "month") {
    for (let i = 11; i >= 0; i--) {
      const m = new Date(today.getFullYear(), today.getMonth() - i - shift, 1);
      const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      const dates = [];
      for (let day = 1; day <= daysInMonth; day++) dates.push(dateStr(new Date(m.getFullYear(), m.getMonth(), day)));
      buckets.push({ label: m.toLocaleDateString("de-DE", { month: "short" }).replace(".", ""), dates });
    }
  } else {
    const startYear = today.getFullYear() - 4 - shift * 5;
    for (let y = startYear; y <= startYear + 4; y++) {
      buckets.push({ label: String(y), yearPrefix: `${y}-` });
    }
  }
  return buckets;
}

function bucketValue(history, bucket, metric) {
  const sumDay = (dateKey) => {
    const day = history[dateKey];
    if (!day) return 0;
    if (metric === "total") return STAT_CATEGORIES.reduce((s, c) => s + (day[c.key] || 0), 0);
    return day[metric] || 0;
  };
  if (bucket.yearPrefix) {
    return Object.keys(history)
      .filter((d) => d.startsWith(bucket.yearPrefix))
      .reduce((s, d) => s + sumDay(d), 0);
  }
  return bucket.dates.reduce((s, d) => s + sumDay(d), 0);
}

function animateCountUp(el, target) {
  const startTime = performance.now();
  const duration = 550;
  function tick(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * eased).toLocaleString("de-DE");
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderStatsChart(history) {
  const buckets = buildBuckets(statsRange, 0);
  const values = buckets.map((b) => bucketValue(history, b, statsMetric));
  const total = values.reduce((a, b) => a + b, 0);

  const prevBuckets = buildBuckets(statsRange, 1);
  const prevTotal = prevBuckets.reduce((s, b) => s + bucketValue(history, b, statsMetric), 0);

  animateCountUp(document.getElementById("stat-chart-total"), total);

  const metricLabel = statsMetric === "total" ? "Gesamt" : STAT_CATEGORIES.find((c) => c.key === statsMetric).label;
  document.getElementById("stat-chart-sub").textContent = `${metricLabel} · ${STAT_RANGE_HINT[statsRange]}`;

  const deltaEl = document.getElementById("stat-chart-delta");
  if (prevTotal > 0) {
    const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
    deltaEl.textContent = `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}%`;
    deltaEl.className = `stat-chart-delta ${pct >= 0 ? "up" : "down"}`;
  } else if (total > 0) {
    deltaEl.textContent = "▲ neu";
    deltaEl.className = "stat-chart-delta up";
  } else {
    deltaEl.textContent = "";
    deltaEl.className = "stat-chart-delta";
  }

  const wrap = document.getElementById("stat-chart-wrap");
  const max = Math.max(1, ...values);
  const W = 300;
  const H = 130;
  const gap = 5;
  const barW = (W - gap * (values.length - 1)) / values.length;
  const top = 16;
  const baseline = H - 20;
  const trackHeight = baseline - top;
  const tracks = values
    .map((v, i) => {
      const x = (i * (barW + gap)).toFixed(1);
      return `<rect class="stat-bar-track" x="${x}" y="${top}" width="${barW.toFixed(1)}" height="${trackHeight}" rx="4"></rect>`;
    })
    .join("");
  const bars = values
    .map((v, i) => {
      const h = Math.round((v / max) * trackHeight);
      const x = (i * (barW + gap)).toFixed(1);
      return `<rect class="stat-bar" x="${x}" y="${baseline}" width="${barW.toFixed(1)}" height="0" rx="4" data-y="${(baseline - h).toFixed(1)}" data-h="${h}"><title>${v}</title></rect>`;
    })
    .join("");
  const valueLabels = values
    .map((v, i) => {
      if (!v) return "";
      const h = Math.round((v / max) * trackHeight);
      const x = (i * (barW + gap) + barW / 2).toFixed(1);
      const y = (baseline - h - 4).toFixed(1);
      return `<text class="stat-bar-value" data-y="${y}" x="${x}" y="${baseline}" text-anchor="middle">${v}</text>`;
    })
    .join("");
  const labels = buckets
    .map((b, i) => {
      const x = (i * (barW + gap) + barW / 2).toFixed(1);
      return `<text class="stat-bar-label" x="${x}" y="${H - 6}" text-anchor="middle">${escapeHtml(b.label)}</text>`;
    })
    .join("");
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="stat-chart-svg" preserveAspectRatio="none">
    <defs>
      <linearGradient id="statBarGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" class="stat-bar-grad-top"></stop>
        <stop offset="100%" class="stat-bar-grad-bottom"></stop>
      </linearGradient>
    </defs>
    ${tracks}${bars}${valueLabels}${labels}
  </svg>`;
  requestAnimationFrame(() => {
    wrap.querySelectorAll(".stat-bar").forEach((rect, i) => {
      setTimeout(() => {
        rect.setAttribute("y", rect.dataset.y);
        rect.setAttribute("height", rect.dataset.h);
      }, i * 22);
    });
    wrap.querySelectorAll(".stat-bar-value").forEach((text, i) => {
      setTimeout(() => {
        text.setAttribute("y", text.dataset.y);
        text.classList.add("visible");
      }, i * 22 + 150);
    });
  });
}

// Vergleicht alle auf diesem Gerät registrierten Konten für den gewählten
// Zeitraum/Metrik (dieselben Tabs wie bei "Meine Statistik"). Da Konten
// nur lokal in diesem Browser existieren, zeigt das Ranking nur dann
// mehrere Personen, wenn mehrere Kolleg:innen dasselbe Gerät nutzen —
// bei je eigenem Laptop sieht jede:r vorerst nur sich selbst.
function rankingTrendHtml(total, prevTotal) {
  if (prevTotal > 0) {
    const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
    return `<span class="ranking-trend ${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
  }
  if (total > 0) return `<span class="ranking-trend up">▲ neu</span>`;
  return "";
}

function renderRankingsView(body) {
  const users = loadUsers().map((u) => u.name);
  const buckets = buildBuckets(statsRange, 0);
  const prevBuckets = buildBuckets(statsRange, 1);
  const totals = users
    .map((user) => {
      const stats = loadStats(user);
      const total = buckets.reduce((sum, b) => sum + bucketValue(stats.history, b, statsMetric), 0);
      const prevTotal = prevBuckets.reduce((sum, b) => sum + bucketValue(stats.history, b, statsMetric), 0);
      return { user, total, prevTotal };
    })
    .sort((a, b) => b.total - a.total);

  const rangeTabs = STAT_RANGES.map(
    (r) => `<button type="button" class="stat-tab ${statsRange === r.key ? "active" : ""}" data-range="${r.key}">${r.label}</button>`
  ).join("");
  const metricTabs = [{ key: "total", emoji: "📊", label: "Gesamt" }, ...STAT_CATEGORIES]
    .map(
      (m) =>
        `<button type="button" class="stat-tab stat-tab-metric ${statsMetric === m.key ? "active" : ""}" data-metric="${m.key}" title="${escapeHtml(m.label)}">${m.emoji}</button>`
    )
    .join("");

  const max = Math.max(1, ...totals.map((t) => t.total));
  const rows = totals
    .map((t, i) => {
      const pct = Math.round((t.total / max) * 100);
      const isLeader = i === 0 && t.total > 0;
      const avatar = getAvatar(t.user);
      return `
      <div class="ranking-row ${t.user === currentUser ? "ranking-row-me" : ""}">
        <div class="ranking-rank">${i + 1}.</div>
        <div class="ranking-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : "👤"}</div>
        <div class="ranking-info">
          <div class="ranking-name">${escapeHtml(t.user)}</div>
          <div class="ranking-bar-track">
            ${isLeader ? '<span class="ranking-crown">👑</span>' : ""}
            <div class="ranking-bar-fill ${isLeader ? "leader" : ""}" data-pct="${pct}"></div>
          </div>
        </div>
        <div class="ranking-value-col">
          <div class="ranking-value">${t.total.toLocaleString("de-DE")}</div>
          ${rankingTrendHtml(t.total, t.prevTotal)}
        </div>
      </div>`;
    })
    .join("");

  body.innerHTML = `
    <div class="stat-tabs-row">${rangeTabs}</div>
    <div class="stat-tabs-row stat-tabs-row-metric">${metricTabs}</div>
    <div class="ranking-sub">${STAT_RANGE_HINT[statsRange]}</div>
    <div class="ranking-list">${rows || '<div class="infothek-empty">Noch keine registrierten Nutzer:innen.</div>'}</div>
  `;

  body.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (statsRange === btn.dataset.range) return;
      statsRange = btn.dataset.range;
      renderSalesStatsPanel();
    });
  });
  body.querySelectorAll("[data-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (statsMetric === btn.dataset.metric) return;
      statsMetric = btn.dataset.metric;
      renderSalesStatsPanel();
    });
  });

  requestAnimationFrame(() => {
    body.querySelectorAll(".ranking-bar-fill").forEach((el, i) => {
      setTimeout(() => {
        el.style.width = el.dataset.pct + "%";
      }, i * 80);
    });
  });
}

function renderSalesStatsPanel() {
  document.querySelectorAll(".stats-view-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === statsView);
  });

  const loggedOutBox = document.getElementById("sales-stats-logged-out");
  const body = document.getElementById("sales-stats-body");
  if (!currentUser) {
    loggedOutBox.hidden = false;
    body.hidden = true;
    return;
  }
  loggedOutBox.hidden = true;
  body.hidden = false;

  if (statsView === "rankings") {
    renderRankingsView(body);
    return;
  }

  const stats = loadStats(currentUser);

  const streakRows = STAT_CATEGORIES.map((c) => {
    const streak = currentStreak(stats.history, c.key);
    const record = longestStreakCount(stats.history, c.key);
    const isPop = pendingStreakPop === c.key;
    return `
    <div class="stat-counter-row">
      <div class="stat-counter-top">
        <span class="stat-counter-label">${c.emoji} ${escapeHtml(c.label)}</span>
        <span class="stat-streak-badge ${streak > 0 ? "active" : ""}">
          <span class="stat-streak-flame ${isPop ? "pop" : ""}">${streak > 0 ? "🔥" : "💤"}</span>
          <span class="stat-streak-num">${streak}</span>
          ${record > 1 ? `<span class="stat-streak-record">Rekord ${record}</span>` : ""}
        </span>
      </div>
      <div class="stat-counter-bottom">
        <span class="stat-counter-today-label">Heute</span>
        <div class="stat-counter-controls">
          <button type="button" class="stat-counter-btn" data-action="dec" data-key="${c.key}">–</button>
          <span class="stat-counter-value">${todayValue(stats.history, c.key)}</span>
          <button type="button" class="stat-counter-btn" data-action="inc" data-key="${c.key}">+</button>
        </div>
      </div>
    </div>`;
  }).join("");
  pendingStreakPop = null;

  const rangeTabs = STAT_RANGES.map(
    (r) => `<button type="button" class="stat-tab ${statsRange === r.key ? "active" : ""}" data-range="${r.key}">${r.label}</button>`
  ).join("");
  const metricTabs = [{ key: "total", emoji: "📊", label: "Gesamt" }, ...STAT_CATEGORIES]
    .map(
      (m) =>
        `<button type="button" class="stat-tab stat-tab-metric ${statsMetric === m.key ? "active" : ""}" data-metric="${m.key}" title="${escapeHtml(m.label)}">${m.emoji}</button>`
    )
    .join("");

  const noteItems = stats.notes
    .slice(0, 20)
    .map((n, i) => {
      const title = n.title || (n.text ? n.text.slice(0, 40) : "(ohne Titel)");
      return `
      <li class="stat-note-item">
        <div class="stat-note-row">
          <button type="button" class="stat-note-title-btn" data-index="${i}">
            <span class="stat-note-date">${escapeHtml(n.date)}</span>
            <span class="stat-note-title-text">${escapeHtml(title)}</span>
          </button>
          <button type="button" class="stat-note-delete-btn" data-index="${i}" title="Notiz löschen">×</button>
        </div>
        <div class="stat-note-full-text" hidden>${escapeHtml(n.text || "(keine weiteren Details)")}</div>
      </li>`;
    })
    .join("");

  body.innerHTML = `
    <div class="stat-streak-title">🔥 Streaks</div>
    ${streakRows}
    <div class="settings-divider"></div>
    <div class="stat-tabs-row">${rangeTabs}</div>
    <div class="stat-tabs-row stat-tabs-row-metric">${metricTabs}</div>
    <div class="stat-chart-summary">
      <span class="stat-chart-total" id="stat-chart-total">0</span>
      <span class="stat-chart-delta" id="stat-chart-delta"></span>
      <span class="stat-chart-sub" id="stat-chart-sub"></span>
    </div>
    <div class="stat-chart-wrap" id="stat-chart-wrap"></div>
    <div class="settings-divider"></div>
    <div class="stat-notes-title">Notizen</div>
    <button type="button" id="stat-note-open" class="stat-note-open-btn">+ Notiz hinzufügen</button>
    <ul class="stat-note-list">${noteItems || '<li class="stat-note-item">Noch keine Notizen.</li>'}</ul>
  `;

  body.querySelectorAll(".stat-counter-btn").forEach((btn) => {
    btn.addEventListener("click", () => bumpStat(btn.dataset.key, btn.dataset.action === "inc" ? 1 : -1));
  });
  body.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (statsRange === btn.dataset.range) return;
      statsRange = btn.dataset.range;
      renderSalesStatsPanel();
    });
  });
  body.querySelectorAll("[data-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (statsMetric === btn.dataset.metric) return;
      statsMetric = btn.dataset.metric;
      renderSalesStatsPanel();
    });
  });
  const noteOpenBtn = document.getElementById("stat-note-open");
  if (noteOpenBtn) noteOpenBtn.addEventListener("click", openNoteEditor);
  body.querySelectorAll(".stat-note-title-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fullText = btn.closest(".stat-note-item").querySelector(".stat-note-full-text");
      fullText.hidden = !fullText.hidden;
    });
  });
  body.querySelectorAll(".stat-note-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteStatNote(Number(btn.dataset.index)));
  });

  renderStatsChart(stats.history);
}

function openNoteEditor() {
  document.getElementById("note-editor-title").value = "";
  document.getElementById("note-editor-text").value = "";
  document.getElementById("note-editor-backdrop").hidden = false;
  document.getElementById("note-editor-title").focus();
}
function closeNoteEditor() {
  document.getElementById("note-editor-backdrop").hidden = true;
}
document.getElementById("note-editor-close").addEventListener("click", closeNoteEditor);
document.getElementById("note-editor-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "note-editor-backdrop") closeNoteEditor();
});
document.getElementById("note-editor-save").addEventListener("click", () => {
  const title = document.getElementById("note-editor-title").value;
  const text = document.getElementById("note-editor-text").value;
  if (!title.trim()) {
    document.getElementById("note-editor-title").focus();
    return;
  }
  addStatNote(title, text);
  closeNoteEditor();
});

document.querySelectorAll(".stats-view-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (statsView === btn.dataset.view) return;
    statsView = btn.dataset.view;
    renderSalesStatsPanel();
  });
});

document.getElementById("sales-stats-toggle").addEventListener("click", () => {
  const panel = document.getElementById("sales-stats-panel");
  const willOpen = panel.hidden;
  closeAllOverlayPanels();
  panel.hidden = !willOpen;
  if (willOpen) renderSalesStatsPanel();
});
document.getElementById("sales-stats-close").addEventListener("click", () => {
  document.getElementById("sales-stats-panel").hidden = true;
});
document.getElementById("sales-stats-login-btn").addEventListener("click", () => {
  document.getElementById("sales-stats-panel").hidden = true;
  document.getElementById("auth-panel").hidden = false;
  renderAuthPanel();
});

updateUserBadge();

// ============================================================================
// Geführte Tour — erklärt jede Funktion direkt an der echten Oberfläche
// (öffnet dafür kurz die jeweiligen Panels/Popups), statt in einem separaten
// Hilfe-Dokument, das schnell veraltet und nie gelesen wird.
// ============================================================================
(function () {
  const overlay = document.getElementById("tour-overlay");
  const highlightEl = document.getElementById("tour-highlight");
  const tooltipEl = document.getElementById("tour-tooltip");
  const stepLabelEl = document.getElementById("tour-step-label");
  const titleEl = document.getElementById("tour-title");
  const textEl = document.getElementById("tour-text");
  const backBtn = document.getElementById("tour-back-btn");
  const nextBtn = document.getElementById("tour-next-btn");
  const skipBtn = document.getElementById("tour-skip-btn");

  let steps = [];
  let stepIndex = 0;
  let active = false;
  let priorState = null;

  function pickDemoDoctor() {
    const pool = AERZTE_DATA;
    if (!pool || !pool.length) return null;
    return (
      pool.find((d) => d.kette && d.telefon && d.status !== "kunde" && !getInfosheet(d.id)) ||
      pool.find((d) => d.status !== "kunde") ||
      pool[0]
    );
  }

  function ensurePanel(panelId, renderFn) {
    closeAllOverlayPanels();
    document.getElementById(panelId).hidden = false;
    if (renderFn) renderFn();
  }

  function ensureDemoPopup(demo, expandInfothek) {
    if (!demo) return;
    closeAllOverlayPanels();
    if (expandInfothek) infothekExpandedFor = demo.id;
    map.jumpTo({ center: [demo.lng, demo.lat], zoom: 10 });
    openDoctorPopup(demo, [demo.lng, demo.lat]);
  }

  function buildSteps() {
    const demo = pickDemoDoctor();
    const accountText = currentUser
      ? `Du bist aktuell als „${currentUser}“ angemeldet. Hier änderst du dein Profilbild, meldest dich ab oder löschst dein Konto komplett (das entfernt dich dann auch aus den Rankings).`
      : `Hier meldest du dich an oder registrierst ein neues Konto — nur ein Name + Passwort, rein lokal auf diesem Gerät. Angemeldet lässt sich deine eigene Statistik führen und du erscheinst in den Rankings.`;

    return [
      {
        target: null,
        title: "Willkommen bei MediPulse 👋",
        text: "Diese Tour zeigt dir Schritt für Schritt jede Funktion der App. Mit „Weiter“ geht's los — mit dem × oben rechts steigst du jederzeit aus.",
      },
      {
        target: "#stats",
        title: "Kennzahlen auf einen Blick",
        before: () => closeAllOverlayPanels(),
        text: "Live-Übersicht: wie viele Praxen insgesamt erfasst sind und wie viele davon Kunden, Interessenten oder Leads sind.",
      },
      {
        target: "#notif-bell",
        title: "Follow-up-Erinnerungen",
        before: () => ensurePanel("notif-panel"),
        text: "Sobald du über den E-Mail-Button im Popup eine Erstansprache verschickt hast, taucht hier 24 Stunden später automatisch eine Erinnerung auf, falls noch kein Follow-up gesendet wurde — inklusive fertigem Follow-up-Text.",
      },
      {
        target: "#user-badge",
        title: "Konto",
        before: () => ensurePanel("auth-panel", renderAuthPanel),
        text: accountText,
      },
      {
        target: "#sales-stats-toggle",
        title: "Meine Statistik",
        before: () => {
          statsView = "mine";
          ensurePanel("sales-stats-panel", renderSalesStatsPanel);
        },
        text: "Deine eigenen Zahlen — Anrufe, Vor-Ort-Termine, neue Kunden, E-Mails — über Tag, Woche oder Monat, inklusive Streaks für Tage in Folge mit Aktivität.",
      },
      {
        target: currentUser ? "#sales-stats-body" : "#sales-stats-logged-out",
        title: "Rankings",
        before: () => {
          statsView = "rankings";
          renderSalesStatsPanel();
        },
        text: currentUser
          ? "Der Team-Vergleich. Wichtig: Das Ranking zeigt nur Kolleg:innen, die auf DIESEM Gerät/Browser registriert sind — bei getrennten Laptops sieht aktuell jede:r nur sich selbst."
          : "Der Team-Vergleich (nach Anmeldung sichtbar). Wichtig: Das Ranking zeigt nur Kolleg:innen, die auf DIESEM Gerät/Browser registriert sind — bei getrennten Laptops sieht aktuell jede:r nur sich selbst.",
      },
      {
        target: "#settings-toggle",
        title: "Einstellungen",
        before: () => ensurePanel("settings-panel"),
        text: "Globale Anzeige-Optionen — schauen wir sie uns einzeln an.",
      },
      {
        target: "#settings-rotate-toggle",
        title: "Automatische Rotation",
        text: "Lässt die Karte im Ruhezustand langsam von selbst weiterdrehen — praktisch als Übersichts-/Bildschirmschoner-Ansicht.",
      },
      {
        target: "#settings-heatmap-toggle",
        title: "Heatmap",
        text: "Blendet zusätzlich eine Dichte-Heatmap ein. Direkt darunter lässt sich der Bereich einschränken: nur Kunden, nur Leads oder alle Praxen.",
      },
      {
        target: "#gpa-slider",
        title: "Gewinn pro Arzt",
        text: "Dieser Wert (€ pro Arzt/Ärztin) fließt in die „möglicher Umsatz“-Schätzung im Popup jeder Praxis ein — je nach Praxisgröße hochgerechnet.",
      },
      {
        target: "#settings-gemini-worker-url",
        title: "Gemini-Worker (optional)",
        text: "Trägst du hier die URL eures Cloudflare Workers ein, recherchiert die App beim Erstellen eines Infosheets automatisch per KI, inklusive optional hochgeladener Dokumente. Ohne URL bleibt es beim manuellen Workflow — dazu gleich mehr bei der Infothek.",
      },
      {
        target: "#search",
        title: "Suche",
        before: () => closeAllOverlayPanels(),
        text: "Volltextsuche über Name, Stadt und Fachrichtung — filtert Liste und Karte sofort.",
      },
      {
        target: "#status-filter-group",
        title: "Filter: Status",
        text: "Blendet Praxen nach Status ein/aus — Kunde, Interessent, Lead, Inaktiv.",
      },
      {
        target: ".kategorie-filters",
        title: "Filter: Fachrichtung & MVZ",
        text: "Filtert nach Fachrichtung — „alle“/„keine“ setzt alle Kacheln auf einmal.",
      },
      {
        target: ".groesse-filter",
        title: "Filter: Praxisgröße",
        text: "Regler + Zahlenfeld, um nur Praxen ab einer bestimmten Anzahl Ärzt:innen anzuzeigen.",
      },
      {
        target: ".bundesland-filter",
        title: "Filter: Bundesland",
        before: () => {
          const body = document.getElementById("bundesland-body");
          const chevron = document.querySelector('.chevron-btn[data-target="bundesland-body"]');
          body.classList.remove("collapsed");
          if (chevron) chevron.setAttribute("aria-expanded", "true");
        },
        text: "Genau wie bei der Fachrichtung, nur nach Bundesland.",
      },
      {
        target: "#doctor-list",
        title: "Praxen-Liste",
        text: "Alle gefilterten Praxen als Liste — ein Klick fliegt auf der Karte direkt zur Praxis und öffnet ihre Infokarte.",
      },
      {
        target: "#sidebar-toggle",
        title: "Liste ein-/ausblenden",
        text: "Blendet die linke Seitenleiste aus, wenn du mehr Platz für die Karte brauchst.",
      },
      {
        target: "#map",
        title: "Die Karte",
        before: () => {
          document.getElementById("sidebar").classList.remove("collapsed");
          closeAllOverlayPanels();
          if (currentPopupDoctor) popup.remove();
        },
        text: "Jeder Punkt ist eine Praxis, farbcodiert nach Status (siehe Legende unten links). Klick auf einen Punkt öffnet die Infokarte — schauen wir sie uns als Nächstes an.",
      },
      {
        target: ".popup-make-kunde-btn, .popup-unmake-kunde-btn",
        title: "Infokarte: Status ändern",
        before: () => ensureDemoPopup(demo, false),
        text: "Ein Klick macht eine Praxis direkt zum Kunden — der vorherige Status (Lead/Interessent) wird gemerkt. „Kein Kunde mehr“ macht das jederzeit wieder rückgängig.",
      },
      {
        target: ".size-row",
        title: "Praxisgröße",
        before: () => ensureDemoPopup(demo, false),
        text: "Zeigt die Anzahl Ärzt:innen an diesem Standort auf einer visuellen Skala.",
      },
      {
        target: ".earnings-row",
        title: "Möglicher Umsatz",
        before: () => ensureDemoPopup(demo, false),
        text: "Hochrechnung aus Praxisgröße × „Gewinn pro Arzt“ aus den Einstellungen. Verschwindet automatisch, sobald die Praxis Kunde ist.",
      },
      {
        target: ".popup-email-row",
        title: "Kontakt & E-Mail",
        before: () => ensureDemoPopup(demo, false),
        text: "Adresse, Ansprechpartner, Telefon und E-Mail der Praxis. Fehlt die E-Mail-Adresse in den Rohdaten, trägst du sie über das ✏️-Symbol manuell nach — jederzeit änderbar.",
      },
      {
        target: ".popup-actions",
        title: "Aktionen",
        before: () => ensureDemoPopup(demo, false),
        text: "„Anrufen“ öffnet die Telefon-App, „E-Mail“ öffnet eine vorformulierte Erstansprache (mit den größten Painpoints aus der Infothek, falls vorhanden) in deinem E-Mail-Programm, „Route“ öffnet die Routenplanung.",
      },
      {
        target: "#route-planner",
        title: "Routenplanung",
        before: () => {
          ensureDemoPopup(demo, false);
          if (demo) openRoutePlanner(demo);
        },
        after: () => closeRoutePlanner(),
        text: "Start-Praxis ist schon gesetzt. Du kannst weitere Praxis-Stopps ergänzen (per Klick auf der Karte oder aus der Liste) — am Ende öffnet sich die komplette, fertig sortierte Route direkt in Google Maps.",
      },
      {
        target: ".infothek",
        title: "Infothek & Recherche",
        before: () => ensureDemoPopup(demo, true),
        text: "Hier sammelst du recherchierte Hintergrundinfos zur Praxis. Die eigentliche Recherche läuft über den „medipulse-infosheet“-Skill in Claude Code: Du nennst Claude dort den Praxisnamen, Claude recherchiert Trigger, Firmografie, Struktur, Produkt und die größten Painpoints — und liefert am Ende einen fertigen Text plus passende .txt-Datei.",
      },
      {
        target: "#infosheet-paste-all",
        title: "Recherche-Ergebnis übernehmen",
        before: () => {
          ensureDemoPopup(demo, true);
          if (demo) openInfosheetEditor(demo);
        },
        after: () => closeInfosheetEditor(),
        text: "Den kompletten Text aus Claude fügst du hier oben ein und klickst „Auf die Felder unten verteilen“ — die Felder Trigger, Firmografie, Struktur, Produkt und Painpoints werden automatisch anhand der Überschriften befüllt. Alternativ lädst du direkt die vom Skill mitgelieferte .txt-Datei über „📎 Stattdessen .txt-Datei hochladen“ hoch. Ganz ohne Recherche lassen sich die Felder darunter auch von Hand ausfüllen.",
      },
      {
        target: geminiWorkerUrl ? ".infosheet-docs" : null,
        title: "Dokumente zur Recherche",
        before: () => ensureDemoPopup(demo, true),
        text: geminiWorkerUrl
          ? "Optional lassen sich bis zu 3 PDFs/Bilder je Praxis hochladen (z.B. Screenshots der Webseite) — die fließen automatisch als Zusatzkontext in eine erneute KI-Recherche ein (Button „🔄 Mit Dokumenten neu recherchieren“, sobald ein Infosheet existiert)."
          : "Sobald in den Einstellungen eine Gemini-Worker-URL hinterlegt ist, taucht hier zusätzlich ein Upload für bis zu 3 PDFs/Bilder je Praxis auf (z.B. Screenshots der Webseite) — die fließen dann automatisch als Zusatzkontext in die KI-Recherche ein.",
      },
      {
        target: null,
        title: "Das war's! 🎉",
        before: () => {
          closeAllOverlayPanels();
          if (currentPopupDoctor) popup.remove();
        },
        text: "Du kennst jetzt jede Funktion der App. Diese Tour startest du jederzeit erneut über den „Tutorial“-Button unten rechts.",
      },
    ];
  }

  function positionTooltip(target) {
    tooltipEl.style.visibility = "hidden";
    tooltipEl.style.top = "0px";
    tooltipEl.style.left = "0px";
    requestAnimationFrame(() => {
      const margin = 14;
      const tw = tooltipEl.offsetWidth;
      const th = tooltipEl.offsetHeight;
      let top, left;
      if (!target) {
        highlightEl.hidden = true;
        top = (window.innerHeight - th) / 2;
        left = (window.innerWidth - tw) / 2;
      } else {
        const rect = target.getBoundingClientRect();
        highlightEl.hidden = false;
        highlightEl.style.top = `${rect.top - 6}px`;
        highlightEl.style.left = `${rect.left - 6}px`;
        highlightEl.style.width = `${rect.width + 12}px`;
        highlightEl.style.height = `${rect.height + 12}px`;

        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow >= th + margin * 2 || spaceBelow >= spaceAbove) {
          top = rect.bottom + margin;
        } else {
          top = rect.top - th - margin;
        }
        left = Math.min(Math.max(rect.left, margin), window.innerWidth - tw - margin);
      }
      top = Math.min(Math.max(top, margin), window.innerHeight - th - margin);
      tooltipEl.style.top = `${top}px`;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.visibility = "visible";
    });
  }

  function showStep(index) {
    stepIndex = index;
    const step = steps[index];
    if (typeof step.before === "function") {
      try {
        step.before();
      } catch (err) {
        console.warn("Tour-Schritt konnte nicht vorbereitet werden:", err);
      }
    }
    stepLabelEl.textContent = `Schritt ${index + 1} von ${steps.length}`;
    titleEl.textContent = step.title;
    textEl.textContent = step.text;
    backBtn.disabled = index === 0;
    nextBtn.textContent = index === steps.length - 1 ? "Fertig" : "Weiter";
    setTimeout(() => {
      const target = step.target ? document.querySelector(step.target) : null;
      if (target) target.scrollIntoView({ block: "center", behavior: "instant" });
      positionTooltip(target);
    }, 120);
  }

  function goTo(index) {
    if (index < 0 || index >= steps.length) return;
    const prevStep = steps[stepIndex];
    if (prevStep && typeof prevStep.after === "function") {
      try {
        prevStep.after();
      } catch (err) {
        console.warn("Tour-Schritt konnte nicht aufgeräumt werden:", err);
      }
    }
    showStep(index);
  }

  function onKeydown(e) {
    if (!active) return;
    if (e.key === "Escape") endTour();
    else if (e.key === "ArrowRight") nextBtn.click();
    else if (e.key === "ArrowLeft" && !backBtn.disabled) goTo(stepIndex - 1);
  }

  function onResize() {
    if (!active) return;
    const step = steps[stepIndex];
    const target = step && step.target ? document.querySelector(step.target) : null;
    positionTooltip(target);
  }

  function startTour() {
    if (active) return;
    active = true;
    closeAllOverlayPanels();
    if (currentPopupDoctor) {
      popup.remove();
      currentPopupDoctor = null;
    }
    priorState = {
      sidebarCollapsed: document.getElementById("sidebar").classList.contains("collapsed"),
      bundeslandCollapsed: document.getElementById("bundesland-body").classList.contains("collapsed"),
      infothekExpandedFor,
    };
    steps = buildSteps();
    overlay.hidden = false;
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onResize);
    showStep(0);
  }

  function endTour() {
    if (!active) return;
    const step = steps[stepIndex];
    if (step && typeof step.after === "function") {
      try {
        step.after();
      } catch (err) {
        console.warn("Tour konnte nicht sauber beendet werden:", err);
      }
    }
    active = false;
    overlay.hidden = true;
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", onResize);
    closeAllOverlayPanels();
    if (currentPopupDoctor) {
      popup.remove();
      currentPopupDoctor = null;
    }
    closeInfosheetEditor();
    closeRoutePlanner();
    if (priorState) {
      document.getElementById("sidebar").classList.toggle("collapsed", priorState.sidebarCollapsed);
      const bundeslandBody = document.getElementById("bundesland-body");
      bundeslandBody.classList.toggle("collapsed", priorState.bundeslandCollapsed);
      const chevron = document.querySelector('.chevron-btn[data-target="bundesland-body"]');
      if (chevron) chevron.setAttribute("aria-expanded", String(!priorState.bundeslandCollapsed));
      infothekExpandedFor = priorState.infothekExpandedFor;
    }
  }

  nextBtn.addEventListener("click", () => {
    if (stepIndex === steps.length - 1) endTour();
    else goTo(stepIndex + 1);
  });
  backBtn.addEventListener("click", () => goTo(stepIndex - 1));
  skipBtn.addEventListener("click", endTour);
  document.getElementById("tour-fab").addEventListener("click", startTour);
})();
