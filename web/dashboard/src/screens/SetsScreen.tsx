import { Async, Chevron, Mark, ScreenHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { href } from "@/lib/route";
import type { ToolSet } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

export function SetsScreen() {
  const [sets] = useFetch("tool-sets", api.toolSets);
  const list = sets.status === "ready" ? sets.data : null;

  if (list?.length === 0) {
    return (
      <section className="empty">
        <h1>Give an agent only the tools it needs</h1>
        <p className="lead">
          A tool set is its own endpoint that serves just the tools you pick, from any connection. Point a focused agent at it and it never
          sees the rest.
        </p>
        <a className="button primary" href={href.newSet}>
          New tool set
        </a>
      </section>
    );
  }

  return (
    <>
      <ScreenHeader
        action={
          list ? (
            <a className="button" href={href.newSet}>
              New tool set
            </a>
          ) : null
        }
        summary="Each set is its own endpoint with only the tools you choose."
        title="Tool sets"
      />
      <Async fetched={sets} what="tool sets">
        {(items) => (
          <ul className="rows">
            {[...items]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((set) => (
                <li key={set.name}>
                  <a className="row" href={href.set(set.name)}>
                    <Mark name={set.name} />
                    <span className="row-text">
                      <strong>{set.name}</strong>
                      <small>{set.description || sources(set)}</small>
                    </span>
                    <span className="count">{plural(set.tool_count, "tool")}</span>
                    <Chevron />
                  </a>
                </li>
              ))}
          </ul>
        )}
      </Async>
    </>
  );
}

function sources(set: ToolSet): string {
  const names = [...new Set(set.tools.map((tool) => tool.server))].sort();
  return names.length ? `From ${names.join(", ")}` : "No tools";
}
