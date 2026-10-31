import assert from "node:assert/strict";
import test from "node:test";
import { canManageCrew, canReview, isFieldRole } from "../src/lib/roles.js";

test("only an approver or admin can open Review", () => {
  assert.equal(canReview("trainee"), false);
  assert.equal(canReview("lead_man"), false);
  assert.equal(canReview("crew"), false);
  assert.equal(canReview("approver"), true);
  assert.equal(canReview("admin"), true);
  assert.equal(canReview(undefined), false);
  assert.equal(canReview(""), false);
});

test("trainee and lead man are field roles with the same gate today", () => {
  assert.equal(isFieldRole("trainee"), true);
  assert.equal(isFieldRole("lead_man"), true);
  assert.equal(isFieldRole("approver"), false);
  assert.equal(isFieldRole("crew"), false);
});

test("only an admin manages roles", () => {
  assert.equal(canManageCrew("trainee"), false);
  assert.equal(canManageCrew("lead_man"), false);
  assert.equal(canManageCrew("approver"), false);
  assert.equal(canManageCrew("admin"), true);
});
