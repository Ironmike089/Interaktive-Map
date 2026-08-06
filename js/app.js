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

let activeStatuses = new Set(["kunde", "interessent", "lead", "inaktiv"]);
let activeKategorien = new Set(KATEGORIE_KEYS);
let searchTerm = "";
let autoRotate = true;
let userInteracting = false;
let rotateFrame = null;
let selectedId = null;

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

function createPinIcon() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  // Kreis (Kopf der Pin-Form)
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.36, size * 0.26, 0, Math.PI * 2);
  ctx.fill();
  // Spitze (Dreieck) darunter
  ctx.beginPath();
  ctx.moveTo(size * 0.28, size * 0.42);
  ctx.lineTo(size * 0.72, size * 0.42);
  ctx.lineTo(size * 0.5, size * 0.92);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function setupMapLayers() {
  map.addImage("pin-icon", createPinIcon(), { sdf: true });

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

  map.addLayer({
    id: "unclustered-point",
    type: "symbol",
    source: "aerzte",
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": "pin-icon",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.32, 12, 0.55, 16, 0.75],
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": [
        "match",
        ["get", "kategorie"],
        ...KATEGORIE_KEYS.flatMap((key) => [key, KATEGORIE_COLORS[key]]),
        KATEGORIE_COLORS.sonstige,
      ],
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1.2,
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

function openDoctorPopup(d, coords) {
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=17/${d.lat}/${d.lng}`;
  const kategorie = d.kategorie || "sonstige";
  const html = `
    <div class="popup-title">${escapeHtml(d.name)}</div>
    <div class="popup-sub">
      <span class="dot" style="background:${KATEGORIE_COLORS[kategorie]}"></span>
      ${escapeHtml(KATEGORIE_LABELS[kategorie])} · ${escapeHtml(d.fachrichtung)} · ${escapeHtml(d.stadt)}
    </div>
    ${d.einrichtung ? `<div class="popup-row">🏥 ${escapeHtml(d.einrichtung)}${d.kette ? ` <span style="color:var(--text-dim)">(${escapeHtml(d.kette)})</span>` : ""}</div>` : ""}
    <div class="popup-row">📍 ${escapeHtml(d.strasse)}, ${escapeHtml(d.plz)} ${escapeHtml(d.stadt)}</div>
    ${d.ansprechpartner && d.ansprechpartner !== d.name ? `<div class="popup-row">👤 ${escapeHtml(d.ansprechpartner)}</div>` : ""}
    ${d.telefon ? `<div class="popup-row">📞 ${escapeHtml(d.telefon)}</div>` : ""}
    ${d.email ? `<div class="popup-row">✉️ ${escapeHtml(d.email)}</div>` : ""}
    ${d.website ? `<div class="popup-row">🔗 <a href="${escapeHtml(d.website)}" target="_blank" rel="noopener">${escapeHtml(d.website.replace(/^https?:\/\//, ""))}</a></div>` : ""}
    ${d.notizen ? `<div class="popup-row" style="color:var(--text-dim)">📝 ${escapeHtml(d.notizen)}</div>` : ""}
    <div class="popup-actions">
      ${d.telefon ? `<a href="tel:${escapeHtml(d.telefon)}">Anrufen</a>` : ""}
      ${d.email ? `<a href="mailto:${escapeHtml(d.email)}">E-Mail</a>` : ""}
      <a href="${mapsUrl}" target="_blank" rel="noopener">Route</a>
    </div>
  `;
  popup.setLngLat(coords).setHTML(html).addTo(map);
}

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

function applyFilters() {
  refreshSource();
  renderList();
  updateStats();
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

document.getElementById("rotate-toggle").addEventListener("click", () => {
  autoRotate = !autoRotate;
  document.getElementById("rotate-icon").textContent = autoRotate ? "⏸" : "▶";
});
