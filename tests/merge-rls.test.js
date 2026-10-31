import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const kent = "11111111-1111-4111-8111-111111111111";
const sam = "22222222-2222-4222-8222-222222222222";
const pat = "33333333-3333-4333-8333-333333333333";
const haley = "44444444-4444-4444-8444-444444444444";
const lee = "55555555-5555-4555-8555-555555555555";

function asJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function asUser(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec(`set local role authenticated`);
    return fn(tx);
  });
}

async function expectFail(fn, pattern) {
  await assert.rejects(fn, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

async function post(db, userId, lat, summary) {
  const today = (await db.query(`select current_date::text as d`)).rows[0].d;
  const created = await asUser(db, userId, (tx) => tx.query(
    `select public.create_job($1,$2,$3,$4,$5::date,$6,$7,$8) as id`,
    ["Seamless Gutters", "Farmington", "KY", summary, today, lat, -88.65, "Sample house"],
  ));
  const id = created.rows[0].id;
  await asUser(db, userId, (tx) => tx.query(
    `select public.attach_photo($1, $2)`,
    [id, `${userId}/${id}/1.webp`],
  ));
  return id;
}

test("a trainee post folds into the matching lead job and stays private", { timeout: 120000 }, async () => {
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

    for (const [id, email, name, role] of [
      [kent, "kent@example.com", "Kent", "admin"],
      [sam, "sam@example.com", "Sam", "trainee"],
      [pat, "pat@example.com", "Pat", "lead_man"],
      [haley, "haley@example.com", "Haley", "approver"],
      [lee, "lee@example.com", "Lee", "lead_man"],
    ]) {
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}'::jsonb)`, [id, email]);
      await db.query(`update public.profiles set role = $2, display_name = $3, disabled = false where id = $1`, [id, role, name]);
    }

    const leadId = await post(db, pat, 36.61, "New seamless gutters on a ranch house.");
    const traineeId = await post(db, sam, 36.6104, "Gutters on the same ranch house today.");
    const settled = asJson((await asUser(db, sam, (tx) => tx.query(
      `select public.settle_job($1, null, null, null) as result`,
      [traineeId],
    ))).rows[0].result);
    assert.equal(settled.status, "merged");
    assert.equal(settled.mergeNote, "added to Pat's job");

    const samRows = await asUser(db, sam, (tx) => tx.query(`select id, status, merge_note from public.jobs`));
    assert.deepEqual(samRows.rows.map((row) => row.id), [traineeId]);
    assert.equal(samRows.rows[0].status, "merged");
    assert.equal(samRows.rows[0].merge_note, "added to Pat's job");
    const samPhotos = await asUser(db, sam, (tx) => tx.query(`select id from public.job_photos`));
    assert.equal(samPhotos.rows.length, 0);

    const patRows = await asUser(db, pat, (tx) => tx.query(`select id, status from public.jobs`));
    assert.deepEqual(patRows.rows.map((row) => row.id), [leadId]);
    const patPhotos = await asUser(db, pat, (tx) => tx.query(`select job_id from public.job_photos order by sort_order`));
    assert.equal(patPhotos.rows.length, 2);
    assert.equal(patPhotos.rows.every((row) => row.job_id === leadId), true);
    const crew = await asUser(db, pat, (tx) => tx.query(`select display_name from public.job_contributors`));
    assert.deepEqual(crew.rows.map((row) => row.display_name), ["Sam"]);

    const queued = await asUser(db, haley, (tx) => tx.query(
      `select id from public.jobs where status = 'pending'`,
    ));
    assert.deepEqual(queued.rows.map((row) => row.id), [leadId]);

    await expectFail(
      () => asUser(db, sam, (tx) => tx.query(`select public.merge_jobs($1, $2)`, [leadId, traineeId])),
      /Only Kent or Haley/,
    );

    const otherLead = await post(db, lee, 36.70, "Gutters on a house across town.");
    const otherTrainee = await post(db, sam, 36.7003, "Gutters across town with two leads.");
    const secondLead = await post(db, pat, 36.7002, "Another lead on the across town house.");
    const ambiguous = asJson((await asUser(db, sam, (tx) => tx.query(
      `select public.settle_job($1, null, null, null) as result`,
      [otherTrainee],
    ))).rows[0].result);
    assert.equal(ambiguous.status, "pending");
    assert.equal(ambiguous.mergeNote, null);
    const stillSeparate = await db.query(`select status from public.jobs where id = $1`, [secondLead]);
    assert.equal(stillSeparate.rows[0].status, "pending");
    void otherLead;

    const photo = await db.query(`select id from public.job_photos where job_id = $1 limit 1`, [otherTrainee]);
    await expectFail(
      () => asUser(db, sam, (tx) => tx.query(`select public.remove_review_photo($1)`, [photo.rows[0].id])),
      /Only Kent or Haley/,
    );
    await asUser(db, haley, (tx) => tx.query(`select public.merge_jobs($1, $2)`, [otherLead, otherTrainee]));
    const combined = await db.query(`select status, merge_note from public.jobs where id = $1`, [otherTrainee]);
    assert.equal(combined.rows[0].status, "merged");
    assert.equal(combined.rows[0].merge_note, "added to Lee's job");

    const today = (await db.query(`select current_date::text as d`)).rows[0].d;
    const leadPhotos = await db.query(`select id from public.job_photos where job_id = $1 order by sort_order`, [leadId]);
    const urls = leadPhotos.rows.map((_, index) => (
      `https://example.supabase.co/storage/v1/object/public/job-photos/seamless-gutters-farmington-${today}-${index + 1}.webp`
    ));
    await asUser(db, haley, (tx) => tx.query(
      `select public.approve_job($1, $2, $3, $4, $5, 'KY', $6::date, $7::uuid[], $8::text[], null, null, null, null, null)`,
      [leadId, "Seamless Gutters in Farmington, KY", "New seamless gutters on a ranch house.", "Seamless Gutters", "Farmington", today, leadPhotos.rows.map((row) => row.id), urls],
    ));

    const late = await post(db, sam, 36.6105, "More gutters after the lead job is approved.");
    const added = asJson((await asUser(db, sam, (tx) => tx.query(
      `select public.settle_job($1, null, null, null) as result`,
      [late],
    ))).rows[0].result);
    assert.equal(added.status, "merged");
    const flagged = await db.query(`select new_photos from public.jobs where id = $1`, [leadId]);
    assert.equal(flagged.rows[0].new_photos, true);
    const fresh = await db.query(`select id from public.job_photos where job_id = $1 and public_url is null`, [leadId]);
    assert.equal(fresh.rows.length, 1);
    const addedUrl = `https://example.supabase.co/storage/v1/object/public/job-photos/seamless-gutters-farmington-${today}-3.webp`;
    await asUser(db, haley, (tx) => tx.query(
      `select public.publish_new_photos($1, $2::uuid[], $3::text[])`,
      [leadId, [fresh.rows[0].id], [addedUrl]],
    ));
    const feed = asJson((await db.query(`select public.public_jobs_feed() as feed`)).rows[0].feed);
    const published = feed.find((item) => item.id === leadId);
    assert.equal(published.photos.includes(addedUrl), true);
    const cleared = await db.query(`select new_photos from public.jobs where id = $1`, [leadId]);
    assert.equal(cleared.rows[0].new_photos, false);

    const waiting = await post(db, sam, 36.80, "Trainee posted before the lead arrived.");
    const laterLead = await post(db, pat, 36.8002, "Lead arrived after the trainee.");
    const leadSettled = asJson((await asUser(db, pat, (tx) => tx.query(
      `select public.settle_job($1, null, null, null) as result`,
      [laterLead],
    ))).rows[0].result);
    assert.deepEqual(leadSettled.absorbed, ["Sam"]);
    const waitingRow = await db.query(`select status, merge_note from public.jobs where id = $1`, [waiting]);
    assert.equal(waitingRow.rows[0].status, "merged");
    assert.equal(waitingRow.rows[0].merge_note, "added to Pat's job");

    const distant = await post(db, sam, 37.2, "Gutters on a house far from the others.");
    const kept = asJson((await asUser(db, sam, (tx) => tx.query(
      `select public.settle_job($1, null, null, null) as result`,
      [distant],
    ))).rows[0].result);
    assert.equal(kept.status, "pending");
  } finally {
    await db.close();
  }
});
