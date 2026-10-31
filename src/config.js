// Heartland Crew settings.
// This is the public anon key. It is safe in the app because Row Level Security
// decides what each person can read. Never put the service_role key in this file.
// That key bypasses every privacy rule.

export const SUPABASE_URL = "https://jrhvtgtrfimplhvktsdz.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyaHZ0Z3RyZmltcGxodmt0c2R6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NTY5NjUsImV4cCI6MjEwOTAzMjk2NX0.tKhpDBQPtNDyBd0wL5GqYLhOrLLMiJWlCRsCBH-68jc";

// Address lookup uses OpenStreetMap Nominatim (no key).
// The app calls it only when someone taps "Use my location" or "Find address",
// waits at least one second between calls, and caches repeats.
// To switch services later, replace these two lines and redeploy.
// {query}, {lat}, and {lng} are filled in by the app.
// viewbox biases results toward western Kentucky, Tennessee, southern Illinois,
// and southeast Missouri around Mayfield. bounded=0 still allows matches outside that box.
export const GEOCODER_SEARCH =
  "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&viewbox=-91.8,39.2,-85.8,35.4&bounded=0&q={query}";
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
