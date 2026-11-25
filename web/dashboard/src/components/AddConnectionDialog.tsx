import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { plural } from "@/lib/format";
import { href, navigate } from "@/lib/route";
import type { Connection, NewConnection, OAuthRequired, SessionMode, Tool, Transport } from "@/lib/types";
import { invalidate } from "@/lib/useFetch";
import { Dialog } from "./Dialog";
import { Choice, PairsField, RadioGroup, SecretField, TextField, type Pair } from "./fields";

type Kind = "remote" | "local";
type Protocol = "detect" | Exclude<Transport, "stdio">;

interface Draft {
  kind: Kind;
  url: string;
  token: string;
  headers: Pair[];
  protocol: Protocol;
  command: string;
  args: string;
  env: Pair[];
  name: string;
  nameEdited: boolean;
  description: string;
  sessionMode: SessionMode;
}

type Step =
  | { step: "form" }
  | { step: "authorize"; name: string; auth: OAuthRequired; opened: boolean; error: string }
  | { step: "done"; name: string; connection: Connection | null; tools: Tool[] };

const emptyDraft: Draft = {
  kind: "remote",
  url: "",
  token: "",
  headers: [],
  protocol: "detect",
  command: "",
  args: "",
  env: [],
  name: "",
  nameEdited: false,
  description: "",
  sessionMode: "stateless",
};

export function AddConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog onClose={onClose} open={open} titleId="add-connection-title">
      <AddConnection onClose={onClose} />
    </Dialog>
  );
}

