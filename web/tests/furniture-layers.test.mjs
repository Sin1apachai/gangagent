import test from "node:test";
import assert from "node:assert/strict";
import {
  LayoutEngine,
  objectLevel,
} from "../src/features/office/domain/LayoutEngine.ts";
const item = (id, kind, x = 3, y = 3) => ({ id, kind, x, y, rotation: 0 });
test("rug desk and computer stack independently of insertion order", () => {
  const items = [
    item("pc", "computer"),
    item("desk", "desk"),
    item("rug", "rug"),
  ];
  const e = new LayoutEngine(items);
  for (const i of items) assert.equal(e.validate(i), "");
  assert.equal(e.hit(3, 3).id, "pc");
  assert.equal(e.walkable({ x: 3, y: 3 }), false);
  assert.deepEqual(
    items.map((i) => objectLevel(i.kind)),
    [3, 2, 1],
  );
});
test("same-level collisions and computers on incompatible objects are rejected", () => {
  assert.notEqual(
    new LayoutEngine([item("a", "desk")]).validate(item("b", "chair")),
    "",
  );
  assert.notEqual(
    new LayoutEngine([item("a", "computer")]).validate(item("b", "computer")),
    "",
  );
  assert.notEqual(
    new LayoutEngine([item("a", "plant")]).validate(item("b", "computer")),
    "",
  );
  assert.notEqual(
    new LayoutEngine([item("a", "rug")]).validate(item("b", "rug")),
    "",
  );
});
test("a worker finds a reachable interaction position without walking into the desk", () => {
  const e = new LayoutEngine([item("desk", "desk"), item("pc", "computer")]);
  const target = e.interaction({ x: 0, y: 0 }, 0, true);
  assert.equal(target.item.kind, "computer");
  assert.equal(e.walkable(target.point), true);
  const path = e.path({ x: 0, y: 0 }, target.point);
  assert.deepEqual(path.at(-1), target.point);
});
test("idle interaction prefers coffee and stays within assigned area", () => {
  const e = new LayoutEngine([
    item("coffee", "coffee"),
    item("desk", "desk", 10, 10),
  ]);
  assert.equal(e.interaction({ x: 0, y: 0 }, 0, false).item.kind, "coffee");
});
import { activeAgentTask } from "../src/features/office/domain/AgentActivity.ts";
test("an agent with an older running task still works even if another task awaits review", () => {
  const tasks = [
    { agent_id: "a", status: "review", id: "newer" },
    { agent_id: "a", status: "running", id: "older" },
  ];
  assert.equal(activeAgentTask(tasks, "a").id, "older");
  assert.equal(activeAgentTask(tasks, "b"), undefined);
});
test("completed tasks do not keep an idle character at a workstation", () => {
  assert.equal(
    activeAgentTask([{ agent_id: "a", status: "done" }], "a"),
    undefined,
  );
});
