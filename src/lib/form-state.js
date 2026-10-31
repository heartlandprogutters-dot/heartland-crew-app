const DIRTY_KEY = "heartland-form-dirty";
const DRAFT_KEY = "heartland-draft-v1";

export function setFormDirty(dirty, storage = globalThis.sessionStorage) {
  try {
    if (dirty) storage?.setItem(DIRTY_KEY, "1");
    else storage?.removeItem(DIRTY_KEY);
  } catch {
    // Private mode can refuse storage. The in-memory page still has the form.
  }
}

export function isFormDirty(storage = globalThis.sessionStorage) {
  try {
    if (storage?.getItem(DIRTY_KEY) === "1") return true;
    const raw = storage?.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    return Boolean(
      String(draft?.summary || "").trim()
      || String(draft?.address || "").trim()
      || Number.isFinite(Number(draft?.location?.lat))
    );
  } catch {
    return false;
  }
}
