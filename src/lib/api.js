import { photoFileName } from "./names.js";
import { getSupabase } from "./supabase.js";

export function friendlyError(error) {
  const msg = error?.message || error?.error_description || "Something went wrong.";
  if (/invalid login credentials/i.test(msg)) return "That email or password does not match.";
  if (/email not confirmed/i.test(msg)) return "This login is not confirmed yet. Ask Kent.";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return "Cannot reach the server. Check your connection and try again.";
  if (/too many requests|rate limit/i.test(msg)) return "Too many tries. Wait a minute and try again.";
  return msg;
}

async function rpc(name, args) {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function loadProfile() {
  const supabase = getSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(friendlyError(userError));
  if (!userData.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, disabled")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function signIn(email, password) {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(friendlyError(error));
}

export async function signOut() {
  await getSupabase().auth.signOut();
}

export async function sendPasswordReset(email) {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw new Error(friendlyError(error));
}

export async function changePassword(password) {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
}

export async function submitNewJob({ fields, photos, location, onProgress }) {
  const supabase = getSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Sign in first.");
  const userId = userData.user.id;
  const jobId = await rpc("create_job", {
    p_service: fields.service,
    p_town: fields.town,
    p_state: fields.state,
    p_summary: fields.summary,
    p_job_date: fields.date,
    p_exact_lat: location.lat,
    p_exact_lng: location.lng,
    p_address: location.address || null,
  });
  try {
    for (let index = 0; index < photos.length; index += 1) {
      onProgress?.(`Saving photo ${index + 1} of ${photos.length}…`);
      const path = `${userId}/${jobId}/${index + 1}.webp`;
      const { error: uploadError } = await supabase.storage.from("job-photos-private").upload(path, photos[index].blob, {
        contentType: "image/webp",
        upsert: true,
      });
      if (uploadError) throw new Error(friendlyError(uploadError));
      await rpc("attach_photo", { p_job_id: jobId, p_storage_path: path });
    }
  } catch (error) {
    await rpc("delete_own_job", { p_job_id: jobId }).catch(() => {});
    throw new Error(`${friendlyError(error)} Nothing was kept. Please try again.`);
  }
  return jobId;
}

export async function listMyJobs() {
  const { data, error } = await getSupabase()
    .from("jobs")
    .select("id, status, service, town, state, title, summary, job_date, rejection_reason, created_at, job_photos(id, storage_path, public_url, sort_order)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyError(error));
  return data || [];
}

export async function deleteOwnJob(job) {
  const supabase = getSupabase();
  const paths = (job.job_photos || [])
    .map((photo) => photo.storage_path)
    .filter((path) => path && !path.startsWith("imported/") && !path.startsWith("http"));
  if (paths.length) await supabase.storage.from("job-photos-private").remove(paths);
  await rpc("delete_own_job", { p_job_id: job.id });
}

export async function signedPhotoUrl(path) {
  const { data, error } = await getSupabase().storage.from("job-photos-private").createSignedUrl(path, 60 * 30);
  if (error) throw new Error(friendlyError(error));
  return data.signedUrl;
}

export async function listReviewJobs() {
  const supabase = getSupabase();
  const [jobsRes, peopleRes] = await Promise.all([
    supabase.from("jobs").select("*, job_locations(*), job_photos(*)").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, display_name, role, email, disabled").order("display_name"),
  ]);
  if (jobsRes.error) throw new Error(friendlyError(jobsRes.error));
  if (peopleRes.error) throw new Error(friendlyError(peopleRes.error));
  const names = new Map((peopleRes.data || []).map((person) => [person.id, person]));
  return {
    jobs: (jobsRes.data || []).map((job) => ({ ...job, poster: names.get(job.created_by) || null })),
    people: peopleRes.data || [],
  };
}

async function uploadPublicPhoto(blob, filename) {
  const supabase = getSupabase();
  const bucket = supabase.storage.from("job-photos");
  let name = filename;
  let result = await bucket.upload(name, blob, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (result.error && /exists|duplicate|409/i.test(result.error.message || "")) {
    name = filename.replace(/\.webp$/, `-${crypto.randomUUID().slice(0, 4)}.webp`);
    result = await bucket.upload(name, blob, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  }
  if (result.error) throw new Error(friendlyError(result.error));
  const { data } = bucket.getPublicUrl(name);
  return data.publicUrl;
}

export async function approveJob(job, form, orderedPhotos, onProgress) {
  const supabase = getSupabase();
  const urls = [];
  for (let index = 0; index < orderedPhotos.length; index += 1) {
    onProgress?.(`Publishing photo ${index + 1} of ${orderedPhotos.length}…`);
    const photo = orderedPhotos[index];
    const { data, error } = await supabase.storage.from("job-photos-private").download(photo.storage_path);
    if (error) throw new Error(friendlyError(error));
    const filename = photoFileName(form.service, form.town, form.date, index + 1);
    urls.push(await uploadPublicPhoto(data, filename));
  }
  return rpc("approve_job", {
    p_job_id: job.id,
    p_title: form.title,
    p_summary: form.summary,
    p_service: form.service,
    p_town: form.town,
    p_state: form.state,
    p_job_date: form.date,
    p_photo_ids: orderedPhotos.map((photo) => photo.id),
    p_public_urls: urls,
    p_review_name: form.reviewName || null,
    p_review_stars: form.reviewStars || null,
    p_review_text: form.reviewText || null,
    p_review_date: form.reviewDate || null,
    p_gbp_url: form.gbpUrl || null,
  });
}

export async function updateApprovedJob(job, form, orderedPhotos) {
  await rpc("update_approved_job", {
    p_job_id: job.id,
    p_title: form.title,
    p_summary: form.summary,
    p_service: form.service,
    p_town: form.town,
    p_state: form.state,
    p_job_date: form.date,
    p_photo_ids: orderedPhotos.map((photo) => photo.id),
    p_review_name: form.reviewName || null,
    p_review_stars: form.reviewStars || null,
    p_review_text: form.reviewText || null,
    p_review_date: form.reviewDate || null,
    p_gbp_url: form.gbpUrl || null,
  });
}

export function rejectJob(jobId, reason) {
  return rpc("reject_job", { p_job_id: jobId, p_reason: reason });
}

export function withdrawJob(jobId, reason) {
  return rpc("withdraw_job", { p_job_id: jobId, p_reason: reason });
}

export function republishJob(jobId) {
  return rpc("republish_job", { p_job_id: jobId });
}

export async function fetchFeed() {
  const data = await rpc("public_jobs_feed");
  const feed = typeof data === "string" ? JSON.parse(data) : data;
  if (!Array.isArray(feed)) throw new Error("The public feed did not come back as a list.");
  return feed;
}

export async function downloadBackup() {
  const supabase = getSupabase();
  const [jobsRes, locationsRes, photosRes] = await Promise.all([
    supabase.from("jobs").select("*").order("created_at", { ascending: false }),
    supabase.from("job_locations").select("*"),
    supabase.from("job_photos").select("*"),
  ]);
  if (jobsRes.error) throw new Error(friendlyError(jobsRes.error));
  if (locationsRes.error) throw new Error(friendlyError(locationsRes.error));
  if (photosRes.error) throw new Error(friendlyError(photosRes.error));
  return { jobs: jobsRes.data || [], locations: locationsRes.data || [], photos: photosRes.data || [] };
}

export function importJobs(kind, jobs) {
  return rpc("import_jobs", { p_kind: kind, p_jobs: jobs });
}

export async function listPeople() {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, email, display_name, role, disabled, created_at")
    .order("display_name");
  if (error) throw new Error(friendlyError(error));
  return data || [];
}

export function createPerson(input) {
  return rpc("admin_create_user", {
    p_email: input.email,
    p_password: input.password,
    p_display_name: input.displayName,
    p_role: input.role,
  });
}

export function setPersonRole(userId, role) {
  return rpc("admin_set_role", { p_user_id: userId, p_role: role });
}

export function setPersonDisabled(userId, disabled) {
  return rpc("admin_set_disabled", { p_user_id: userId, p_disabled: disabled });
}
