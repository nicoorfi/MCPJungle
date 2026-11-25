import { useState, type ReactNode } from "react";
import { DeleteDialog } from "@/components/Dialog";
import { Async, Chevron, CopyValue, Mark } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { brandFor } from "@/lib/brands";
import { availableTools, plural, transportLabels } from "@/lib/format";
import { href, navigate } from "@/lib/route";
import { notify } from "@/lib/toast";
import type { Connection, Prompt, Resource, Tool } from "@/lib/types";
import { invalidate, useFetch } from "@/lib/useFetch";

export function ConnectionScreen({ name }: { name: string }) {
  const [connections, patchConnections] = useFetch("connections", api.connections);
  const [tools, patchTools] = useFetch("tools", api.tools);
  const [prompts, patchPrompts] = useFetch("prompts", api.prompts);
  const [resources] = useFetch("resources", api.resources);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const back = (
    <a className="back" href={href.connections}>
      <Chevron direction="left" />
      Connections
    </a>
  );

  if (connections.status !== "ready") {
    return (
      <>
        {back}
        <Async fetched={connections} what="this connection">
          {() => null}
        </Async>
      </>
    );
  }

  const connection = connections.data.find((item) => item.name === name);
  if (!connection) {
    return (
      <>
        {back}
        <section className="empty">
          <h1>No connection named {name}</h1>
          <p className="lead">It may have been deleted. The list shows every connection Jungle has.</p>
        </section>
      </>
    );
  }

  // Runs one mutation, then patches what it changed so the screen does not wait
  // for the refetch that follows.
  async function run(key: string, action: () => Promise<void>) {
    setBusy((current) => ({ ...current, [key]: true }));
    setError("");
    try {
      await action();
      invalidate();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(({ [key]: _, ...rest }) => rest);
    }
  }

  const enabled = connection.enabled;
  const togglePause = () =>
    run("pause", async () => {
      await api.setConnectionEnabled(name, !enabled);
      patchConnections((list) => list.map((item) => (item.name === name ? { ...item, enabled: !enabled } : item)));
    });

  const toggleTool = (tool: Tool) =>
    run(tool.canonical_name, async () => {
      await api.setToolEnabled(tool.canonical_name, !tool.enabled);
      patchTools((list) => list.map((item) => (item.canonical_name === tool.canonical_name ? { ...item, enabled: !tool.enabled } : item)));
      refocus(tool.canonical_name);
    });

  const togglePrompt = (prompt: Prompt) =>
    run(prompt.canonical_name, async () => {
      await api.setPromptEnabled(prompt.canonical_name, !prompt.enabled);
      patchPrompts((list) =>
        list.map((item) => (item.canonical_name === prompt.canonical_name ? { ...item, enabled: !prompt.enabled } : item)),
      );
      refocus(prompt.canonical_name);
    });

  return (
    <>
      {back}
      <div className="detail-head">
        <Mark brand={brandFor(connection)} large name={name} />
        <div>
          <h1>{name}</h1>
          {connection.config_summary.description ? <p className="summary">{connection.config_summary.description}</p> : null}
        </div>
      </div>

      <section aria-label="Status" className="panel status">
        <div>
          <strong>{enabled ? "Enabled" : "Paused"}</strong>
          <p className="quiet-text">{statusLine(connection)}</p>
        </div>
        <button aria-busy={busy.pause} className="button" disabled={busy.pause} onClick={togglePause} type="button">
          {busy.pause ? (enabled ? "Pausing…" : "Resuming…") : enabled ? "Pause" : "Resume"}
        </button>
      </section>

      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="tools-heading" className="section">
        <h2 id="tools-heading">Tools</h2>
        <Async fetched={tools} what="tools">
          {(all) => (
            <ToolLists
              busy={busy}
              paused={!enabled}
              onToggle={toggleTool}
              tools={all.filter((tool) => tool.server === name).sort((a, b) => a.title.localeCompare(b.title))}
            />
          )}
        </Async>
      </section>

      <Async fetched={prompts} what="prompts">
        {(all) => <PromptList busy={busy} onToggle={togglePrompt} prompts={all.filter((prompt) => prompt.server === name)} />}
      </Async>

      <Async fetched={resources} what="resources">
        {(all) => <ResourceList resources={all.filter((resource) => resource.server === name)} />}
      </Async>

      <TechnicalDetails connection={connection} />

      <div className="danger-zone">
        <button className="button danger-quiet" onClick={() => setDeleting(true)} type="button">
          Delete connection
        </button>
      </div>

      <DeleteDialog
        confirm="Delete connection"
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await api.deleteConnection(name);
          notify(`Deleted ${name}`);
          navigate(href.connections);
          invalidate();
        }}
        open={deleting}
        title={`Delete ${name}?`}
      >
        <p>
          Agents lose its {plural(connection.tool_count, "tool")}, and tool sets that use them lose them too. You can add it again
          later.
        </p>
      </DeleteDialog>
    </>
  );
}

function statusLine(connection: Connection): string {
  if (connection.enabled) return `${plural(availableTools(connection), "tool")} available to agents`;
  const kept = connection.enabled_tool_count;
  return kept > 0 ? `No tools available to agents · ${kept} stay selected for when you resume` : "No tools available to agents";
}

// A switched tool moves between the Tools and Excluded lists; keep focus on it.
function refocus(canonicalName: string) {
  window.requestAnimationFrame(() => document.getElementById(switchId(canonicalName))?.focus({ preventScroll: true }));
}

const switchId = (canonicalName: string) => `switch-${canonicalName}`;

