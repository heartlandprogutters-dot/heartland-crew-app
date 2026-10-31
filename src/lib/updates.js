import { registerSW } from "virtual:pwa-register";
import { isFormDirty } from "./form-state.js";
import { decideUpdate } from "./update-policy.js";
import { APP_VERSION } from "../version.js";

const RELOAD_FLAG = "heartland-reload-for";

function showUpdateBanner(message, onTap) {
  let banner = document.querySelector("[data-update-banner]");
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "update-banner";
    banner.dataset.updateBanner = "true";
    banner.setAttribute("role", "status");
    document.body.append(banner);
  }
  banner.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  banner.append(text);
  if (onTap) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn small";
    button.textContent = "Reload";
    button.addEventListener("click", onTap);
    banner.append(button);
  }
  banner.hidden = false;
  if (!onTap) {
    const token = message;
    window.setTimeout(() => {
      if (banner.querySelector("span")?.textContent === token) banner.hidden = true;
    }, 5000);
  }
}

async function fetchPublishedVersion() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
    if (!response.ok) return APP_VERSION;
    const body = await response.json();
    return String(body.version || APP_VERSION);
  } catch {
    return APP_VERSION;
  }
}

function reloadOnce() {
  try {
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // Reload still switches to the new files. The session stays in localStorage.
  }
  window.location.reload();
}

export function watchForUpdates() {
  let suppressUntil = 0;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.removeItem(RELOAD_FLAG);
      suppressUntil = Date.now() + 4000;
      showUpdateBanner(`Updated to version ${APP_VERSION}`);
    }
  } catch {
    // Ignore storage failures.
  }
  if (!("serviceWorker" in navigator)) return;

  let hadController = Boolean(navigator.serviceWorker.controller);
  let handling = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const decision = decideUpdate({
      hadController,
      dirty: isFormDirty(),
      suppress: Date.now() < suppressUntil,
    });
    hadController = true;
    if (decision !== "reload" && decision !== "prompt") return;
    if (handling) return;
    handling = true;
    const apply = (dirty) => {
      if (dirty) {
        showUpdateBanner("Update ready, tap to reload", () => reloadOnce());
        handling = false;
        return;
      }
      fetchPublishedVersion().then((version) => {
        if (isFormDirty()) {
          apply(true);
          return;
        }
        showUpdateBanner(`Updated to version ${version}`);
        window.setTimeout(() => {
          if (isFormDirty()) {
            apply(true);
            return;
          }
          reloadOnce();
        }, 800);
      }).catch(() => {
        handling = false;
      });
    };
    apply(decision === "prompt");
  });

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        registration.update().catch(() => {});
      };
      check();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
}
