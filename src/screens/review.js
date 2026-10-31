import { SERVICES } from "../lists.js";
import { el, field } from "../lib/dom.js";
import { buildBackup, parseImportText } from "../lib/feed.js";
import { formatWhen, todayISO } from "../lib/format.js";
import { buildJobsZip } from "../lib/export.js";
import { saveFile } from "../lib/download.js";
import { inspectPublicText, isReviewName } from "../lib/privacy.js";
import { signedPhotoUrl, signedVideoUrl } from "../lib/api.js";
import { mountMap } from "../lib/map.js";
import { placeFields, serviceSelect } from "../ui/choices.js";

export function renderReview({ load, actions, selectedId, hashFor }) {
  const root = el("section", { class: "stack" });
  root._leave = () => {};
  root.append(el("h1", { tabindex: "-1", text: "Review" }), el("p", { text: "Loading…" }));
  load().then((data) => paint(root, data, { actions, selectedId, hashFor })).catch((error) => {
    root.replaceChildren(el("h1", { tabindex: "-1", text: "Review" }), el("p", { class: "error", text: error.message }));
  });
  return root;
}

function paint(root, data, ctx) {
  const status = el("p", { class: "status", role: "status" });
  const flash = sessionStorage.getItem("heartland-flash");
  if (flash) {
    sessionStorage.removeItem("heartland-flash");
    status.textContent = flash;
  }
  const toolbar = el("div", { class: "row wrap" }, [
    el("button", { type: "button", class: "btn", dataset: { testid: "export-zip" }, text: "Export jobs.txt + photos", onclick: () => exportZip(status, ctx.actions) }),
    el("button", { type: "button", class: "btn", text: "Download backup", onclick: () => backup(status, ctx.actions) }),
    el("button", { type: "button", class: "btn", text: "Import jobs", onclick: () => file.click() }),
  ]);
  const file = el("input", { type: "file", accept: "application/json,.json" });
  file.hidden = true;
  file.addEventListener("change", () => importFile(file, status, ctx, root));
  const filters = ["pending", "approved", "rejected"];
  const current = filters.includes(sessionStorage.getItem("heartland-filter")) ? sessionStorage.getItem("heartland-filter") : "pending";
  const filterRow = el("div", { class: "row", role: "tablist" });
  for (const name of filters) {
    const count = data.jobs.filter((job) => job.status === name).length;
    filterRow.append(el("button", {
      type: "button",
      class: name === current ? "btn small primary" : "btn small",
      text: `${labelFor(name)} (${count})`,
      onclick: () => {
        sessionStorage.setItem("heartland-filter", name);
        const next = ctx.hashFor();
        if (location.hash === next) paint(root, data, { ...ctx, selectedId: null });
        else location.hash = next;
      },
    }));
  }
  const visible = data.jobs.filter((job) => job.status === current);
  const selected = data.jobs.find((job) => job.id === ctx.selectedId) || null;
  const queue = el("div", { class: "queue stack" }, visible.length
    ? visible.map((job) => el("a", { class: "card job-link", href: ctx.hashFor(job.id) }, [
        el("strong", { text: job.title }),
        el("span", { class: "muted", text: `${job.town}, ${job.state} · ${formatWhen(job.job_date)}` }),
        job.poster ? el("span", { class: "muted", text: `Posted by ${job.poster.display_name}` }) : null,
      ]))
    : [el("p", { class: "empty", text: current === "pending" ? "No jobs waiting. You're caught up." : "Nothing in this list." })]);
  const detail = el("div", { class: "detail" });
  const split = el("div", { class: selected ? "split has-detail" : "split" }, [queue, detail]);
  root._leave?.();
  root._leave = () => {};
  root.replaceChildren(
    el("h1", { tabindex: "-1", text: "Review" }),
    el("p", { text: "Exact spots stay in this app. Approving saves a website pin 150–250 meters away, once." }),
    status,
    toolbar,
    file,
    filterRow,
    split,
  );
  if (selected) {
    detail.append(renderDetail(selected, ctx, status, () => {
      const next = ctx.hashFor();
      if (location.hash === next) paint(root, data, { ...ctx, selectedId: null });
      else location.hash = next;
    }));
    const mapSlot = detail.querySelector(".map");
    const location = locationOf(selected);
    const exact = location ? { lat: location.exact_lat, lng: location.exact_lng } : null;
    const publicPoint = selected.public_lat != null ? { lat: selected.public_lat, lng: selected.public_lng } : null;
    if (mapSlot && (exact || publicPoint)) {
      mountMap(mapSlot, { exact, publicPoint }).then((cleanup) => {
        root._leave = cleanup;
      }).catch(() => {
        mapSlot.replaceChildren(el("p", { text: "The map did not load. Check the connection." }));
      });
    }
  }
}

