import { STATES, TOWNS } from "../lists.js";
import { el, field } from "../lib/dom.js";

export function serviceSelect(services, current) {
  const listed = Boolean(current) && services.includes(current);
  const select = el("select", { name: "service", required: "true", dataset: { testid: "service" } });
  for (const service of services) {
    const option = el("option", { value: service, text: service });
    if (listed && service === current) option.selected = true;
    select.append(option);
  }
  const other = el("option", { value: "__other", text: "Other" });
  if (current && !listed) other.selected = true;
  select.append(other);
  const custom = el("input", {
    name: "customService",
    value: current && !listed ? current : "",
    maxlength: "60",
    placeholder: "Type the service",
    autocomplete: "off",
    dataset: { testid: "custom-service" },
  });
  const customWrap = el("div", { class: current && !listed ? "stack" : "stack hidden" }, [custom]);
  select.addEventListener("change", () => {
    const show = select.value === "__other";
    customWrap.classList.toggle("hidden", !show);
    if (show) custom.focus();
  });
  const group = el("div", { class: "stack" }, [
    field("Service", select, "Same names as the website menu. Choose Other to type one."),
    customWrap,
  ]);
  return {
    element: group,
    focus() {
      if (select.value === "__other") custom.focus();
      else select.focus();
    },
    value() {
      if (select.value === "__other") return custom.value.trim();
      return select.value;
    },
  };
}

export function placeFields({ town = "", state = "KY" } = {}) {
  const known = TOWNS.find((item) => item.town === town && item.state === state);
  const townSelect = el("select", { name: "townChoice" });
  for (const item of TOWNS) {
    const option = el("option", { value: `${item.town}|${item.state}`, text: `${item.town}, ${item.state}` });
    if (known && item.town === town && item.state === state) option.selected = true;
    townSelect.append(option);
  }
  const other = el("option", { value: "__other", text: "Other town…" });
  if (!known) other.selected = true;
  townSelect.append(other);
  const custom = el("input", {
    name: "customTown",
    value: known ? "" : town,
    maxlength: "40",
    autocomplete: "address-level2",
    placeholder: "Town name",
  });
  const stateSelect = el("select", { name: "state" });
  const stateValues = STATES.includes(state) ? STATES : [state, ...STATES];
  for (const code of stateValues) {
    const option = el("option", { value: code, text: code });
    if (code === state) option.selected = true;
    stateSelect.append(option);
  }
  const customWrap = el("div", { class: known ? "hidden" : "stack" }, [custom]);
  townSelect.addEventListener("change", () => {
    if (townSelect.value === "__other") {
      customWrap.classList.remove("hidden");
      custom.focus();
      return;
    }
    customWrap.classList.add("hidden");
    const [nextTown, nextState] = townSelect.value.split("|");
    if (nextState && [...stateSelect.options].some((option) => option.value === nextState)) {
      stateSelect.value = nextState;
    }
    custom.value = nextTown;
  });
  const group = el("div", { class: "place-grid" }, [
    field("Town", townSelect),
    field("State", stateSelect),
    customWrap,
  ]);
  return {
    element: group,
    setTown(nextTown, nextState) {
      const match = [...townSelect.options].find((option) => option.value === `${nextTown}|${nextState}`);
      if (match) {
        townSelect.value = match.value;
        customWrap.classList.add("hidden");
        stateSelect.value = nextState;
      } else if (nextTown) {
        townSelect.value = "__other";
        customWrap.classList.remove("hidden");
        custom.value = nextTown;
        if (nextState && [...stateSelect.options].some((option) => option.value === nextState)) {
          stateSelect.value = nextState;
        }
      }
    },
    value() {
      if (townSelect.value === "__other") {
        return { town: custom.value.trim(), state: stateSelect.value };
      }
      const [pickedTown, pickedState] = townSelect.value.split("|");
      return { town: pickedTown, state: pickedState || stateSelect.value };
    },
  };
}
