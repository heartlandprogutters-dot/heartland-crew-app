import assert from "node:assert/strict";
import test from "node:test";
import { SERVICES, TOWNS } from "../src/lists.js";
import { inspectPublicText, isReviewName, sanitizeSummary } from "../src/lib/privacy.js";
import { photoFileName } from "../src/lib/names.js";
import { todayISO } from "../src/lib/format.js";

const context = { services: SERVICES, towns: TOWNS };

test("summary warnings catch addresses and full names", () => {
  const clean = inspectPublicText("New seamless gutters on a ranch house.", context);
  assert.deepEqual(clean.errors, []);
  assert.deepEqual(clean.warnings, []);

  const street = inspectPublicText("Installed at 415 Oak Street today.", context);
  assert.ok(street.warnings.some((line) => /address|house number/i.test(line)));

  const measure = inspectPublicText("Hung 120 feet of gutter and 5 inch downspouts.", context);
  assert.deepEqual(measure.warnings, []);

  const name = inspectPublicText("Installed for John Smith.", context);
  assert.ok(name.warnings.some((line) => /full name/i.test(line)));

  const service = inspectPublicText("Seamless Gutters across the front.", context);
  assert.deepEqual(service.warnings, []);

  const skirting = inspectPublicText("Crew installed Mobile Home Skirting along the north side.", context);
  assert.deepEqual(skirting.warnings, []);
});

test("phone, email, and links are errors", () => {
  assert.ok(inspectPublicText("Call 270-555-0100", context).errors.length);
  assert.ok(inspectPublicText("mail me at pat@example.com", context).errors.length);
  assert.ok(inspectPublicText("see https://maps.example.com/pin", context).errors.length);
});

test("public text is one line without backslashes", () => {
  assert.equal(sanitizeSummary('Line\n two \\ and "quotes"'), "Line two and 'quotes'");
});

test("review names stay first name and initial", () => {
  assert.equal(isReviewName("Mike L."), true);
  assert.equal(isReviewName("Mike"), true);
  assert.equal(isReviewName("Mary-Ann L."), true);
  assert.equal(isReviewName("Mike Smith"), false);
  assert.equal(isReviewName("mike L."), false);
});

test("photo names follow service-town-date-number", () => {
  assert.equal(
    photoFileName("Seamless Gutters", "Murray", "2026-11-05", 1),
    "seamless-gutters-murray-2026-11-05-1.webp",
  );
  assert.equal(photoFileName("Fascia/Soffit", "New Concord", "2026-11-05", 2), "fascia-soffit-new-concord-2026-11-05-2.webp");
});

test("job dates use Central time", () => {
  assert.equal(todayISO("America/Chicago", new Date("2026-11-06T03:30:00Z")), "2026-11-05");
});