function renderDetail(job, ctx, status, onBack) {
  const photos = (job.job_photos || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  let order = photos.slice();
  const place = placeFields({ town: job.town, state: job.state });
  const service = serviceSelect(SERVICES, job.service);
  const date = el("input", { type: "date", name: "date", value: String(job.job_date).slice(0, 10) });
  const title = el("input", { name: "title", value: job.title, maxlength: "120" });
  const summary = el("textarea", { name: "summary", rows: "3", maxlength: "180" });
  summary.value = job.summary;
  const warning = el("div", { class: "warning" });
  const ack = el("input", { type: "checkbox" });
  const ackLine = el("label", { class: "checkline" }, [ack, el("span", { text: "I reviewed the privacy warning." })]);
  const reviewName = el("input", { name: "reviewName", value: job.review_name || "", placeholder: "Mike L.", maxlength: "40" });
  const reviewText = el("textarea", { name: "reviewText", rows: "2", maxlength: "400" });
  reviewText.value = job.review_text || "";
  const reviewDate = el("input", { type: "date", name: "reviewDate", value: job.review_date ? String(job.review_date).slice(0, 10) : "" });
  const stars = el("input", { type: "hidden", name: "stars", value: job.review_stars ? String(job.review_stars) : "" });
  const starRow = el("div", { class: "stars" });
  for (let value = 1; value <= 5; value += 1) {
    const button = el("button", {
      type: "button",
      class: Number(stars.value) === value ? "star on" : "star",
      text: "★",
      "aria-label": `${value} star${value === 1 ? "" : "s"}`,
      onclick: () => {
        stars.value = String(value);
        [...starRow.children].forEach((child, index) => child.classList.toggle("on", index < value));
      },
    });
    starRow.append(button);
  }
  const gbp = el("input", { name: "gbp", value: job.gbp_url || "", placeholder: "https://", inputmode: "url" });
  const reason = el("textarea", { name: "reason", rows: "2", maxlength: "300" });
  const photoRow = el("div", { class: "photos" });
  const error = el("p", { class: "error", role: "alert" });
  error.hidden = true;
  const location = locationOf(job);
  const panel = el("div", { class: "card stack" });

  function showWarning() {
    const issues = inspectPublicText(summary.value, { services: SERVICES });
    if (!issues.errors.length && !issues.warnings.length) {
      warning.hidden = true;
      ackLine.hidden = true;
      return issues;
    }
    warning.hidden = false;
    warning.replaceChildren(...[...issues.errors, ...issues.warnings].map((line) => el("p", { text: line })));
    ackLine.hidden = false;
    return issues;
  }

  function drawPhotos() {
    photoRow.replaceChildren(...order.map((photo, index) => {
      const fig = el("figure", { class: index === 0 ? "photo main" : "photo" });
      const img = el("img", { alt: index === 0 ? "Main photo" : `Photo ${index + 1}`, referrerpolicy: "no-referrer" });
      const src = photo.public_url || photo.previewUrl;
      if (src) img.src = src;
      else if (photo.storage_path) signedPhotoUrl(photo.storage_path).then((url) => { img.src = url; }).catch(() => {});
      fig.append(img, el("button", {
        type: "button",
        class: "remove",
        text: index === 0 ? "Main" : "Make main",
        onclick: () => {
          order = [photo, ...order.filter((item) => item !== photo)];
          drawPhotos();
        },
      }));
      return fig;
    }));
  }

  function readForm() {
    const placed = place.value();
    const name = reviewName.value.trim();
    const text = reviewText.value.trim();
    const when = reviewDate.value;
    const starValue = stars.value ? Number(stars.value) : null;
    const any = name || text || when || starValue;
    return {
      service: service.value,
      town: placed.town,
      state: placed.state,
      date: date.value,
      title: title.value,
      summary: summary.value,
      reviewName: any ? name : null,
      reviewStars: any ? starValue : null,
      reviewText: any ? text : null,
      reviewDate: any ? when : null,
      gbpUrl: gbp.value.trim() || null,
      reason: reason.value,
    };
  }

  function validate(form, { reviewRequired = false } = {}) {
    const issues = showWarning();
    if (issues.errors.length) throw new Error(issues.errors[0]);
    if ((issues.warnings.length || issues.errors.length) && !ack.checked) {
      throw new Error("Review the privacy warning and check the box.");
    }
    if (reviewRequired || form.reviewName || form.reviewText || form.reviewStars || form.reviewDate) {
      if (!isReviewName(form.reviewName || "")) throw new Error("Review name must look like Mike L.");
      if (!form.reviewStars) throw new Error("Choose 1 to 5 stars.");
      if (!form.reviewText || form.reviewText.length < 2) throw new Error("Write a short review sentence.");
      if (!form.reviewDate) throw new Error("Add the review date.");
    }
  }

  async function run(work) {
    error.hidden = true;
    try {
      await work();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      status.textContent = "";
    }
  }

  const buttons = el("div", { class: "row wrap" });
  if (job.status === "pending") {
    buttons.append(
      el("button", { type: "button", class: "btn primary", text: "Approve", onclick: () => run(async () => {
        const form = readForm();
        validate(form);
        if (!order.length) throw new Error("This job needs a photo.");
        status.textContent = "Approving…";
        await ctx.actions.approve(job, form, order, (text) => { status.textContent = text; });
        sessionStorage.setItem("heartland-flash", "Approved. The website pin is saved.");
        location.hash = ctx.hashFor();
      }) }),
      el("button", { type: "button", class: "btn danger", text: "Reject", onclick: () => run(async () => {
        if (reason.value.trim().length < 3) throw new Error("Write a short reason so the crew can fix it.");
        await ctx.actions.reject(job.id, reason.value);
        sessionStorage.setItem("heartland-flash", "Rejected. The crew can see the reason.");
        location.hash = ctx.hashFor();
      }) }),
    );
  }
  if (job.status === "approved") {
    buttons.append(
      el("button", { type: "button", class: "btn primary", text: "Save changes", onclick: () => run(async () => {
        const form = readForm();
        validate(form);
        await ctx.actions.update(job, form, order);
        status.textContent = "Saved. The website pin stayed where it was.";
      }) }),
      el("button", { type: "button", class: "btn danger", text: "Take off the website", onclick: () => run(async () => {
        if (reason.value.trim().length < 3) throw new Error("Write a short reason for taking it off the website.");
        await ctx.actions.withdraw(job.id, reason.value);
        sessionStorage.setItem("heartland-flash", "Taken off the website. The pin was not moved.");
        location.hash = ctx.hashFor();
      }) }),
    );
  }
  if (job.status === "rejected" && job.public_lat != null) {
    buttons.append(el("button", { type: "button", class: "btn", text: "Put back on the website", onclick: () => run(async () => {
      await ctx.actions.republish(job.id);
      sessionStorage.setItem("heartland-flash", "Back on the website. The pin stayed put.");
      location.hash = ctx.hashFor();
    }) }));
  }

  summary.addEventListener("input", showWarning);
  drawPhotos();
  showWarning();
  panel.append(...[
    el("button", { type: "button", class: "btn ghost small back", text: "Back to the list", onclick: onBack }),
    el("div", { class: "spread" }, [
      el("h2", { text: job.title }),
      el("span", { class: `chip ${job.status}`, text: labelFor(job.status) }),
    ]),
    job.poster ? el("p", { class: "muted", text: `Posted by ${job.poster.display_name}` }) : null,
    job.rejection_reason ? el("p", { class: "warning", text: job.rejection_reason }) : null,
    error,
    photoRow,
    el("p", { class: "hint", text: "The first photo is the one the website shows first." }),
    renderReviewVideos(job, ctx),
    field("Service", service),
    place.element,
    field("Date", date),
    field("Title", title),
    field("Summary", summary),
    warning,
    ackLine,
    el("h3", { text: "Review on the website" }),
    el("p", { class: "hint", text: "Optional. First name and last initial only, like Mike L." }),
    field("Name", reviewName),
    el("div", { class: "field" }, [el("span", { class: "field-label", text: "Stars" }), starRow, stars]),
    field("Review text", reviewText),
    field("Review date", reviewDate),
    field("Google Business post link", gbp),
    el("h3", { text: "Private location" }),
    location
      ? el("p", { class: "private-note", text: location.address || "Exact spot saved. No street address was typed." })
      : el("p", { text: "No exact location is stored for this job. The map shows the website pin when there is one." }),
    location ? el("p", { class: "muted", text: `${Number(location.exact_lat).toFixed(5)}, ${Number(location.exact_lng).toFixed(5)}` }) : null,
    el("div", { class: "map", role: "img", "aria-label": "Private map of this job" }),
    el("p", { class: "legend", text: location && job.public_lat != null
      ? "Copper dot: exact house. Green dot: website pin."
      : location
        ? "Copper dot: exact house. The website pin is placed when you approve."
        : "Green dot: website pin." }),
    field(job.status === "approved" ? "Reason if you take it off the website" : "Reason if you reject it", reason),
    buttons,
  ].filter((node) => node != null));
  return panel;
}

function renderReviewVideos(job, ctx) {
  const videos = (job.job_videos || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  if (!videos.length) return null;
  const wrap = el("div", { class: "stack clips" }, [el("h3", { text: "Video" })]);
  for (const video of videos) {
    const node = el("video", { controls: true, playsinline: "", preload: "metadata" });
    node.playsInline = true;
    const src = video.public_url || video.previewUrl;
    if (src) node.src = src;
    else if (video.storage_path) {
      signedVideoUrl(video.storage_path).then((url) => { node.src = url; }).catch(() => {});
    }
    const block = el("div", { class: "stack" }, [
      node,
      el("button", {
        type: "button",
        class: "btn small danger",
        text: "Remove video",
        onclick: () => {
          if (!confirm("Remove this video from the job?")) return;
          Promise.resolve(ctx.actions.removeVideo?.(job, video)).then(() => {
            location.hash = ctx.hashFor(job.id);
          }).catch((error) => {
            block.append(el("p", { class: "error", text: error.message }));
          });
        },
      }),
    ]);
    wrap.append(block);
  }
  return wrap;
}

function locationOf(job) {
  const loc = job.job_locations;
  if (Array.isArray(loc)) return loc[0] || null;
  return loc || null;
}

function labelFor(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

async function exportZip(status, actions) {
  try {
    status.textContent = "Preparing the zip…";
    const feed = await actions.feed();
    const files = [];
    let missing = 0;
    for (const job of feed) {
      for (const url of job.photos || []) {
        files.push(await fetchMedia(url, "photos", () => { missing += 1; return missing; }));
      }
      for (const url of job.videos || []) {
        files.push(await fetchMedia(url, "videos", () => { missing += 1; return missing; }));
      }
    }
    const blob = await buildJobsZip(feed, files.filter(Boolean));
    await saveFile(`heartland-jobs-${todayISO()}.zip`, blob);
    status.textContent = missing
      ? `Zip saved. ${missing} file${missing === 1 ? "" : "s"} could not be downloaded.`
      : "Zip saved. jobs.txt is the website file. Photos are in the photos folder and videos are in the videos folder.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function fetchMedia(url, folder, nextMissing) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const name = decodeURIComponent((url.split("/").pop() || "file").split("?")[0]);
    return { name, bytes: new Uint8Array(await response.arrayBuffer()), folder };
  } catch {
    const n = nextMissing();
    return {
      name: `MISSING-${n}.txt`,
      folder,
      bytes: new TextEncoder().encode(`Could not download ${url}\n`),
    };
  }
}

async function backup(status, actions) {
  try {
    status.textContent = "Preparing the backup…";
    const rows = await actions.backup();
    const json = buildBackup({ ...rows, exportedAt: new Date().toISOString() });
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    await saveFile(`heartland-backup-${todayISO()}.json`, blob);
    status.textContent = "Backup saved. Keep that file private. It has exact house locations.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function importFile(file, status, ctx, root) {
  const picked = file.files?.[0];
  file.value = "";
  if (!picked) return;
  try {
    const parsed = parseImportText(await picked.text());
    if (!confirm(`Import ${parsed.jobs.length} jobs? Existing ids are skipped. Pins in the file stay where they are.`)) return;
    status.textContent = "Importing…";
    const result = await ctx.actions.import(parsed.kind, parsed.jobs);
    const failed = result?.errors?.length || 0;
    status.textContent = `Imported ${result?.imported || 0}. Skipped ${result?.skipped || 0}. ${failed ? `${failed} need a look.` : ""}`;
    const data = await ctx.load();
    paint(root, data, ctx);
  } catch (error) {
    status.textContent = error.message;
  }
}
