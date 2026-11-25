import { useEffect, useState, useSyncExternalStore } from "react";
import { errorMessage } from "./api";

export type Fetched<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Refetches every mounted useFetch. Each keeps its data on screen until the new data arrives. */
export function invalidate() {
  revision += 1;
  listeners.forEach((listener) => listener());
}

/**
 * Loads `load()` once per `key` and again after each invalidate(). A failed
 * refetch keeps the data already shown; mutations report their own errors.
 * The second value patches the loaded data in place after a mutation succeeds.
 */
export function useFetch<T>(key: string, load: () => Promise<T>): [Fetched<T>, (patch: (data: T) => T) => void] {
  const current = useSyncExternalStore(subscribe, () => revision);
  const [state, setState] = useState<{ key: string; fetched: Fetched<T> }>({ key, fetched: { status: "loading" } });

  useEffect(() => {
    let live = true;
    load().then(
      (data) => {
        if (live) setState({ key, fetched: { status: "ready", data } });
      },
      (error: unknown) => {
        if (!live) return;
        setState((previous) =>
          previous.key === key && previous.fetched.status === "ready"
            ? previous
            : { key, fetched: { status: "error", error: errorMessage(error) } },
        );
      },
    );
    return () => {
      live = false;
    };
    // `load` is a fresh closure on every render; `key` names what it loads.
  }, [key, current]);

  const patch = (update: (data: T) => T) =>
    setState((previous) =>
      previous.fetched.status === "ready"
        ? { key: previous.key, fetched: { status: "ready", data: update(previous.fetched.data) } }
        : previous,
    );

  return [state.key === key ? state.fetched : { status: "loading" }, patch];
}

/** Ready when every input is ready; the first error wins. */
export function all<T extends unknown[]>(...items: { [K in keyof T]: Fetched<T[K]> }): Fetched<T> {
  const failed = items.find((item) => item.status === "error");
  if (failed) return failed as Fetched<T>;
  if (items.some((item) => item.status === "loading")) return { status: "loading" };
  return { status: "ready", data: items.map((item) => (item as { data: unknown }).data) as T };
}
