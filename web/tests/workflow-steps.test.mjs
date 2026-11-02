import test from "node:test";
import assert from "node:assert/strict";
import {
  nextStep,
  removeStep,
  suggestedTitle,
} from "../src/features/organization/stepDraft.ts";
const step = (title, deps = []) => ({
  ...nextStep([]),
  title,
  agent_id: "agent",
  depends_on: deps,
  required_files: ["proof.md"],
  reviewer_id: "owner",
  skill_ids: ["skill"],
});
test("new steps default to the previous approval gate without changing existing steps", () => {
  const first = step("A");
  const next = nextStep([first]);
  assert.deepEqual(next.depends_on, [0]);
  assert.deepEqual(first.depends_on, []);
  assert.deepEqual(nextStep([]).depends_on, []);
});
test("deleting a middle step preserves upstream approval gates and contracts", () => {
  const original = [step("A"), step("B", [0]), step("C", [1])];
  const result = removeStep(original, 1);
  assert.deepEqual(result[1].depends_on, [0]);
  assert.deepEqual(result[1].required_files, ["proof.md"]);
  assert.equal(result[1].reviewer_id, "owner");
  assert.deepEqual(result[1].skill_ids, ["skill"]);
  assert.deepEqual(original[2].depends_on, [1]);
});
test("deleting a branch preserves and deduplicates join prerequisites", () => {
  const result = removeStep(
    [step("A"), step("B", [0]), step("C", [0]), step("D", [0, 1, 2])],
    1,
  );
  assert.deepEqual(result[2].depends_on, [0, 1]);
  assert.ok(result.every((s, i) => s.depends_on.every((d) => d < i)));
});
test("deleting first or final step keeps indexes valid", () => {
  assert.deepEqual(
    removeStep([step("A"), step("B", [0])], 0)[0].depends_on,
    [],
  );
  assert.equal(removeStep([step("A")], 0).length, 0);
});
test("role suggestions are task labels and do not invent business scope", () => {
  assert.equal(suggestedTitle("Software Engineer"), "พัฒนาโปรแกรม");
  assert.equal(suggestedTitle("QA Engineer"), "ตรวจสอบผลงาน");
  assert.equal(suggestedTitle("Custom role"), "");
});
