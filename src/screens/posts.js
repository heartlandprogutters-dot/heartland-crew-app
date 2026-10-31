import { el } from "../lib/dom.js";
import { formatWhen } from "../lib/format.js";
import { signedPhotoUrl, signedVideoUrl } from "../lib/api.js";

const DRAFT_KEY = "heartland-draft-v1";

export function renderPosts({ load, remove, onCopy }) {
  const root = el("section", { class: "stack" });
  root.append(el("h1", { tabindex: "-1", text: "My posts" }), el("p", { text: "Loading…" }));
  load().then((jobs) => paint(root, jobs, { load, remove, onCopy })).catch((error) => {
    root.replaceChildren(el("h1", { tabindex: "-1", text: "My posts" }), el("p", { class: "error", text: error.message }));
  });
  return root;
}

function paint(root, jobs, actions) {
  if (!jobs.length) {
    root.replaceChildren(
      el("h1", { tabindex: "-1", text: "My posts" }),
      el("p", { class: "empty", text: "No jobs yet. Tap New job after you finish a house." }),
    );
    return;
  }
  root.replaceChildren(
    el("h1", { tabindex: "-1", text: "My posts" }),
    ...jobs.map((job) => jobCard(job, actions, root)),
  );
}

function jobCard(job, actions, root) {
  const photos = (job.job_photos || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const card = el("article", { class: "card stack" }, [
    el("div", { class: "spread" }, [
      el("h2", { text: job.title }),
      el("span", { class: `chip ${job.status}`, text: labelFor(job.status) }),
    ]),
    el("p", { class: "muted", text: `${job.service} · ${job.town}, ${job.state} · ${formatWhen(job.job_date)}` }),
    el("p", { text: job.summary }),
  ]);
  if (job.status === "rejected" && job.rejection_reason) {
    card.append(el("p", { class: "warning", text: `Needs a change: ${job.rejection_reason}` }));
  }
  const figure = el("div", { class: "photos" });
  card.append(figure);
  photos.forEach(async (photo, index) => {
    const src = photo.public_url || photo.previewUrl || (photo.storage_path ? await signedPhotoUrl(photo.storage_path).catch(() => "") : "");
    if (!src) return;
    figure.append(el("img", { src, alt: `${job.town} photo ${index + 1}`, referrerpolicy: "no-referrer" }));
  });
  const clips = el("div", { class: "stack clips" });
  card.append(clips);
  (job.job_videos || []).slice().sort((a, b) => a.sort_order - b.sort_order).forEach(async (video) => {
    const src = video.public_url || video.previewUrl || (video.storage_path ? await signedVideoUrl(video.storage_path).catch(() => "") : "");
    if (!src) return;
    const node = el("video", { controls: true, playsinline: "", preload: "metadata", src });
    node.playsInline = true;
    clips.append(node);
  });
  const row = el("div", { class: "row" });
  if (job.status === "rejected") {
    row.append(el("button", {
      type: "button",
      class: "btn",
      text: "Start a fixed copy",
      onclick: () => {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          service: job.service,
          town: job.town,
          state: job.state,
          summary: job.summary,
          date: job.job_date,
        }));
        actions.onCopy();
      },
    }));
  }
  if (job.status === "pending" || job.status === "rejected") {
    row.append(el("button", {
      type: "button",
      class: "btn danger",
      text: "Delete",
      onclick: async () => {
        if (!confirm("Delete this job?")) return;
        try {
          await actions.remove(job);
          root.replaceChildren(el("p", { text: "Loading…" }));
          paint(root, await actions.load(), actions);
        } catch (error) {
          card.append(el("p", { class: "error", text: error.message }));
        }
      },
    }));
  }
  if (row.childNodes.length) card.append(row);
  return card;
}

function labelFor(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}
