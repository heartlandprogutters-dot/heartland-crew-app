import { el } from "../lib/dom.js";
import { canManageCrew, canReview } from "../lib/roles.js";
import { icon } from "./icons.js";

const ITEMS = [
  { id: "new", label: "New job", icon: "plus" },
  { id: "posts", label: "My posts", icon: "list" },
  { id: "review", label: "Review", icon: "check", allow: canReview },
  { id: "crew", label: "Crew", icon: "people", allow: canManageCrew },
];

function navItems(profile) {
  return ITEMS.filter((item) => !item.allow || item.allow(profile?.role));
}

function navLink(item, active, hashFor) {
  const link = el("a", {
    href: hashFor(item.id),
    class: active === item.id ? "nav-btn active" : "nav-btn",
    dataset: { testid: `nav-${item.id}` },
  }, [icon(item.icon), el("span", { text: item.label })]);
  if (active === item.id) link.setAttribute("aria-current", "page");
  return link;
}

export function renderShell({ profile, active, hashFor, onSignOut, signOutLabel = "Sign out", onPassword, banner, content }) {
  const items = navItems(profile);
  const app = el("div", { class: "app" });
  const bar = el("header", { class: "topbar" }, [
    el("div", { class: "brand" }, [
      el("span", { class: "brand-mark", "aria-hidden": "true" }),
      el("span", { class: "brand-text" }, [
        el("strong", { text: "Heartland Crew" }),
        el("small", { text: profile.display_name }),
      ]),
    ]),
    el("div", { class: "top-actions" }, [
      onPassword ? el("button", { type: "button", class: "btn ghost small", onclick: onPassword, text: "Password" }) : null,
      el("button", { type: "button", class: "btn ghost small", onclick: onSignOut, text: signOutLabel }),
    ]),
  ]);
  const sider = el("nav", { class: "sider", "aria-label": "Sections" }, items.map((item) => navLink(item, active, hashFor)));
  const main = el("main", { class: "content", id: "content" }, [content]);
  const body = el("div", { class: "body" }, [sider, main]);
  const tabs = el("nav", { class: "tabbar", "aria-label": "Sections" }, items.map((item) => navLink(item, active, hashFor)));
  if (banner) app.append(banner);
  app.append(bar, body, tabs);
  return app;
}
