import assert from "node:assert/strict";
import test from "node:test";
import { videoFileName } from "../src/lib/names.js";
import { clipStartLimit, defaultClipWindow, extensionForMime, formatClock } from "../src/lib/video.js";

test("the default clip is the middle 30 seconds", () => {
  assert.deepEqual(defaultClipWindow(90), { start: 30, length: 30 });
  assert.deepEqual(defaultClipWindow(30), { start: 0, length: 30 });
  assert.deepEqual(defaultClipWindow(12), { start: 0, length: 12 });
  assert.deepEqual(defaultClipWindow(0), { start: 0, length: 0 });
  assert.equal(clipStartLimit(90, 30), 60);
  assert.equal(clipStartLimit(12, 12), 0);
});

test("video names stay next to the photo pattern", () => {
  assert.equal(
    videoFileName("Seamless Gutters", "Murray", "2026-11-05", 1, "mp4"),
    "seamless-gutters-murray-2026-11-05-video-1.mp4",
  );
  assert.equal(videoFileName("Gutter Guards", "Paris", "2026-11-05", 2, "webm").endsWith(".webm"), true);
  assert.equal(extensionForMime("video/mp4"), "mp4");
  assert.equal(extensionForMime("video/webm;codecs=vp8"), "webm");
  assert.equal(formatClock(65), "1:05");
});
