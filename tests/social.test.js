import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { originalPhotoFileName, originalVideoFileName } from "../src/lib/names.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const kent = "11111111-1111-4111-8111-111111111111";
const sam = "22222222-2222-4222-8222-222222222222";
const haley = "44444444-4444-4444-8444-444444444444";

function asJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function asUser(db, role, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId || ""]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

async function expectFail(fn, pattern) {
  await assert.rejects(fn, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

test("original social file names stay next to the website names", () => {
  assert.equal(
    originalPhotoFileName("Seamless Gutters", "Farmington", "2026-10-31", 1),
    "seamless-gutters-farmington-2026-10-31-1-full.webp",
  );
  assert.equal(
    originalVideoFileName("Seamless Gutters", "Farmington", "2026-10-31", 1, "mp4"),
    "seamless-gutters-farmington-2026-10-31-video-1-full.mp4",
  );
});

test("the social feed SQL does not read exact locations or names", () => {
  const sql = read("../supabase/migrations/20261031180000_social_feed.sql");
  const feed = sql.split("function public.public_social_feed")[1].split("$fn$;")[0];
  for (const word of ["exact_lat", "exact_lng", "address", "display_name", "review_name", "created_by", "storage_path", "original_path"]) {
    assert.equal(feed.includes(word), false, word);
  }
  assert.match(sql, /PASTE_A_LONG_RANDOM_TOKEN_HERE/);
  assert.doesNotMatch(sql, /eyJ/);
  assert.doesNotMatch(sql, /alter\s+table\s+storage\./i);
});

test("anon can read the social feed and only a token can change its status", { timeout: 120000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(read("../supabase/tests/prelude.sql"));
    await db.exec(read("../supabase/migrations/20261031120000_init.sql"));
    await db.exec(read("../supabase/migrations/20261031120100_storage.sql"));
    await db.exec(read("../supabase/migrations/20261031130000_videos.sql"));
    await db.exec(read("../supabase/migrations/20261031140000_move_pin.sql"));
    await db.exec(read("../supabase/migrations/20261031150000_roles.sql"));
    await db.exec(read("../supabase/migrations/20261031160000_delete_job.sql"));
    await db.exec(read("../supabase/migrations/20261031170000_job_merge.sql"));
    await db.exec(read("../supabase/migrations/20261031180000_social_feed.sql"));

    for (const [id, email, name, role] of [
      [kent, "kent@example.com", "Kent", "admin"],
      [sam, "sam@example.com", "Sam Crew", "trainee"],
      [haley, "haley@example.com", "Haley", "approver"],
    ]) {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}'::jsonb)`, [id, email]);
      await db.query(`update public.profiles set role = $2, display_name = $3, disabled = false where id = $1`, [id, role, name]);
    }

    const today = (await db.query(`select current_date::text as d`)).rows[0].d;
    const created = await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.create_job($1,$2,$3,$4,$5::date,$6,$7,$8) as id`,
      ["Seamless Gutters", "Farmington", "KY", "New seamless gutters on a ranch house.", today, 36.66851, -88.21672, "123 Secret Lane"],
    ));
    const jobId = created.rows[0].id;
    const photoId = (await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.attach_photo($1, $2) as id`,
      [jobId, `${sam}/${jobId}/1.webp`],
    ))).rows[0].id;
    await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.save_photo_extra($1, 'after', $2)`,
      [photoId, `${sam}/${jobId}/o1.webp`],
    ));
    const videoId = (await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.attach_video($1, $2) as id`,
      [jobId, `${sam}/${jobId}/v1.mp4`],
    ))).rows[0].id;
    await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.save_video_extra($1, 1280, 720, 42, $2)`,
      [videoId, `${sam}/${jobId}/full1.mp4`],
    ));
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('job-videos-original-private', $1)`,
      [`${sam}/${jobId}/full1.mp4`],
    );

    const photoUrl = `https://example.supabase.co/storage/v1/object/public/job-photos/seamless-gutters-farmington-${today}-1.webp`;
    const trimUrl = `https://example.supabase.co/storage/v1/object/public/job-videos/seamless-gutters-farmington-${today}-video-1.mp4`;
    const originalPhoto = `https://example.supabase.co/storage/v1/object/public/job-photos-original/seamless-gutters-farmington-${today}-1-full.webp`;
    const originalVideo = `https://example.supabase.co/storage/v1/object/public/job-videos-original/seamless-gutters-farmington-${today}-video-1-full.mp4`;
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.approve_job($1, $2, $3, $4, $5, 'KY', $6::date, $7::uuid[], $8::text[], null, null, null, null, null)`,
      [jobId, "Seamless Gutters in Farmington, KY", "New seamless gutters on a ranch house.", "Seamless Gutters", "Farmington", today, [photoId], [photoUrl]],
    ));
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.publish_job_videos($1, $2::uuid[], $3::text[])`,
      [jobId, [videoId], [trimUrl]],
    ));
    await db.query(`update public.jobs set public_lat = 36.7419, public_lng = -88.6361 where id = $1`, [jobId]);
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.set_privacy_checked($1, true)`,
      [jobId],
    ));
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.publish_photo_original($1, $2)`,
      [photoId, originalPhoto],
    ));
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.publish_video_original($1, $2)`,
      [videoId, originalVideo],
    ));

    await expectFail(
      () => asUser(db, "anon", null, (tx) => tx.query(`select * from public.jobs`)),
      /permission denied/,
    );
    await expectFail(
      () => asUser(db, "anon", null, (tx) => tx.query(`select * from public.app_settings`)),
      /permission denied/,
    );
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(`select public.set_social_skip($1, true)`, [jobId])),
      /Only Kent or Haley/,
    );

    const feed = asJson((await asUser(db, "anon", null, (tx) => tx.query(
      `select public.public_social_feed() as feed`,
    ))).rows[0].feed);
    assert.equal(feed.length, 1);
    const row = feed[0];
    assert.deepEqual(Object.keys(row), [
      "job_id", "approved_at", "service", "town", "state", "title", "summary",
      "photos", "videos", "social_status", "privacy_checked", "lat", "lng",
    ]);
    assert.equal(row.job_id, jobId);
    assert.match(String(row.approved_at), /T/);
    assert.match(String(row.approved_at), /([+-]\d{2}|Z)/);
    assert.equal(row.service, "Seamless Gutters");
    assert.equal(row.town, "Farmington");
    assert.equal(row.state, "KY");
    assert.equal(row.social_status, "pending");
    assert.equal(row.privacy_checked, true);
    assert.equal(row.lat, 36.74);
    assert.equal(row.lng, -88.64);
    assert.equal(row.photos[0].stage, "after");
    assert.equal(row.photos[0].url, originalPhoto);
    assert.equal(row.photos[0].caption_hint, "After. Seamless Gutters in Farmington, KY");
    assert.equal(row.videos[0].url, originalVideo);
    assert.equal(row.videos[0].trim_url, trimUrl);
    assert.equal(row.videos[0].width, 1280);
    assert.equal(row.videos[0].height, 720);
    assert.equal(Number(row.videos[0].duration_s), 42);
    const dumped = JSON.stringify(feed);
    assert.equal(dumped.includes("123 Secret Lane"), false);
    assert.equal(dumped.includes("36.66851"), false);
    assert.equal(dumped.includes("Sam Crew"), false);
    assert.equal(dumped.includes("sam@example.com"), false);
    assert.equal(dumped.includes(sam), false);

    const postedOnly = asJson((await asUser(db, "anon", null, (tx) => tx.query(
      `select public.public_social_feed('posted') as feed`,
    ))).rows[0].feed);
    assert.deepEqual(postedOnly, []);

    await db.query(`insert into public.app_settings (key, value) values ('social_token_hash', 'nope')`);
    await expectFail(
      () => asUser(db, "anon", null, (tx) => tx.query(
        `select public.set_social_status($1, 'posted', 'placeholder-token')`,
        [jobId],
      )),
      /not accepted/,
    );
    await db.query(`update public.app_settings set value = 'test-hash' where key = 'social_token_hash'`);
    const updated = asJson((await asUser(db, "anon", null, (tx) => tx.query(
      `select public.set_social_status($1, 'posted', 'placeholder-token') as result`,
      [jobId],
    ))).rows[0].result);
    assert.equal(updated.social_status, "posted");
    assert.equal(JSON.stringify(updated).includes("placeholder-token"), false);
    const waiting = asJson((await asUser(db, "anon", null, (tx) => tx.query(
      `select public.public_social_feed() as feed`,
    ))).rows[0].feed);
    assert.deepEqual(waiting, []);
    const kept = await db.query(`select original_url from public.job_videos where id = $1`, [videoId]);
    assert.equal(kept.rows[0].original_url, null);
    const stored = await db.query(`select id from storage.objects where name = $1`, [`${sam}/${jobId}/full1.mp4`]);
    assert.equal(stored.rows.length, 0);

    await asUser(db, "authenticated", haley, (tx) => tx.query(`select public.set_social_skip($1, true)`, [jobId]));
    const skipped = await db.query(`select social_status from public.jobs where id = $1`, [jobId]);
    assert.equal(skipped.rows[0].social_status, "skip");
    await asUser(db, "authenticated", haley, (tx) => tx.query(`select public.set_social_skip($1, false)`, [jobId]));
    const restored = await db.query(`select social_status from public.jobs where id = $1`, [jobId]);
    assert.equal(restored.rows[0].social_status, "pending");
  } finally {
    await db.close();
  }
});
