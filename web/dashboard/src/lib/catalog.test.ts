import assert from "node:assert/strict";
import test from "node:test";
import { brandFor, markInk, type Brand } from "./brands.ts";
import { catalog, searchCatalog, type CatalogEntry } from "./catalog.ts";
import { draftFrom, toInput, validate } from "./draft.ts";
import type { Connection, ConnectionConfig } from "./types.ts";

const entry = (id: string): CatalogEntry => {
  const found = catalog.find((candidate) => candidate.id === id);
  assert.ok(found, `catalog has ${id}`);
  return found;
};

test("every entry has a unique id that is a valid connection name and an https endpoint or a command", () => {
  assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
  for (const item of catalog) {
    assert.equal(validate(draftFrom(item)).name, undefined, item.id);
    assert.match(item.docs, /^https:\/\//, item.id);
    if (item.connect.kind === "remote") assert.match(item.connect.url, /^https:\/\//, item.id);
    else assert.ok(item.connect.command, item.id);
  }
});

test("a picked entry leaves only what the person holds to fill", () => {
  const left = (id: string) => Object.keys(validate(draftFrom(entry(id)))).sort();
  assert.deepEqual(left("linear"), []);
  assert.deepEqual(left("context7"), []);
  assert.deepEqual(left("fetch"), []);
  assert.deepEqual(left("github"), ["token"]);
  assert.deepEqual(left("asana"), ["clientId", "clientSecret"]);
  assert.deepEqual(left("filesystem"), ["input:folder"]);
});

test("filesystem with a folder becomes the official npx command with the folder last", () => {
  const draft = { ...draftFrom(entry("filesystem")), inputs: { folder: " /tmp " } };
  assert.deepEqual(validate(draft), {});
  assert.deepEqual(toInput(draft), {
    name: "filesystem",
    description: "Read and write files in one folder",
    session_mode: "stateless",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    env: undefined,
  });
});

test("an OAuth entry is its URL alone", () => {
  const linear = toInput(draftFrom(entry("linear")));
  assert.equal(linear.transport, "streamable_http");
  assert.equal(linear.url, "https://mcp.linear.app/mcp");
  assert.equal(linear.bearer_token, undefined);
  assert.equal(linear.oauth_client_id, undefined);
});

test("a token goes out as the bearer token, app credentials as the OAuth client", () => {
  const github = toInput({ ...draftFrom(entry("github")), token: "ghp_example\n" });
  assert.equal(github.bearer_token, "ghp_example");
  const asana = toInput({ ...draftFrom(entry("asana")), clientId: "123", clientSecret: "shh" });
  assert.deepEqual([asana.oauth_client_id, asana.oauth_client_secret, asana.bearer_token], ["123", "shh", undefined]);
});

test("an env input joins the environment the person added", () => {
  const withKey: CatalogEntry = {
    id: "example",
    name: "Example",
    description: "",
    docs: "https://example.com",
    connect: { kind: "local", command: "uvx", args: ["example-mcp"], inputs: [{ key: "EXAMPLE_KEY", label: "API key", hint: "", secret: true, kind: "env" }] },
  };
  const draft = { ...draftFrom(withKey), env: [{ key: "LOG", value: "1" }] };
  assert.deepEqual(Object.keys(validate(draft)), ["input:EXAMPLE_KEY"]);
  assert.deepEqual(toInput({ ...draft, inputs: { EXAMPLE_KEY: "k" } }).env, { LOG: "1", EXAMPLE_KEY: "k" });
});

test("search matches name or description, ignoring case", () => {
  assert.equal(searchCatalog("  ").length, catalog.length);
  assert.deepEqual(
    searchCatalog("ISSUES").map((item) => item.id),
    ["github", "sentry", "linear"],
  );
  assert.deepEqual(searchCatalog("nothing like this"), []);
});

const connection = (name: string, config: ConnectionConfig): Connection => ({
  name,
  transport: config.kind,
  enabled: true,
  tool_count: 0,
  enabled_tool_count: 0,
  prompt_count: 0,
  resource_count: 0,
  config_summary: config,
});

test("every catalog entry shows its brand", () => {
  for (const item of catalog) assert.equal(brandFor(item)?.id, item.id);
});

test("a connection is known by its endpoint before its name", () => {
  const remote = connection("work", { kind: "streamable_http", target: "https://api.githubcopilot.com/mcp/" });
  assert.equal(brandFor(remote)?.id, "github");
  const misnamed = connection("github", { kind: "sse", target: "https://mcp.linear.app/sse" });
  assert.equal(brandFor(misnamed)?.id, "linear");
  const local = connection("files", { kind: "stdio", command: "npx", target: "npx @modelcontextprotocol/server-filesystem /srv" });
  assert.equal(brandFor(local)?.id, "filesystem");
  const docs = connection("docs", { kind: "streamable_http", target: "https://sigmie.com/mcp" });
  assert.equal(brandFor(docs)?.id, "sigmie");
});

test("a custom install falls back to its name; anything else keeps the letter", () => {
  const everything = { kind: "stdio", command: "npx", target: "npx -y @modelcontextprotocol/server-everything" } as const;
  assert.equal(brandFor(connection("Asana", everything))?.id, "asana");
  assert.equal(brandFor(connection("google", everything))?.id, "google");
  assert.equal(brandFor(connection("whatsapp", everything))?.id, "whatsapp");
  assert.equal(brandFor(connection("telegram", everything))?.id, "telegram");
  assert.equal(brandFor(connection("everything", everything)), undefined);
  assert.equal(brandFor(connection("fetcher", { kind: "stdio", command: "npx", target: "npx mcp-server-fetch" })), undefined);
});

test("a brand color that vanishes on the canvas gives way to the foreground", () => {
  const brand = (id: string): Brand => {
    const found = brandFor(entry(id));
    assert.ok(found, id);
    return found;
  };
  assert.deepEqual(markInk(brand("github")), { light: "#181717", dark: null });
  assert.deepEqual(markInk(brand("sentry")), { light: "#362D59", dark: null });
  assert.deepEqual(markInk(brand("supabase")), { light: "#3FCF8E", dark: "#3FCF8E" });
  assert.deepEqual(markInk(brand("fetch")), { light: null, dark: null });
});
