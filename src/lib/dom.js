export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset" && value && typeof value === "object") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function field(labelText, control, hint) {
  const wrap = el("label", { class: "field" }, [
    el("span", { class: "field-label", text: labelText }),
    control,
  ]);
  if (hint) wrap.append(el("span", { class: "hint", text: hint }));
  return wrap;
}

export function button(text, attrs = {}) {
  return el("button", { type: "button", ...attrs }, [text]);
}
