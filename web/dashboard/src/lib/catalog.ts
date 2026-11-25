// Well-known MCP servers the add-connection dialog offers before its custom
// form. Curated on purpose and shipped with the dashboard: the browser asks no
// outside registry. Each entry uses only the vendor's official endpoint or
// package, as its docs page states it.

export type RemoteAuth =
  /** The vendor registers Jungle as a client on its own; the person signs in in the browser. */
  | { kind: "oauth" }
  /** The vendor signs in only apps registered in its console, so the person brings that app's client ID and secret. */
  | { kind: "oauth-app"; consoleUrl: string }
  /** A token the person creates once. Jungle sends it as `Authorization: Bearer`. */
  | { kind: "token"; label: string; createUrl: string }
  | { kind: "none" };

export interface CatalogInput {
  /** The variable name for env; for arg, the key its value is kept under. */
  key: string;
  label: string;
  hint: string;
  secret: boolean;
  /** env becomes an environment variable; arg is appended after the entry's args. */
  kind: "env" | "arg";
}

export type Connect =
  | { kind: "remote"; url: string; auth: RemoteAuth }
  | {
      kind: "local";
      command: string;
      args: string[];
      inputs: CatalogInput[];
      /** Keep one process open, for servers that hold state between calls. */
      stateful?: true;
    };

export interface CatalogEntry {
  /** Also the connection name it suggests, and what "Added" matches against. */
  id: string;
  name: string;
  description: string;
  docs: string;
  connect: Connect;
}

export const catalog: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, issues and pull requests",
    docs: "https://github.com/github/github-mcp-server",
    // GitHub's OAuth needs an app per host and offers no self-registration.
    connect: {
      kind: "remote",
      url: "https://api.githubcopilot.com/mcp/",
      auth: { kind: "token", label: "Personal access token", createUrl: "https://github.com/settings/personal-access-tokens/new" },
    },
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Errors, issues and releases",
    docs: "https://mcp.sentry.dev",
    connect: { kind: "remote", url: "https://mcp.sentry.dev/mcp", auth: { kind: "oauth" } },
  },
  {
    id: "asana",
    name: "Asana",
    description: "Tasks, projects and comments",
    docs: "https://developers.asana.com/docs/using-asanas-mcp-server",
    connect: {
      kind: "remote",
      url: "https://mcp.asana.com/v2/mcp",
      auth: { kind: "oauth-app", consoleUrl: "https://app.asana.com/0/my-apps" },
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects and cycles",
    docs: "https://linear.app/docs/mcp",
    connect: { kind: "remote", url: "https://mcp.linear.app/mcp", auth: { kind: "oauth" } },
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages, databases and comments",
    docs: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
    connect: { kind: "remote", url: "https://mcp.notion.com/mcp", auth: { kind: "oauth" } },
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Projects, databases and edge functions",
    docs: "https://supabase.com/docs/guides/getting-started/mcp",
    connect: { kind: "remote", url: "https://mcp.supabase.com/mcp", auth: { kind: "oauth" } },
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, customers and billing",
    docs: "https://docs.stripe.com/mcp",
    connect: { kind: "remote", url: "https://mcp.stripe.com", auth: { kind: "oauth" } },
  },
  {
    id: "context7",
    name: "Context7",
    description: "Current docs for libraries and frameworks",
    docs: "https://github.com/upstash/context7",
    connect: { kind: "remote", url: "https://mcp.context7.com/mcp", auth: { kind: "none" } },
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "A headless browser agents can drive",
    docs: "https://github.com/microsoft/playwright-mcp",
    // Stateful, so the page an agent opened is still there on its next call.
    connect: { kind: "local", command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"], inputs: [], stateful: true },
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and write files in one folder",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    connect: {
      kind: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      inputs: [{ key: "folder", label: "Folder", hint: "An absolute path. Agents reach only files inside it", secret: false, kind: "arg" }],
    },
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Web pages as Markdown",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    connect: { kind: "local", command: "uvx", args: ["mcp-server-fetch"], inputs: [] },
  },
];

/** Entries whose name or description contains the query, in catalog order. */
export function searchCatalog(query: string): CatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return catalog;
  return catalog.filter((entry) => `${entry.name} ${entry.description}`.toLowerCase().includes(needle));
}
