import type { CatalogEntry, CatalogInput } from "./catalog";
import type { NewConnection, SessionMode, Transport } from "./types";

// What the add-connection form holds while the operator fills it, and how it
// becomes the API's NewConnection. A catalog entry prefills the same draft.

export type Pair = { key: string; value: string };

type Kind = "remote" | "local";
type Protocol = "detect" | Exclude<Transport, "stdio">;

export interface Draft {
  /** The catalog entry the draft started from; null for a custom connection. */
  entry: CatalogEntry | null;
  kind: Kind;
  url: string;
  token: string;
  headers: Pair[];
  protocol: Protocol;
  /** A registered app's credentials, for vendors that sign in no other client. */
  clientId: string;
  clientSecret: string;
  command: string;
  args: string;
  env: Pair[];
  /** Values for the entry's own inputs, by input key. */
  inputs: Record<string, string>;
  name: string;
  nameEdited: boolean;
  description: string;
  sessionMode: SessionMode;
}

export const emptyDraft: Draft = {
  entry: null,
  kind: "remote",
  url: "",
  token: "",
  headers: [],
  protocol: "detect",
  clientId: "",
  clientSecret: "",
  command: "",
  args: "",
  env: [],
  inputs: {},
  name: "",
  nameEdited: false,
  description: "",
  sessionMode: "stateless",
};

/** The draft a catalog entry starts: everything known filled, only what the person holds left empty. */
export function draftFrom(entry: CatalogEntry): Draft {
  const base: Draft = { ...emptyDraft, entry, name: entry.id, nameEdited: true, description: entry.description };
  const connect = entry.connect;
  if (connect.kind === "remote") return { ...base, kind: "remote", url: connect.url };
  return {
    ...base,
    kind: "local",
    command: connect.command,
    args: connect.args.join("\n"),
    sessionMode: connect.stateful ? "stateful" : "stateless",
  };
}

export type Field = "url" | "command" | "name" | "token" | "clientId" | "clientSecret" | `input:${string}`;

export function validate(draft: Draft): Partial<Record<Field, string>> {
  const problems: Partial<Record<Field, string>> = {};
  const auth = draft.entry?.connect.kind === "remote" ? draft.entry.connect.auth : null;
  if (draft.kind === "remote") {
    if (!draft.url.trim()) problems.url = "Enter the server's URL";
    else if (!isHttpURL(draft.url)) problems.url = "Enter a full http:// or https:// URL";
    if (auth?.kind === "token" && !draft.token.trim()) problems.token = `Paste your ${auth.label.toLowerCase()}`;
    if (auth?.kind === "oauth-app") {
      if (!draft.clientId.trim()) problems.clientId = "Paste the app's client ID";
      if (!draft.clientSecret.trim()) problems.clientSecret = "Paste the app's client secret";
    }
  } else if (!draft.command.trim()) {
    problems.command = "Enter the program to start";
  }
  for (const input of entryInputs(draft)) {
    if (!draft.inputs[input.key]?.trim()) problems[`input:${input.key}`] = `Enter the ${input.label.toLowerCase()}`;
  }
  const name = draft.name.trim();
  if (!name) problems.name = "Name the connection";
  else if (!/^[a-zA-Z0-9_-]+$/.test(name)) problems.name = "Use letters, numbers, - and _ only";
  else if (name.includes("__")) problems.name = "Use one _ at a time; __ separates a connection from its tools";
  return problems;
}

export function entryInputs(draft: Draft): CatalogInput[] {
  return draft.entry?.connect.kind === "local" ? draft.entry.connect.inputs : [];
}

function isHttpURL(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

export function detectedProtocol(draft: Draft): Exclude<Transport, "stdio"> {
  if (draft.protocol !== "detect") return draft.protocol;
  try {
    return new URL(draft.url.trim()).pathname.replace(/\/+$/, "").endsWith("/sse") ? "sse" : "streamable_http";
  } catch {
    return "streamable_http";
  }
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function pairsToMap(pairs: Pair[]): Record<string, string> | undefined {
  const entries = pairs.filter((pair) => pair.key.trim()).map((pair) => [pair.key.trim(), pair.value] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function toInput(draft: Draft): NewConnection {
  const base = { name: draft.name.trim(), description: draft.description.trim() || undefined, session_mode: draft.sessionMode };
  if (draft.kind === "local") {
    const inputs = entryInputs(draft).map((input) => ({ ...input, value: draft.inputs[input.key]?.trim() ?? "" }));
    return {
      ...base,
      transport: "stdio",
      command: draft.command.trim(),
      args: [...lines(draft.args), ...inputs.filter((input) => input.kind === "arg").map((input) => input.value)],
      env: pairsToMap([...draft.env, ...inputs.filter((input) => input.kind === "env")]),
    };
  }
  const transport = detectedProtocol(draft);
  return {
    ...base,
    transport,
    url: draft.url.trim(),
    bearer_token: draft.token.trim() || undefined,
    headers: transport === "streamable_http" ? pairsToMap(draft.headers) : undefined,
    oauth_client_id: draft.clientId.trim() || undefined,
    oauth_client_secret: draft.clientSecret.trim() || undefined,
  };
}

const runners = new Set(["npx", "pnpx", "bunx", "uvx", "pipx", "docker", "node", "bun", "deno", "python", "python3", "uv", "pnpm"]);
const runnerVerbs = new Set(["run", "dlx", "exec", "x"]);

// Suggests a name from what the operator typed, until they type a name themselves:
// https://mcp.linear.app/mcp -> linear, npx -y @modelcontextprotocol/server-everything -> everything.
export function suggestName(draft: Draft): string {
  let source = "";
  if (draft.kind === "remote") {
    try {
      const host = new URL(draft.url.trim()).hostname;
      if (host === "localhost" || /^[\d.:[\]]+$/.test(host)) return "";
      const labels = host.split(".").filter((label) => !["www", "mcp", "api"].includes(label));
      source = labels.length > 1 ? labels[labels.length - 2] : (labels[0] ?? "");
    } catch {
      return "";
    }
  } else {
    const words = [draft.command.trim(), ...lines(draft.args)].filter((word) => word && !word.startsWith("-"));
    const base = (word: string) => word.split("/").pop() ?? "";
    let index = 0;
    if (runners.has(base(words[0] ?? ""))) {
      index = 1;
      while (runnerVerbs.has(words[index] ?? "")) index += 1;
    }
    source = base(words[index] ?? "")
      .replace(/@[^@]*$/, (version) => (version.length > 1 && /\d/.test(version) ? "" : version))
      .replace(/\.(js|mjs|ts|py)$/, "")
      .replace(/^(mcp[-_]server[-_]|server[-_]|mcp[-_])/, "")
      .replace(/([-_]mcp[-_]server|[-_]mcp|[-_]server)$/, "");
  }
  return source
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
}
