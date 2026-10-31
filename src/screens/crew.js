import { el, field } from "../lib/dom.js";
import { ROLE_OPTIONS, roleLabel } from "../lib/roles.js";

export function renderCrew({ load, profile, actions }) {
  const root = el("section", { class: "stack" });
  root.append(el("h1", { tabindex: "-1", text: "Crew" }), el("p", { text: "Loading…" }));
  const refresh = (flash) => load().then((people) => paint(root, people, profile, actions, refresh, flash)).catch((error) => {
    root.replaceChildren(el("h1", { tabindex: "-1", text: "Crew" }), el("p", { class: "error", text: error.message }));
  });
  refresh();
  return root;
}

function paint(root, people, profile, actions, refresh, flash) {
  const notice = el("p", { class: "ok", role: "status", text: flash || "" });
  notice.hidden = !flash;
  const error = el("p", { class: "error", role: "alert" });
  error.hidden = true;
  const name = el("input", { name: "name", autocomplete: "name", required: "true", maxlength: "60" });
  const email = el("input", { type: "email", name: "email", autocomplete: "off", autocapitalize: "none", required: "true" });
  const password = el("input", { type: "text", name: "password", autocomplete: "new-password", required: "true", minlength: "8" });
  const role = el("select", { name: "role" }, ROLE_OPTIONS.map((item) => (
    el("option", { value: item.value, text: item.label })
  )));
  const form = el("form", { class: "card stack" }, [
    el("h2", { text: "Add someone" }),
    el("p", { class: "hint", text: "They sign in with this email and temporary password, then change the password." }),
    error,
    notice,
    field("Name", name),
    field("Email", email),
    field("Temporary password", password),
    field("Role", role),
    el("button", { type: "submit", class: "btn primary", dataset: { testid: "add-crew" }, text: "Add person" }),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    notice.hidden = true;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const temporary = password.value;
      await actions.create({
        displayName: name.value,
        email: email.value,
        password: temporary,
        role: role.value,
      });
      await refresh(`Added. Tell them this password now: ${temporary}`);
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      button.disabled = false;
    }
  });
  const list = el("div", { class: "stack" }, people.map((person) => personCard(person, profile, actions, refresh, error)));
  root.replaceChildren(
    el("h1", { tabindex: "-1", text: "Crew" }),
    form,
    el("h2", { text: "People" }),
    list.childNodes.length ? list : el("p", { text: "No one is on the list yet." }),
  );
}

function personCard(person, profile, actions, refresh, error) {
  const role = el("select", { "aria-label": `Role for ${person.display_name}`, dataset: { testid: `role-${person.id}` } }, ROLE_OPTIONS.map((item) => {
    const option = el("option", { value: item.value, text: item.label });
    if (item.value === person.role) option.selected = true;
    return option;
  }));
  role.addEventListener("change", async () => {
    const next = role.value;
    role.disabled = true;
    try {
      await actions.setRole(person.id, next);
      await refresh(`${person.display_name} is now ${roleLabel(next)}.`);
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      role.value = person.role;
      role.disabled = false;
    }
  });
  const card = el("article", { class: "card spread" }, [
    el("div", { class: "who" }, [
      el("strong", { text: person.display_name }),
      el("span", { class: "muted", text: person.email }),
      person.disabled ? el("span", { class: "chip rejected", text: "Off" }) : el("span", { class: "chip approved", text: "On" }),
    ]),
    el("div", { class: "row" }, [
      field("Role", role, "Trainee and Lead Man post only their own jobs. Approvers can review every job."),
      person.id === profile.id ? null : el("button", {
        type: "button",
        class: "btn small",
        text: person.disabled ? "Turn on" : "Turn off",
        onclick: async () => {
          try {
            await actions.setDisabled(person.id, !person.disabled);
            await refresh();
          } catch (err) {
            error.hidden = false;
            error.textContent = err.message;
          }
        },
      }),
    ]),
  ]);
  return card;
}
