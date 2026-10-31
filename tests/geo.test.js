import assert from "node:assert/strict";
import test from "node:test";
import { GEOCODER_SEARCH } from "../src/config.js";
import { destinationPoint, distanceMeters, fillTemplate, nextDelay, townFromAddress } from "../src/lib/geo.js";

test("geocoder calls wait at least one second and do not autocomplete", () => {
  const state = { next: 0 };
  assert.equal(nextDelay(state, 1000, 1100), 0);
  assert.equal(nextDelay(state, 1000, 1100), 1100);
  assert.equal(nextDelay(state, 3000, 1100), 200);
});

test("address search is biased toward the Heartland area and is not autocomplete", () => {
  assert.match(GEOCODER_SEARCH, /viewbox=-91\.8,39\.2,-85\.8,35\.4/);
  assert.match(GEOCODER_SEARCH, /bounded=0/);
  assert.equal(/autocomplete/i.test(GEOCODER_SEARCH), false);
});

test("address templates stay easy to swap", () => {
  const url = fillTemplate("https://example.test/search?q={query}", { query: "Oak St, Murray" });
  assert.equal(url, "https://example.test/search?q=Oak%20St%2C%20Murray");
});

test("reverse results suggest a town without a house number", () => {
  assert.deepEqual(townFromAddress({ town: "Murray", state: "Kentucky" }), { town: "Murray", state: "KY" });
  assert.equal(townFromAddress({ village: "12th Street", state: "Kentucky" }).town, "");
});

test("a 200 meter offset lands about 200 meters away", () => {
  const point = destinationPoint(36.6, -88.3, 200, 0);
  const distance = distanceMeters(36.6, -88.3, point.lat, point.lng);
  assert.ok(Math.abs(distance - 200) < 0.5, distance);
  assert.ok(Math.abs(point.lng + 88.3) < 0.00001);
  for (let i = 0; i < 30; i += 1) {
    const distanceM = 150 + Math.random() * 100;
    const moved = destinationPoint(36.61, -88.31, distanceM, Math.random() * Math.PI * 2);
    const got = distanceMeters(36.61, -88.31, moved.lat, moved.lng);
    assert.ok(got >= 149 && got <= 251, got);
  }
});
