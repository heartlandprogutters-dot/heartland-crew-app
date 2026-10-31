import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const init = readFileSync(new URL("../supabase/migrations/20261031120000_init.sql", import.meta.url), "utf8");
const storage = readFileSync(new URL("../supabase/migrations/20261031120100_storage.sql", import.meta.url), "utf8");
const videos = readFileSync(new URL("../supabase/migrations/20261031130000_videos.sql", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
const srcFiles = walk("src").map((file) => readFileSync(file, "utf8")).join("\n");

function walk(dir) {
  return readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [new URL(`../${path}`, import.meta.url)];
  });
}

test("the public feed cannot see private columns", () => {
  const feed = init.split("-- BEGIN PUBLIC FEED")[1].split("-- END PUBLIC FEED")[0];
  for (const word of ["exact_lat", "exact_lng", "job_locations", "created_by", "display_name", "rejection_reason", "storage_path", "auth.users"]) {
    assert.equal(feed.includes(word), false, word);
  }
  assert.match(feed, /status = 'approved'/);
  const keys = [...feed.matchAll(/'([A-Za-z]+)',/g)].map((match) => match[1]);
  assert.deepEqual(keys.slice(0, 12), [
    "id", "title", "service", "town", "state", "lat", "lng", "date", "summary", "photos", "review", "name",
  ]);
  assert.ok(feed.includes("'gbpUrl'"));
  const videoFeed = videos.split("-- BEGIN PUBLIC FEED")[1].split("-- END PUBLIC FEED")[0];
  for (const word of ["exact_lat", "exact_lng", "job_locations", "created_by", "display_name", "rejection_reason", "storage_path"]) {
    assert.equal(videoFeed.includes(word), false, word);
  }
  assert.match(videoFeed, /'videos'/);
  assert.match(videos, /job_videos_select_own_or_staff/);
  assert.match(videos, /crew_upload_own_private_videos/);
  assert.match(videos, /approver_upload_public_videos/);
  assert.match(videos, /20971520/);
});

test("row level security is enabled and the anon key is not handed the private tables", () => {
  for (const table of ["profiles", "jobs", "job_locations", "job_photos"]) {
    assert.match(init, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(init, /revoke all on table public\.job_locations from anon, authenticated/);
  assert.match(init, /job_locations_select_staff_only/);
  assert.match(init, /using \(public\.is_approver\(\)\)/);
  assert.match(storage, /job-photos-private/);
  assert.match(storage, /crew_upload_own_private_photos/);
  assert.match(storage, /approver_upload_public_photos/);
  for (const sql of [storage, videos]) {
    assert.doesNotMatch(sql, /alter\s+table\s+storage\./i);
    assert.doesNotMatch(sql, /grant\s+.+\s+on\s+(table\s+)?storage\./i);
    assert.match(sql, /on conflict \(id\) do nothing/i);
    assert.match(sql, /drop policy if exists/i);
    assert.match(sql, /create policy/i);
  }
});

test("the app has no public sign-up and no service role key", () => {
  assert.equal(/\.signUp\(/.test(srcFiles), false);
  assert.equal(/service_role\s*=/.test(config), false);
  assert.match(config, /Never put the service_role key/);
  const url = config.match(/SUPABASE_URL = "([^"]+)"/)[1];
  const key = config.match(/SUPABASE_ANON_KEY = "([^"]+)"/)[1];
  assert.match(url, /^https:\/\/[a-z0-9-]+\.supabase\.co$/);
  const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
  assert.equal(payload.role, "anon");
  assert.equal(payload.iss, "supabase");
});
