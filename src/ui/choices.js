import { STATES, TOWNS } from "../lists.js";
import { el, field } from "../lib/dom.js";

export function serviceSelect(services, current) {
  const select = el("select", { name: "service", required: "true" });
  const options = !current || services.includes(current) ? services : [current, ...services];
  for (const service of options) {
    const option = el("option", { value: service, text: service });
    if (service === current) option.selected = true;
    select.append(option);
  }
  return select;
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
