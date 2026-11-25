import type { Tool } from "./types";

// A tool set stores whole connections, single tools, and tools excluded from
// either. It resolves to canonical tool names the same way the gateway
// resolves a tool group (internal/model/tool_group.go): servers' tools plus
// single tools, minus exclusions.
export interface Selection {
  servers: string[];
  tools: string[];
  excluded: string[];
}

export type Coverage = "all" | "some" | "none";

export const emptySelection: Selection = { servers: [], tools: [], excluded: [] };

export function resolve(selection: Selection, tools: Tool[]): Set<string> {
  const servers = new Set(selection.servers);
  const names = new Set(selection.tools);
  for (const tool of tools) {
    if (servers.has(tool.server)) names.add(tool.canonical_name);
  }
  for (const name of selection.excluded) names.delete(name);
  return names;
}

export function isAvailable(tool: Tool): boolean {
  return tool.enabled && tool.server_enabled;
}

// The gateway refuses to add a tool to a set while that tool is off, so off
// tools that would newly join (by picking their whole connection) are excluded
// before saving. Tools already in the saved set stay as they are.
export function withOffToolsExcluded(draft: Selection, saved: Selection, tools: Tool[]): Selection {
  const before = resolve(saved, tools);
  const after = resolve(draft, tools);
  const excluded = new Set(draft.excluded);
  for (const tool of tools) {
    const name = tool.canonical_name;
    if (!isAvailable(tool) && after.has(name) && !before.has(name)) excluded.add(name);
  }
  return { ...draft, excluded: [...excluded] };
}

// Judged by the tools agents can use now, so a whole connection with a tool
// switched off still reads as fully picked.
export function coverage(effective: Set<string>, connectionTools: Tool[]): Coverage {
  if (!connectionTools.some((tool) => effective.has(tool.canonical_name))) return "none";
  const available = connectionTools.filter(isAvailable);
  return available.length > 0 && available.every((tool) => effective.has(tool.canonical_name)) ? "all" : "some";
}

// Picks the whole connection, so its future tools join too, or drops it when it
// is already fully picked.
export function toggleConnection(selection: Selection, server: string, connectionTools: Tool[], current: Coverage): Selection {
  const own = new Set(connectionTools.map((tool) => tool.canonical_name));
  const others = (names: string[]) => names.filter((name) => !own.has(name));
  const servers = selection.servers.filter((name) => name !== server);
  return {
    servers: current === "all" ? servers : [...servers, server],
    tools: others(selection.tools),
    excluded: others(selection.excluded),
  };
}

export function toggleTool(selection: Selection, tool: Tool, isOn: boolean): Selection {
  const name = tool.canonical_name;
  const without = (names: string[]) => names.filter((value) => value !== name);
  if (selection.servers.includes(tool.server)) {
    return { ...selection, excluded: isOn ? [...without(selection.excluded), name] : without(selection.excluded) };
  }
  return isOn
    ? { ...selection, tools: without(selection.tools) }
    : { ...selection, tools: [...without(selection.tools), name], excluded: without(selection.excluded) };
}

export function sameSelection(a: Selection, b: Selection): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join("\n") === [...y].sort().join("\n");
  return same(a.servers, b.servers) && same(a.tools, b.tools) && same(a.excluded, b.excluded);
}
