function pinIcon(L, kind) {
  return L.divIcon({
    className: "leaflet-pin",
    html: `<span class="map-pin ${kind}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 26],
  });
}

function addTiles(L, map) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
}

export async function mountMap(container, { exact, publicPoint, editable = false, onExact }) {
  const L = (await import("leaflet")).default;
  await import("leaflet/dist/leaflet.css");
  const start = exact || publicPoint;
  const map = L.map(container, { scrollWheelZoom: false }).setView([start.lat, start.lng], exact ? 16 : 14);
  addTiles(L, map);
  const points = [];
  if (exact || editable) {
    const pinAt = exact || publicPoint;
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
  if (publicPoint) {
    points.push([publicPoint.lat, publicPoint.lng]);
    L.marker([publicPoint.lat, publicPoint.lng], {
      icon: pinIcon(L, "public"),
      interactive: false,
      keyboard: false,
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

export async function mountPinMap(container, { lat, lng, zoom = 16, onMove }) {
  const L = (await import("leaflet")).default;
  await import("leaflet/dist/leaflet.css");
  const map = L.map(container, { scrollWheelZoom: false }).setView([lat, lng], zoom);
  addTiles(L, map);
  const marker = L.marker([lat, lng], { draggable: true, icon: pinIcon(L, "exact") }).addTo(map);
  const report = () => {
    const next = marker.getLatLng();
    onMove?.({ lat: next.lat, lng: next.lng });
  };
  marker.on("dragend", report);
  map.on("click", (event) => {
    marker.setLatLng(event.latlng);
    report();
  });
  const refresh = () => map.invalidateSize();
  const timer = setTimeout(refresh, 50);
  requestAnimationFrame(refresh);
  window.addEventListener("resize", refresh);
  return {
    setView(nextLat, nextLng, nextZoom = zoom) {
      marker.setLatLng([nextLat, nextLng]);
      map.setView([nextLat, nextLng], nextZoom);
      onMove?.({ lat: nextLat, lng: nextLng });
      setTimeout(refresh, 50);
    },
    destroy() {
      clearTimeout(timer);
      window.removeEventListener("resize", refresh);
      map.remove();
    },
  };
}
