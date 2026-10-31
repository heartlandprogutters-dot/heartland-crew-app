// Leaflet is served from public/vendor/leaflet (Leaflet 1.9.4, BSD-2-Clause).
// It is not loaded from a CDN and not split into a second chunk. The installed
// app was failing when that chunk request came back as the wrong file.

const LEAFLET_JS = "vendor/leaflet/leaflet.js";
const LEAFLET_CSS = "vendor/leaflet/leaflet.css";

function asset(path) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${path}`.replace(/([^:])\/{2,}/g, "$1/");
}

function ensureCss() {
  if (document.querySelector("link[data-leaflet-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = asset(LEAFLET_CSS);
  link.dataset.leafletCss = "true";
  document.head.append(link);
}

function loadLeaflet() {
  if (globalThis.L?.map) return Promise.resolve(globalThis.L);
  ensureCss();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-leaflet-js]");
    const finish = () => {
      if (globalThis.L?.map) resolve(globalThis.L);
      else reject(new Error("The map library did not start."));
    };
    if (existing) {
      if (globalThis.L?.map) finish();
      else existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("The map library did not load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = asset(LEAFLET_JS);
    script.dataset.leafletJs = "true";
    script.onload = finish;
    script.onerror = () => reject(new Error("The map library did not load."));
    document.head.append(script);
  });
}

function pinIcon(L, kind) {
  return L.divIcon({
    className: "leaflet-pin",
    html: `<span class="map-pin ${kind}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 26],
  });
}

function finitePoint(point, fallback) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return fallback;
}

function addTiles(L, map) {
  // The browser must send Referer itself. The service worker does not
  // intercept these requests. OpenStreetMap refuses tiles with no Referer.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
    referrerPolicy: "origin",
  }).addTo(map);
}

function watchSize(map) {
  const refresh = () => map.invalidateSize();
  const timer = setTimeout(refresh, 50);
  requestAnimationFrame(refresh);
  window.addEventListener("resize", refresh);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", refresh);
    map.remove();
  };
}

export async function mountMap(container, { exact, publicPoint, editable = false, onExact }) {
  const L = await loadLeaflet();
  const fallback = { lat: 36.7417, lng: -88.6366 };
  const exactPoint = finitePoint(exact, null);
  const publicSpot = finitePoint(publicPoint, null);
  const start = exactPoint || publicSpot || fallback;
  if (container._leaflet_id) {
    container.replaceChildren();
    delete container._leaflet_id;
  }
  const map = L.map(container, { scrollWheelZoom: false }).setView([start.lat, start.lng], exactPoint ? 16 : 14);
  addTiles(L, map);
  const points = [];
  if (exactPoint || editable) {
    const pinAt = exactPoint || publicSpot || start;
    points.push([pinAt.lat, pinAt.lng]);
    const marker = L.marker([pinAt.lat, pinAt.lng], {
      draggable: editable,
      icon: pinIcon(L, "exact"),
      zIndexOffset: 500,
    }).addTo(map);
    if (editable) {
      const report = () => {
        const next = marker.getLatLng();
        onExact?.({ lat: next.lat, lng: next.lng });
      };
      marker.on("dragend", report);
      map.on("click", (event) => {
        marker.setLatLng(event.latlng);
        report();
      });
    }
  }
  if (publicSpot) {
    points.push([publicSpot.lat, publicSpot.lng]);
    L.marker([publicSpot.lat, publicSpot.lng], {
      icon: pinIcon(L, "public"),
      interactive: false,
      keyboard: false,
    }).addTo(map);
  }
  if (points.length === 2) map.fitBounds(points, { padding: [28, 28], maxZoom: 16 });
  return watchSize(map);
}

export async function mountPinMap(container, { lat, lng, zoom = 16, onMove }) {
  const L = await loadLeaflet();
  const start = finitePoint({ lat, lng }, { lat: 36.7417, lng: -88.6366 });
  if (container._leaflet_id) {
    container.replaceChildren();
    delete container._leaflet_id;
  }
  const map = L.map(container, { scrollWheelZoom: false }).setView([start.lat, start.lng], zoom);
  addTiles(L, map);
  const marker = L.marker([start.lat, start.lng], { draggable: true, icon: pinIcon(L, "exact") }).addTo(map);
  const report = () => {
    const next = marker.getLatLng();
    onMove?.({ lat: next.lat, lng: next.lng });
  };
  marker.on("dragend", report);
  map.on("click", (event) => {
    marker.setLatLng(event.latlng);
    report();
  });
  const stop = watchSize(map);
  return {
    setView(nextLat, nextLng, nextZoom = zoom) {
      const next = finitePoint({ lat: nextLat, lng: nextLng }, start);
      marker.setLatLng([next.lat, next.lng]);
      map.setView([next.lat, next.lng], nextZoom);
      onMove?.({ lat: next.lat, lng: next.lng });
      setTimeout(() => map.invalidateSize(), 50);
    },
    destroy() {
      stop();
    },
  };
}
