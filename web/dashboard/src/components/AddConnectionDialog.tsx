import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { brandFor } from "@/lib/brands";
import { searchCatalog, type CatalogEntry } from "@/lib/catalog";
import { detectedProtocol, draftFrom, emptyDraft, entryInputs, suggestName, toInput, validate, type Draft, type Field } from "@/lib/draft";
import { endpoints, plural } from "@/lib/format";
import { href, navigate } from "@/lib/route";
import type { Connection, OAuthRequired, Tool } from "@/lib/types";
import { invalidate, useFetch } from "@/lib/useFetch";
import { Dialog } from "./Dialog";
import { Choice, PairsField, RadioGroup, SecretField, TextField } from "./fields";
import { Chevron, CopyValue, Mark } from "./ui";

type Step =
  | { step: "pick" }
  | { step: "form" }
  | { step: "authorize"; name: string; auth: OAuthRequired; opened: boolean; error: string }
  | { step: "done"; name: string; connection: Connection | null; tools: Tool[] };

export function AddConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog onClose={onClose} open={open} titleId="add-connection-title">
      <AddConnection onClose={onClose} />
    </Dialog>
  );
}

function AddConnection({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState<Step>({ step: "pick" });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const problems = validate(draft);
  const problem = (field: Field) => (submitted || touched[field] ? problems[field] : undefined);

  function start(next: Draft) {
    setDraft(next);
    setTouched({});
    setSubmitted(false);
    setError("");
    setStep({ step: "form" });
  }

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

  if (step.step === "pick") {
    return <Picker onClose={onClose} onCustom={() => start(emptyDraft)} onPick={(entry) => start(draftFrom(entry))} onQuery={setQuery} query={query} />;
  }

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
  const entry = draft.entry;
  const auth = entry?.connect.kind === "remote" ? entry.connect.auth : null;
  const inputs = entryInputs(draft);
  // An entry focuses the first field the person still has to fill; with none left, the submit button.
  const needsNothing = entry !== null && auth?.kind !== "token" && auth?.kind !== "oauth-app" && inputs.length === 0;

  const remoteFields = (
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
      {auth?.kind === "token" || auth?.kind === "oauth-app" ? null : (
        <SecretField label="Bearer token" onChange={(token) => update({ token })} value={draft.token} />
      )}
      {detectedProtocol(draft) === "streamable_http" ? (
        <PairsField addLabel="Add header" keyLabel="Header" label="Headers" onChange={(headers) => update({ headers })} pairs={draft.headers} />
      ) : null}
    </>
  );

  const localFields = (
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
  );

  const connectFields = draft.kind === "remote" ? remoteFields : localFields;

  return (
    <form className="dialog-form" noValidate onSubmit={submit}>
      <DialogHead onClose={onClose} title={entry ? `Add ${entry.name}` : "Add a connection"} />
      <div className="dialog-body stack">
        {entry ? (
          <EntryHead entry={entry} />
        ) : (
          <fieldset className="choices">
            <legend className="visually-hidden">Kind of connection</legend>
            <Choice
              autoFocus
              checked={draft.kind === "remote"}
              group="connection-kind"
              hint="A URL that speaks MCP"
              label="Remote server"
              onSelect={() => update({ kind: "remote" })}
            />
            <Choice
              checked={draft.kind === "local"}
              group="connection-kind"
              hint="A program Jungle runs on this machine"
              label="Local command"
              onSelect={() => update({ kind: "local" })}
            />
          </fieldset>
        )}

        {entry ? null : connectFields}

        {entry && auth?.kind === "token" ? (
          <SecretField
            autoFocus
            error={problem("token")}
            hint={
              <a href={auth.createUrl} rel="noreferrer" target="_blank">
                Create one in your {entry.name} settings
              </a>
            }
            label={auth.label}
            onBlur={blur("token")}
            onChange={(token) => update({ token })}
            required
            value={draft.token}
          />
        ) : null}

        {entry && auth?.kind === "oauth-app" ? (
          <>
            <div className="panel app-setup">
              <p className="quiet-text">
                {entry.name} signs in only apps registered with it.{" "}
                <a href={auth.consoleUrl} rel="noreferrer" target="_blank">
                  Create an MCP app
                </a>
                , add this redirect URL to it, then paste its client ID and secret.
              </p>
              <CopyValue label="redirect URL" value={endpoints.oauthCallback()} />
            </div>
            <TextField
              autoComplete="off"
              autoFocus
              error={problem("clientId")}
              label="Client ID"
              mono
              onBlur={blur("clientId")}
              onChange={(clientId) => update({ clientId })}
              required
              value={draft.clientId}
            />
            <SecretField
              error={problem("clientSecret")}
              label="Client secret"
              onBlur={blur("clientSecret")}
              onChange={(clientSecret) => update({ clientSecret })}
              required
              value={draft.clientSecret}
            />
          </>
        ) : null}

        {inputs.map((input, index) => {
          const field: Field = `input:${input.key}`;
          const props = {
            autoFocus: index === 0,
            error: problem(field),
            hint: input.hint,
            label: input.label,
            onBlur: blur(field),
            onChange: (value: string) => update({ inputs: { ...draft.inputs, [input.key]: value } }),
            required: true,
            value: draft.inputs[input.key] ?? "",
          };
          return input.secret ? <SecretField key={input.key} {...props} /> : <TextField autoComplete="off" key={input.key} mono {...props} />;
        })}

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

        <details className="disclosure" open={entry && (problem("url") || problem("command")) ? true : undefined}>
          <summary>Advanced</summary>
          <div className="stack">
            {entry ? connectFields : null}
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
        <button className="button quiet" disabled={busy} onClick={() => setStep({ step: "pick" })} type="button">
          Back
        </button>
        <button aria-busy={busy} autoFocus={needsNothing} className="button primary" disabled={busy} type="submit">
          {busy ? "Connecting…" : "Add connection"}
        </button>
      </div>
    </form>
  );
}

/** The first step: a well-known server, or the custom form. A server already added opens instead. */
function Picker({
  query,
  onQuery,
  onPick,
  onCustom,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  onPick: (entry: CatalogEntry) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const [connections] = useFetch("connections", api.connections);
  const added = new Set(connections.status === "ready" ? connections.data.map((connection) => connection.name) : []);
  const matches = searchCatalog(query);
  const search = useRef<HTMLInputElement>(null);

  // An effect, not autoFocus: on first open the dialog becomes modal only after React's autoFocus ran.
  useEffect(() => search.current?.focus(), []);

  function choose(entry: CatalogEntry) {
    if (!added.has(entry.id)) return onPick(entry);
    navigate(href.connection(entry.id));
    onClose();
  }

  return (
    <>
      <DialogHead onClose={onClose} title="Add a connection" />
      <div className="dialog-body stack">
        <div className="field">
          <label htmlFor="catalog-search">Search</label>
          <input
            autoComplete="off"
            id="catalog-search"
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !query.trim() || !matches[0]) return;
              event.preventDefault();
              choose(matches[0]);
            }}
            ref={search}
            spellCheck={false}
            type="search"
            value={query}
          />
        </div>
        {matches.length > 0 ? (
          <ul className="rows">
            {matches.map((entry) => (
              <li key={entry.id}>
                <button className="row" onClick={() => choose(entry)} type="button">
                  <Mark brand={brandFor(entry)} name={entry.id} />
                  <span className="row-text">
                    <strong>{entry.name}</strong>
                    <small>{entry.description}</small>
                  </span>
                  {added.has(entry.id) ? <span className="note">Added</span> : null}
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet-text">No listed server matches “{query.trim()}”.</p>
        )}
      </div>
      <div className="dialog-foot">
        <p className="quiet-text foot-note">Not listed? Any MCP server works by URL or command.</p>
        <button className="button" onClick={onCustom} type="button">
          Custom connection
        </button>
      </div>
    </>
  );
}

function EntryHead({ entry }: { entry: CatalogEntry }) {
  return (
    <div className="entry-head">
      <Mark brand={brandFor(entry)} name={entry.id} />
      <span className="row-text">
        <span>{entry.description}</span>
        <small>{howItConnects(entry)}</small>
      </span>
      <a href={entry.docs} rel="noreferrer" target="_blank">
        Docs
      </a>
    </div>
  );
}

function howItConnects(entry: CatalogEntry): string {
  const connect = entry.connect;
  if (connect.kind === "local") return `Jungle runs it on this machine with ${connect.command}`;
  switch (connect.auth.kind) {
    case "oauth":
      return `You sign in to ${entry.name} in your browser next`;
    case "oauth-app":
      return `You sign in to ${entry.name} through an app you register`;
    case "token":
      return "Connects with a token you create";
    case "none":
      return "Needs no sign-in";
  }
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
