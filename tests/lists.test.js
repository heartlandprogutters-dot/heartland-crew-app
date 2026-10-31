import assert from "node:assert/strict";
import test from "node:test";
import { friendlyError } from "../src/lib/api.js";
import { SERVICES, serviceNameError } from "../src/lists.js";

const MENU = [
  "Pressure Washing",
  "Window Washing",
  "Soft Washing",
  "Gutter Cleaning & Repair",
  "Mobile Home Skirting",
  "Gutter Guards",
  "Seamless Gutters",
  "Under-Deck Gutter Systems",
  "Fascia and Soffit Repair",
  "Vinyl Siding",
  "Yard Drainage Solutions",
  "Chop & Drop Gutter Machine Service",
  "Gravel Driveway Rejuvenation",
  "Rain Barrels & Water Storage",
  "Christmas Lights",
];

test("the service list matches the website menu, in menu order", () => {
  assert.deepEqual(SERVICES, MENU);
  assert.equal(SERVICES.includes("Other"), false);
});

test("older map service names still fit the service field", () => {
  for (const name of ["Seamless Gutters", "Gutter Guards", "Gutter Repair", "Downspouts", "Gutter Cleaning", "Fascia/Soffit", ...SERVICES]) {
    assert.equal(serviceNameError(name), "", name);
  }
  assert.match(serviceNameError(""), /Choose a service/);
  assert.match(serviceNameError("A"), /60 characters/);
  assert.match(serviceNameError("House #4"), /60 characters/);
});

test("upload and sign-in failures stay in plain words", () => {
  assert.match(friendlyError({ message: "new row violates row-level security policy" }), /cannot save that/i);
  assert.match(friendlyError({ message: "JWT expired" }), /sign-in expired/i);
  assert.match(friendlyError({ message: "Payload too large" }), /too large/i);
  assert.equal(friendlyError({ message: "Choose a service from the list." }), "Choose a service from the list.");
  assert.equal(friendlyError({ message: "Not allowed." }), "This login cannot do that. Ask Kent if the account is turned off.");
});
