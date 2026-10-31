// Field roles post jobs and see only their own. They match today.
// A merged trainee post keeps that rule: the note "added to Lee's job"
// is stored on the trainee's own row. A later clock in/out (or a lead
// seeing a trainee's jobs) should branch in isFieldRole / canReview,
// and in the database helpers is_field_role() and can_read_job(),
// not in every screen.

const FIELD_ROLES = ["trainee", "lead_man"];

export const ROLE_OPTIONS = [
  { value: "trainee", label: "Trainee" },
  { value: "lead_man", label: "Lead Man" },
  { value: "approver", label: "Approver" },
  { value: "admin", label: "Admin" },
];

export function isFieldRole(role) {
  return FIELD_ROLES.includes(role);
}

export function canReview(role) {
  return role === "approver" || role === "admin";
}

export function canManageCrew(role) {
  return role === "admin";
}

export function roleLabel(role) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role || "";
}
