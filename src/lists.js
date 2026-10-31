// Service names, in the same order and wording as the Services items in the
// main menu on https://heartlandprogutters.com (hamburger menu and desktop nav).
// Category labels (Cleaning, Home Repair, Contractor Services) are not services.
// About, Gallery, Blog, Contact, Reviews, and Promotions are not services.
// To add one: copy a line, change the name, commit, and the site will redeploy.
// The public map still stores this as the "service" text field. Older jobs may
// say "Gutter Cleaning", "Gutter Repair", "Downspouts", or "Fascia/Soffit".
// Those stay valid. Choose Other and the existing name is kept.

export const SERVICES = [
  "Pressure Washing",
  "Window Washing",
  "Soft Washing",
  "Gutter Cleaning & Repair",
  "Mobile Home Skirting",
  "Gutter Guards",
  "Seamless Gutters",
  "Under-Deck Gutter Systems",
  "Fascia and Soffit Repair",
  "Vinyl Siding",
  "Yard Drainage Solutions",
  "Chop & Drop Gutter Machine Service",
  "Gravel Driveway Rejuvenation",
  "Rain Barrels & Water Storage",
  "Christmas Lights",
];

// Same rule the database uses in prepare_copy. Older map values still match.
const SERVICE_NAME = /^[A-Za-z0-9 /&-]{2,60}$/;

export function serviceNameError(value) {
  const text = String(value || "").trim();
  if (!text) return "Choose a service, or type one under Other.";
  if (!SERVICE_NAME.test(text)) {
    return "Use letters, numbers, spaces, &, or / in the service name (60 characters or fewer).";
  }
  return "";
}

// Towns around Farmington. The GPS button can still fill in a town that is not listed.
// To add one: copy a line with the town and the two-letter state.

export const TOWNS = [
  { town: "Farmington", state: "KY" },
  { town: "Murray", state: "KY" },
  { town: "Hazel", state: "KY" },
  { town: "Lynn Grove", state: "KY" },
  { town: "Kirksey", state: "KY" },
  { town: "Almo", state: "KY" },
  { town: "New Concord", state: "KY" },
  { town: "Hardin", state: "KY" },
  { town: "Dexter", state: "KY" },
  { town: "Benton", state: "KY" },
  { town: "Calvert City", state: "KY" },
  { town: "Mayfield", state: "KY" },
  { town: "Wingo", state: "KY" },
  { town: "Fancy Farm", state: "KY" },
  { town: "Lowes", state: "KY" },
  { town: "Fulton", state: "KY" },
  { town: "Clinton", state: "KY" },
  { town: "Paducah", state: "KY" },
  { town: "Cadiz", state: "KY" },
  { town: "Hopkinsville", state: "KY" },
  { town: "Puryear", state: "TN" },
  { town: "Paris", state: "TN" },
  { town: "Buchanan", state: "TN" },
  { town: "Martin", state: "TN" },
  { town: "Dresden", state: "TN" },
  { town: "Union City", state: "TN" },
];

export const STATES = ["KY", "TN", "IL", "MO", "IN"];
