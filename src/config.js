// Heartland Crew settings.
// Replace the two YOUR_... values, then commit this file and let GitHub Pages rebuild.
// Use the anon public key from Supabase → Project Settings → API.
// Never put the service_role key in this file. That key bypasses every privacy rule.

export const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

// Address lookup uses OpenStreetMap Nominatim (no key).
// The app calls it only when someone taps "Use my location" or "Find address",
// waits at least one second between calls, and caches repeats.
// To switch services later, replace these two lines and redeploy.
// {query}, {lat}, and {lng} are filled in by the app.
export const GEOCODER_SEARCH =
  "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&q={query}";
export const GEOCODER_REVERSE =
  "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat={lat}&lon={lng}";

export function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL) &&
    typeof SUPABASE_ANON_KEY === "string" &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
  );
}
