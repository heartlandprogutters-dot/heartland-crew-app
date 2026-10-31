export const MAX_CLIP_SECONDS = 30;
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

export function defaultClipWindow(durationSeconds, maxSeconds = MAX_CLIP_SECONDS) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { start: 0, length: 0 };
  }
  const length = Math.min(maxSeconds, duration);
  const start = Math.max(0, (duration - length) / 2);
  return { start, length };
}

export function clipStartLimit(durationSeconds, lengthSeconds) {
  return Math.max(0, Number(durationSeconds) - Number(lengthSeconds));
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function extensionForMime(mime) {
  return String(mime || "").includes("mp4") ? "mp4" : "webm";
}

export function canTrimOnThisDevice() {
  return typeof MediaRecorder !== "undefined"
    && typeof HTMLCanvasElement !== "undefined"
    && typeof HTMLCanvasElement.prototype.captureStream === "function"
    && Boolean(pickRecorderMime());
}

export function fitVideoSize(width, height, maxWidth = 1280, maxHeight = 720) {
  const safeWidth = Math.max(2, Number(width) || maxWidth);
  const safeHeight = Math.max(2, Number(height) || maxHeight);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: Math.max(2, Math.round((safeWidth * scale) / 2) * 2),
    height: Math.max(2, Math.round((safeHeight * scale) / 2) * 2),
  };
}

function waitEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, onOk);
      target.removeEventListener("error", onError);
    };
    const onOk = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("This phone could not open that video.")); };
    target.addEventListener(eventName, onOk);
    target.addEventListener("error", onError);
  });
}

export function loadVideoPreview(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.controls = true;
  video.src = url;
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        URL.revokeObjectURL(url);
        reject(new Error("This video has no length we can read. Nothing was uploaded."));
        return;
      }
      resolve({
        video,
        url,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This phone could not open that video. Nothing was uploaded."));
    };
  });
}

export function playClipWindow(video, start, length) {
  const end = start + length;
  const stop = () => {
    if (video.currentTime >= end - 0.05) {
      video.pause();
      video.removeEventListener("timeupdate", stop);
    }
  };
  video.addEventListener("timeupdate", stop);
  const afterSeek = () => {
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
  };
  if (Math.abs(video.currentTime - start) < 0.15) afterSeek();
  else {
    video.addEventListener("seeked", afterSeek, { once: true });
    video.currentTime = start;
  }
  return () => video.removeEventListener("timeupdate", stop);
}

export async function trimVideoFile(file, { start, length, onProgress, mount } = {}) {
  if (!canTrimOnThisDevice()) {
    throw new Error("This phone cannot trim video. Update Safari or Chrome. The full recording was not uploaded.");
  }
  const clipLength = Math.min(MAX_CLIP_SECONDS, Math.max(0.1, Number(length) || 0));
  const clipStart = Math.max(0, Number(start) || 0);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  video.className = "clip-source";
  video.src = url;
  (mount || ((node) => document.body.append(node)))(video);
  const mime = pickRecorderMime();
  let recorder;
  let stream;
  try {
    await waitEvent(video, "loadedmetadata");
    const size = fitVideoSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This phone cannot prepare a video clip. Nothing was uploaded.");
    const canvasStream = canvas.captureStream(24);
    let audioTracks = [];
    const capture = video.captureStream?.bind(video) || video.mozCaptureStream?.bind(video);
    if (capture) {
      try {
        audioTracks = capture().getAudioTracks();
      } catch {
        audioTracks = [];
      }
    }
    stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 1_500_000,
        audioBitsPerSecond: 96_000,
      });
    } catch {
      throw new Error("This phone cannot save a trimmed clip. The full recording was not uploaded.");
    }
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(new Error("The clip could not be saved on this phone. Nothing was uploaded."));
    });
    if (Math.abs(video.currentTime - clipStart) >= 0.15) {
      await new Promise((resolve, reject) => {
        const onSeeked = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("Could not move to that part of the video. Nothing was uploaded.")); };
        const cleanup = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        video.currentTime = clipStart;
      });
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    recorder.start(1000);
    try {
      await video.play();
    } catch {
      video.muted = true;
      await video.play();
    }
    await new Promise((resolve, reject) => {
      let lastMedia = video.currentTime;
      let lastChange = performance.now();
      const tick = () => {
        const mediaPlayed = video.currentTime - clipStart;
        if (video.currentTime !== lastMedia) {
          lastMedia = video.currentTime;
          lastChange = performance.now();
        } else if (performance.now() - lastChange > 5000) {
          reject(new Error("Playback stalled while preparing the clip. Nothing was uploaded."));
          return;
        }
        if (mediaPlayed >= clipLength - 0.05 || video.ended) {
          resolve();
          return;
        }
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch {
          // The next frame may still draw.
        }
        onProgress?.(Math.min(clipLength, Math.max(0, mediaPlayed)), clipLength);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    video.pause();
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mime.split(";")[0] || "video/mp4" });
    if (!blob.size) throw new Error("The clip came out empty. Nothing was uploaded.");
    if (blob.size > MAX_VIDEO_BYTES) {
      throw new Error("The clip is still too big for the free storage plan. Nothing was uploaded.");
    }
    return { blob, mime: blob.type, ext: extensionForMime(blob.type || mime), duration: clipLength };
  } catch (error) {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (error instanceof Error && /uploaded|trim|clip|stalled|open that video|move to that part/.test(error.message)) throw error;
    throw new Error("This phone could not prepare a 30 second clip. The full recording was not uploaded.");
  } finally {
    video.pause();
    stream?.getTracks().forEach((track) => track.stop());
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
