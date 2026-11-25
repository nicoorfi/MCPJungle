import { useMemo, useSyncExternalStore } from "react";

// Hash routes, so a reload or the back button lands on the same screen and the
// Go server serves only `/`.
export type Route =
  | { screen: "connections" }
  | { screen: "connection"; name: string }
  | { screen: "sets" }
  | { screen: "set"; name: string }
  | { screen: "new-set" }
  | { screen: "system" };

// Tool set names may be "new", so creating one has its own route.
export const href = {
  connections: "#/connections",
  connection: (name: string) => `#/connections/${encodeURIComponent(name)}`,
  sets: "#/sets",
  set: (name: string) => `#/sets/${encodeURIComponent(name)}`,
  newSet: "#/new-set",
  system: "#/system",
};

export function parseRoute(hash: string): Route {
  const [screen, rawName] = hash.replace(/^#\/?/, "").split("/");
  let name = "";
  try {
    name = rawName ? decodeURIComponent(rawName) : "";
  } catch {
    return { screen: "connections" };
  }
  switch (screen) {
    case "connections":
      return name ? { screen: "connection", name } : { screen: "connections" };
    case "sets":
      return name ? { screen: "set", name } : { screen: "sets" };
    case "new-set":
      return { screen: "new-set" };
    case "system":
      return { screen: "system" };
    default:
      return { screen: "connections" };
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => parseRoute(hash), [hash]);
}

export function navigate(to: string) {
  window.location.hash = to;
}
