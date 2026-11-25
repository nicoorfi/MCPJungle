import { useSyncExternalStore } from "react";

// One short message after an action that leaves the screen it started on
// (a delete, a create). Actions that stay on screen show their result in place.
let message = "";
let timer = 0;
const listeners = new Set<() => void>();

export function notify(text: string) {
  message = text;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    message = "";
    listeners.forEach((listener) => listener());
  }, 3200);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function Toast() {
  const text = useSyncExternalStore(subscribe, () => message);
  return (
    <div aria-live="polite" className="toast" data-visible={text ? "" : undefined} role="status">
      {text}
    </div>
  );
}
