const STREET = /\b\d{1,6}\s+[A-Za-z0-9.'-]+\s+(st|street|rd|road|ave|avenue|dr|drive|ln|lane|ct|court|blvd|boulevard|way|pkwy|parkway|cir|circle|trl|trail|hwy|highway|ter|terrace)\b/i;
const ZIP = /\b\d{5}(?:-\d{4})?\b/;
const PHONE = /\b\d{3}[^0-9]{0,2}\d{3}[^0-9]{0,2}\d{4}\b/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL = /https?:\/\/\S+/i;
const NAME = /\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}\b/g;
const NUMBER = /\b\d{3,5}\b/g;
const UNIT_AFTER = /^\s*(inch|inches|in|ft|feet|foot|gal|gallon|lb|lbs|oz|mm|cm|yr|yrs|year|years)\b/i;

export function sanitizeSummary(value) {
  if (value == null) return "";
  return String(value)
    .replaceAll('"', "'")
    .replaceAll("\\", "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReviewName(value) {
  return /^[A-Z][a-z]+(-[A-Z][a-z]+)?( [A-Z]\.)?$/.test(String(value || "").trim());
}

function safePhrases(context) {
  const phrases = new Set();
  for (const service of context?.services || []) phrases.add(String(service).toLowerCase());
  for (const town of context?.towns || []) phrases.add(String(town.town || town).toLowerCase());
  return phrases;
}

export function inspectPublicText(value, context = {}) {
  const text = String(value || "");
  const errors = [];
  const warnings = [];
  if (PHONE.test(text)) errors.push("Take the phone number out. It would show on the public map.");
  if (EMAIL.test(text)) errors.push("Take the email address out. It would show on the public map.");
  if (URL.test(text)) errors.push("Take the link out. Links can hide an address.");
  if (STREET.test(text) || ZIP.test(text)) {
    warnings.push("This looks like a street address. The website note should stay a description of the work.");
  }
  const phrases = safePhrases(context);
  const names = text.match(NAME) || [];
  for (const phrase of names) {
    if (phrases.has(phrase.toLowerCase())) continue;
    warnings.push("This looks like a person's full name. Leave customer names out of the public note.");
    break;
  }
  NUMBER.lastIndex = 0;
  let match;
  while ((match = NUMBER.exec(text))) {
    const number = Number(match[0]);
    if (number >= 1990 && number <= 2039) continue;
    const after = text.slice(match.index + match[0].length);
    if (UNIT_AFTER.test(after)) continue;
    warnings.push("This number may be a house number. Measurements like “120 feet” are fine. Street numbers are not.");
    break;
  }
  return { errors, warnings };
}
