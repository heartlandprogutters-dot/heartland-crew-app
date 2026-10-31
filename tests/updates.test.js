import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isFormDirty, setFormDirty } from "../src/lib/form-state.js";
import { decideUpdate } from "../src/lib/update-policy.js";
import { APP_VERSION } from "../src/version.js";

test("the published version file matches the app version", () => {
  const published = JSON.parse(readFileSync(new URL("../public/version.json", import.meta.url), "utf8"));
  assert.equal(published.version, APP_VERSION);
});

test("a new job note counts as unsaved work", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  assert.equal(isFormDirty(storage), false);
  setFormDirty(true, storage);
  assert.equal(isFormDirty(storage), true);
  setFormDirty(false, storage);
  storage.setItem("heartland-draft-v1", JSON.stringify({ summary: "Hung lights along the porch." }));
  assert.equal(isFormDirty(storage), true);
  storage.setItem("heartland-draft-v1", JSON.stringify({ summary: "" }));
  assert.equal(isFormDirty(storage), false);
  storage.setItem("heartland-draft-v1", JSON.stringify({ address: "121 Kentucky Highway, Bardwell" }));
  assert.equal(isFormDirty(storage), true);
  storage.setItem("heartland-draft-v1", JSON.stringify({ location: { lat: 36.87, lng: -88.98 } }));
  assert.equal(isFormDirty(storage), true);
});

test("a new worker reloads once unless the new job form has data", () => {
  assert.equal(decideUpdate({ hadController: false, dirty: false, suppress: false }), "ignore");
  assert.equal(decideUpdate({ hadController: true, dirty: false, suppress: false }), "reload");
  assert.equal(decideUpdate({ hadController: true, dirty: true, suppress: false }), "prompt");
  assert.equal(decideUpdate({ hadController: true, dirty: false, suppress: true }), "stay");
});

test("the service worker takes control and checks for a new shell", () => {
  const config = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
  assert.match(config, /skipWaiting:\s*true/);
  assert.match(config, /clientsClaim:\s*true/);
  assert.match(config, /heartland-crew-v12/);
  assert.match(config, /globIgnores: \['\*\*\/index\.html', '\*\*\/version\.json'\]/);
  assert.match(config, /handler: 'NetworkFirst'/);
  assert.equal(config.includes("tile.openstreetmap.org"), false);
});

test("an update does not clear the saved sign-in", () => {
  const source = readFileSync(new URL("../src/lib/updates.js", import.meta.url), "utf8");
  assert.equal(source.includes("localStorage.clear"), false);
  assert.equal(source.includes("signOut"), false);
  assert.match(source, /registration\.update\(\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /Update ready, tap to reload/);
  assert.match(source, /Updated to version/);
});
