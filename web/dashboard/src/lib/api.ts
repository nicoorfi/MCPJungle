import type {
  AddConnectionResult,
  Connection,
  Diagnostics,
  NewConnection,
  OAuthSession,
  Prompt,
  Resource,
  Tool,
  ToolSet,
  ToolSetInput,
} from "./types";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/dashboard${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

const segment = encodeURIComponent;

export const api = {
  connections: () => request<{ servers: Connection[] }>("GET", "/servers").then((r) => r.servers),
  tools: () => request<{ tools: Tool[] }>("GET", "/tools").then((r) => r.tools),
  prompts: () => request<{ prompts: Prompt[] }>("GET", "/prompts").then((r) => r.prompts),
  resources: () => request<{ resources: Resource[] }>("GET", "/resources").then((r) => r.resources),
  diagnostics: () => request<Diagnostics>("GET", "/diagnostics"),
  toolSets: () => request<{ tool_groups: ToolSet[] }>("GET", "/tool-groups").then((r) => r.tool_groups),

  addConnection: (input: NewConnection) => request<AddConnectionResult>("POST", "/servers", input),
  oauthSession: (id: string) => request<OAuthSession>("GET", `/oauth/session/${segment(id)}`),
  deleteConnection: (connection: string) => request<unknown>("DELETE", `/servers/${segment(connection)}`),
  setConnectionEnabled: (connection: string, enabled: boolean) =>
    request<unknown>("PATCH", `/servers/${segment(connection)}/enabled`, { enabled }),
  setToolEnabled: (tool: string, enabled: boolean) =>
    request<unknown>("PATCH", `/tools/${segment(tool)}/enabled`, { enabled }),
  setPromptEnabled: (prompt: string, enabled: boolean) =>
    request<unknown>("PATCH", `/prompts/${segment(prompt)}/enabled`, { enabled }),

  createToolSet: (input: ToolSetInput & { name: string }) => request<ToolSet>("POST", "/tool-groups", input),
  updateToolSet: (set: string, input: ToolSetInput) => request<ToolSet>("PUT", `/tool-groups/${segment(set)}`, input),
  deleteToolSet: (set: string) => request<unknown>("DELETE", `/tool-groups/${segment(set)}`),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
