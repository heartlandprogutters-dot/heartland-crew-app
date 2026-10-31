export function slugPart(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function photoFileName(service, town, date, index) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD.");
  if (!Number.isInteger(index) || index < 1) throw new Error("Photo number must start at 1.");
  const serviceSlug = slugPart(service);
  const townSlug = slugPart(town);
  if (!serviceSlug || !townSlug) throw new Error("Service and town are needed for the photo name.");
  return `${serviceSlug}-${townSlug}-${date}-${index}.webp`;
}
