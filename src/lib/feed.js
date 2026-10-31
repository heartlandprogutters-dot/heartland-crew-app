import { roundCoord } from "./format.js";
import { sanitizeSummary } from "./privacy.js";

export const PUBLIC_KEYS = Object.freeze([
  "id",
  "title",
  "service",
  "town",
  "state",
  "lat",
  "lng",
  "date",
  "summary",
  "photos",
  "review",
  "gbpUrl",
]);

export function toPublicJob(input) {
  const review = input.review
    ? {
        name: input.review.name,
        stars: Number(input.review.stars),
        text: sanitizeSummary(input.review.text || ""),
        date: input.review.date,
      }
    : null;
  const job = {
    id: String(input.id),
    title: sanitizeSummary(input.title),
    service: input.service,
    town: input.town,
    state: input.state,
    lat: roundCoord(input.lat),
    lng: roundCoord(input.lng),
    date: String(input.date).slice(0, 10),
    summary: sanitizeSummary(input.summary),
    photos: Array.isArray(input.photos) ? input.photos.filter(Boolean) : [],
    review,
    gbpUrl: input.gbpUrl ?? null,
  };
  const ordered = {};
  for (const key of PUBLIC_KEYS) ordered[key] = job[key];
  return ordered;
}

export function assertPublicShape(job) {
  const keys = Object.keys(job);
  if (keys.join(",") !== PUBLIC_KEYS.join(",")) {
    throw new Error(`Public job keys must be ${PUBLIC_KEYS.join(", ")}.`);
  }
  if (typeof job.lat !== "number" || typeof job.lng !== "number") throw new Error("lat and lng must be numbers.");
  if (!Array.isArray(job.photos)) throw new Error("photos must be a list.");
  if (job.summary.includes("\\") || job.summary.includes("\n")) throw new Error("Summary must be one line.");
  if (job.review !== null) {
    const reviewKeys = Object.keys(job.review).join(",");
    if (reviewKeys !== "name,stars,text,date") throw new Error("Review keys must be name, stars, text, date.");
  }
}

function photoList(photos) {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((photo) => (typeof photo === "string" ? photo : photo?.publicUrl))
    .filter((url) => typeof url === "string" && url.startsWith("https://"));
}

function baseJob(job) {
  return {
    id: String(job.id || "").trim(),
    title: job.title || "",
    service: job.service || "",
    town: job.town || "",
    state: job.state || "",
    date: String(job.date || "").slice(0, 10),
    summary: job.summary || "",
    photos: photoList(job.photos),
    review: job.review && typeof job.review === "object" ? {
      name: job.review.name || "",
      stars: job.review.stars,
      text: job.review.text || "",
      date: job.review.date || "",
    } : null,
    gbpUrl: job.gbpUrl || null,
  };
}

export function parseImportText(text) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "").trim();
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (Array.isArray(data)) {
    return {
      kind: "public",
      jobs: data.map((job) => ({
        ...baseJob(job),
        lat: job.lat,
        lng: job.lng,
      })),
    };
  }
  if (data && data.version === 1 && Array.isArray(data.jobs)) {
    return {
      kind: "backup",
      jobs: data.jobs.map((job) => ({
        ...baseJob(job),
        status: job.status || "approved",
        lat: job.publicLat ?? job.lat ?? null,
        lng: job.publicLng ?? job.lng ?? null,
        exactLat: job.exactLat ?? null,
        exactLng: job.exactLng ?? null,
        address: job.address ?? null,
        rejectionReason: job.rejectionReason ?? null,
      })),
    };
  }
  throw new Error("This file is not a jobs list or a Heartland backup.");
}

export function buildBackup({ jobs, locations, photos, exportedAt }) {
  const locById = new Map((locations || []).map((row) => [row.job_id, row]));
  const photosById = new Map();
  for (const photo of photos || []) {
    const list = photosById.get(photo.job_id) || [];
    list.push(photo);
    photosById.set(photo.job_id, list);
  }
  return {
    version: 1,
    exportedAt,
    warning: "Private backup. Contains exact house locations. Do not post this file anywhere public.",
    jobs: (jobs || []).map((job) => {
      const location = locById.get(job.id);
      const jobPhotos = (photosById.get(job.id) || []).slice().sort((a, b) => a.sort_order - b.sort_order);
      return {
        id: job.id,
        status: job.status,
        service: job.service,
        town: job.town,
        state: job.state,
        title: job.title,
        summary: job.summary,
        date: String(job.job_date).slice(0, 10),
        publicLat: job.public_lat,
        publicLng: job.public_lng,
        exactLat: location?.exact_lat ?? null,
        exactLng: location?.exact_lng ?? null,
        address: location?.address ?? null,
        photos: jobPhotos.map((photo) => ({
          publicUrl: photo.public_url,
          storagePath: photo.storage_path,
          sortOrder: photo.sort_order,
        })),
        review: job.review_name ? {
          name: job.review_name,
          stars: job.review_stars,
          text: job.review_text,
          date: job.review_date,
        } : null,
        gbpUrl: job.gbp_url,
        rejectionReason: job.rejection_reason,
      };
    }),
  };
}
