import { useEffect, useRef, useState, type FormEvent } from "react";
import { DeleteDialog } from "@/components/Dialog";
import { TextField } from "@/components/fields";
import { Async, Chevron, CopyValue, Mark, ScreenHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { endpoints, plural } from "@/lib/format";
import { href, navigate } from "@/lib/route";
import {
  coverage,
  emptySelection,
  isAvailable,
  resolve,
  sameSelection,
  toggleConnection,
  toggleTool,
  withOffToolsExcluded,
  type Coverage,
  type Selection,
} from "@/lib/selection";
import { notify } from "@/lib/toast";
import type { Connection, Tool, ToolSet } from "@/lib/types";
import { all, invalidate, useFetch } from "@/lib/useFetch";

/** One tool set to edit, or a new one when `name` is absent. */
export function SetScreen({ name }: { name?: string }) {
  const [sets, patchSets] = useFetch("tool-sets", api.toolSets);
  const [connections] = useFetch("connections", api.connections);
  const [tools] = useFetch("tools", api.tools);

  return (
    <>
      <a className="back" href={href.sets}>
        <Chevron direction="left" />
        Tool sets
      </a>
      <Async fetched={all(sets, connections, tools)} what={name ? "this tool set" : "your tools"}>
        {([setList, connectionList, toolList]) => {
          const set = name ? setList.find((item) => item.name === name) : null;
          if (set === undefined) {
            return (
              <section className="empty">
                <h1>No tool set named {name}</h1>
                <p className="lead">It may have been deleted. The list shows every tool set.</p>
              </section>
            );
          }
          return (
            <SetEditor
              connections={connectionList}
              onSaved={(saved) => patchSets((list) => list.map((item) => (item.name === saved.name ? saved : item)))}
              set={set}
              taken={setList.map((item) => item.name)}
              tools={toolList}
            />
          );
        }}
      </Async>
    </>
  );
}

function selectionOf(set: ToolSet | null): Selection {
  return set ? { servers: set.included_servers, tools: set.included_tools, excluded: set.excluded_tools } : emptySelection;
}

function SetEditor({
  set,
  connections,
  tools,
  taken,
  onSaved,
}: {
  set: ToolSet | null;
  connections: Connection[];
  tools: Tool[];
  taken: string[];
  onSaved: (set: ToolSet) => void;
}) {
  const saved = selectionOf(set);
  const [draft, setDraft] = useState(saved);
  const [name, setName] = useState("");
  const [description, setDescription] = useState(set?.description ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const prepared = withOffToolsExcluded(draft, saved, tools);
  const effective = resolve(prepared, tools);
  const availableIn = (names: Set<string>) => tools.filter((tool) => names.has(tool.canonical_name) && isAvailable(tool)).length;
  const dirty = !set || !sameSelection(prepared, saved) || description.trim() !== (set.description ?? "");

  const toolsOf = (server: string) => tools.filter((tool) => tool.server === server).sort((a, b) => a.title.localeCompare(b.title));
  const [open, setOpen] = useState<string[]>(() =>
    connections.length === 1
      ? [connections[0].name]
      : connections.filter((c) => coverage(effective, toolsOf(c.name)) === "some").map((c) => c.name),
  );

  const nameProblem = set ? "" : validateName(name.trim(), taken);
  const pickProblem = effective.size === 0 ? "Pick at least one tool" : "";

  async function save(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (nameProblem || pickProblem) return;
    setBusy(true);
    setError("");
    const input = { description: description.trim(), tools: prepared.tools, servers: prepared.servers, excluded_tools: prepared.excluded };
    try {
      if (set) {
        const updated = await api.updateToolSet(set.name, input);
        onSaved(updated);
        setDraft(selectionOf(updated));
        setDescription(updated.description ?? "");
        setSubmitted(false);
      } else {
        await api.createToolSet({ name: name.trim(), ...input });
        notify(`Created ${name.trim()}`);
        navigate(href.set(name.trim()));
      }
      invalidate();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="set-form" noValidate onSubmit={save}>
      {set ? (
        <div className="detail-head">
          <Mark large name={set.name} />
          <div>
            <h1>{set.name}</h1>
            <p className="summary">
              {plural(set.tool_count, "tool")} · {availableIn(resolve(saved, tools))} available to agents
            </p>
          </div>
        </div>
      ) : (
        <ScreenHeader summary="Pick the tools one agent should see." title="New tool set" />
      )}

      {set ? (
        <div className="panel endpoint">
          <span className="label">Agents connect to</span>
          <CopyValue label="tool set endpoint" value={endpoints.toolSet(set.name)} />
        </div>
      ) : (
        <TextField
          error={submitted ? nameProblem : undefined}
          hint="Part of the endpoint URL, so letters, numbers, - and _"
          label="Name"
          onChange={setName}
          required
          value={name}
        />
      )}
      <TextField label="Description" onChange={setDescription} value={description} />

      <section aria-labelledby="pick-heading" className="section">
        <div className="section-head">
          <h2 id="pick-heading">Tools</h2>
          <span className="count">
            {effective.size} picked · {availableIn(effective)} available
          </span>
        </div>
        {connections.length === 0 ? (
          <p className="quiet-text">
            No connections yet. <a href={href.connections}>Add a connection</a> first, then pick its tools here.
          </p>
        ) : (
          <ul className="picker">
            {connections.map((connection) => {
              const own = toolsOf(connection.name);
              const covered = coverage(effective, own);
              return (
                <PickConnection
                  connection={connection}
                  covered={covered}
                  effective={effective}
                  key={connection.name}
                  onToggleAll={() => setDraft(toggleConnection(draft, connection.name, own, covered))}
                  onToggleOpen={() =>
                    setOpen((current) =>
                      current.includes(connection.name) ? current.filter((n) => n !== connection.name) : [...current, connection.name],
                    )
                  }
                  onToggleTool={(tool) => setDraft(toggleTool(draft, tool, effective.has(tool.canonical_name)))}
                  open={open.includes(connection.name)}
                  tools={own}
                  whole={prepared.servers.includes(connection.name)}
                />
              );
            })}
          </ul>
        )}
        {submitted && pickProblem ? (
          <p className="field-error" role="alert">
            {pickProblem}
          </p>
        ) : null}
      </section>

      {set ? (
        <div className="danger-zone">
          <button className="button danger-quiet" onClick={() => setDeleting(true)} type="button">
            Delete tool set
          </button>
        </div>
      ) : null}

      {dirty ? (
        <div className="action-bar">
          <div className="action-bar-inner">
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : (
              <p className="quiet-text">{set ? "Unsaved changes" : `${plural(effective.size, "tool")} picked`}</p>
            )}
            {set ? (
              <button
                className="button quiet"
                onClick={() => {
                  setDraft(saved);
                  setDescription(set.description ?? "");
                  setError("");
                }}
                type="button"
              >
                Discard
              </button>
            ) : null}
            <button aria-busy={busy} className="button primary" disabled={busy} type="submit">
              {busy ? "Saving…" : set ? "Save changes" : "Create tool set"}
            </button>
          </div>
        </div>
      ) : null}

      {set ? (
        <DeleteDialog
          confirm="Delete tool set"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.deleteToolSet(set.name);
            notify(`Deleted ${set.name}`);
            navigate(href.sets);
            invalidate();
          }}
          open={deleting}
          title={`Delete ${set.name}?`}
        >
          <p>Agents using its endpoint lose access to these tools. The connections and their tools stay as they are.</p>
        </DeleteDialog>
      ) : null}
    </form>
  );
}

