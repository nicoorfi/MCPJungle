// Dashboard API contracts (pkg/types/dashboard.go, internal/api/dashboard*.go).
// The API speaks of servers and tool groups; the UI calls them connections and
// tool sets. This file is the one place the two vocabularies meet.

export type Transport = "stdio" | "streamable_http" | "sse";
export type SessionMode = "stateless" | "stateful";

export interface ConnectionConfig {
  kind: Transport;
  target?: string;
  command?: string;
  env_keys?: string[];
  header_keys?: string[];
  session_mode?: SessionMode;
  description?: string;
}

/** A registered upstream MCP server. */
export interface Connection {
  name: string;
  transport: Transport;
  /** False while paused. */
  enabled: boolean;
  tool_count: number;
  /** Tools whose own switch is on, kept while the connection is paused. */
  enabled_tool_count: number;
  prompt_count: number;
  resource_count: number;
  config_summary: ConnectionConfig;
}

export interface Tool {
  name: string;
  /** `<server>__<tool>`, the name agents call. */
  canonical_name: string;
  title: string;
  server: string;
  description: string;
  enabled: boolean;
  server_enabled: boolean;
  input_schema?: { properties?: Record<string, unknown>; required?: string[] };
}

export interface Prompt {
  name: string;
  canonical_name: string;
  title: string;
  server: string;
  description: string;
  enabled: boolean;
  server_enabled: boolean;
  arguments?: Array<{ name?: string; required?: boolean }>;
}

export interface Resource {
  uri: string;
  name: string;
  server: string;
  description: string;
  mime_type?: string;
}

/** A tool group: an endpoint that serves only the tools it selects. */
export interface ToolSet {
  name: string;
  description?: string;
  included_tools: string[];
  included_servers: string[];
  excluded_tools: string[];
  tool_count: number;
  /** What the selection resolves to now. */
  tools: Array<{ canonical_name: string; server: string }>;
}

export interface ToolSetInput {
  description: string;
  tools: string[];
  servers: string[];
  excluded_tools: string[];
}

export interface Diagnostics {
  version: string;
  mode: string;
  config_source?: string;
  database: string;
  metrics_endpoint?: string;
  server_count: number;
  tool_count: number;
  prompt_count: number;
  resource_count: number;
}

export interface NewConnection {
  name: string;
  transport: Transport;
  description?: string;
  url?: string;
  bearer_token?: string;
  headers?: Record<string, string>;
  oauth_client_id?: string;
  oauth_client_secret?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  session_mode: SessionMode;
}

export interface OAuthRequired {
  session_id: string;
  authorization_url: string;
  expires_at: string;
}

export interface AddConnectionResult {
  name?: string;
  authorization_required?: OAuthRequired;
}

export interface OAuthSession {
  status: "pending" | "completed" | "failed" | "expired";
  server_name?: string;
  error?: string;
}
