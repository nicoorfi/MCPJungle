import { Async, Chevron, CopyValue, Mark, ScreenHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { availableTools, connectionSummary, endpoints, plural } from "@/lib/format";
import { href } from "@/lib/route";
import { useFetch } from "@/lib/useFetch";

export function ConnectionsScreen({ onAdd }: { onAdd: () => void }) {
  const [connections] = useFetch("connections", api.connections);
  const list = connections.status === "ready" ? connections.data : null;

  if (list?.length === 0) {
    return (
      <section className="empty">
        <h1>Connect your first MCP server</h1>
        <p className="lead">Jungle puts all your MCP servers behind one endpoint, so every agent gets the same tools from one place.</p>
        <button className="button primary" onClick={onAdd} type="button">
          Add connection
        </button>
        <div className="panel endpoint">
          <span className="label">Agents connect to</span>
          <CopyValue label="gateway endpoint" value={endpoints.gateway()} />
        </div>
      </section>
    );
  }

  const available = list?.reduce((sum, connection) => sum + availableTools(connection), 0) ?? 0;

  return (
    <>
      <ScreenHeader
        action={
          list ? (
            <button className="button" onClick={onAdd} type="button">
              Add connection
            </button>
          ) : null
        }
        summary={list ? `${plural(list.length, "connection")} · ${plural(available, "tool")} available to agents` : null}
        title="Connections"
      />
      <Async fetched={connections} what="connections">
        {(items) => (
          <>
            <ul className="rows">
              {items.map((connection) => (
                <li key={connection.name}>
                  <a className="row" href={href.connection(connection.name)}>
                    <Mark name={connection.name} />
                    <span className="row-text">
                      <strong>{connection.name}</strong>
                      <small>{connectionSummary(connection)}</small>
                    </span>
                    <span className="count">
                      {connection.enabled ? `${availableTools(connection)} / ${connection.tool_count} tools` : "Paused"}
                    </span>
                    <Chevron />
                  </a>
                </li>
              ))}
            </ul>
            <div className="panel endpoint">
              <span className="label">Agents connect to</span>
              <CopyValue label="gateway endpoint" value={endpoints.gateway()} />
            </div>
          </>
        )}
      </Async>
    </>
  );
}
