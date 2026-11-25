import assert from "node:assert/strict";
import test from "node:test";
import { coverage, resolve, toggleConnection, toggleTool, withOffToolsExcluded, type Selection } from "./selection.ts";
import type { Tool } from "./types";

function tool(server: string, name: string, enabled = true): Tool {
  return {
    name,
    canonical_name: `${server}__${name}`,
    title: name,
    server,
    description: "",
    enabled,
    server_enabled: true,
  };
}

const echo = tool("everything", "echo");
const sum = tool("everything", "get-sum");
const off = tool("everything", "print-env", false);
const task = tool("asana", "get_task");
const tools = [echo, sum, off, task];
const names = (set: Set<string>) => [...set].sort();

test("resolves whole connections and single tools, minus exclusions", () => {
  const selection: Selection = { servers: ["everything"], tools: [task.canonical_name], excluded: [sum.canonical_name] };
  assert.deepEqual(names(resolve(selection, tools)), [task.canonical_name, echo.canonical_name, off.canonical_name].sort());
});

test("excludes off tools only when they would newly join", () => {
  const whole: Selection = { servers: ["everything"], tools: [], excluded: [] };
  assert.deepEqual(withOffToolsExcluded(whole, { servers: [], tools: [], excluded: [] }, tools).excluded, [off.canonical_name]);
  assert.deepEqual(withOffToolsExcluded(whole, whole, tools).excluded, []);
});

test("a whole connection reads as all even with an off tool", () => {
  const prepared = withOffToolsExcluded({ servers: ["everything"], tools: [], excluded: [] }, { servers: [], tools: [], excluded: [] }, tools);
  assert.equal(coverage(resolve(prepared, tools), [echo, sum, off]), "all");
});

test("toggling a connection goes some -> all -> none", () => {
  const some: Selection = { servers: [], tools: [echo.canonical_name], excluded: [] };
  const all = toggleConnection(some, "everything", [echo, sum, off], "some");
  assert.deepEqual(all, { servers: ["everything"], tools: [], excluded: [] });
  assert.deepEqual(toggleConnection(all, "everything", [echo, sum, off], "all"), { servers: [], tools: [], excluded: [] });
});

test("toggling a tool inside a whole connection excludes it, and back", () => {
  const whole: Selection = { servers: ["everything"], tools: [], excluded: [] };
  const without = toggleTool(whole, echo, true);
  assert.deepEqual(without.excluded, [echo.canonical_name]);
  assert.deepEqual(toggleTool(without, echo, false), whole);
});

test("toggling a single tool on clears a stale exclusion", () => {
  const stale: Selection = { servers: [], tools: [], excluded: [task.canonical_name] };
  assert.deepEqual(toggleTool(stale, task, false), { servers: [], tools: [task.canonical_name], excluded: [] });
});
