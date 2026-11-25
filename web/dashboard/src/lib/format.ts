import type { Connection, Transport } from "./types";

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Agents see a tool only while both its switch and its connection are on. */
export function availableTools(connection: Connection): number {
  return connection.enabled ? connection.enabled_tool_count : 0;
}

// Agents reach the gateway at the same origin the dashboard is served from.
export const endpoints = {
  gateway: () => `${window.location.origin}/mcp`,
  sse: () => `${window.location.origin}/sse`,
  toolSet: (name: string) => `${window.location.origin}/v0/groups/${encodeURIComponent(name)}/mcp`,
};

export const transportLabels: Record<Transport, string> = {
  streamable_http: "Remote · Streamable HTTP",
  sse: "Remote · SSE",
  stdio: "Local command",
};

/** The one line under a connection's name: its own description, else where it runs. */
export function connectionSummary(connection: Connection): string {
  const config = connection.config_summary;
  if (config.description) return config.description;
  if (connection.transport === "stdio") return config.target || "Local command";
  try {
    return new URL(config.target ?? "").host;
  } catch {
    return transportLabels[connection.transport];
  }
}
