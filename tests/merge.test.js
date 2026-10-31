import assert from "node:assert/strict";
import test from "node:test";
import { readPhotoExif } from "../src/lib/exif.js";
import {
  autoMergePlan,
  chooseExif,
  distanceMeters,
  jobsAreNear,
  possibleDuplicates,
} from "../src/lib/merge.js";

const day = "2026-10-31";

function job(overrides) {
  return {
    id: "a",
    status: "pending",
    role: "trainee",
    jobDate: day,
    createdAt: "2026-10-31T18:00:00Z",
    lat: 36.61,
    lng: -88.65,
    ...overrides,
  };
}

test("the same house on the same day matches, and a block away does not", () => {
  const here = job({ id: "here" });
  const close = job({ id: "close", lat: 36.6104, lng: -88.65 });
  const far = job({ id: "far", lat: 36.62, lng: -88.65 });
  assert.ok(distanceMeters(here.lat, here.lng, close.lat, close.lng) < 150);
  assert.ok(distanceMeters(here.lat, here.lng, far.lat, far.lng) > 150);
  assert.equal(jobsAreNear(here, close), true);
  assert.equal(jobsAreNear(here, far), false);
  assert.equal(jobsAreNear(here, job({ id: "next", jobDate: "2026-11-02", createdAt: "2026-11-02T18:00:00Z" })), false);
});

test("a photo GPS point can connect two posts when one pin is missing or off the house", () => {
  const pin = job({ id: "pin", lat: 36.61, lng: -88.65 });
  const fromPhoto = job({ id: "photo", lat: null, lng: null, exifLat: 36.6102, exifLng: -88.65 });
  assert.equal(jobsAreNear(pin, fromPhoto), true);
  const townPin = job({ id: "town", lat: 36.63, lng: -88.65, exifLat: 36.61, exifLng: -88.65 });
  assert.equal(jobsAreNear(pin, townPin), true);
  const otherTown = job({ id: "other", lat: 36.7, lng: -88.9, exifLat: 36.7, exifLng: -88.9 });
  assert.equal(jobsAreNear(pin, otherTown), false);
});

test("twelve hours still counts when the calendar dates differ", () => {
  const morning = job({ id: "am", jobDate: "2026-10-30", createdAt: "2026-10-31T04:00:00Z" });
  const evening = job({ id: "pm", jobDate: day, createdAt: "2026-10-31T12:00:00Z" });
  const later = job({ id: "later", jobDate: day, createdAt: "2026-11-01T20:00:00Z" });
  assert.equal(jobsAreNear(morning, evening), true);
  assert.equal(jobsAreNear(morning, later), false);
});

test("a trainee attaches only to one lead, and a lead does not take another lead's crew", () => {
  const trainee = { id: "sam", role: "trainee", status: "pending" };
  const lead = { id: "pat", role: "lead_man", status: "pending" };
  const otherLead = { id: "lee", role: "lead_man", status: "approved" };
  assert.deepEqual(autoMergePlan({ role: "trainee", matches: [lead] }), { absorbInto: "pat", absorb: [] });
  assert.deepEqual(autoMergePlan({ role: "trainee", matches: [lead, otherLead] }), { absorbInto: null, absorb: [] });
  assert.deepEqual(autoMergePlan({ role: "lead_man", matches: [trainee] }), { absorbInto: null, absorb: ["sam"] });
  assert.deepEqual(autoMergePlan({ role: "lead_man", matches: [trainee, otherLead] }), { absorbInto: null, absorb: [] });
  assert.deepEqual(autoMergePlan({ role: "trainee", matches: [{ id: "jo", role: "trainee", status: "pending" }] }), { absorbInto: null, absorb: [] });
});

test("the camera location is taken from the first photo that has one", async () => {
  const chosen = chooseExif([
    { exif: { takenAt: "2026-10-31T15:00:00Z" } },
    { exif: { lat: 36.61, lng: -88.65, takenAt: "2026-10-31T15:04:00Z" } },
  ]);
  assert.equal(chosen.lat, 36.61);
  assert.equal(chosen.lng, -88.65);
  assert.equal(chosen.takenAt, "2026-10-31T15:00:00Z");
  assert.equal(await readPhotoExif(new Blob(["not a photo"])), null);
});

test("review can name a possible duplicate without listing a merged post", () => {
  const pending = {
    id: "sam",
    status: "pending",
    title: "Sam's gutters",
    job_date: day,
    created_at: "2026-10-31T18:00:00Z",
    job_locations: { exact_lat: 36.61, exact_lng: -88.65 },
    poster: { role: "trainee" },
  };
  const lead = {
    id: "pat",
    status: "pending",
    title: "Pat's gutters",
    job_date: day,
    created_at: "2026-10-31T18:30:00Z",
    job_locations: { exact_lat: 36.6103, exact_lng: -88.65 },
    poster: { role: "lead_man" },
  };
  const merged = { ...pending, id: "old", status: "merged", title: "Already combined" };
  const dupes = possibleDuplicates(pending, [pending, lead, merged]);
  assert.deepEqual(dupes.map((item) => item.id), ["pat"]);
});
