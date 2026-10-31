import { SERVICES, TOWNS, serviceNameError } from "../lists.js";
import { CENSUS_GEOCODER, GEOCODER_REVERSE, GEOCODER_SEARCH } from "../config.js";
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
import { mountPinMap } from "../lib/map.js";
import { setFormDirty } from "../lib/form-state.js";
import { readPhotoExif } from "../lib/exif.js";
import { chooseExif } from "../lib/merge.js";
import { placeFields, serviceSelect } from "../ui/choices.js";

const DRAFT_KEY = "heartland-draft-v1";
const lookup = createLookup({
  searchTemplate: GEOCODER_SEARCH,
  reverseTemplate: GEOCODER_REVERSE,
  censusTemplate: CENSUS_GEOCODER,
});

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
  let pinMap = null;
  root._leave = () => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    videos.forEach((clip) => {
      if (clip.url) URL.revokeObjectURL(clip.url);
      clip.video?.pause?.();
    });
    pinMap?.destroy();
    pinMap = null;
  };

  const status = el("p", { class: "status", role: "status", text: "" });
  const error = el("p", { class: "error", role: "alert" });
  error.hidden = true;
  const submitError = el("p", { class: "error", role: "alert", dataset: { testid: "submit-error" } });
  submitError.hidden = true;
  let photoSection;
  let workSection;
  let locationSection;
  let noteSection;
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
  addressInput.value = draft?.address || "";
  if (draft?.location && Number.isFinite(Number(draft.location.lat)) && Number.isFinite(Number(draft.location.lng))) {
    location = {
      lat: Number(draft.location.lat),
      lng: Number(draft.location.lng),
      address: String(draft.location.address || ""),
      accuracy: draft.location.accuracy ?? null,
    };
  }
  const results = el("div", { class: "stack", dataset: { testid: "address-results" } });
  if (location) {
    results.replaceChildren(el("p", { class: "ok", text: `Pin saved. ${location.address || "House pin restored."}` }));
  }
  const mapSlot = el("div", { class: "map picker-map hidden", dataset: { testid: "pin-map" } });
  const mapHint = el("p", { class: "hint" });
  mapHint.hidden = true;
  const usePinBtn = el("button", { type: "button", class: "btn primary", dataset: { testid: "use-pin" }, text: "Use this pin" });
  usePinBtn.hidden = true;
  let pinPoint = null;
  let lastHit = null;
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
          syncDirty();
        },
      });
      const img = el("img", { src: photo.url, alt: `Photo ${index + 1} preview` });
      return el("figure", { class: "photo" }, [img, remove]);
    }));
  }

  async function addFiles(list) {
    clearProblems();
    const files = [...list];
    for (const file of files) {
      if (photos.length >= 8) {
        showError(new Error("8 photos is the limit for one job."), photoSection);
        break;
      }
      status.textContent = `Preparing photo ${photos.length + 1}…`;
      const exif = await readPhotoExif(file);
      const blob = await resizeToWebp(file);
      photos.push({ blob, url: URL.createObjectURL(blob), exif });
      renderThumbs();
    }
    status.textContent = photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} ready.` : "";
    syncDirty();
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
            syncDirty();
          },
        }),
      ]),
      adjust,
    ]);
    return card;
  }

  async function addVideo(file) {
    clearProblems();
    if (!file) return;
    if (!canTrimOnThisDevice()) {
      showError(new Error("This phone cannot trim video. Update Safari or Chrome. The full recording was not added."), photoSection);
      return;
    }
    if (videos.length >= 2) {
      showError(new Error("2 videos is the limit for one job."), photoSection);
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
    syncDirty();
  }

  recordVideo.addEventListener("change", () => {
    addVideo(recordVideo.files?.[0]).catch(showError);
    recordVideo.value = "";
  });
  pickVideo.addEventListener("change", () => {
    addVideo(pickVideo.files?.[0]).catch(showError);
    pickVideo.value = "";
  });

  function clearProblems() {
    submitError.hidden = true;
    submitError.textContent = "";
    error.hidden = true;
    error.textContent = "";
    for (const section of [photoSection, workSection, locationSection, noteSection]) {
      if (!section) continue;
      section.classList.remove("problem");
      section.querySelector("[data-field-error]")?.remove();
    }
  }

  function showProblem(message, section) {
    submitError.hidden = false;
    submitError.textContent = message;
    status.textContent = "";
    if (section) {
      section.classList.add("problem");
      const note = el("p", { class: "error", role: "alert", dataset: { fieldError: "true" }, text: message });
      const heading = section.querySelector("h2");
      if (heading) heading.after(note);
      else section.prepend(note);
      section.scrollIntoView({ block: "start", behavior: "smooth" });
    } else {
      submitError.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function showError(err, section) {
    showProblem(err?.message || "Something went wrong.", section);
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

  function syncDirty() {
    const dirty = Boolean(
      photos.length
      || videos.length
      || location
      || addressInput.value.trim()
      || summary.value.trim()
    );
    setFormDirty(dirty);
    try {
      if (!dirty) {
        sessionStorage.removeItem(DRAFT_KEY);
        return;
      }
      const current = place.value();
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        service: service.value(),
        town: current.town,
        state: current.state,
        summary: summary.value,
        date: date.value,
        address: addressInput.value,
        location,
      }));
    } catch {
      // Ignore storage failures. The page still holds the form until reload.
    }
  }

  addressInput.addEventListener("input", syncDirty);
  summary.addEventListener("input", () => {
    refreshWarnings();
    syncDirty();
  });

  async function useGps() {
    clearProblems();
    if (!navigator.geolocation) {
      showError(new Error("This phone cannot share location. Type the address instead."), locationSection);
      return;
    }
    results.replaceChildren(el("p", { class: "status", role: "status", text: "Finding this house…" }));
    status.textContent = "";
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
    const saved = meters
      ? `Location saved, about ${meters} m. ${hit.town ? `Town looks like ${hit.town}.` : ""}`
      : "Location saved.";
    const savedBits = [el("p", { class: "ok", text: saved })];
    if (hit.label) savedBits.push(el("p", { class: "private-note", text: `Check this house: ${hit.label}` }));
    results.replaceChildren(...savedBits);
    syncDirty();
    await showPinMap(location.lat, location.lng, "Drag the pin if this is not the house, then tap Use this pin.", 17);
  }

  async function showPinMap(lat, lng, message, zoom = 16) {
    mapSlot.classList.remove("hidden");
    mapHint.hidden = false;
    mapHint.textContent = message;
    usePinBtn.hidden = false;
    pinPoint = { lat, lng };
    if (!pinMap) {
      pinMap = await mountPinMap(mapSlot, {
        lat,
        lng,
        zoom,
        onMove(next) { pinPoint = next; },
      });
    } else {
      pinMap.setView(lat, lng, zoom);
    }
    mapSlot.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function rememberPin() {
    if (!pinPoint) return;
    let label = "";
    try {
      const hit = await lookup.reverse(pinPoint.lat, pinPoint.lng);
      label = hit.label;
      if (hit.town) place.setTown(hit.town, hit.state || place.value().state);
    } catch {
      const placed = place.value();
      label = placed.town ? `Pinned near ${placed.town}, ${placed.state}` : "Pinned location";
    }
    location = { lat: pinPoint.lat, lng: pinPoint.lng, address: label, accuracy: null };
    syncDirty();
    results.replaceChildren(el("p", { class: "ok", text: `Pin saved. ${label}` }));
  }

  function focusHit(hit, needsPin) {
    lastHit = hit;
    if (hit.town) place.setTown(hit.town, hit.state || place.value().state);
    const message = needsPin || hit.precision !== "house"
      ? "No house number was found for this road. Drag the pin onto the house, then tap Use this pin."
      : "Drag the pin if this is not the house, then tap Use this pin.";
    if (!needsPin && hit.precision === "house") {
      location = { lat: hit.lat, lng: hit.lng, address: hit.label, accuracy: null };
      syncDirty();
    }
    return showPinMap(hit.lat, hit.lng, message, hit.precision === "place" ? 13 : 16);
  }

  async function findAddress() {
    clearProblems();
    const placed = place.value();
    results.replaceChildren(el("p", { class: "status", role: "status", dataset: { testid: "address-status" }, text: "Searching…" }));
    let found;
    try {
      found = await lookup.search(addressInput.value, { town: placed.town, state: placed.state }, (text) => {
        const statusLine = results.querySelector('[data-testid="address-status"]');
        if (statusLine) statusLine.textContent = text;
      });
    } catch (err) {
      results.replaceChildren(el("p", { class: "error", role: "alert", text: err.message || "Address search did not answer." }));
      return;
    }
    if (!found.hits.length) {
      results.replaceChildren(el("p", { class: "error", role: "alert", text: "No match. Try a road and town, a ZIP such as 42023, or tap Set on map." }));
      return;
    }
    const needsPin = found.needsPin;
    results.replaceChildren(
      el("p", { class: "hint", text: needsPin ? "Tap a place to center the map, then drag the pin to the house." : "Tap the right address." }),
      ...found.hits.map((hit) => el("button", {
        type: "button",
        class: "btn address-hit",
        text: hit.label,
        onclick: () => { focusHit(hit, needsPin).catch((err) => showError(err, locationSection)); },
      })),
    );
    await focusHit(found.hits[0], needsPin);
  }

  async function openSetOnMap() {
    clearProblems();
    results.replaceChildren(el("p", { class: "status", role: "status", text: "Opening the map…" }));
    try {
      if (location) {
        results.replaceChildren();
        await showPinMap(location.lat, location.lng, "Drag the pin onto the house, then tap Use this pin.", 17);
        return;
      }
      if (lastHit) {
        results.replaceChildren();
        await showPinMap(lastHit.lat, lastHit.lng, "Drag the pin onto the house, then tap Use this pin.", lastHit.precision === "place" ? 13 : 16);
        return;
      }
      const placed = place.value();
      const center = await lookup.place(`${placed.town}, ${placed.state}`);
      results.replaceChildren();
      if (!center) {
        await showPinMap(36.7417, -88.6366, "Map opened near Mayfield. Drag the pin onto the house, then tap Use this pin.", 11);
        return;
      }
      if (center.town) place.setTown(center.town, center.state || placed.state);
      await showPinMap(center.lat, center.lng, `Map centered on ${placed.town}. Drag the pin onto the house, then tap Use this pin.`, 13);
    } catch (err) {
      showError(err, locationSection);
    }
  }

  usePinBtn.addEventListener("click", () => {
    rememberPin().catch((err) => showError(err, locationSection));
  });

  photoSection = el("section", { class: "card stack" }, [
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
  ]);
  workSection = el("section", { class: "card stack" }, [
      el("h2", { text: "2. Work and town" }),
      service.element,
      place.element,
      field("Date finished", date),
  ]);
  locationSection = el("section", { class: "card stack" }, [
      el("h2", { text: "3. Exact location" }),
      el("p", { text: "Kent and Haley use this to see the house. The website pin is shifted 150–250 meters when they approve." }),
      el("div", { class: "row" }, [
        el("button", { type: "button", class: "btn", text: "Use my location", onclick: () => useGps().catch((err) => showError(gpsError(err), locationSection)) }),
        el("button", { type: "button", class: "btn", dataset: { testid: "find-address" }, text: "Find address", onclick: () => findAddress() }),
        el("button", { type: "button", class: "btn", dataset: { testid: "set-on-map" }, text: "Set on map", onclick: () => openSetOnMap() }),
      ]),
      field("Address", addressInput, "Road and town, or a ZIP. Rural highways often have no house number."),
      results,
      mapHint,
      mapSlot,
      usePinBtn,
      el("p", { class: "hint", text: "Address search uses the US Census and OpenStreetMap. Drag the pin when the house is not listed." }),
  ]);
  noteSection = el("section", { class: "card stack" }, [
      el("h2", { text: "4. Note for the website" }),
      field("Short summary", summary, "One line. No house number. No customer name."),
      counter,
      warningBox,
      ackLine,
  ]);
  const form = el("form", { class: "stack" }, [
    el("h1", { tabindex: "-1", text: "New job" }),
    draft ? el("p", {
      class: "ok",
      text: location
        ? "Restored your note and house pin. Add the photos again."
        : "Restored your note. Add the photos and location again.",
    }) : null,
    browserSupportsWebp() ? null : el("p", { class: "error", text: "This browser cannot save WebP photos. Update iOS or use Chrome." }),
    error,
    status,
    photoSection,
    workSection,
    locationSection,
    noteSection,
    submitError,
    submitBtn,
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearProblems();
    const issues = refreshWarnings();
    const serviceName = service.value();
    const placeValue = place.value();
    const serviceProblem = serviceNameError(serviceName);
    if (!photos.length) return showProblem("Add at least one photo.", photoSection);
    if (serviceProblem) {
      service.focus();
      return showProblem(serviceProblem, workSection);
    }
    if (!placeValue.town || /\d/.test(placeValue.town)) return showProblem("Enter the town only, without a house number.", workSection);
    const photoExif = chooseExif(photos);
    if (!location && photoExif.lat != null && photoExif.lng != null) {
      location = {
        lat: photoExif.lat,
        lng: photoExif.lng,
        address: "Location from the photo",
        accuracy: null,
      };
      results.replaceChildren(el("p", { class: "ok", text: "Using the location saved in the photo." }));
    }
    if (!location) {
      addressInput.focus();
      return showProblem("Save a location with GPS, Find address, or Set on map.", locationSection);
    }
    if (issues.errors.length) {
      summary.focus();
      return showProblem(issues.errors[0], noteSection);
    }
    if (issues.warnings.length && !ack.checked) {
      ack.focus();
      return showProblem("Check the privacy box, or change the note.", noteSection);
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return showProblem("You are offline. Connect and try again.");
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
          service: serviceName,
          town: placeValue.town,
          state: placeValue.state,
          summary: summary.value,
          date: date.value,
        },
        photos,
        videos: videos.map((clip) => ({ blob: clip.blob, ext: clip.ext })),
        location,
        exif: photoExif,
        onProgress: (text) => {
          status.textContent = text;
        },
      });
      sessionStorage.removeItem(DRAFT_KEY);
      setFormDirty(false);
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
