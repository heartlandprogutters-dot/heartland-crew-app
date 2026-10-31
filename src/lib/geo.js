const STATE_ABBR = {
  Kentucky: "KY",
  Tennessee: "TN",
  Illinois: "IL",
  Missouri: "MO",
  Indiana: "IN",
  Alabama: "AL",
  Arkansas: "AR",
  Mississippi: "MS",
};

export function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ""));
}

export function nextDelay(state, now, minMs) {
  const delay = Math.max(0, state.next - now);
  state.next = now + delay + minMs;
  return delay;
}

export function townFromAddress(address) {
  if (!address || typeof address !== "object") return { town: "", state: "" };
  const town = address.city || address.town || address.village || address.hamlet || address.municipality || "";
  const rawState = String(address.state || "");
  const state = rawState.length === 2 ? rawState.toUpperCase() : STATE_ABBR[rawState] || "";
  const cleaned = String(town).replace(/\s+/g, " ").trim();
  if (!cleaned || /\d/.test(cleaned)) return { town: "", state };
  return { town: cleaned, state };
}

export function destinationPoint(lat, lng, distanceM, bearingRad) {
  const earth = 6378137;
  const ang = distanceM / earth;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(bearingRad));
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(ang) * Math.cos(lat1),
    Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const earth = 6378137;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a1 = (lat1 * Math.PI) / 180;
  const a2 = (lat2 * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cacheKey(kind, value) {
  return `heartland-geo:${kind}:${value}`;
}

function readCache(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.expires < Date.now()) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify({ expires: Date.now() + 1000 * 60 * 60 * 24 * 30, value }));
  } catch {
    // Private mode can refuse storage. The lookup still works once.
  }
}

export function createLookup({
  searchTemplate,
  reverseTemplate,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  storage = globalThis.localStorage,
  minMs = 1100,
} = {}) {
  const gate = { next: 0 };

  async function request(url, key) {
    const cached = readCache(storage, key);
    if (cached) return cached;
    const delay = nextDelay(gate, now(), minMs);
    if (delay) await sleep(delay);
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (response.status === 429 || response.status === 403) {
      throw new Error("Address search is busy. Wait a minute and try again.");
    }
    if (!response.ok) throw new Error("Address search did not answer. You can type the town and try the address again.");
    const value = await response.json();
    writeCache(storage, key, value);
    return value;
  }

  return {
    async search(query) {
      const cleaned = String(query || "").replace(/\s+/g, " ").trim();
      if (cleaned.length < 5) throw new Error("Type a fuller address, then tap Find address.");
      const url = fillTemplate(searchTemplate, { query: cleaned });
      const rows = await request(url, cacheKey("search", cleaned.toLowerCase()));
      return (Array.isArray(rows) ? rows : []).slice(0, 5).map((row) => ({
        label: row.display_name,
        lat: Number(row.lat),
        lng: Number(row.lon),
        ...townFromAddress(row.address),
      })).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
    },
    async reverse(lat, lng) {
      const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
      const url = fillTemplate(reverseTemplate, { lat, lng });
      const row = await request(url, cacheKey("reverse", key));
      return {
        label: row?.display_name || "",
        lat: Number(lat),
        lng: Number(lng),
        ...townFromAddress(row?.address),
      };
    },
  };
}
