import "./styles.css";
import { isConfigured } from "./config.js";
import { el } from "./lib/dom.js";
import {
  changePassword,
  deleteOwnJob,
  listMyJobs,
  loadProfile,
  sendPasswordReset,
  signIn,
  signOut,
  submitNewJob,
  listReviewJobs,
  approveJob,
  updateApprovedJob,
  rejectJob,
  withdrawJob,
  republishJob,
  fetchFeed,
  downloadBackup,
  importJobs,
  removeJobVideo,
  moveExactPin,
  listPeople,
  createPerson,
  setPersonRole,
  setPersonDisabled,
} from "./lib/api.js";
import { getSupabase } from "./lib/supabase.js";
import { canManageCrew, canReview } from "./lib/roles.js";
import { renderShell } from "./ui/shell.js";
import { renderPassword, renderSetup, renderSignIn } from "./screens/signin.js";
import { renderNewJob } from "./screens/newjob.js";
import { renderPosts } from "./screens/posts.js";
import { renderReview } from "./screens/review.js";
import { renderCrew } from "./screens/crew.js";
import { renderPractice } from "./screens/practice.js";

const app = document.querySelector("#app");
let leave = () => {};
let profile = null;
let recovery = false;
let ready = false;
let disabledMessage = "";
let bootError = "";

function show(node) {
  leave();
  leave = typeof node?._leave === "function" ? node._leave : () => {};
  app.replaceChildren(node);
  node?.querySelector?.("h1")?.focus();
}

function parseRoute() {
  const raw = (location.hash || "").replace(/^#/, "");
  if (raw.includes("access_token") || raw.includes("error_description")) return { name: "callback" };
  const path = raw.split("?")[0].replace(/^\//, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "preview") {
    return { preview: true, name: parts[1] || "new", id: parts[2] ? decodeURIComponent(parts[2]) : null };
  }
  return { preview: false, name: parts[0] || "", id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function homeHash() {
  if (!profile) return "#/";
  return canReview(profile.role) ? "#/review" : "#/new";
}

function draw() {
  const route = parseRoute();
  if (!isConfigured()) {
    if (route.preview) {
      show(renderPractice(route, draw));
      return;
    }
    show(renderSetup(() => { location.hash = "#/preview/new"; }));
    return;
  }
  if (bootError) {
    show(el("section", { class: "card stack" }, [
      el("h1", { tabindex: "-1", text: "Can't open the app" }),
      el("p", { class: "error", text: bootError }),
    ]));
    return;
  }
  if (!profile) {
    show(renderSignIn({
      message: disabledMessage,
      onSubmit: async (email, password, error, button) => {
        button.disabled = true;
        try {
          await signIn(email, password);
          profile = await loadProfile();
          if (!profile || profile.disabled) {
            await signOut();
            profile = null;
            error.hidden = false;
            error.textContent = "This login is turned off. Ask Kent.";
            button.disabled = false;
            return;
          }
          if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
          location.hash = homeHash();
        } catch (err) {
          error.hidden = false;
          error.textContent = err.message;
          button.disabled = false;
        }
      },
      onReset: async (email, error) => {
        if (!email.trim()) {
          error.hidden = false;
          error.textContent = "Type your email first.";
          return;
        }
        try {
          await sendPasswordReset(email);
          error.className = "ok";
          error.hidden = false;
          error.textContent = "Check your email for the reset link.";
        } catch (err) {
          error.className = "error";
          error.hidden = false;
          error.textContent = err.message;
        }
      },
    }));
    return;
  }

  if (!route.name) {
    location.replace(homeHash());
    return;
  }
  const allowed = route.name === "new" || route.name === "posts" || route.name === "password"
    || (route.name === "review" && canReview(profile.role))
    || (route.name === "crew" && canManageCrew(profile.role));
  if (!allowed) {
    location.replace(homeHash());
    return;
  }

  let content;
  if (recovery || route.name === "password") {
    content = renderPassword({
      onSubmit: async (password, error, button) => {
        button.disabled = true;
        try {
          await changePassword(password);
          recovery = false;
          location.hash = homeHash();
        } catch (err) {
          error.hidden = false;
          error.textContent = err.message;
          button.disabled = false;
        }
      },
    });
  } else if (route.name === "posts") {
    content = renderPosts({
      load: listMyJobs,
      remove: deleteOwnJob,
      onCopy: () => { location.hash = "#/new"; },
    });
  } else if (route.name === "review") {
    content = renderReview({
      load: listReviewJobs,
      selectedId: route.id,
      hashFor: (id) => (id ? `#/review/${encodeURIComponent(id)}` : "#/review"),
      actions: {
        approve: approveJob,
        update: updateApprovedJob,
        reject: rejectJob,
        withdraw: withdrawJob,
        republish: republishJob,
        feed: fetchFeed,
        backup: downloadBackup,
        import: importJobs,
        removeVideo: (_job, video) => removeJobVideo(video),
        movePin: (id, lat, lng) => moveExactPin(id, lat, lng),
      },
    });
  } else if (route.name === "crew") {
    content = renderCrew({
      profile,
      load: listPeople,
      actions: { create: createPerson, setRole: setPersonRole, setDisabled: setPersonDisabled },
    });
  } else {
    content = renderNewJob({
      submit: async (payload) => {
        await submitNewJob(payload);
        location.hash = "#/posts";
      },
    });
  }

  const shell = renderShell({
    profile,
    active: route.name === "password" ? "new" : route.name,
    hashFor: (id) => `#/${id}`,
    onPassword: () => { location.hash = "#/password"; },
    onSignOut: async () => {
      profile = null;
      recovery = false;
      await signOut();
      location.hash = "#/";
    },
    content,
  });
  shell._leave = () => content._leave?.();
  show(shell);
}

window.addEventListener("hashchange", () => {
  if (ready) draw();
});

async function boot() {
  if (!isConfigured()) {
    ready = true;
    draw();
    return;
  }
  try {
    const supabase = getSupabase();
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recovery = true;
        if (ready) draw();
      }
    });
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      profile = await loadProfile();
      if (!profile || profile.disabled) {
        await signOut();
        profile = null;
        disabledMessage = "This login is turned off. Ask Kent.";
      }
    }
  } catch (error) {
    bootError = error.message || "The database did not answer.";
  }
  ready = true;
  draw();
}

boot();
