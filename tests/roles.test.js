import assert from "node:assert/strict";
import test from "node:test";
import { canManageCrew, canReview } from "../src/lib/roles.js";

test("only an approver or admin can open Review", () => {
  assert.equal(canReview("crew"), false);
  assert.equal(canReview("approver"), true);
  assert.equal(canReview("admin"), true);
  assert.equal(canReview(undefined), false);
  assert.equal(canReview(""), false);
});

test("only an admin manages roles", () => {
  assert.equal(canManageCrew("crew"), false);
  assert.equal(canManageCrew("approver"), false);
  assert.equal(canManageCrew("admin"), true);
});
