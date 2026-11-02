import test from "node:test";
import assert from "node:assert/strict";
import { planReadiness } from "../src/features/collaboration/planReadiness.ts";
const s = {
  title: "Build",
  agent_id: "agent",
  description: "",
  depends_on: [],
};
test("empty plan and unavailable agents cannot be started", () => {
  assert.equal(planReadiness([], ["agent"], false).ready, false);
  assert.equal(planReadiness([s], [], false).ready, false);
  assert.equal(
    planReadiness([{ ...s, title: " " }], ["agent"], false).ready,
    false,
  );
});
test("unsaved changes block approval until the saved plan is ready", () => {
  assert.equal(planReadiness([s], ["agent"], true).ready, false);
  assert.equal(planReadiness([s], ["agent"], false).ready, true);
});
