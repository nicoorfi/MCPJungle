import { Async, CopyValue, ScreenHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { endpoints, plural } from "@/lib/format";
import { useFetch } from "@/lib/useFetch";

export function SystemScreen() {
  const [diagnostics] = useFetch("diagnostics", api.diagnostics);

  return (
    <>
      <ScreenHeader summary="How this gateway runs and where agents reach it." title="System" />
      <Async fetched={diagnostics} what="system details">
        {(info) => (
          <>
            <section aria-labelledby="endpoints-heading" className="section">
              <h2 id="endpoints-heading">Endpoints</h2>
              <dl className="facts">
                <dt>Streamable HTTP</dt>
                <dd>
                  <CopyValue label="Streamable HTTP endpoint" value={endpoints.gateway()} />
                </dd>
                <dt>SSE</dt>
                <dd>
                  <CopyValue label="SSE endpoint" value={endpoints.sse()} />
                </dd>
                {info.metrics_endpoint ? (
                  <>
                    <dt>Metrics</dt>
                    <dd>
                      <CopyValue label="metrics endpoint" value={info.metrics_endpoint} />
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
            <section aria-labelledby="runtime-heading" className="section">
              <h2 id="runtime-heading">Runtime</h2>
              <dl className="facts">
                <dt>Version</dt>
                <dd className="mono">{info.version}</dd>
                <dt>Mode</dt>
                <dd>{info.mode === "development" ? "Development" : info.mode}</dd>
                <dt>Database</dt>
                <dd>{info.database === "sqlite" ? "SQLite" : info.database === "postgres" ? "PostgreSQL" : info.database}</dd>
                <dt>Connections</dt>
                <dd>{info.server_count}</dd>
                <dt>Available to agents</dt>
                <dd>
                  {[plural(info.tool_count, "tool"), plural(info.prompt_count, "prompt"), plural(info.resource_count, "resource")].join(" · ")}
                </dd>
              </dl>
            </section>
          </>
        )}
      </Async>
    </>
  );
}
