// Decides what to do when a service worker takes control of this page.
export function decideUpdate({ hadController, dirty, suppress }) {
  if (suppress) return "stay";
  if (!hadController) return "ignore";
  if (dirty) return "prompt";
  return "reload";
}
