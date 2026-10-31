import { SERVICES, serviceNameError } from "../lists.js";
import { el, field } from "../lib/dom.js";
import { buildBackup, parseImportText } from "../lib/feed.js";
import { formatWhen, todayISO } from "../lib/format.js";
import { buildJobsZip } from "../lib/export.js";
import { saveFile } from "../lib/download.js";
import { inspectPublicText, isReviewName } from "../lib/privacy.js";
import { explainDatabaseError, signedPhotoUrl, signedVideoUrl } from "../lib/api.js";
import { possibleDuplicates } from "../lib/merge.js";
import { showToast } from "../lib/toast.js";
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
    status.className = "ok";
    status.textContent = flash;
    window.scrollTo(0, 0);
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
    const count = data.jobs.filter((job) => matchesFilter(job, name)).length;
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
  const visible = data.jobs.filter((job) => matchesFilter(job, current));
  const selected = data.jobs.find((job) => job.id === ctx.selectedId) || null;
  const queue = el("div", { class: "queue stack" }, visible.length
    ? visible.map((job) => el("a", { class: "card job-link", href: ctx.hashFor(job.id) }, [
        el("strong", { text: job.title }),
        el("span", { class: "muted", text: `${job.town}, ${job.state} · ${formatWhen(job.job_date)}` }),
        job.poster ? el("span", { class: "muted", text: `Posted by ${job.poster.display_name}` }) : null,
        job.new_photos ? el("span", { class: "muted", text: "New photos added" }) : null,
        possibleDuplicates(job, data.jobs).length
          ? el("span", { class: "muted", text: `Possible duplicate of ${possibleDuplicates(job, data.jobs)[0].title}` })
          : null,
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
    detail.append(renderDetail(selected, {
      ...ctx,
      jobs: data.jobs,
      finishApproved(jobId) {
        const row = data.jobs.find((item) => item.id === jobId);
        if (row) row.status = "approved";
        sessionStorage.setItem("heartland-filter", "pending");
        sessionStorage.setItem("heartland-flash", "Approved, it's on the map");
        showToast("Approved, it's on the map", "ok");
        paint(root, data, { ...ctx, selectedId: null });
        const next = ctx.hashFor();
        if (location.hash !== next) location.hash = next;
      },
      finishMerged(primaryId, childId) {
        const primary = data.jobs.find((item) => item.id === primaryId);
        const child = data.jobs.find((item) => item.id === childId);
        if (primary && child) {
          primary.job_photos = [...(primary.job_photos || []), ...(child.job_photos || [])];
          primary.job_videos = [...(primary.job_videos || []), ...(child.job_videos || [])];
          primary.job_contributors = [
            ...(primary.job_contributors || []),
            { display_name: child.poster?.display_name || "Crew" },
          ];
          if (primary.status === "approved") primary.new_photos = true;
          child.job_photos = [];
          child.job_videos = [];
          child.status = "merged";
          child.merged_into = primaryId;
          const lead = (primary.poster?.display_name || "the lead").split(" ")[0];
          child.merge_note = `added to ${lead}'s job`;
        }
        sessionStorage.setItem("heartland-flash", "Combined. The photos are on the main job.");
        showToast("Combined. The photos are on the main job.", "ok");
        paint(root, data, { ...ctx, selectedId: primaryId });
        const next = ctx.hashFor(primaryId);
        if (location.hash !== next) location.hash = next;
      },
      finishDeleted(jobId) {
        data.jobs = data.jobs.filter((item) => item.id !== jobId);
        sessionStorage.setItem("heartland-flash", "Deleted. It's off the map.");
        showToast("Deleted. It's off the map.", "ok");
        paint(root, data, { ...ctx, selectedId: null });
        const next = ctx.hashFor();
        if (location.hash !== next) location.hash = next;
      },
    }, status, () => {
      const next = ctx.hashFor();
      if (location.hash === next) paint(root, data, { ...ctx, selectedId: null });
      else location.hash = next;
    }));
    const mapSlot = detail.querySelector(".map");
    const location = locationOf(selected);
    const exact = location ? { lat: location.exact_lat, lng: location.exact_lng } : null;
    const publicPoint = selected.public_lat != null ? { lat: selected.public_lat, lng: selected.public_lng } : null;
    if (mapSlot) {
      const start = exact || publicPoint || { lat: 36.7417, lng: -88.6366 };
      mapSlot._pin = { lat: start.lat, lng: start.lng };
      Promise.resolve()
        .then(() => mountMap(mapSlot, {
          exact: exact || start,
          publicPoint,
          editable: true,
          onExact(next) { mapSlot._pin = { lat: next.lat, lng: next.lng }; },
        }))
        .then((cleanup) => {
          root._leave = cleanup;
        })
        .catch((err) => {
          mapSlot.replaceChildren(el("p", { text: "The map did not open. You can still approve this job." }));
          console.error(err);
        });
    }
  }
}

function renderDetail(job, ctx, status, onBack) {
  if (job.status === "merged") {
    const note = job.merge_note
      ? `${job.merge_note.charAt(0).toUpperCase()}${job.merge_note.slice(1)}`
      : "This post was combined with another job";
    return el("div", { class: "card stack" }, [
      el("button", { type: "button", class: "btn ghost small back", text: "Back to the list", onclick: onBack }),
      el("h2", { text: job.title }),
      el("p", { class: "ok", dataset: { testid: "merge-note" }, text: note.endsWith(".") ? note : `${note}.` }),
    ]);
  }
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
  const reviewFilled = Boolean(job.review_name || job.review_text || job.review_stars || job.review_date);
  const reviewFields = el("div", {
    class: reviewFilled ? "stack" : "hidden",
    dataset: { testid: "customer-review" },
  }, [
    el("h3", { text: "Review on the website" }),
    el("p", { class: "hint", text: "Saved with this job. First name and last initial only, like Mike L." }),
    field("Name", reviewName),
    el("div", { class: "field" }, [el("span", { class: "field-label", text: "Stars" }), starRow, stars]),
    field("Review text", reviewText),
    field("Review date", reviewDate),
  ]);
  const reason = el("textarea", { name: "reason", rows: "2", maxlength: "300" });
  const photoRow = el("div", { class: "photos" });
  const error = el("p", { class: "error", role: "alert" });
  error.hidden = true;
  const actionError = el("p", {
    class: "error action-error",
    role: "alert",
    dataset: { testid: "approve-error" },
  });
  actionError.hidden = true;
  const actionStatus = el("p", { class: "status", dataset: { testid: "approve-status" } });
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
      fig.append(img, el("div", { class: "row" }, [
        el("button", {
          type: "button",
          class: "remove",
          text: index === 0 ? "Main" : "Make main",
          onclick: () => {
            order = [photo, ...order.filter((item) => item.id !== photo.id)];
            drawPhotos();
          },
        }),
        el("button", {
          type: "button",
          class: "remove",
          dataset: { testid: "remove-photo" },
          text: "Remove",
          onclick: () => run(async () => {
            if (!confirm("Remove this photo from the job?")) return;
            if (ctx.actions.removePhoto) await ctx.actions.removePhoto(photo);
            order = order.filter((item) => item.id !== photo.id);
            job.job_photos = order.slice();
            drawPhotos();
            showActionStatus("Photo removed.");
          }),
        }),
      ]));
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
      service: service.value(),
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
      privacyChecked: privacyBox.checked,
    };
  }

  function validate(form, { reviewRequired = false } = {}) {
    const issues = showWarning();
    const serviceProblem = serviceNameError(form.service);
    if (serviceProblem) throw new Error(serviceProblem);
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

  function showActionError(message) {
    const text = explainDatabaseError(message || "Something went wrong.");
    actionError.hidden = false;
    actionError.textContent = text;
    error.hidden = false;
    error.textContent = text;
    actionStatus.textContent = "";
    status.textContent = "";
    showToast(text, "error");
    try {
      actionError.scrollIntoView({ block: "center" });
    } catch {
      // A scroll failure must not hide the toast.
    }
  }

  function showActionStatus(text) {
    actionError.hidden = true;
    actionError.textContent = "";
    actionStatus.textContent = text;
    status.textContent = text;
  }

  async function run(work) {
    actionError.hidden = true;
    actionError.textContent = "";
    error.hidden = true;
    try {
      await work();
    } catch (err) {
      showActionError(err?.message || "Something went wrong.");
    }
  }

  const privacyBox = el("input", { type: "checkbox", dataset: { testid: "privacy-checked" } });
  privacyBox.checked = Boolean(job.privacy_checked);
  const privacyLine = el("label", { class: "checkline" }, [
    privacyBox,
    el("span", { text: "Photos show no faces, plates, house numbers, or family." }),
  ]);
  const socialSkip = el("input", { type: "checkbox", dataset: { testid: "no-social" } });
  socialSkip.checked = job.social_status === "skip";
  socialSkip.addEventListener("change", () => run(async () => {
    if (ctx.actions.setSocialSkip) await ctx.actions.setSocialSkip(job.id, socialSkip.checked);
    job.social_status = socialSkip.checked ? "skip" : (job.social_status === "skip" ? "pending" : job.social_status);
    showActionStatus(socialSkip.checked ? "This job will not be posted on social." : "This job is waiting for social again.");
  }));
  const socialLine = job.status === "approved"
    ? el("label", { class: "checkline" }, [
      socialSkip,
      el("span", { text: "No social" }),
    ])
    : null;
  const buttons = el("div", { class: "row wrap" });
  const deleteButton = el("button", {
    type: "button",
    class: "btn danger",
    dataset: { testid: "delete-job" },
    text: "Delete",
    onclick: (event) => {
      if (!confirm("Delete this job? It comes off the website map. Photos and videos are removed. This cannot be undone.")) return;
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Deleting…";
      showToast("Deleting…", "busy");
      run(async () => {
        try {
          const result = await ctx.actions.deleteJob(job);
          if (typeof ctx.finishDeleted === "function") ctx.finishDeleted(job.id);
          if (result?.storageWarning) {
            showToast("Deleted from the map. A file could not be removed from storage.", "error");
          }
        } catch (err) {
          button.disabled = false;
          button.textContent = "Delete";
          throw err;
        }
      });
    },
  });
  if (job.status === "pending") {
    buttons.append(
      el("button", { type: "button", class: "btn primary", dataset: { testid: "approve" }, text: "Approve", onclick: (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.classList.add("busy");
        button.textContent = "Approving…";
        showActionStatus("Approving…");
        showToast("Approving…", "busy");
        run(async () => {
          try {
            const form = readForm();
            validate(form);
            if (!order.length) throw new Error("This job needs a photo.");
            await ctx.actions.approve(job, form, order, (text) => {
              showActionStatus(text);
              showToast(text, "busy");
            });
            if (typeof ctx.finishApproved === "function") ctx.finishApproved(job.id);
            else showToast("Approved, it's on the map", "ok");
          } catch (err) {
            button.disabled = false;
            button.classList.remove("busy");
            button.textContent = "Approve";
            throw err;
          }
        });
      } }),
      el("button", { type: "button", class: "btn danger", text: "Reject", onclick: () => run(async () => {
        if (reason.value.trim().length < 3) throw new Error("Write a short reason so the crew can fix it.");
        await ctx.actions.reject(job.id, reason.value);
        sessionStorage.setItem("heartland-flash", "Rejected. The crew can see the reason.");
        location.hash = ctx.hashFor();
      }) }),
    );
  }
  if (job.status === "approved" && job.new_photos) {
    buttons.append(el("button", {
      type: "button",
      class: "btn primary",
      dataset: { testid: "publish-new" },
      text: "Publish new photos",
      onclick: (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Publishing…";
        showToast("Publishing…", "busy");
        run(async () => {
          try {
            const form = readForm();
            validate(form);
            await ctx.actions.publishNew(job, form, order, (text) => {
              showActionStatus(text);
              showToast(text, "busy");
            });
            job.new_photos = false;
            showToast("New photos are on the map.", "ok");
            showActionStatus("New photos are on the map. The website pin stayed where it was.");
            button.remove();
          } catch (err) {
            button.disabled = false;
            button.textContent = "Publish new photos";
            throw err;
          }
        });
      },
    }));
  }
  if (job.status === "approved") {
    buttons.append(
      el("button", { type: "button", class: "btn", text: "Save changes", onclick: () => run(async () => {
        const form = readForm();
        validate(form);
        await ctx.actions.update(job, form, order);
        showActionStatus("Saved. The website pin stayed where it was.");
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
  buttons.append(deleteButton);

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
    contributorLine(job),
    job.new_photos ? el("p", { class: "warning", dataset: { testid: "new-photos" }, text: "New photos added. Publish them to put them on the website." }) : null,
    duplicateBlock(job, ctx),
    job.rejection_reason ? el("p", { class: "warning", text: job.rejection_reason }) : null,
    error,
    photoRow,
    el("p", { class: "hint", text: "The first photo is the one the website shows first." }),
    renderReviewVideos(job, ctx),
    service.element,
    place.element,
    field("Date", date),
    field("Title", title),
    field("Summary", summary),
    warning,
    ackLine,
    reviewFields,
    field("Google Business post link", gbp),
    el("h3", { text: "Private location" }),
    location
      ? el("p", { class: "private-note", text: location.address || "Exact spot saved. No street address was typed." })
      : el("p", { text: "No exact location is stored yet. Drag the copper pin onto the house." }),
    location ? el("p", { class: "muted", text: `${Number(location.exact_lat).toFixed(5)}, ${Number(location.exact_lng).toFixed(5)}` }) : null,
    el("div", { class: "map", role: "img", "aria-label": "Private map of this job" }),
    el("p", { class: "legend", text: job.public_lat != null
      ? "Copper pin: exact house. Drag it, then save. The green pin is the website and stays put."
      : "Copper pin: exact house. Drag it onto the house, then save. Approving shifts the website pin from that spot." }),
    el("button", {
      type: "button",
      class: "btn",
      dataset: { testid: "save-pin" },
      text: "Save house pin",
      onclick: () => run(async () => {
        const slot = panel.querySelector(".map");
        const next = slot?._pin;
        if (!next) throw new Error("Move the pin onto the house first.");
        await ctx.actions.movePin(job.id, next.lat, next.lng);
        if (location) {
          location.exact_lat = next.lat;
          location.exact_lng = next.lng;
        } else {
          job.job_locations = { exact_lat: next.lat, exact_lng: next.lng, address: null };
        }
        showActionStatus(job.public_lat != null
          ? "House pin saved. The website pin stayed where it was."
          : "House pin saved. Approving will place the website pin from this spot.");
      }),
    }),
    field(job.status === "approved" ? "Reason if you take it off the website" : "Reason if you reject it", reason),
    privacyLine,
    socialLine,
    el("div", { class: "stack approve-actions", dataset: { approveActions: "true" } }, [
      actionError,
      actionStatus,
      buttons,
    ]),
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

function contributorLine(job) {
  const names = (job.job_contributors || []).map((person) => person.display_name).filter(Boolean);
  if (!names.length) return null;
  return el("p", { dataset: { testid: "contributors" }, text: `Also on this job: ${names.join(", ")}.` });
}

function duplicateBlock(job, ctx) {
  const dupes = possibleDuplicates(job, ctx.jobs || []);
  if (!dupes.length) return null;
  const wrap = el("div", { class: "stack", dataset: { testid: "duplicates" } });
  for (const other of dupes) {
    const row = (ctx.jobs || []).find((item) => item.id === other.id);
    const who = row?.poster?.display_name ? ` by ${row.poster.display_name}` : "";
    wrap.append(
      el("p", { class: "warning", text: `Possible duplicate of ${other.title}${who}.` }),
      el("div", { class: "row wrap" }, [
        el("button", {
          type: "button",
          class: "btn",
          dataset: { testid: "merge-into" },
          text: "Merge into this job",
          onclick: () => runMerge(ctx, job.id, other.id),
        }),
        el("button", {
          type: "button",
          class: "btn",
          dataset: { testid: "merge-other" },
          text: "Use the other as the main job",
          onclick: () => runMerge(ctx, other.id, job.id),
        }),
      ]),
    );
  }
  return wrap;
}

function runMerge(ctx, primaryId, childId) {
  const primary = (ctx.jobs || []).find((item) => item.id === primaryId);
  const child = (ctx.jobs || []).find((item) => item.id === childId);
  const label = child?.title || "the other job";
  if (!confirm(`Combine “${label}” into “${primary?.title || "this job"}”? The photos move onto the main job.`)) return;
  const work = async () => {
    if (ctx.actions.merge) await ctx.actions.merge(primaryId, childId);
    if (typeof ctx.finishMerged === "function") ctx.finishMerged(primaryId, childId);
  };
  work().catch((err) => {
    showToast(explainDatabaseError(err?.message || "Could not combine those jobs."), "error");
  });
}

function locationOf(job) {
  const loc = job.job_locations;
  if (Array.isArray(loc)) return loc[0] || null;
  return loc || null;
}

function matchesFilter(job, current) {
  if (job.status === "merged") return false;
  if (current === "pending") return job.status === "pending" || job.new_photos === true;
  return job.status === current;
}

function labelFor(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "merged") return "Combined";
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
