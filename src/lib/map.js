export async function mountMap(container, { exact, publicPoint }) {
  const L = (await import("leaflet")).default;
  await import("leaflet/dist/leaflet.css");
  const first = exact || publicPoint;
  const map = L.map(container, { scrollWheelZoom: false }).setView([first.lat, first.lng], 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  const points = [];
  if (exact) {
    points.push([exact.lat, exact.lng]);
    L.circleMarker([exact.lat, exact.lng], {
      radius: 9,
      color: "#14352a",
      fillColor: "#c56a32",
      fillOpacity: 0.95,
      weight: 2,
    }).addTo(map);
  }
  if (publicPoint) {
    points.push([publicPoint.lat, publicPoint.lng]);
    L.circleMarker([publicPoint.lat, publicPoint.lng], {
      radius: 8,
      color: "#1f6b45",
      fillColor: "#d7efe0",
      fillOpacity: 0.95,
      weight: 2,
    }).addTo(map);
  }
  if (points.length === 2) map.fitBounds(points, { padding: [28, 28], maxZoom: 16 });
  const refresh = () => map.invalidateSize();
  const timer = setTimeout(refresh, 150);
  window.addEventListener("resize", refresh);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", refresh);
    map.remove();
  };
}
