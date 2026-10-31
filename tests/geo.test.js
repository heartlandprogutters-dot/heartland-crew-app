import assert from "node:assert/strict";
import test from "node:test";
import { GEOCODER_SEARCH } from "../src/config.js";
import {
  createLookup,
  destinationPoint,
  distanceMeters,
  fillTemplate,
  isFalseRouteHouse,
  nextDelay,
  roadPhrase,
  searchSteps,
  townFromAddress,
} from "../src/lib/geo.js";

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

test("highway names share one road phrase", () => {
  const context = { town: "Bardwell", state: "KY" };
  assert.equal(roadPhrase({ state: "KY", number: "121", us: false }), "Kentucky Highway 121");
  for (const typed of ["Hwy 121", "KY 121", "KY-121", "State Route 121", "Highway 121", "121"]) {
    const steps = searchSteps(typed, context);
    assert.equal(steps[0].query, "Kentucky Highway 121, Bardwell, KY", typed);
    assert.equal(steps[0].level, "street", typed);
    assert.equal(steps[1].query, "Bardwell, KY", typed);
    assert.equal(steps[1].level, "place", typed);
  }
  const withHouse = searchSteps("450 KY Highway 121 42023", context);
  assert.equal(withHouse[0].query, "450 Kentucky Highway 121, Bardwell, KY, 42023");
  assert.equal(withHouse[0].level, "house");
  assert.equal(withHouse.at(-1).query, "42023");
  assert.equal(withHouse.at(-1).level, "place");
  assert.deepEqual(searchSteps("42023", { town: "Farmington", state: "KY" }).map((step) => step.query), ["42023"]);
});

test("a route number is not treated as a house on another street", () => {
  const highway = { number: "121" };
  assert.equal(isFalseRouteHouse({ houseNumber: "121", road: "Elsey Avenue" }, highway), true);
  assert.equal(isFalseRouteHouse({ houseNumber: "121", road: "Kentucky Highway 121" }, highway), false);
  assert.equal(isFalseRouteHouse({ houseNumber: "450", road: "Elsey Avenue" }, highway), false);
});

test("a rural highway with no house number centers on the ZIP", async () => {
  const calls = [];
  const memory = new Map();
  const lookup = createLookup({
    searchTemplate: "https://nominatim.test/search?q={query}",
    reverseTemplate: "https://nominatim.test/reverse?lat={lat}&lon={lng}",
    censusTemplate: "https://census.test/search?address={query}",
    minMs: 0,
    storage: {
      getItem: (key) => memory.get(key) || null,
      setItem: (key, value) => memory.set(key, value),
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("census.test")) {
        return { ok: true, status: 200, json: async () => ({ result: { addressMatches: [] } }) };
      }
      const query = decodeURIComponent(String(url).split("q=")[1] || "");
      if (query === "42023") {
        return {
          ok: true,
          status: 200,
          json: async () => [{
            display_name: "42023, Carlisle County, Kentucky, United States",
            lat: "36.8728",
            lon: "-88.9782",
            addresstype: "postcode",
            address: { postcode: "42023", state: "Kentucky" },
          }],
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    },
  });
  const found = await lookup.search("KY Highway 121 42023", { town: "Bardwell", state: "KY" });
  assert.equal(found.needsPin, true);
  assert.equal(found.hits[0].precision, "place");
  assert.equal(found.hits[0].lat, 36.8728);
  assert.ok(calls.some((url) => url.startsWith("https://census.test/")));
  assert.ok(calls.some((url) => url.includes("Kentucky%20Highway%20121")));
  const before = calls.length;
  await lookup.search("KY Highway 121 42023", { town: "Bardwell", state: "KY" });
  assert.equal(calls.length, before);
});

test("a working census house match is used before OpenStreetMap", async () => {
  const calls = [];
  const lookup = createLookup({
    searchTemplate: "https://nominatim.test/search?q={query}",
    reverseTemplate: "https://nominatim.test/reverse?lat={lat}&lon={lng}",
    censusTemplate: "https://census.test/search?address={query}",
    minMs: 0,
    storage: { getItem: () => null, setItem: () => {} },
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            addressMatches: [{
              matchedAddress: "100 E BROADWAY ST, MAYFIELD, KY, 42066",
              coordinates: { x: -88.6357, y: 36.7416 },
              addressComponents: { city: "MAYFIELD", state: "KY", streetName: "BROADWAY" },
            }],
          },
        }),
      };
    },
  });
  const found = await lookup.search("100 Broadway, Mayfield, KY 42066", { town: "Mayfield", state: "KY" });
  assert.equal(found.needsPin, false);
  assert.equal(found.hits[0].town, "Mayfield");
  assert.equal(found.hits[0].lat, 36.7416);
  assert.equal(calls.some((url) => url.includes("nominatim.test")), false);
});

test("a blocked census geocoder is skipped after the first failure", async () => {
  let censusCalls = 0;
  const lookup = createLookup({
    searchTemplate: "https://nominatim.test/search?q={query}",
    reverseTemplate: "https://nominatim.test/reverse?lat={lat}&lon={lng}",
    censusTemplate: "https://census.test/search?address={query}",
    minMs: 0,
    storage: { getItem: () => null, setItem: () => {} },
    fetchImpl: async (url) => {
      if (String(url).includes("census.test")) {
        censusCalls += 1;
        throw new Error("Failed to fetch");
      }
      return {
        ok: true,
        status: 200,
        json: async () => [{
          display_name: "Bardwell, Carlisle County, Kentucky, United States",
          lat: "36.8706",
          lon: "-89.0098",
          addresstype: "administrative",
          address: { town: "Bardwell", state: "Kentucky" },
        }],
      };
    },
  });
  const first = await lookup.search("Hwy 121", { town: "Bardwell", state: "KY" });
  const second = await lookup.search("Highway 121", { town: "Bardwell", state: "KY" });
  assert.equal(first.needsPin, true);
  assert.equal(second.hits[0].town, "Bardwell");
  assert.equal(censusCalls, 1);
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