function validateName(name: string, taken: string[]): string {
  if (!name) return "Name the tool set";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) return "Start with a letter or number; then use letters, numbers, - and _";
  if (taken.includes(name)) return "A tool set with this name exists";
  return "";
}

function PickConnection({
  connection,
  tools,
  effective,
  covered,
  whole,
  open,
  onToggleOpen,
  onToggleAll,
  onToggleTool,
}: {
  connection: Connection;
  tools: Tool[];
  effective: Set<string>;
  covered: Coverage;
  whole: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggleAll: () => void;
  onToggleTool: (tool: Tool) => void;
}) {
  const paused = !connection.enabled;
  const picked = tools.filter((tool) => effective.has(tool.canonical_name)).length;
  const summary = paused
    ? "Paused · resume it to pick its tools"
    : tools.length === 0
      ? "No tools"
      : `${picked} of ${tools.length} tools${whole ? " · new tools join automatically" : ""}`;
  const listId = `pick-${connection.name}`;

  return (
    <li className="pick">
      <div className="pick-head">
        <TriCheckbox
          disabled={paused || !tools.some(isAvailable)}
          label={`Every tool from ${connection.name}`}
          onChange={onToggleAll}
          state={covered}
        />
        <button aria-controls={listId} aria-expanded={open} className="pick-toggle" onClick={onToggleOpen} type="button">
          <Mark name={connection.name} />
          <span className="row-text">
            <strong>{connection.name}</strong>
            <small>{summary}</small>
          </span>
          <Chevron direction={open ? "down" : "right"} />
        </button>
      </div>
      {open ? (
        <ul className="pick-tools" id={listId}>
          {tools.map((tool) => (
            <li key={tool.canonical_name}>
              <label className="pick-tool">
                <input
                  checked={effective.has(tool.canonical_name)}
                  disabled={!isAvailable(tool)}
                  onChange={() => onToggleTool(tool)}
                  type="checkbox"
                />
                <span className="item-text">
                  <span className="item-title">{tool.title}</span>
                  {tool.description ? <span className="item-desc">{tool.description}</span> : null}
                </span>
                {isAvailable(tool) ? null : <span className="note">{paused ? "Paused" : "Excluded"}</span>}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TriCheckbox({ state, disabled, label, onChange }: { state: Coverage; disabled: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return <input aria-label={label} checked={state === "all"} disabled={disabled} onChange={onChange} ref={ref} type="checkbox" />;
}
