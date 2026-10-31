import { originalPhotoFileName, originalVideoFileName, photoFileName, videoFileName } from "./names.js";
import { MAX_ORIGINAL_BYTES } from "./video.js";
import { getSupabase } from "./supabase.js";

export function friendlyError(error) {
  const msg = error?.message || error?.error_description || "Something went wrong.";
  if (/invalid login credentials/i.test(msg)) return "That email or password does not match.";
  if (/email not confirmed/i.test(msg)) return "This login is not confirmed yet. Ask Kent.";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return "Cannot reach the server. Check your connection and try again.";
  if (/too many requests|rate limit/i.test(msg)) return "Too many tries. Wait a minute and try again.";
  if (/jwt expired|invalid jwt/i.test(msg)) return "Your sign-in expired. Sign in again, then try once more.";
  if (/row-level security|permission denied|42501/i.test(msg)) {
    return "This login cannot save that. Ask Kent if the account is turned off.";
  }
  if (/payload too large|entity too large|\b413\b/i.test(msg)) {
    return "A photo or video is too large to upload. Remove one and try again.";
  }
  if (/mime type|content.type|invalid mime/i.test(msg)) {
    return "That file type was rejected. Photos are saved as WebP, and videos as mp4 or webm.";
  }
  if (msg === "Not allowed.") return "This login cannot do that. Ask Kent if the account is turned off.";
  return explainDatabaseError(msg);
}

export function explainDatabaseError(message) {
  const msg = String(message || "Something went wrong.");
  const missing = /schema cache|does not exist|could not find the function/i.test(msg);
  if (missing && /move_exact_pin/i.test(msg)) {
    return "Saving a moved house pin needs a database update. In the Supabase SQL Editor, run supabase/migrations/20261031140000_move_pin.sql";
  }
  if (missing && /publish_job_videos|attach_video|job_videos/i.test(msg)) {
    return "Short videos need a database update. In the Supabase SQL Editor, run supabase/migrations/20261031130000_videos.sql";
  }
  if (missing && /delete_job/i.test(msg)) {
    return "Deleting a job needs a database update. In the Supabase SQL Editor, run supabase/migrations/20261031160000_delete_job.sql";
  }
  if (missing && /settle_job|merge_jobs|publish_new_photos|remove_review_photo|job_contributors/i.test(msg)) {
    return "Combining jobs needs a database update. In the Supabase SQL Editor, run supabase/migrations/20261031170000_job_merge.sql";
  }
  if (missing && /public_social_feed|set_social_status|set_social_skip|set_privacy_checked|save_photo_extra|save_video_extra|publish_photo_original|publish_video_original/i.test(msg)) {
    return "The social feed needs a database update. In the Supabase SQL Editor, run supabase/migrations/20261031180000_social_feed.sql";
  }
  if (missing && /approve_job/i.test(msg)) {
    return "Approving needs the first database setup. In the Supabase SQL Editor, run supabase/migrations/20261031120000_init.sql";
  }
  if (/profiles_role_check|role must be trainee|invalid input value for enum|lead_man/i.test(msg)) {
    return "The Trainee and Lead Man roles need a database update. In the Supabase SQL Editor, run supabase/migrations/20261031150000_roles.sql";
  }
  if (missing) {
    const name = msg.match(/function (?:public\.)?([a-z0-9_]+)/i)?.[1] || "a required function";
    return `The database is missing ${name}. In the Supabase SQL Editor, run the files in supabase/migrations in order. The latest are 20261031140000_move_pin.sql and 20261031150000_roles.sql.`;
  }
  return msg;
}

