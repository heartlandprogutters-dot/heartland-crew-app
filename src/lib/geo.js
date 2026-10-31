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

const ROUTE_STATES = {
  KY: "Kentucky",
  TN: "Tennessee",
  IL: "Illinois",
  MO: "Missouri",
  IN: "Indiana",
};

export function parseLocationQuery(raw, context = {}) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : "";
  const state = String(context.state || "").trim().toUpperCase();
  const town = String(context.town || "").replace(/\s+/g, " ").trim();
  let highway = matchHighway(text, state);
  if (!highway && state && /^\d{1,4}$/.test(text)) {
    highway = { state, number: text, us: false };
  }
  let house = "";
  const leading = text.match(/^(\d{1,6})\b/);
  const zipOnly = /^\d{5}(?:-\d{4})?$/.test(text);
  if (leading && !zipOnly && leading[1] !== zip && !(highway && leading[1] === highway.number)) {
    house = leading[1];
  }
  return { text, zip, town, state, highway, house, zipOnly };
}

function matchHighway(text, contextState) {
  const named = text.match(/\b(?:(KY|TN|IL|MO|IN|US)\s*[- ]?)?(?:state\s+)?(?:highway|hwy|route|rt|sr)\.?\s*#?\s*(\d{1,4})\b/i);
  if (named) {
    const token = (named[1] || "").toUpperCase();
    return { state: token === "US" ? "US" : (token || contextState || ""), number: named[2], us: token === "US" };
  }
  const bare = text.match(/\b(KY|TN|IL|MO|IN|US)\s*[- ]?\s*(\d{1,4})\b/i);
  if (!bare) return null;
  const token = bare[1].toUpperCase();
  return { state: token === "US" ? "US" : token, number: bare[2], us: token === "US" };
}

export function roadPhrase(highway) {
  if (!highway) return "";
  const number = highway.number;
  if (highway.us || highway.state === "US") return `US Highway ${number}`;
  const name = ROUTE_STATES[highway.state];
  if (name) return `${name} Highway ${number}`;
  return `State Highway ${number}`;
}

function joinParts(parts) {
  return parts
    .map((part) => String(part || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchSteps(raw, context = {}) {
  const parsed = parseLocationQuery(raw, context);
  const locality = joinParts([[parsed.town, parsed.state].filter(Boolean).join(", "), parsed.zip]);
  const road = roadPhrase(parsed.highway);
  const steps = [];
  const push = (query, level) => {
    const cleaned = String(query || "").replace(/\s+/g, " ").trim();
    if (cleaned.length < 3) return;
    if (steps.some((step) => step.query.toLowerCase() === cleaned.toLowerCase())) return;
    steps.push({ query: cleaned, level });
  };
  if (!parsed.zipOnly) {
    if (parsed.highway && parsed.house) push(joinParts([`${parsed.house} ${road}`, locality]), "house");
    if (!parsed.highway && parsed.text) push(parsed.text, parsed.house ? "house" : "street");
    if (road) push(joinParts([road, locality]), "street");
  }
  if (parsed.zip && (parsed.zipOnly || parsed.highway || !parsed.town)) push(parsed.zip, "place");
  else if (parsed.town && parsed.state) push(`${parsed.town}, ${parsed.state}`, "place");
  else if (parsed.zip) push(parsed.zip, "place");
  return steps.slice(0, 3);
}

export function isFalseRouteHouse(hit, highway) {
  if (!highway || !hit) return false;
  if (String(hit.houseNumber || "") !== String(highway.number)) return false;
  return !/\b(highway|hwy|route|interstate|state)\b/i.test(String(hit.road || ""));
}

function nominatimPrecision(row) {
  const kind = String(row?.addresstype || row?.type || "");
  if (row?.address?.house_number) return "house";
  if (["house", "building", "farm"].includes(kind)) return "house";
  if (["road", "highway", "residential", "tertiary", "secondary", "primary", "trunk", "unclassified", "service", "path"].includes(kind)) {
    return "street";
  }
  return "place";
}

function titleTown(value) {
  return String(value || "").toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
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
  censusTemplate = "",
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  storage = globalThis.localStorage,
  minMs = 1100,
} = {}) {
  const gate = { next: 0 };
  let censusOk = Boolean(censusTemplate);

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

  function mapNominatim(row) {
    return {
      label: row.display_name,
      lat: Number(row.lat),
      lng: Number(row.lon),
      houseNumber: row.address?.house_number || "",
      road: row.address?.road || "",
      precision: nominatimPrecision(row),
      ...townFromAddress(row.address),
    };
  }

  async function nominatimHits(query) {
    const url = fillTemplate(searchTemplate, { query });
    const rows = await request(url, cacheKey("search", query.toLowerCase()));
    return (Array.isArray(rows) ? rows : []).slice(0, 5).map(mapNominatim)
      .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
  }

  async function censusHits(query, level) {
    if (!censusOk || !censusTemplate) return [];
    const url = fillTemplate(censusTemplate, { query });
    try {
      const cached = readCache(storage, cacheKey("census", query.toLowerCase()));
      const value = cached || await (async () => {
        const response = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
        });
        if (!response.ok) return { result: { addressMatches: [] } };
        const body = await response.json();
        writeCache(storage, cacheKey("census", query.toLowerCase()), body);
        return body;
      })();
      const matches = value?.result?.addressMatches;
      if (!Array.isArray(matches)) return [];
      const houseToken = (query.match(/^(\d{1,6})\b/) || [])[1] || "";
      return matches.slice(0, 5).map((match) => {
        const parts = match.addressComponents || {};
        const askedHouse = level === "house" && houseToken
          && new RegExp(`^${houseToken}\\b`, "i").test(match.matchedAddress || "");
        return {
          label: match.matchedAddress || query,
          lat: Number(match.coordinates?.y),
          lng: Number(match.coordinates?.x),
          houseNumber: askedHouse ? houseToken : "",
          road: parts.streetName || "",
          precision: askedHouse ? "house" : "street",
          town: titleTown(parts.city),
          state: String(parts.state || "").toUpperCase(),
        };
      }).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
    } catch {
      censusOk = false;
      return [];
    }
  }

  return {
    async search(query, context = {}, onStatus) {
      const parsed = parseLocationQuery(query, context);
      const steps = searchSteps(query, context);
      if (!steps.length) throw new Error("Type a road, town, or ZIP, then tap Find address.");
      onStatus?.("Searching…");
      const censusQuery = steps.find((step) => step.level !== "place")?.query || "";
      if (censusQuery) {
        const censusLevel = steps.find((step) => step.query === censusQuery)?.level === "house" ? "house" : "street";
        const fromCensus = (await censusHits(censusQuery, censusLevel))
          .filter((hit) => !isFalseRouteHouse(hit, parsed.highway));
        const houses = fromCensus.filter((hit) => hit.precision === "house");
        if (houses.length) return { hits: houses, needsPin: false };
        if (fromCensus.length) return { hits: fromCensus, needsPin: true };
      }
      for (const step of steps) {
        if (step.level === "place") onStatus?.("No house number on that road. Centering on the town or ZIP…");
        const hits = (await nominatimHits(step.query)).filter((hit) => !isFalseRouteHouse(hit, parsed.highway));
        if (step.level === "house") {
          const houses = hits.filter((hit) => hit.precision === "house");
          if (houses.length) return { hits: houses, needsPin: false };
          continue;
        }
        if (step.level === "street") {
          if (hits.length) {
            const houses = hits.filter((hit) => hit.precision === "house");
            if (houses.length) return { hits: houses, needsPin: false };
            return { hits, needsPin: true };
          }
          continue;
        }
        if (hits.length) {
          return { hits: hits.map((hit) => ({ ...hit, precision: "place" })), needsPin: true };
        }
      }
      return { hits: [], needsPin: false };
    },
    async place(query) {
      const cleaned = String(query || "").replace(/\s+/g, " ").trim();
      if (cleaned.length < 3) return null;
      const hits = await nominatimHits(cleaned);
      return hits[0] || null;
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
