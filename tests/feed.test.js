import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildJobsZip } from "../src/lib/export.js";
import { PUBLIC_KEYS, assertPublicShape, buildBackup, parseImportText, toPublicJob } from "../src/lib/feed.js";

const sample = JSON.parse(readFileSync(new URL("../samples/sample-jobs.json", import.meta.url), "utf8"));

test("public jobs use the website key order", () => {
  const job = toPublicJob(sample[0]);
  assert.deepEqual(Object.keys(job), [...PUBLIC_KEYS]);
  assertPublicShape(job);
  assert.equal(job.review.name, "Mike L.");
  assert.equal(job.gbpUrl, null);
  assert.equal(typeof job.lat, "number");
});

test("a public import ignores exact location fields", () => {
  const parsed = parseImportText(JSON.stringify([{ ...sample[0], exactLat: 36.1, address: "123 Secret St" }]));
  assert.equal(parsed.kind, "public");
  assert.equal(parsed.jobs[0].exactLat, undefined);
  assert.equal(parsed.jobs[0].address, undefined);
  assert.equal(parsed.jobs[0].lat, 36.6105);
});

test("a backup keeps exact locations out of the public shape", () => {
  const backup = buildBackup({
    exportedAt: "2026-10-31T00:00:00Z",
    jobs: [{
      id: "job-1",
      status: "approved",
      service: "Seamless Gutters",
      town: "Murray",
      state: "KY",
      title: "Seamless Gutters in Murray, KY",
      summary: "New seamless gutters on a ranch house.",
      job_date: "2026-10-01",
      public_lat: 36.61,
      public_lng: -88.31,
      review_name: null,
      review_stars: null,
      review_text: null,
      review_date: null,
      gbp_url: null,
      rejection_reason: null,
    }],
    locations: [{ job_id: "job-1", exact_lat: 36.612349, exact_lng: -88.654321, address: "123 Private Lane" }],
    photos: [],
  });
  assert.equal(backup.jobs[0].exactLat, 36.612349);
  assert.match(backup.warning, /exact house locations/i);
  const parsed = parseImportText(JSON.stringify(backup));
  assert.equal(parsed.kind, "backup");
  assert.equal(parsed.jobs[0].exactLat, 36.612349);
  const pub = toPublicJob({
    ...parsed.jobs[0],
    lat: parsed.jobs[0].lat,
    lng: parsed.jobs[0].lng,
  });
  assert.equal(JSON.stringify(pub).includes("123 Private Lane"), false);
  assert.equal(JSON.stringify(pub).includes("36.612349"), false);
});

test("jobs.txt zip keeps the public list and photo files", async () => {
  const jobs = [toPublicJob(sample[0])];
  const bytes = await buildJobsZip(jobs, [{ name: "seamless-gutters-murray-2026-10-01-1.webp", bytes: new Uint8Array([1, 2, 3]) }], { type: "nodebuffer" });
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file("jobs.txt"));
  assert.ok(zip.file("photos/seamless-gutters-murray-2026-10-01-1.webp"));
  const parsed = JSON.parse(await zip.file("jobs.txt").async("string"));
  assert.deepEqual(Object.keys(parsed[0]), [...PUBLIC_KEYS]);
});
