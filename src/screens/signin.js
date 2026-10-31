import { el, field } from "../lib/dom.js";

export function renderSetup(onPreview) {
  return el("section", { class: "setup card" }, [
    el("p", { class: "eyebrow", text: "Heartland ProGutters · Farmington, Kentucky" }),
    el("h1", { tabindex: "-1", text: "Crew app setup" }),
    el("p", { text: "This copy does not have its database keys yet. Open src/config.js, paste the Supabase project URL and the anon key, then let GitHub Pages rebuild. The README lists every click." }),
    el("p", { class: "hint", text: "Use the anon key only. The service_role key must stay out of this file." }),
    el("button", {
      type: "button",
      class: "btn primary",
      dataset: { testid: "setup-preview" },
      onclick: onPreview,
      text: "Preview the screens",
    }),
  ]);
}

export function renderSignIn({ onSubmit, onReset, message }) {
  const email = el("input", {
    type: "email",
    name: "email",
    autocomplete: "username",
    autocapitalize: "none",
    spellcheck: "false",
    inputmode: "email",
    required: "true",
  });
  const password = el("input", { type: "password", name: "password", autocomplete: "current-password", required: "true" });
  const show = el("input", { type: "checkbox" });
  show.addEventListener("change", () => {
    password.type = show.checked ? "text" : "password";
  });
  const error = el("p", { class: "error", role: "alert", text: message || "" });
  if (!message) error.hidden = true;
  const form = el("form", { class: "card stack", dataset: { testid: "signin-form" } }, [
    el("p", { class: "eyebrow", text: "Heartland ProGutters · Farmington, Kentucky" }),
    el("h1", { tabindex: "-1", text: "Sign in" }),
    el("p", { text: "Kent creates every login. There is no sign-up." }),
    error,
    field("Email", email),
    field("Password", password),
    el("label", { class: "checkline" }, [show, el("span", { text: "Show password" })]),
    el("button", { type: "submit", class: "btn primary", text: "Sign in" }),
    el("button", {
      type: "button",
      class: "btn ghost",
      text: "Email me a reset link",
      onclick: () => onReset(email.value, error),
    }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    onSubmit(email.value, password.value, error, form.querySelector('[type="submit"]'));
  });
  return el("section", { class: "signin" }, [form]);
}

export function renderPassword({ onSubmit, message }) {
  const password = el("input", { type: "password", name: "password", autocomplete: "new-password", minlength: "8", required: "true" });
  const confirm = el("input", { type: "password", name: "confirm", autocomplete: "new-password", minlength: "8", required: "true" });
  const error = el("p", { class: "error", role: "alert", text: message || "" });
  if (!message) error.hidden = true;
  const form = el("form", { class: "card stack" }, [
    el("h1", { tabindex: "-1", text: "Choose a new password" }),
    el("p", { text: "Use at least 8 characters. Kent should not keep a copy of the temporary one." }),
    error,
    field("New password", password),
    field("Type it again", confirm),
    el("button", { type: "submit", class: "btn primary", text: "Save password" }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (password.value !== confirm.value) {
      error.hidden = false;
      error.textContent = "Those passwords do not match.";
      return;
    }
    if (password.value.length < 8) {
      error.hidden = false;
      error.textContent = "Use at least 8 characters.";
      return;
    }
    onSubmit(password.value, error, form.querySelector('[type="submit"]'));
  });
  return form;
}
