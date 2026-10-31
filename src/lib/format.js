export function todayISO(timeZone = "America/Chicago", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function roundCoord(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 1e5) / 1e5;
}

export function formatWhen(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = String(isoDate).slice(0, 10).split("-");
  if (!year || !month || !day) return String(isoDate);
  return `${month}/${day}/${year}`;
}