async function rpc(name, args) {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

async function rpcIfReady(name, args) {
  try {
    return await rpc(name, args);
  } catch (error) {
    if (/social_feed\.sql|schema cache|could not find the function|does not exist/i.test(error?.message || "")) return null;
    throw error;
  }
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

export async function submitNewJob({ fields, photos, videos = [], location, exif = null, onProgress }) {
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
      const photo = photos[index];
      const path = `${userId}/${jobId}/${index + 1}.webp`;
      const { error: uploadError } = await supabase.storage.from("job-photos-private").upload(path, photo.blob, {
        contentType: "image/webp",
        upsert: true,
      });
      if (uploadError) throw new Error(friendlyError(uploadError));
      const photoId = await rpc("attach_photo", { p_job_id: jobId, p_storage_path: path });
      let originalPath = null;
      if (photo.original && photo.original.size <= 8 * 1024 * 1024) {
        originalPath = `${userId}/${jobId}/o${index + 1}.webp`;
        const { error: originalError } = await supabase.storage.from("job-photos-original-private").upload(originalPath, photo.original, {
          contentType: "image/webp",
          upsert: true,
        });
        if (originalError) originalPath = null;
      }
      if (photoId && (photo.stage || originalPath)) {
        await rpcIfReady("save_photo_extra", {
          p_photo_id: photoId,
          p_stage: photo.stage || null,
          p_original_path: originalPath,
        });
      }
    }
    for (let index = 0; index < videos.length; index += 1) {
      onProgress?.(`Saving video ${index + 1} of ${videos.length}…`);
      const clip = videos[index];
      const ext = clip.ext === "webm" ? "webm" : "mp4";
      const path = `${userId}/${jobId}/v${index + 1}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("job-videos-private").upload(path, clip.blob, {
        contentType: ext === "webm" ? "video/webm" : "video/mp4",
        upsert: true,
      });
      if (uploadError) throw new Error(friendlyError(uploadError));
      const videoId = await rpc("attach_video", { p_job_id: jobId, p_storage_path: path });
      let originalPath = null;
      const source = clip.file;
      const sourceExt = source?.type?.includes("webm") ? "webm" : "mp4";
      if (source && source.size > 0 && source.size <= MAX_ORIGINAL_BYTES && (sourceExt === "mp4" || sourceExt === "webm")) {
        originalPath = `${userId}/${jobId}/full${index + 1}.${sourceExt}`;
        const { error: originalError } = await supabase.storage.from("job-videos-original-private").upload(originalPath, source, {
          contentType: sourceExt === "webm" ? "video/webm" : "video/mp4",
          upsert: true,
        });
        if (originalError) originalPath = null;
      }
      if (videoId) {
        await rpcIfReady("save_video_extra", {
          p_video_id: videoId,
          p_width: Math.round(clip.width || 0) || null,
          p_height: Math.round(clip.height || 0) || null,
          p_duration_s: Number(clip.duration) || null,
          p_original_path: originalPath,
        });
      }
    }
  } catch (error) {
    await rpc("delete_own_job", { p_job_id: jobId }).catch(() => {});
    throw new Error(`${friendlyError(error)} Nothing was kept. Please try again.`);
  }
  try {
    const data = await rpc("settle_job", {
      p_job_id: jobId,
      p_exif_lat: exif?.lat ?? null,
      p_exif_lng: exif?.lng ?? null,
      p_exif_taken_at: exif?.takenAt || null,
    });
    const settled = typeof data === "string" ? JSON.parse(data) : (data || {});
    return { id: jobId, status: "pending", mergeNote: null, absorbed: [], ...settled };
  } catch (error) {
    return {
      id: jobId,
      status: "pending",
      mergeNote: null,
      absorbed: [],
      warning: friendlyError(error),
    };
  }
}

export async function listMyJobs() {
  const supabase = getSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Sign in first.");
  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, service, town, state, title, summary, job_date, rejection_reason, created_at, merge_note, merged_into, new_photos, job_photos(id, storage_path, public_url, sort_order), job_videos(id, storage_path, public_url, sort_order), job_contributors(display_name)")
    .eq("created_by", userData.user.id)
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
  const videoPaths = (job.job_videos || [])
    .map((video) => video.storage_path)
    .filter((path) => path && !path.startsWith("imported/") && !path.startsWith("http"));
  if (videoPaths.length) await supabase.storage.from("job-videos-private").remove(videoPaths);
  await rpc("delete_own_job", { p_job_id: job.id });
}

export async function signedPhotoUrl(path) {
  const { data, error } = await getSupabase().storage.from("job-photos-private").createSignedUrl(path, 60 * 30);
  if (error) throw new Error(friendlyError(error));
  return data.signedUrl;
}

export async function signedVideoUrl(path) {
  const { data, error } = await getSupabase().storage.from("job-videos-private").createSignedUrl(path, 60 * 30);
  if (error) throw new Error(friendlyError(error));
  return data.signedUrl;
}

export async function listReviewJobs() {
  const supabase = getSupabase();
  const [jobsRes, peopleRes] = await Promise.all([
    supabase.from("jobs").select("*, job_locations(*), job_photos(*), job_videos(*), job_contributors(display_name, profile_id)").order("created_at", { ascending: false }),
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

async function uploadPublicVideo(blob, filename, contentType) {
  const supabase = getSupabase();
  const bucket = supabase.storage.from("job-videos");
  let name = filename;
  let result = await bucket.upload(name, blob, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (result.error && /exists|duplicate|409/i.test(result.error.message || "")) {
    name = filename.replace(/\.(mp4|webm)$/, `-${crypto.randomUUID().slice(0, 4)}.$1`);
    result = await bucket.upload(name, blob, {
      contentType,
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
  const pendingVideos = (job.job_videos || []).filter((video) => video.storage_path && !video.public_url);
  const videoIds = [];
  const videoUrls = [];
  for (let index = 0; index < pendingVideos.length; index += 1) {
    onProgress?.(`Publishing video ${index + 1} of ${pendingVideos.length}…`);
    const video = pendingVideos[index];
    const { data, error } = await supabase.storage.from("job-videos-private").download(video.storage_path);
    if (error) throw new Error(friendlyError(error));
    const ext = video.storage_path.endsWith(".webm") ? "webm" : "mp4";
    const filename = videoFileName(form.service, form.town, form.date, index + 1, ext);
    videoIds.push(video.id);
    videoUrls.push(await uploadPublicVideo(data, filename, ext === "webm" ? "video/webm" : "video/mp4"));
  }
  const approved = await rpc("approve_job", {
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
  if (videoIds.length) {
    await rpc("publish_job_videos", {
      p_job_id: job.id,
      p_video_ids: videoIds,
      p_public_urls: videoUrls,
    });
  }
  await publishOriginals(job, form, orderedPhotos);
  if (form.privacyChecked != null) {
    await rpc("set_privacy_checked", { p_job_id: job.id, p_checked: Boolean(form.privacyChecked) });
  }
  return approved;
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

async function publishOriginals(job, form, orderedPhotos) {
  const supabase = getSupabase();
  for (let index = 0; index < orderedPhotos.length; index += 1) {
    const photo = orderedPhotos[index];
    if (!photo.original_path) continue;
    const { data, error } = await supabase.storage.from("job-photos-original-private").download(photo.original_path);
    if (error || !data) continue;
    const filename = originalPhotoFileName(form.service, form.town, form.date, index + 1);
    const bucket = supabase.storage.from("job-photos-original");
    const uploaded = await bucket.upload(filename, data, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (uploaded.error) continue;
    const { data: pub } = bucket.getPublicUrl(filename);
    await rpc("publish_photo_original", { p_photo_id: photo.id, p_url: pub.publicUrl });
  }
  const clips = (job.job_videos || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  for (let index = 0; index < clips.length; index += 1) {
    const video = clips[index];
    if (!video.original_path) continue;
    const { data, error } = await supabase.storage.from("job-videos-original-private").download(video.original_path);
    if (error || !data) continue;
    const ext = video.original_path.endsWith(".webm") ? "webm" : "mp4";
    const filename = originalVideoFileName(form.service, form.town, form.date, index + 1, ext);
    const bucket = supabase.storage.from("job-videos-original");
    const uploaded = await bucket.upload(filename, data, {
      contentType: ext === "webm" ? "video/webm" : "video/mp4",
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploaded.error) continue;
    const { data: pub } = bucket.getPublicUrl(filename);
    await rpc("publish_video_original", { p_video_id: video.id, p_url: pub.publicUrl });
  }
}

export function setSocialSkip(jobId, skip) {
  return rpc("set_social_skip", { p_job_id: jobId, p_skip: skip });
}

export function mergeJobs(primaryId, childId) {
  return rpc("merge_jobs", { p_primary: primaryId, p_child: childId });
}

export async function removeReviewPhoto(photo) {
  const data = await rpc("remove_review_photo", { p_photo_id: photo.id });
  const info = typeof data === "string" ? JSON.parse(data) : (data || {});
  const supabase = getSupabase();
  const path = info.storagePath;
  if (path && !String(path).startsWith("imported/") && !String(path).startsWith("http")) {
    await supabase.storage.from("job-photos-private").remove([path]);
  }
  if (info.publicName) {
    await supabase.storage.from("job-photos").remove([info.publicName]);
  }
  return info;
}

export async function publishNewPhotos(job, form, orderedPhotos, onProgress) {
  const fresh = (orderedPhotos || []).filter((photo) => photo.storage_path && !photo.public_url);
  const ids = [];
  const urls = [];
  for (let index = 0; index < fresh.length; index += 1) {
    onProgress?.(`Publishing photo ${index + 1} of ${fresh.length}…`);
    const photo = fresh[index];
    const { data, error } = await getSupabase().storage.from("job-photos-private").download(photo.storage_path);
    if (error) throw new Error(friendlyError(error));
    const filename = photoFileName(form.service, form.town, form.date, index + 1);
    ids.push(photo.id);
    urls.push(await uploadPublicPhoto(data, filename));
  }
  await rpc("publish_new_photos", {
    p_job_id: job.id,
    p_photo_ids: ids,
    p_public_urls: urls,
  });
  const pendingVideos = (job.job_videos || []).filter((video) => video.storage_path && !video.public_url);
  const videoIds = [];
  const videoUrls = [];
  for (let index = 0; index < pendingVideos.length; index += 1) {
    onProgress?.(`Publishing video ${index + 1} of ${pendingVideos.length}…`);
    const video = pendingVideos[index];
    const { data, error } = await getSupabase().storage.from("job-videos-private").download(video.storage_path);
    if (error) throw new Error(friendlyError(error));
    const ext = video.storage_path.endsWith(".webm") ? "webm" : "mp4";
    videoIds.push(video.id);
    videoUrls.push(await uploadPublicVideo(data, videoFileName(form.service, form.town, form.date, index + 1, ext), ext === "webm" ? "video/webm" : "video/mp4"));
  }
  if (videoIds.length) {
    await rpc("publish_job_videos", {
      p_job_id: job.id,
      p_video_ids: videoIds,
      p_public_urls: videoUrls,
    });
  }
}

export function moveExactPin(jobId, lat, lng) {
  return rpc("move_exact_pin", { p_job_id: jobId, p_exact_lat: lat, p_exact_lng: lng });
}

function storageNames(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => decodeURIComponent(String(item || "").split("?")[0]))
    .filter((name) => name && name !== "undefined");
}

export async function deleteStaffJob(job) {
  const data = await rpc("delete_job", { p_job_id: job.id });
  const info = typeof data === "string" ? JSON.parse(data) : (data || {});
  const supabase = getSupabase();
  const removals = [
    ["job-photos-private", storageNames(info.privatePhotos)],
    ["job-photos", storageNames(info.publicPhotos)],
    ["job-photos-original-private", storageNames(info.originalPhotos)],
    ["job-videos-private", storageNames(info.privateVideos)],
    ["job-videos", storageNames(info.publicVideos)],
    ["job-videos-original-private", storageNames(info.originalVideos)],
  ];
  const problems = [];
  for (const [bucket, names] of removals) {
    if (!names.length) continue;
    const { error } = await supabase.storage.from(bucket).remove(names);
    if (error) problems.push(error.message);
  }
  return { storageWarning: problems.length ? problems.join(" ") : "" };
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
  const [jobsRes, locationsRes, photosRes, videosRes] = await Promise.all([
    supabase.from("jobs").select("*").order("created_at", { ascending: false }),
    supabase.from("job_locations").select("*"),
    supabase.from("job_photos").select("*"),
    supabase.from("job_videos").select("*"),
  ]);
  if (jobsRes.error) throw new Error(friendlyError(jobsRes.error));
  if (locationsRes.error) throw new Error(friendlyError(locationsRes.error));
  if (photosRes.error) throw new Error(friendlyError(photosRes.error));
  if (videosRes.error) throw new Error(friendlyError(videosRes.error));
  return {
    jobs: jobsRes.data || [],
    locations: locationsRes.data || [],
    photos: photosRes.data || [],
    videos: videosRes.data || [],
  };
}

export async function removeJobVideo(video) {
  const data = await rpc("remove_job_video", { p_video_id: video.id });
  const info = typeof data === "string" ? JSON.parse(data) : data;
  const supabase = getSupabase();
  if (info?.storagePath && !String(info.storagePath).startsWith("imported/")) {
    await supabase.storage.from("job-videos-private").remove([info.storagePath]);
  }
  if (info?.publicUrl) {
    const name = decodeURIComponent(String(info.publicUrl).split("/").pop().split("?")[0]);
    if (name) await supabase.storage.from("job-videos").remove([name]);
  }
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
