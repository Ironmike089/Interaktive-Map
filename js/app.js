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
let minGroesse = 0;
let maxGroesseInData = 1;

let AERZTE_DATA = [];
const MAX_LIST_ITEMS = 300;

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
  AERZTE_DATA = data;
  dataReady = true;
  maxGroesseInData = data.reduce((max, d) => Math.max(max, d.groesse || 1), 1);
  setLoadingState(false);
  // Liste/Statistik sofort anzeigen, unabhängig davon ob die Kartenkacheln
  // (externe Netzwerkabfrage) schon geladen sind.
  renderList();
  updateStats();
  maybeInit();
});

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

  // Heatmap (optional, per Einstellungen umschaltbar) — eigene Quelle statt
  // der geclusterten "aerzte"-Quelle, damit sie unabhängig von der aktuellen
  // Cluster-Auflösung eine durchgehende Dichtefläche zeigen kann.
  map.addSource("heatmap-source", { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: "heatmap-layer",
    type: "heatmap",
    source: "heatmap-source",
    layout: { visibility: "none" },
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "groesse"], 1], 1, 0.3, 20, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0,0,0,0)",
        0.2, "#3fd0c7",
        0.4, "#4f8cff",
        0.6, "#f5a623",
        0.8, "#e74c3c",
        1, "#ffffff",
      ],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 9, 30],
      "heatmap-opacity": 0.75,
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

function earningsRowHtml(d) {
  const groesse = d.groesse || 1;
  const total = groesse * gewinnProArzt;
  return `<div class="popup-row earnings-row">💰 ${total.toLocaleString("de-DE")} € möglicher Umsatz</div>`;
}

function openDoctorPopup(d, coords) {
  const kategorie = d.kategorie || "sonstige";
  // Nur die Info berechnen (keine Kartenänderung) — das tatsächliche Zeichnen
  // passiert erst NACH addTo(), siehe unten: MapLibre entfernt beim
  // Wiederverwenden desselben Popup-Objekts intern kurz das alte (feuert
  // "close"), was currentPopupDoctor/die Verbindungslinien sonst sofort
  // wieder zurücksetzen würde.
  const conn = getConnectedDoctors(d);
  const html = `
    <div class="popup-title">${escapeHtml(d.name)}</div>
    <div class="popup-sub">
      <span class="dot" style="background:${KATEGORIE_COLORS[kategorie]}"></span>
      ${escapeHtml(KATEGORIE_LABELS[kategorie])} · ${escapeHtml(d.fachrichtung)} · ${escapeHtml(d.stadt)}
    </div>
    ${d.einrichtung ? `<div class="popup-row">🏥 ${escapeHtml(d.einrichtung)}${d.kette ? ` <span style="color:var(--text-dim)">(${escapeHtml(d.kette)})</span>` : ""}</div>` : ""}
    ${conn.total > 0 ? `<div class="popup-row connections-row">🔗 ${conn.total.toLocaleString("de-DE")} weitere Standorte der Kette ${escapeHtml(d.kette)} auf der Karte hervorgehoben${conn.total > conn.items.length ? ` (${conn.items.length} angezeigt)` : ""}</div>` : ""}
    ${sizeGaugeHtml(d.groesse)}
    ${earningsRowHtml(d)}
    <div class="popup-row">📍 ${escapeHtml(d.strasse)}, ${escapeHtml(d.plz)} ${escapeHtml(d.stadt)}</div>
    ${d.ansprechpartner && d.ansprechpartner !== d.name ? `<div class="popup-row">👤 ${escapeHtml(d.ansprechpartner)}</div>` : ""}
    ${d.telefon ? `<div class="popup-row">📞 ${escapeHtml(d.telefon)}</div>` : ""}
    ${d.email ? `<div class="popup-row">✉️ ${escapeHtml(d.email)}</div>` : ""}
    ${d.website ? `<div class="popup-row">🔗 <a href="${escapeHtml(d.website)}" target="_blank" rel="noopener">${escapeHtml(d.website.replace(/^https?:\/\//, ""))}</a></div>` : ""}
    ${d.notizen ? `<div class="popup-row" style="color:var(--text-dim)">📝 ${escapeHtml(d.notizen)}</div>` : ""}
    <div class="popup-actions">
      ${d.telefon ? `<a href="tel:${escapeHtml(d.telefon)}">Anrufen</a>` : ""}
      ${d.email ? `<a href="mailto:${escapeHtml(d.email)}">E-Mail</a>` : ""}
      <button type="button" class="popup-route-btn">Route</button>
    </div>
  `;
  popup.setLngLat(coords).setHTML(html).addTo(map);
  currentPopupDoctor = d;
  updateConnections(d);
}

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
      <div class="doctor-meta doctor-earnings">💰 ${((d.groesse || 1) * gewinnProArzt).toLocaleString("de-DE")} € möglich</div>
    `;
    li.addEventListener("click", () => selectDoctor(d.id, true));
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

function heatmapGeoJSON() {
  let data = getFilteredData();
  const scope = document.querySelector('input[name="heatmap-scope"]:checked').value;
  if (scope === "kunde") data = data.filter((d) => d.status === "kunde");
  return toGeoJSON(data);
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

document.getElementById("settings-heatmap-toggle").addEventListener("change", (e) => {
  document.getElementById("heatmap-scope-row").hidden = !e.target.checked;
  setHeatmapVisible(e.target.checked);
});
document.querySelectorAll('input[name="heatmap-scope"]').forEach((r) => {
  r.addEventListener("change", () => { if (heatmapEnabled) updateHeatmap(); });
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
  document.getElementById("settings-panel").hidden = false;
});
document.getElementById("settings-close").addEventListener("click", () => {
  document.getElementById("settings-panel").hidden = true;
});
document.addEventListener("click", (e) => {
  const panel = document.getElementById("settings-panel");
  if (!panel.hidden && !panel.contains(e.target) && e.target.id !== "settings-toggle") {
    panel.hidden = true;
  }
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

// Der "Route"-Button im Popup wird per Event-Delegation behandelt, weil das
// Popup-HTML bei jedem Öffnen neu erzeugt wird (siehe openDoctorPopup).
document.addEventListener("click", (e) => {
  if (e.target.closest(".popup-route-btn") && currentPopupDoctor) {
    openRoutePlanner(currentPopupDoctor);
  }
});
