export function canReview(role) {
  return role === "approver" || role === "admin";
}

export function canManageCrew(role) {
  return role === "admin";
}
