import { useEffect, useState } from "react";
import { AddConnectionDialog } from "@/components/AddConnectionDialog";
import { href, useRoute, type Route } from "@/lib/route";
import { Toast } from "@/lib/toast";
import { ConnectionScreen } from "@/screens/ConnectionScreen";
import { ConnectionsScreen } from "@/screens/ConnectionsScreen";
import { SetScreen } from "@/screens/SetScreen";
import { SetsScreen } from "@/screens/SetsScreen";
import { SystemScreen } from "@/screens/SystemScreen";

const sectionOf: Record<Route["screen"], "connections" | "sets" | null> = {
  connections: "connections",
  connection: "connections",
  sets: "sets",
  set: "sets",
  "new-set": "sets",
  system: null,
};

function titleOf(route: Route): string {
  switch (route.screen) {
    case "connection":
    case "set":
      return route.name;
    case "connections":
      return "Connections";
    case "sets":
      return "Tool sets";
    case "new-set":
      return "New tool set";
    case "system":
      return "System";
  }
}

export default function App() {
  const route = useRoute();
  const [adding, setAdding] = useState(false);
  const section = sectionOf[route.screen];
  const title = titleOf(route);

  useEffect(() => {
    document.title = `${title} · Jungle`;
    window.scrollTo(0, 0);
  }, [route, title]);

  return (
    <div className="shell">
      <header className="masthead">
        <a className="wordmark" href={href.connections}>
          Jungle
        </a>
        <nav aria-label="Main">
          <a aria-current={section === "connections" ? "page" : undefined} href={href.connections}>
            Connections
          </a>
          <a aria-current={section === "sets" ? "page" : undefined} href={href.sets}>
            Tool sets
          </a>
        </nav>
      </header>
      {/* Keyed by route, so each screen starts with fresh state and its own fetches. */}
      <main key={JSON.stringify(route)}>
        <Screen onAdd={() => setAdding(true)} route={route} />
      </main>
      <footer className="footer">
        <span>Gateway · {window.location.host}</span>
        <a aria-current={route.screen === "system" ? "page" : undefined} href={href.system}>
          System
        </a>
      </footer>
      <AddConnectionDialog onClose={() => setAdding(false)} open={adding} />
      <Toast />
    </div>
  );
}

function Screen({ route, onAdd }: { route: Route; onAdd: () => void }) {
  switch (route.screen) {
    case "connections":
      return <ConnectionsScreen onAdd={onAdd} />;
    case "connection":
      return <ConnectionScreen name={route.name} />;
    case "sets":
      return <SetsScreen />;
    case "set":
      return <SetScreen name={route.name} />;
    case "new-set":
      return <SetScreen />;
    case "system":
      return <SystemScreen />;
  }
}