function AddConnection({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState<Step>({ step: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const problems = validate(draft);
  const problem = (field: Field) => (submitted || touched[field] ? problems[field] : undefined);

  function update(patch: Partial<Draft>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      return next.nameEdited ? next : { ...next, name: suggestName(next) };
    });
  }

  async function finish(name: string) {
    invalidate();
    const [connections, tools] = await Promise.all([api.connections(), api.tools()]).catch(() => [[], []] as [Connection[], Tool[]]);
    setStep({
      step: "done",
      name,
      connection: connections.find((c) => c.name === name) ?? null,
      tools: tools.filter((tool) => tool.server === name),
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    setError("");
    const input = toInput(draft);
    try {
      const result = await api.addConnection(input);
      if (result.authorization_required) {
        setStep({ step: "authorize", name: input.name, auth: result.authorization_required, opened: false, error: "" });
      } else {
        await finish(input.name);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  // Poll the pending OAuth session once the operator opened the authorization
  // page. Only a new session restarts it; the draft is fixed while it runs.
  const polling = step.step === "authorize" && step.opened ? step.auth.session_id : "";
  useEffect(() => {
    if (!polling) return;
    let live = true;
    async function poll() {
      try {
        const session = await api.oauthSession(polling);
        if (!live || session.status === "pending") return;
        if (session.status === "completed") {
          live = false;
          await finish(session.server_name || draft.name);
          return;
        }
        const message = session.error || "Authorization did not complete. Start over to try again.";
        setStep((current) => (current.step === "authorize" ? { ...current, opened: false, error: message } : current));
      } catch (failure) {
        if (live) setStep((current) => (current.step === "authorize" ? { ...current, opened: false, error: errorMessage(failure) } : current));
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [polling]);

  if (step.step === "authorize") {
    return (
      <>
        <DialogHead onClose={onClose} title={`Authorize ${step.name}`} />
        <div className="dialog-body stack">
          <p className="lead">
            {step.name} signs in with OAuth. Approve access in your browser; this window continues on its own when you are done.
          </p>
          <div className="panel">
            <strong>{step.opened ? "Waiting for your approval…" : "Approval needed"}</strong>
            <p className="quiet-text">
              The link expires at {new Date(step.auth.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
            </p>
          </div>
          {step.error ? (
            <p className="field-error" role="alert">
              {step.error}
            </p>
          ) : null}
        </div>
        <div className="dialog-foot">
          <button className="button quiet" onClick={() => setStep({ step: "form" })} type="button">
            Start over
          </button>
          <button
            autoFocus
            className="button primary"
            onClick={() => {
              window.open(step.auth.authorization_url, "_blank", "noopener,noreferrer");
              setStep({ ...step, opened: true, error: "" });
            }}
            type="button"
          >
            {step.opened ? "Open again" : "Continue in browser"}
          </button>
        </div>
      </>
    );
  }

  if (step.step === "done") {
    const shown = step.tools.slice(0, 8);
    return (
      <>
        <DialogHead onClose={onClose} title={`${step.name} is connected`} />
        <div className="dialog-body stack">
          <p className="lead">{discoveredSentence(step.connection, step.tools.length)}</p>
          {shown.length > 0 ? (
            <ul className="name-list">
              {shown.map((tool) => (
                <li key={tool.canonical_name}>{tool.title}</li>
              ))}
              {step.tools.length > shown.length ? <li className="quiet-text">and {step.tools.length - shown.length} more</li> : null}
            </ul>
          ) : null}
        </div>
        <div className="dialog-foot">
          <button className="button quiet" onClick={onClose} type="button">
            Done
          </button>
          <button
            autoFocus
            className="button primary"
            onClick={() => {
              navigate(href.connection(step.name));
              onClose();
            }}
            type="button"
          >
            Open connection
          </button>
        </div>
      </>
    );
  }

  const blur = (field: Field) => () => setTouched((current) => ({ ...current, [field]: true }));

  return (
    <form className="dialog-form" noValidate onSubmit={submit}>
      <DialogHead onClose={onClose} title="Add a connection" />
      <div className="dialog-body stack">
        <fieldset className="choices">
          <legend className="visually-hidden">Kind of connection</legend>
          <Choice checked={draft.kind === "remote"} group="connection-kind" hint="A URL that speaks MCP" label="Remote server" onSelect={() => update({ kind: "remote" })} />
          <Choice
            checked={draft.kind === "local"}
            group="connection-kind"
            hint="A program Jungle runs on this machine"
            label="Local command"
            onSelect={() => update({ kind: "local" })}
          />
        </fieldset>

        {draft.kind === "remote" ? (
          <>
            <TextField
              autoComplete="off"
              error={problem("url")}
              label="URL"
              onBlur={blur("url")}
              onChange={(url) => update({ url })}
              required
              type="url"
              value={draft.url}
            />
            <SecretField label="Bearer token" onChange={(token) => update({ token })} value={draft.token} />
            {detectedProtocol(draft) === "streamable_http" ? (
              <PairsField
                addLabel="Add header"
                keyLabel="Header"
                label="Headers"
                onChange={(headers) => update({ headers })}
                pairs={draft.headers}
              />
            ) : null}
          </>
        ) : (
          <>
            <TextField
              autoComplete="off"
              error={problem("command")}
              hint="The program to start, without its arguments"
              label="Command"
              mono
              onBlur={blur("command")}
              onChange={(command) => update({ command })}
              required
              value={draft.command}
            />
            <div className="field">
              <label htmlFor="connection-args">
                Arguments <span className="optional">optional</span>
              </label>
              <p className="hint">One per line</p>
              <textarea
                className="mono"
                id="connection-args"
                onChange={(event) => update({ args: event.target.value })}
                rows={3}
                spellCheck={false}
                value={draft.args}
              />
            </div>
            <PairsField addLabel="Add variable" keyLabel="Variable" label="Environment" onChange={(env) => update({ env })} pairs={draft.env} />
          </>
        )}

        <TextField
          autoComplete="off"
          error={problem("name")}
          hint="Agents see its tools as name__tool"
          label="Name"
          onBlur={blur("name")}
          onChange={(name) => update({ name, nameEdited: true })}
          required
          value={draft.name}
        />
        <TextField label="Description" onChange={(description) => update({ description })} value={draft.description} />

        <details className="disclosure">
          <summary>Advanced</summary>
          <div className="stack">
            {draft.kind === "remote" ? (
              <RadioGroup
                label="Protocol"
                onChange={(protocol) => update({ protocol })}
                options={[
                  { value: "detect", label: "Detect from the URL" },
                  { value: "streamable_http", label: "Streamable HTTP" },
                  { value: "sse", label: "SSE" },
                ]}
                value={draft.protocol}
              />
            ) : null}
            <RadioGroup
              label="Sessions"
              onChange={(sessionMode) => update({ sessionMode })}
              options={[
                { value: "stateless", label: "A new session for each call" },
                { value: "stateful", label: "One session kept open", hint: "For servers that remember state between calls" },
              ]}
              value={draft.sessionMode}
            />
          </div>
        </details>

        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="dialog-foot">
        {busy ? <p className="quiet-text foot-note">Starting it and listing its tools…</p> : null}
        <button className="button quiet" onClick={onClose} type="button">
          Cancel
        </button>
        <button aria-busy={busy} className="button primary" disabled={busy} type="submit">
          {busy ? "Connecting…" : "Add connection"}
        </button>
      </div>
    </form>
  );
}

type Field = "url" | "command" | "name";

function validate(draft: Draft): Partial<Record<Field, string>> {
  const problems: Partial<Record<Field, string>> = {};
  if (draft.kind === "remote") {
    if (!draft.url.trim()) problems.url = "Enter the server's URL";
    else if (!isHttpURL(draft.url)) problems.url = "Enter a full http:// or https:// URL";
  } else if (!draft.command.trim()) {
    problems.command = "Enter the program to start";
  }
  const name = draft.name.trim();
  if (!name) problems.name = "Name the connection";
  else if (!/^[a-zA-Z0-9_-]+$/.test(name)) problems.name = "Use letters, numbers, - and _ only";
  else if (name.includes("__")) problems.name = "Use one _ at a time; __ separates a connection from its tools";
  return problems;
}

function isHttpURL(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

function detectedProtocol(draft: Draft): Exclude<Transport, "stdio"> {
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

function toInput(draft: Draft): NewConnection {
  const base = { name: draft.name.trim(), description: draft.description.trim() || undefined, session_mode: draft.sessionMode };
  if (draft.kind === "local") {
    return { ...base, transport: "stdio", command: draft.command.trim(), args: lines(draft.args), env: pairsToMap(draft.env) };
  }
  const transport = detectedProtocol(draft);
  return {
    ...base,
    transport,
    url: draft.url.trim(),
    bearer_token: draft.token.trim() || undefined,
    headers: transport === "streamable_http" ? pairsToMap(draft.headers) : undefined,
  };
}

const runners = new Set(["npx", "pnpx", "bunx", "uvx", "pipx", "docker", "node", "bun", "deno", "python", "python3", "uv", "pnpm"]);
const runnerVerbs = new Set(["run", "dlx", "exec", "x"]);

// Suggests a name from what the operator typed, until they type a name themselves:
// https://mcp.asana.com/sse -> asana, npx -y @modelcontextprotocol/server-everything -> everything.
function suggestName(draft: Draft): string {
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

function discoveredSentence(connection: Connection | null, toolCount: number): string {
  if (!connection) return "Agents can use its tools now.";
  if (toolCount === 0) return "It lists no tools yet. Agents see them here as soon as it does.";
  const parts = [plural(toolCount, "tool")];
  if (connection.prompt_count) parts.push(plural(connection.prompt_count, "prompt"));
  if (connection.resource_count) parts.push(plural(connection.resource_count, "resource"));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Jungle found ${list}. Agents can use them now.`;
}

function DialogHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="dialog-head">
      <h2 id="add-connection-title">{title}</h2>
      <button aria-label="Close" className="icon-button" onClick={onClose} type="button">
        <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
          <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  );
}
