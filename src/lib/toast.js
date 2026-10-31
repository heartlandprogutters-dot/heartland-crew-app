import { el } from "./dom.js";

export function showToast(message, kind = "error") {
  let toast = document.querySelector("[data-app-toast]");
  if (!toast) {
    toast = el("div", { class: "toast", role: "status", dataset: { appToast: "true" } });
    document.body.append(toast);
  }
  toast.className = `toast ${kind}`;
  toast.textContent = message || "";
  toast.hidden = !message;
}
