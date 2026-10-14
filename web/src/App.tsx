import { useEffect, useState } from "react";
import { Home } from "./Home";
import { Editor } from "./Editor";

const route = () => window.location.hash.match(/^#\/p\/([a-z0-9-]+)/)?.[1] ?? null;

export function App() {
  const [projectId, setProjectId] = useState(route);
  useEffect(() => {
    const onHash = () => setProjectId(route());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return projectId ? <Editor key={projectId} id={projectId} /> : <Home />;
}

export const openProject = (id: string) => (window.location.hash = `#/p/${id}`);
export const goHome = () => (window.location.hash = "#/");
