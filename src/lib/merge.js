// Two posts are the same house when a pin or a photo GPS point is within
// 150 meters and the work falls on the same Chicago calendar day or within
// 12 hours. Photo GPS is a fallback when the pin is missing, and an extra
// point when the camera recorded a location.

export const MATCH_METERS = 150;
export const MATCH_HOURS = 12;

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const a1 = Number(lat1);
  const o1 = Number(lng1);
  const a2 = Number(lat2);
  const o2 = Number(lng2);
  if (![a1, o1, a2, o2].every(Number.isFinite)) return Infinity;
  const earth = 6378137;
  const h = Math.sin(rad(a2 - a1) / 2) ** 2
    + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function chicagoDay(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function chooseExif(photos) {
  const list = Array.isArray(photos) ? photos : [];
  const gps = list.find((photo) => finitePair(photo?.exif?.lat, photo?.exif?.lng));
  const timed = list.find((photo) => photo?.exif?.takenAt);
  return {
    lat: gps ? Number(gps.exif.lat) : null,
    lng: gps ? Number(gps.exif.lng) : null,
    takenAt: timed?.exif?.takenAt || gps?.exif?.takenAt || null,
  };
}

export function pointsOf(job) {
  const points = [];
  if (finitePair(job?.lat, job?.lng)) points.push({ lat: Number(job.lat), lng: Number(job.lng) });
  if (finitePair(job?.exifLat, job?.exifLng)) points.push({ lat: Number(job.exifLat), lng: Number(job.exifLng) });
  return points;
}

export function sameWorkWindow(a, b) {
  const dayA = String(a?.jobDate || "").slice(0, 10);
  const dayB = String(b?.jobDate || "").slice(0, 10);
  if (dayA && dayB && dayA === dayB) return true;
  const createdA = a?.createdAt || "";
  const createdB = b?.createdAt || "";
  if (createdA && createdB && chicagoDay(createdA) && chicagoDay(createdA) === chicagoDay(createdB)) return true;
  if (withinHours(createdA, createdB)) return true;
  const exifA = a?.exifTakenAt || "";
  const exifB = b?.exifTakenAt || "";
  if (withinHours(exifA, exifB)) return true;
  if (withinHours(exifA, createdB) || withinHours(exifB, createdA)) return true;
  if (exifA && dayB && chicagoDay(exifA) === dayB) return true;
  if (exifB && dayA && chicagoDay(exifB) === dayA) return true;
  return false;
}

export function jobsAreNear(a, b) {
  const left = pointsOf(a);
  const right = pointsOf(b);
  if (!left.length || !right.length) return false;
  const close = left.some((point) => right.some((other) => distanceMeters(point.lat, point.lng, other.lat, other.lng) <= MATCH_METERS));
  return close && sameWorkWindow(a, b);
}

export function normalizeJob(job) {
  const loc = Array.isArray(job?.job_locations) ? job.job_locations[0] : job?.job_locations;
  return {
    id: job?.id,
    status: job?.status,
    role: job?.poster?.role || job?.role || "",
    title: job?.title || "",
    jobDate: job?.job_date || job?.jobDate || "",
    createdAt: job?.created_at || job?.createdAt || "",
    lat: loc?.exact_lat ?? job?.lat,
    lng: loc?.exact_lng ?? job?.lng,
    exifLat: loc?.exif_lat ?? job?.exifLat,
    exifLng: loc?.exif_lng ?? job?.exifLng,
    exifTakenAt: loc?.exif_taken_at || job?.exifTakenAt || "",
  };
}

export function possibleDuplicates(job, jobs) {
  const self = normalizeJob(job);
  if (!self.id || self.status === "merged" || self.status === "rejected") return [];
  return (jobs || [])
    .filter((other) => other && other.id !== self.id)
    .map(normalizeJob)
    .filter((other) => other.status === "pending" || other.status === "approved")
    .filter((other) => jobsAreNear(self, other));
}

// A trainee attaches only to the single matching lead. A lead absorbs matching
// trainee posts only when no other lead is at that house. Same-role pairs wait
// for an approver.
export function autoMergePlan({ role, matches }) {
  const open = (matches || []).filter((item) => item.status !== "merged" && item.status !== "rejected");
  if (role === "trainee") {
    const leads = open.filter((item) => item.role === "lead_man");
    if (leads.length === 1) return { absorbInto: leads[0].id, absorb: [] };
    return { absorbInto: null, absorb: [] };
  }
  if (role === "lead_man") {
    if (open.some((item) => item.role === "lead_man")) return { absorbInto: null, absorb: [] };
    return {
      absorbInto: null,
      absorb: open.filter((item) => item.role === "trainee" && item.status === "pending").map((item) => item.id),
    };
  }
  return { absorbInto: null, absorb: [] };
}

function finitePair(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

function rad(value) {
  return (Number(value) * Math.PI) / 180;
}

function withinHours(a, b) {
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return Math.abs(left.getTime() - right.getTime()) <= MATCH_HOURS * 60 * 60 * 1000;
}
