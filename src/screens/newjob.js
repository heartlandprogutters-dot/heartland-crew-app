import { SERVICES, TOWNS } from "../lists.js";
import { GEOCODER_REVERSE, GEOCODER_SEARCH } from "../config.js";
import { el, field } from "../lib/dom.js";
import { todayISO } from "../lib/format.js";
import { createLookup } from "../lib/geo.js";
import { resizeToWebp, browserSupportsWebp } from "../lib/photos.js";
import { inspectPublicText } from "../lib/privacy.js";
import {
  canTrimOnThisDevice,
  clipStartLimit,
  defaultClipWindow,
  formatClock,
  loadVideoPreview,
  playClipWindow,
  trimVideoFile,
} from "../lib/video.js";
import { placeFields, serviceSelect } from "../ui/choices.js";

const DRAFT_KEY = "heartland-draft-v1";
const lookup = createLookup({ searchTemplate: GEOCODER_SEARCH, reverseTemplate: GEOCODER_REVERSE });

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function renderNewJob({ submit, restoreDraft = true }) {
  const draft = restoreDraft ? readDraft() : null;
  const photos = [];
  const videos = [];
  let location = null;
  let warnedText = "";
  const root = el("section", { class: "stack" });
  root._leave = () => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    videos.forEach((clip) => {
      if (clip.url) URL.revokeObjectURL(clip.url);
      clip.video?.pause?.();
    });
  };

  const status = el("p", { class: "status", role: "status", text: "" });
  const error = el("p", { class: "error", role: "alert" });
  error.hidden = true;
  const warningBox = el("div", { class: "warning", dataset: { testid: "summary-warning" } });
  warningBox.hidden = true;
  const ack = el("input", { type: "checkbox" });
  const ackLine = el("label", { class: "checkline" }, [
    ack,
    el("span", { text: "I checked this note. It has no house number and no customer name." }),
  ]);
  ackLine.hidden = true;

  const take = el("input", { type: "file", accept: "image/*", capture: "environment" });
  const pick = el("input", { type: "file", accept: "image/*", multiple: "true" });
  take.hidden = true;
  pick.hidden = true;
  const thumbs = el("div", { class: "photos" });
  const clipList = el("div", { class: "stack" });
  const recordVideo = el("input", { type: "file", accept: "video/*", capture: "environment" });
  const pickVideo = el("input", { type: "file", accept: "video/*" });
  recordVideo.hidden = true;
  pickVideo.hidden = true;
  const service = serviceSelect(SERVICES, draft?.service || SERVICES[0]);
  const place = placeFields({ town: draft?.town || "Farmington", state: draft?.state || "KY" });
  const summary = el("textarea", {
    name: "summary",
    rows: "3",
    maxlength: "180",
    dataset: { testid: "summary" },
    placeholder: "New seamless gutters and guards on a one-story house.",
  });
  summary.value = draft?.summary || "";
  const date = el("input", { type: "date", name: "date", value: draft?.date || todayISO(), required: "true" });
  const counter = el("span", { class: "hint", text: "0/180" });
  const addressInput = el("input", {
    name: "address",
    autocomplete: "street-address",
    placeholder: "Street, town, state",
  });
  const results = el("div", { class: "stack" });
  const submitBtn = el("button", { type: "submit", class: "btn primary", dataset: { testid: "submit-job" }, text: "Send for approval" });

  function renderThumbs() {
    thumbs.replaceChildren(...photos.map((photo, index) => {
      const remove = el("button", {
        type: "button",
        class: "remove",
        text: "Remove",
        "aria-label": `Remove photo ${index + 1}`,
        onclick: () => {
          URL.revokeObjectURL(photo.url);
          photos.splice(index, 1);
          renderThumbs();
        },
      });
      const img = el("img", { src: photo.url, alt: `Photo ${index + 1} preview` });
      return el("figure", { class: "photo" }, [img, remove]);
    }));
  }

  async function addFiles(list) {
    error.hidden = true;
    const files = [...list];
    for (const file of files) {
      if (photos.length >= 8) {
        error.hidden = false;
        error.textContent = "8 photos is the limit for one job.";
        break;
      }
      status.textContent = `Preparing photo ${photos.length + 1}…`;
      const blob = await resizeToWebp(file);
      photos.push({ blob, url: URL.createObjectURL(blob) });
      renderThumbs();
    }
    status.textContent = photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} ready.` : "";
  }

  take.addEventListener("change", () => {
    addFiles(take.files).catch(showError);
    take.value = "";
  });
  pick.addEventListener("change", () => {
    addFiles(pick.files).catch(showError);
    pick.value = "";
  });

  function renderClips() {
    clipList.replaceChildren(...videos.map((clip, index) => clipCard(clip, index)));
  }

  function clipCard(clip, index) {
    const limit = clipStartLimit(clip.duration, clip.length);
    const label = el("p", { class: "hint", text: clipLabel(clip) });
    const slider = el("input", {
      type: "range",
      min: "0",
      max: String(limit),
      step: "0.1",
      value: String(clip.start),
      dataset: { testid: "trim-slider" },
    });
    slider.disabled = limit <= 0;
    slider.addEventListener("input", () => {
      clip.start = Number(slider.value);
      clip.blob = null;
      label.textContent = clipLabel(clip);
    });
    const adjust = el("div", { class: "stack hidden" }, [
      field("Start of the 30 second clip", slider, "Drag, then play the part this phone will keep."),
      el("button", {
        type: "button",
        class: "btn",
        text: "Play the part we'll keep",
        onclick: () => playClipWindow(clip.video, clip.start, clip.length),
      }),
    ]);
    const card = el("div", { class: "stack clip" }, [
      el("strong", { text: `Video ${index + 1}` }),
      clip.video,
      label,
      el("div", { class: "row" }, [
        el("button", {
          type: "button",
          class: "btn",
          text: "Adjust the clip",
          onclick: () => adjust.classList.toggle("hidden"),
        }),
        el("button", {
          type: "button",
          class: "btn ghost",
          text: "Remove video",
          onclick: () => {
            URL.revokeObjectURL(clip.url);
            clip.video.pause();
            videos.splice(index, 1);
            renderClips();
          },
        }),
      ]),
      adjust,
    ]);
    return card;
  }

  async function addVideo(file) {
    error.hidden = true;
    if (!file) return;
    if (!canTrimOnThisDevice()) {
      showError(new Error("This phone cannot trim video. Update Safari or Chrome. The full recording was not added."));
      return;
    }
    if (videos.length >= 2) {
      showError(new Error("2 videos is the limit for one job."));
      return;
    }
    status.textContent = "Reading the video…";
    const preview = await loadVideoPreview(file);
    const window = defaultClipWindow(preview.duration);
    videos.push({
      file,
      video: preview.video,
      url: preview.url,
      duration: preview.duration,
      width: preview.width,
      height: preview.height,
      start: window.start,
      length: window.length,
      blob: null,
    });
    renderClips();
    status.textContent = preview.duration > 30
      ? `Video added. The middle 30 seconds will be kept (${formatClock(window.start)} to ${formatClock(window.start + window.length)}).`
      : "Video added. It is under 30 seconds, so the whole clip will be kept.";
  }

  recordVideo.addEventListener("change", () => {
    addVideo(recordVideo.files?.[0]).catch(showError);
    recordVideo.value = "";
  });
  pickVideo.addEventListener("change", () => {
    addVideo(pickVideo.files?.[0]).catch(showError);
    pickVideo.value = "";
  });

  function showError(err) {
    error.hidden = false;
    error.textContent = err.message || "Something went wrong.";
    status.textContent = "";
  }

  function refreshWarnings() {
    const issues = inspectPublicText(summary.value, { services: SERVICES, towns: TOWNS });
    counter.textContent = `${summary.value.length}/180`;
    if (summary.value !== warnedText) {
      ack.checked = false;
      warnedText = summary.value;
    }
    if (!issues.errors.length && !issues.warnings.length) {
      warningBox.hidden = true;
      ackLine.hidden = true;
      warningBox.replaceChildren();
      return issues;
    }
    warningBox.hidden = false;
    warningBox.replaceChildren(
      el("strong", { text: "Check this note before it goes on the website" }),
      ...issues.errors.map((line) => el("p", { text: line })),
      ...issues.warnings.map((line) => el("p", { text: line })),
    );
    ackLine.hidden = issues.warnings.length === 0 || issues.errors.length > 0;
    return issues;
  }

  summary.addEventListener("input", () => {
    try {
      const current = place.value();
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        service: service.value,
        town: current.town,
        state: current.state,
        summary: summary.value,
        date: date.value,
      }));
    } catch {
      // Ignore storage failures.
    }
    refreshWarnings();
  });

  async function useGps() {
    error.hidden = true;
    if (!navigator.geolocation) {
      showError(new Error("This phone cannot share location. Type the address instead."));
      return;
    }
    status.textContent = "Finding this house…";
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
    });
    const hit = await lookup.reverse(position.coords.latitude, position.coords.longitude);
    location = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      address: hit.label,
      accuracy: position.coords.accuracy,
    };
    if (hit.town) place.setTown(hit.town, hit.state || place.value().state);
    const meters = Math.round(position.coords.accuracy || 0);
    status.textContent = meters
      ? `Location saved, about ${meters} m. ${hit.town ? `Town looks like ${hit.town}.` : ""}`
      : "Location saved.";
    results.replaceChildren(el("p", { class: "private-note", text: hit.label ? `Check this house: ${hit.label}` : "Location saved from GPS." }));
  }

  async function findAddress() {
    error.hidden = true;
    status.textContent = "Searching OpenStreetMap…";
    const hits = await lookup.search(addressInput.value);
    status.textContent = "";
    if (!hits.length) {
      results.replaceChildren(el("p", { text: "No match. Try street, town, and state." }));
      return;
    }
    results.replaceChildren(...hits.map((hit) => el("button", {
      type: "button",
      class: "btn ghost",
      text: hit.label,
      onclick: () => {
        location = { lat: hit.lat, lng: hit.lng, address: hit.label, accuracy: null };
        if (hit.town) place.setTown(hit.town, hit.state || place.value().state);
        status.textContent = "Address match saved.";
        results.replaceChildren(el("p", { class: "private-note", text: `Check this house: ${hit.label}` }));
      },
    })));
  }

  const form = el("form", { class: "stack" }, [
    el("h1", { tabindex: "-1", text: "New job" }),
    draft ? el("p", { class: "ok", text: "Restored your note. Add the photos and location again." }) : null,
    browserSupportsWebp() ? null : el("p", { class: "error", text: "This browser cannot save WebP photos. Update iOS or use Chrome." }),
    error,
    status,
    el("section", { class: "card stack" }, [
      el("h2", { text: "1. Photos and video" }),
      el("div", { class: "row" }, [
        el("button", { type: "button", class: "btn", text: "Take photo", onclick: () => take.click() }),
        el("button", { type: "button", class: "btn", text: "Choose photos", onclick: () => pick.click() }),
      ]),
      take,
      pick,
      thumbs,
      el("p", { class: "hint", text: "Up to 8 photos. Each one is shrunk to a WebP about 150 KB wide, max 1200 px. Camera location is stripped from the file." }),
      el("h3", { text: "Video" }),
      el("div", { class: "row" }, [
        el("button", { type: "button", class: "btn", dataset: { testid: "record-video" }, text: "Record video", onclick: () => recordVideo.click() }),
        el("button", { type: "button", class: "btn", dataset: { testid: "choose-video" }, text: "Choose video", onclick: () => pickVideo.click() }),
      ]),
      recordVideo,
      pickVideo,
      clipList,
      el("p", { class: "hint", text: "Record as long as you need. This phone keeps at most 30 seconds, about 720p, before anything is uploaded. Up to 2 clips." }),
    ]),
    el("section", { class: "card stack" }, [
      el("h2", { text: "2. Work and town" }),
      field("Service", service),
      place.element,
      field("Date finished", date),
    ]),
    el("section", { class: "card stack" }, [
      el("h2", { text: "3. Exact location" }),
      el("p", { text: "Kent and Haley use this to see the house. The website pin is shifted 150–250 meters when they approve." }),
      el("div", { class: "row" }, [
        el("button", { type: "button", class: "btn", text: "Use my location", onclick: () => useGps().catch((err) => showError(gpsError(err))) }),
        el("button", { type: "button", class: "btn", text: "Find address", onclick: () => findAddress().catch(showError) }),
      ]),
      field("Address", addressInput, "Search runs when you tap Find address."),
      results,
      el("p", { class: "hint", text: "Address search © OpenStreetMap contributors." }),
    ]),
    el("section", { class: "card stack" }, [
      el("h2", { text: "4. Note for the website" }),
      field("Short summary", summary, "One line. No house number. No customer name."),
      counter,
      warningBox,
      ackLine,
    ]),
    submitBtn,
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const issues = refreshWarnings();
    if (!photos.length) return showError(new Error("Add at least one photo."));
    if (!location) return showError(new Error("Save a location with GPS or an address."));
    const placeValue = place.value();
    if (!placeValue.town || /\d/.test(placeValue.town)) return showError(new Error("Enter the town only, without a house number."));
    if (issues.errors.length) return showError(new Error(issues.errors[0]));
    if (issues.warnings.length && !ack.checked) {
      ack.focus();
      return showError(new Error("Check the privacy box, or change the note."));
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return showError(new Error("You are offline. Connect and try again."));
    }
    submitBtn.disabled = true;
    try {
      for (const clip of videos) {
        status.textContent = "Preparing the video clip on this phone. This takes about as long as the clip.";
        const prepared = await trimVideoFile(clip.file, {
          start: clip.start,
          length: clip.length,
          onProgress: (done, total) => {
            status.textContent = `Preparing the clip… ${formatClock(done)} of ${formatClock(total)}.`;
          },
        });
        clip.blob = prepared.blob;
        clip.ext = prepared.ext;
      }
      await submit({
        fields: {
          service: service.value,
          town: placeValue.town,
          state: placeValue.state,
          summary: summary.value,
          date: date.value,
        },
        photos,
        videos: videos.map((clip) => ({ blob: clip.blob, ext: clip.ext })),
        location,
        onProgress: (text) => {
          status.textContent = text;
        },
      });
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      showError(err);
      submitBtn.disabled = false;
    }
  });

  refreshWarnings();
  root.append(form);
  return root;
}

function clipLabel(clip) {
  const end = clip.start + clip.length;
  if (clip.duration <= 30) return `Full clip, ${formatClock(clip.duration)}.`;
  return `Keeping ${formatClock(clip.start)} to ${formatClock(end)} of ${formatClock(clip.duration)}.`;
}

function gpsError(error) {
  if (error?.code === 1) {
    return new Error("Location is blocked. Type the address, or allow location for Safari or this Home Screen app.");
  }
  if (error?.code === 3) return new Error("Location took too long. Step outside or type the address.");
  return error instanceof Error ? error : new Error("Location did not come through. Type the address.");
}
