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

let activeStatuses = new Set(["kunde", "interessent", "lead", "inaktiv"]);
let searchTerm = "";
let autoRotate = true;
let userInteracting = false;
let rotateFrame = null;
let selectedId = null;

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
    if (!term) return true;
    return (
      d.name.toLowerCase().includes(term) ||
      d.stadt.toLowerCase().includes(term) ||
      d.fachrichtung.toLowerCase().includes(term) ||
      (d.land || "").toLowerCase().includes(term)
    );
  });
}

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [10, 35],
  zoom: 1.6,
  pitch: 0,
  attributionControl: { compact: true },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.FullscreenControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
if (typeof maplibregl.GlobeControl === "function") {
  map.addControl(new maplibregl.GlobeControl(), "top-right");
}

let popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });

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
    type: "circle",
    source: "aerzte",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": [
        "match",
        ["get", "status"],
        "kunde", STATUS_COLORS.kunde,
        "interessent", STATUS_COLORS.interessent,
        "lead", STATUS_COLORS.lead,
        "inaktiv", STATUS_COLORS.inaktiv,
        "#ffffff",
      ],
      "circle-radius": 8,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
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

  renderList();
  updateStats();
  startAutoRotate();
});

function refreshSource() {
  const src = map.getSource("aerzte");
  if (src) src.setData(toGeoJSON(getFilteredData()));
}

function openDoctorPopup(d, coords) {
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=17/${d.lat}/${d.lng}`;
  const html = `
    <div class="popup-title">${escapeHtml(d.name)}</div>
    <div class="popup-sub">${escapeHtml(d.fachrichtung)} · ${escapeHtml(d.stadt)}, ${escapeHtml(d.land)}</div>
    <div class="popup-row">📍 ${escapeHtml(d.strasse)}, ${escapeHtml(d.plz)} ${escapeHtml(d.stadt)}</div>
    ${d.ansprechpartner ? `<div class="popup-row">👤 ${escapeHtml(d.ansprechpartner)}</div>` : ""}
    ${d.telefon ? `<div class="popup-row">📞 ${escapeHtml(d.telefon)}</div>` : ""}
    ${d.email ? `<div class="popup-row">✉️ ${escapeHtml(d.email)}</div>` : ""}
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
  const list = document.getElementById("doctor-list");
  const data = getFilteredData();
  list.innerHTML = "";
  data.forEach((d) => {
    const li = document.createElement("li");
    li.className = "doctor-item";
    li.dataset.id = d.id;
    li.innerHTML = `
      <div class="doctor-item-top">
        <span class="status-badge ${d.status}"></span>
        <span class="doctor-name">${escapeHtml(d.name)}</span>
      </div>
      <div class="doctor-meta">${escapeHtml(d.fachrichtung)} · ${escapeHtml(d.stadt)}, ${escapeHtml(d.land)}</div>
    `;
    li.addEventListener("click", () => selectDoctor(d.id, true));
    list.appendChild(li);
  });
}

function updateStats() {
  const data = getFilteredData();
  document.getElementById("stat-total").textContent = data.length;
  document.getElementById("stat-kunde").textContent = data.filter((d) => d.status === "kunde").length;
  document.getElementById("stat-interessent").textContent = data.filter((d) => d.status === "interessent").length;
  document.getElementById("stat-lead").textContent = data.filter((d) => d.status === "lead").length;
}

function applyFilters() {
  refreshSource();
  renderList();
  updateStats();
}

document.getElementById("search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  applyFilters();
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
