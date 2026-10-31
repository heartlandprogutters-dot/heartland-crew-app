import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const kent = "11111111-1111-4111-8111-111111111111";
const sam = "22222222-2222-4222-8222-222222222222";
const pat = "33333333-3333-4333-8333-333333333333";
const haley = "44444444-4444-4444-8444-444444444444";

function asJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function asUser(db, role, userId, fn) {
  if (role !== "anon" && role !== "authenticated") throw new Error(role);
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

test("row level security keeps exact locations off the public feed", { timeout: 120000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(read("../supabase/tests/prelude.sql"));
    await db.exec(read("../supabase/migrations/20261031120000_init.sql"));
    await db.exec(read("../supabase/migrations/20261031120100_storage.sql"));
    await db.exec(read("../supabase/migrations/20261031130000_videos.sql"));
    await db.exec(read("../supabase/migrations/20261031140000_move_pin.sql"));

    const openFunctions = await db.query(`
      select proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
          where cfg like 'search_path=%'
        )
    `);
    assert.deepEqual(openFunctions.rows, [], "every function needs a locked search_path");

    const priv = await db.query(`
      select
        has_table_privilege('anon', 'public.jobs', 'SELECT') as anon_jobs,
        has_table_privilege('anon', 'public.job_locations', 'SELECT') as anon_locations,
        has_table_privilege('authenticated', 'public.jobs', 'INSERT') as crew_insert,
        has_table_privilege('authenticated', 'public.jobs', 'SELECT') as crew_select,
        has_function_privilege('anon', 'public.public_jobs_feed()', 'EXECUTE') as anon_feed,
        (
          select bool_and(has_function_privilege('anon', p.oid, 'EXECUTE') = false)
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('approve_job', 'create_job', 'admin_create_user', 'offset_pin', 'import_jobs', 'attach_video', 'publish_job_videos', 'remove_job_video', 'import_job_videos')
        ) as anon_blocked
    `);
    assert.equal(priv.rows[0].anon_jobs, false);
    assert.equal(priv.rows[0].anon_locations, false);
    assert.equal(priv.rows[0].crew_insert, false);
    assert.equal(priv.rows[0].crew_select, true);
    assert.equal(priv.rows[0].anon_feed, true);
    assert.equal(priv.rows[0].anon_blocked, true);

    for (const [id, email] of [[kent, "kent@example.com"], [sam, "sam@example.com"], [pat, "pat@example.com"], [haley, "haley@example.com"]]) {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}'::jsonb)`, [id, email]);
    }
    await db.query(`update public.profiles set role = 'admin', display_name = 'Kent', disabled = false where id = $1`, [kent]);
    await db.query(`update public.profiles set role = 'crew', display_name = 'Sam', disabled = false where id = $1`, [sam]);
    await db.query(`update public.profiles set role = 'crew', display_name = 'Pat', disabled = false where id = $1`, [pat]);
    await db.query(`update public.profiles set role = 'approver', display_name = 'Haley', disabled = false where id = $1`, [haley]);

    const today = (await db.query(`select current_date::text as d`)).rows[0].d;
    const created = await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.create_job($1,$2,$3,$4,$5::date,$6,$7,$8) as id`,
      ["Seamless Gutters", "Murray", "KY", "New seamless gutters on a ranch house.", today, 36.612349, -88.654321, "123 Private Lane, Murray, KY"],
    ));
    const jobId = created.rows[0].id;

    const samSees = await asUser(db, "authenticated", sam, (tx) => tx.query(`select id, status, public_lat from public.jobs`));
    assert.equal(samSees.rows.length, 1);
    assert.equal(samSees.rows[0].status, "pending");
    assert.equal(samSees.rows[0].public_lat, null);

    const patSees = await asUser(db, "authenticated", pat, (tx) => tx.query(`select id from public.jobs`));
    assert.equal(patSees.rows.length, 0);

    const samLocation = await asUser(db, "authenticated", sam, (tx) => tx.query(`select job_id from public.job_locations`));
    assert.equal(samLocation.rows.length, 0);
    const patPeople = await asUser(db, "authenticated", pat, (tx) => tx.query(`select id from public.profiles`));
    assert.deepEqual(patPeople.rows.map((row) => row.id), [pat]);

    const haleyLocation = await asUser(db, "authenticated", haley, (tx) => tx.query(`select exact_lat, address from public.job_locations`));
    assert.equal(Number(haleyLocation.rows[0].exact_lat), 36.612349);
    assert.match(haleyLocation.rows[0].address, /Private Lane/);

    await expectFail(
      () => asUser(db, "anon", null, (tx) => tx.query(`select * from public.jobs`)),
      /permission denied/,
    );
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(
        `insert into public.jobs (service, town, state, title, summary, job_date) values ('Gutters', 'Murray', 'KY', 'A title here', 'A summary here', current_date)`,
      )),
      /permission denied/,
    );

    const emptyFeed = asJson((await asUser(db, "anon", null, (tx) => tx.query(`select public.public_jobs_feed() as feed`))).rows[0].feed);
    assert.deepEqual(emptyFeed, []);

    await db.exec(`grant update on public.jobs to authenticated`);
    await db.exec(`create policy jobs_update_test on public.jobs for update to authenticated using (true) with check (true)`);
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(`update public.jobs set status = 'approved' where id = $1`, [jobId])),
      /Direct changes are blocked/,
    );
    await db.exec(`drop policy jobs_update_test on public.jobs`);
    await db.exec(`revoke update on public.jobs from authenticated`);

    await db.exec(`grant update on public.profiles to authenticated`);
    await db.exec(`create policy profiles_update_test on public.profiles for update to authenticated using (true) with check (true)`);
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(`update public.profiles set role = 'admin' where id = $1`, [sam])),
      /Direct changes are blocked/,
    );
    const stillCrew = await db.query(`select role from public.profiles where id = $1`, [sam]);
    assert.equal(stillCrew.rows[0].role, "crew");
    await db.exec(`drop policy profiles_update_test on public.profiles`);
    await db.exec(`revoke update on public.profiles from authenticated`);

    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(
        `select public.approve_job($1, null, null, null, null, null, current_date, null, null, null, null, null, null, null)`,
        [jobId],
      )),
      /Only Kent or Haley/,
    );
    await expectFail(
      () => asUser(db, "anon", null, (tx) => tx.query(`select public.approve_job($1, null, null, null, null, null, current_date, null, null, null, null, null, null, null)`, [jobId])),
      /permission denied/,
    );

    const photoPath = `${sam}/${jobId}/1.webp`;
    await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.attach_photo($1, $2)`,
      [jobId, photoPath],
    ));
    const photo = await db.query(`select id from public.job_photos where job_id = $1`, [jobId]);
    const photoId = photo.rows[0].id;
    const publicUrl = `https://example.supabase.co/storage/v1/object/public/job-photos/seamless-gutters-murray-${today}-1.webp`;
    const videoRow = await asUser(db, "authenticated", sam, (tx) => tx.query(
      `select public.attach_video($1, $2) as id`,
      [jobId, `${sam}/${jobId}/v1.mp4`],
    ));
    const videoId = videoRow.rows[0].id;
    const videoUrl = `https://example.supabase.co/storage/v1/object/public/job-videos/seamless-gutters-murray-${today}-video-1.mp4`;

    const approved = asJson((await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.approve_job($1, $2, $3, $4, $5, 'KY', $6::date, $7::uuid[], $8::text[], 'Mike L.', 5, 'Clean work and on time.', $6::date, null) as result`,
      [jobId, "Seamless Gutters in Murray, KY", "New seamless gutters on a ranch house.", "Seamless Gutters", "Murray", today, [photoId], [publicUrl]],
    ))).rows[0].result);

    const distance = Number((await db.query(
      `select public.distance_meters(36.612349, -88.654321, public_lat, public_lng) as meters from public.jobs where id = $1`,
      [jobId],
    )).rows[0].meters);
    assert.ok(distance >= 150 && distance <= 250, `offset was ${distance}`);
    assert.notEqual(Number(approved.publicLat), 36.612349);
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.publish_job_videos($1, $2::uuid[], $3::text[])`,
      [jobId, [videoId], [videoUrl]],
    ));

    const feed = asJson((await asUser(db, "anon", null, (tx) => tx.query(`select public.public_jobs_feed() as feed`))).rows[0].feed);
    assert.equal(feed.length, 1);
    assert.deepEqual(Object.keys(feed[0]), ["id", "title", "service", "town", "state", "lat", "lng", "date", "summary", "photos", "review", "gbpUrl", "videos"]);
    assert.deepEqual(feed[0].videos, [videoUrl]);
    assert.equal(feed[0].date, today);
    assert.deepEqual(feed[0].photos, [publicUrl]);
    assert.equal(feed[0].review.name, "Mike L.");
    assert.equal(feed[0].gbpUrl, null);
    const feedText = JSON.stringify(feed);
    assert.equal(feedText.includes("36.612349"), false);
    assert.equal(feedText.includes("Private Lane"), false);
    assert.equal(feedText.includes(sam), false);
    assert.equal(feedText.includes("sam@example.com"), false);
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(`select public.remove_job_video($1)`, [videoId])),
      /Only Kent or Haley/,
    );
    const patVideos = await asUser(db, "authenticated", pat, (tx) => tx.query(`select id from public.job_videos`));
    assert.equal(patVideos.rows.length, 0);

    const view = await asUser(db, "anon", null, (tx) => tx.query(`select id, lat, summary from public.approved_jobs`));
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0].summary.includes("\\"), false);

    const pinBefore = await db.query(`select public_lat, public_lng from public.jobs where id = $1`, [jobId]);
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.update_approved_job($1, $2, $3, $4, $5, 'KY', $6::date, $7::uuid[], null, null, null, null, null)`,
      [jobId, "Seamless Gutters in Murray, KY", "New seamless gutters on a ranch house.", "Seamless Gutters", "Murray", today, [photoId]],
    ));
    const pinAfter = await db.query(`select public_lat, public_lng from public.jobs where id = $1`, [jobId]);
    assert.equal(pinAfter.rows[0].public_lat, pinBefore.rows[0].public_lat);
    assert.equal(pinAfter.rows[0].public_lng, pinBefore.rows[0].public_lng);

    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.move_exact_pin($1, 36.62, -88.66)`,
      [jobId],
    ));
    const moved = await db.query(`select exact_lat, exact_lng from public.job_locations where job_id = $1`, [jobId]);
    assert.equal(Number(moved.rows[0].exact_lat), 36.62);
    assert.equal(Number(moved.rows[0].exact_lng), -88.66);
    const publicAfterMove = await db.query(`select public_lat, public_lng from public.jobs where id = $1`, [jobId]);
    assert.equal(publicAfterMove.rows[0].public_lat, pinBefore.rows[0].public_lat);
    assert.equal(publicAfterMove.rows[0].public_lng, pinBefore.rows[0].public_lng);
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(`select public.move_exact_pin($1, 36.7, -88.7)`, [jobId])),
      /Only Kent or Haley/,
    );

    await asUser(db, "authenticated", haley, (tx) => tx.query(`select public.withdraw_job($1, $2)`, [jobId, "Taken off the website for a correction."]));
    const hidden = asJson((await asUser(db, "anon", null, (tx) => tx.query(`select public.public_jobs_feed() as feed`))).rows[0].feed);
    assert.deepEqual(hidden, []);
    const kept = await db.query(`select public_lat, status from public.jobs where id = $1`, [jobId]);
    assert.equal(kept.rows[0].status, "rejected");
    assert.equal(kept.rows[0].public_lat, pinBefore.rows[0].public_lat);
    await asUser(db, "authenticated", kent, (tx) => tx.query(`select public.republish_job($1)`, [jobId]));
    const restored = await db.query(`select public_lat, status from public.jobs where id = $1`, [jobId]);
    assert.equal(restored.rows[0].status, "approved");
    assert.equal(restored.rows[0].public_lat, pinBefore.rows[0].public_lat);

    const north = await db.query(`select lat, lng from public.destination_point(36.6, -88.3, 200, 0)`);
    const northDistance = Number((await db.query(
      `select public.distance_meters(36.6, -88.3, $1, $2) as meters`,
      [north.rows[0].lat, north.rows[0].lng],
    )).rows[0].meters);
    assert.ok(Math.abs(northDistance - 200) < 0.5, northDistance);

    for (let i = 0; i < 25; i += 1) {
      const moved = await db.query(`select lat, lng from public.offset_pin(36.61, -88.31)`);
      const meters = Number((await db.query(
        `select public.distance_meters(36.61, -88.31, $1, $2) as meters`,
        [moved.rows[0].lat, moved.rows[0].lng],
      )).rows[0].meters);
      assert.ok(meters >= 150 && meters <= 250, meters);
    }

    const imported = asJson((await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select public.import_jobs('public', $1::json) as result`,
      [JSON.stringify([{
        id: "sample-murray-gutters",
        title: "Seamless Gutters in Murray, KY",
        service: "Seamless Gutters",
        town: "Murray",
        state: "KY",
        lat: 36.6105,
        lng: -88.3148,
        date: today,
        summary: "New seamless gutters on a ranch house.",
        photos: [],
        review: null,
        gbpUrl: null,
        exactLat: 36.111,
        address: "999 Should Not Store",
      }])],
    ))).rows[0].result);
    assert.equal(imported.imported, 1);
    const importedLoc = await db.query(`select job_id from public.job_locations where job_id = 'sample-murray-gutters'`);
    assert.equal(importedLoc.rows.length, 0);
    const importedJob = await db.query(`select public_lat, public_lng from public.jobs where id = 'sample-murray-gutters'`);
    assert.equal(Number(importedJob.rows[0].public_lat), 36.6105);

    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(
        `select public.admin_create_user('new@example.com', 'temporary1', 'Alex', 'crew')`,
      )),
      /Only an admin/,
    );
    const added = await asUser(db, "authenticated", kent, (tx) => tx.query(
      `select public.admin_create_user('alex@example.com', 'temporary1', 'Alex', 'crew') as id`,
    ));
    const alex = added.rows[0].id;
    const alexProfile = await db.query(`select role, disabled from public.profiles where id = $1`, [alex]);
    assert.equal(alexProfile.rows[0].role, "crew");
    assert.equal(alexProfile.rows[0].disabled, false);
    await asUser(db, "authenticated", kent, (tx) => tx.query(`select public.admin_set_disabled($1, true)`, [alex]));
    await expectFail(
      () => asUser(db, "authenticated", alex, (tx) => tx.query(
        `select public.create_job('Seamless Gutters','Murray','KY','New seamless gutters on a ranch house.', current_date, 36.6, -88.3, null)`,
      )),
      /turned off/,
    );

    await asUser(db, "authenticated", sam, (tx) => tx.query(
      `insert into storage.objects (bucket_id, name) values ('job-photos-private', $1)`,
      [photoPath],
    ));
    await expectFail(
      () => asUser(db, "authenticated", pat, (tx) => tx.query(
        `insert into storage.objects (bucket_id, name) values ('job-photos-private', $1)`,
        [`${sam}/${jobId}/2.webp`],
      )),
      /row-level security|violates/,
    );
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(
        `insert into storage.objects (bucket_id, name) values ('job-photos', 'seamless-gutters-murray-${today}-2.webp')`,
      )),
      /row-level security|violates/,
    );
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `insert into storage.objects (bucket_id, name) values ('job-photos', $1)`,
      [`seamless-gutters-murray-${today}-2.webp`],
    ));
    const videoPath = `${sam}/${jobId}/v1.mp4`;
    await asUser(db, "authenticated", sam, (tx) => tx.query(
      `insert into storage.objects (bucket_id, name) values ('job-videos-private', $1)`,
      [videoPath],
    ));
    await expectFail(
      () => asUser(db, "authenticated", sam, (tx) => tx.query(
        `insert into storage.objects (bucket_id, name) values ('job-videos', $1)`,
        [`seamless-gutters-murray-${today}-video-1.mp4`],
      )),
      /row-level security|violates/,
    );
    await asUser(db, "authenticated", haley, (tx) => tx.query(
      `insert into storage.objects (bucket_id, name) values ('job-videos', $1)`,
      [`seamless-gutters-murray-${today}-video-1.mp4`],
    ));
    const anonVideo = await asUser(db, "anon", null, (tx) => tx.query(
      `select name from storage.objects where bucket_id = 'job-videos'`,
    ));
    assert.equal(anonVideo.rows.length, 1);
    const anonPrivateVideo = await asUser(db, "anon", null, (tx) => tx.query(
      `select name from storage.objects where bucket_id = 'job-videos-private'`,
    ));
    assert.equal(anonPrivateVideo.rows.length, 0);

    const anonPublic = await asUser(db, "anon", null, (tx) => tx.query(
      `select name from storage.objects where bucket_id = 'job-photos'`,
    ));
    assert.equal(anonPublic.rows.length, 1);
    const anonPrivate = await asUser(db, "anon", null, (tx) => tx.query(
      `select name from storage.objects where bucket_id = 'job-photos-private'`,
    ));
    assert.equal(anonPrivate.rows.length, 0);
    const patPrivate = await asUser(db, "authenticated", pat, (tx) => tx.query(
      `select name from storage.objects where bucket_id = 'job-photos-private'`,
    ));
    assert.equal(patPrivate.rows.length, 0);
    const haleyPrivate = await asUser(db, "authenticated", haley, (tx) => tx.query(
      `select name from storage.objects where bucket_id = 'job-photos-private'`,
    ));
    assert.equal(haleyPrivate.rows.length, 1);

    await db.exec(read("../supabase/migrations/20261031120100_storage.sql"));
    await db.exec(read("../supabase/migrations/20261031130000_videos.sql"));
    await db.exec(read("../supabase/migrations/20261031140000_move_pin.sql"));
    const stillThere = await asUser(db, "anon", null, (tx) => tx.query(
      `select count(*)::int as n from storage.objects where bucket_id = 'job-photos'`,
    ));
    assert.equal(stillThere.rows[0].n, 1);
  } finally {
    await db.close();
  }
});
