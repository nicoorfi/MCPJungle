import assert from "node:assert/strict";
import test from "node:test";
import { catalog, searchCatalog, type CatalogEntry } from "./catalog.ts";
import { draftFrom, toInput, validate } from "./draft.ts";

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