function ToolLists({
  tools,
  busy,
  paused,
  onToggle,
}: {
  tools: Tool[];
  busy: Record<string, boolean>;
  paused: boolean;
  onToggle: (tool: Tool) => void;
}) {
  if (tools.length === 0) return <p className="quiet-text">This connection lists no tools.</p>;
  const on = tools.filter((tool) => tool.enabled);
  const excluded = tools.filter((tool) => !tool.enabled);
  const row = (tool: Tool) => (
    <Item
      busy={busy[tool.canonical_name]}
      checked={tool.enabled}
      description={tool.description}
      key={tool.canonical_name}
      name={tool.canonical_name}
      onToggle={() => onToggle(tool)}
      title={tool.title}
    >
      <CopyValue label="tool name" value={tool.canonical_name} />
      <Inputs names={Object.keys(tool.input_schema?.properties ?? {})} required={tool.input_schema?.required ?? []} />
    </Item>
  );
  return (
    <>
      {paused ? <p className="quiet-text">Paused. Changes here apply when you resume.</p> : null}
      {on.length > 0 ? <ul className="items">{on.map(row)}</ul> : <p className="quiet-text">Every tool is excluded.</p>}
      {excluded.length > 0 ? (
        <>
          <h3 className="subhead">
            Excluded <span className="count">{excluded.length}</span>
          </h3>
          <ul className="items">{excluded.map(row)}</ul>
        </>
      ) : null}
    </>
  );
}

function PromptList({ prompts, busy, onToggle }: { prompts: Prompt[]; busy: Record<string, boolean>; onToggle: (prompt: Prompt) => void }) {
  if (prompts.length === 0) return null;
  return (
    <section aria-labelledby="prompts-heading" className="section">
      <h2 id="prompts-heading">Prompts</h2>
      <ul className="items">
        {prompts.map((prompt) => (
          <Item
            busy={busy[prompt.canonical_name]}
            checked={prompt.enabled}
            description={prompt.description}
            key={prompt.canonical_name}
            name={prompt.canonical_name}
            onToggle={() => onToggle(prompt)}
            title={prompt.title}
          >
            <CopyValue label="prompt name" value={prompt.canonical_name} />
            <Inputs
              names={(prompt.arguments ?? []).flatMap((argument) => (argument.name ? [argument.name] : []))}
              required={(prompt.arguments ?? []).flatMap((argument) => (argument.name && argument.required ? [argument.name] : []))}
            />
          </Item>
        ))}
      </ul>
    </section>
  );
}

function ResourceList({ resources }: { resources: Resource[] }) {
  if (resources.length === 0) return null;
  return (
    <section aria-labelledby="resources-heading" className="section">
      <h2 id="resources-heading">Resources</h2>
      <ul className="items">
        {resources.map((resource) => (
          <Item description={resource.description} key={resource.uri} name={resource.uri} title={resource.name}>
            <CopyValue label="resource URI" value={resource.uri} />
            {resource.mime_type ? <p className="quiet-text">{resource.mime_type}</p> : null}
          </Item>
        ))}
      </ul>
    </section>
  );
}

function Item({
  name,
  title,
  description,
  checked,
  busy,
  onToggle,
  children,
}: {
  name: string;
  title: string;
  description: string;
  checked?: boolean;
  busy?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <li className="item">
      <details>
        <summary>
          <span className="item-text">
            <span className="item-title">{title}</span>
            {description ? <span className="item-desc">{description}</span> : null}
          </span>
          <Chevron direction="down" />
        </summary>
        <div className="item-more">{children}</div>
      </details>
      {onToggle ? (
        <input
          aria-busy={busy}
          aria-label={`${title}, available to agents`}
          checked={checked}
          className="switch"
          disabled={busy}
          id={switchId(name)}
          onChange={onToggle}
          role="switch"
          type="checkbox"
        />
      ) : null}
    </li>
  );
}

function Inputs({ names, required }: { names: string[]; required: string[] }) {
  if (names.length === 0) return <p className="quiet-text">Takes no input</p>;
  const needed = names.filter((name) => required.includes(name));
  const optional = names.filter((name) => !required.includes(name));
  return (
    <dl className="facts compact">
      {needed.length > 0 ? (
        <>
          <dt>Requires</dt>
          <dd className="chips">{needed.map(chip)}</dd>
        </>
      ) : null}
      {optional.length > 0 ? (
        <>
          <dt>Optional</dt>
          <dd className="chips">{optional.map(chip)}</dd>
        </>
      ) : null}
    </dl>
  );
}

const chip = (name: string) => <code key={name}>{name}</code>;

function TechnicalDetails({ connection }: { connection: Connection }) {
  const config = connection.config_summary;
  const local = connection.transport === "stdio";
  return (
    <details className="disclosure technical">
      <summary>Technical details</summary>
      <dl className="facts">
        <dt>Transport</dt>
        <dd>{transportLabels[connection.transport]}</dd>
        {config.target ? (
          <>
            <dt>{local ? "Command" : "URL"}</dt>
            <dd>
              <CopyValue label={local ? "command" : "URL"} value={config.target} />
            </dd>
          </>
        ) : null}
        {config.env_keys?.length ? (
          <>
            <dt>Environment</dt>
            <dd className="chips">{config.env_keys.map(chip)}</dd>
          </>
        ) : null}
        {config.header_keys?.length ? (
          <>
            <dt>Headers</dt>
            <dd className="chips">{config.header_keys.map(chip)}</dd>
          </>
        ) : null}
        <dt>Sessions</dt>
        <dd>{config.session_mode === "stateful" ? "One session kept open" : "A new session for each call"}</dd>
      </dl>
    </details>
  );
}
