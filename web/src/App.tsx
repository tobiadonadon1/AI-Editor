import { useEffect, useState } from "react";
import { Home } from "./ui/Home";
import { NewProject } from "./ui/NewProject";
import { Editor } from "./ui/Editor";

type Route = { page: "home" } | { page: "new" } | { page: "editor"; id: string };

const parse = (): Route => {
  const h = window.location.hash;
  const m = h.match(/^#\/p\/([a-z0-9-]+)/i);
  if (m) return { page: "editor", id: m[1] };
  if (h.startsWith("#/new")) return { page: "new" };
  return { page: "home" };
};

export function App() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (route.page === "editor") return <Editor key={route.id} id={route.id} />;
  if (route.page === "new") return <NewProject />;
  return <Home />;
}
