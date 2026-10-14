import { useEffect, useState } from "react";
import type { Project } from "../../src/shared/project";
import { api } from "./api";

export const formatDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${sec.toFixed(1)}s`;
};

const STATUS_LABEL: Record<Project["status"], string> = {
  draft: "Draft",
  preparing: "Preparing",
  transcribing: "Transcribing",
  planning: "AI editing",
  ready: "Ready",
  error: "Needs attention",
};

export function StatusPill({ project }: { project: Project }) {
  return <span className={`pill pill-${project.status}`}>{STATUS_LABEL[project.status]}</span>;
}

// Warns when an API key is missing, since the AI steps cannot run without it.
export function KeyBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    api
      .health()
      .then((h) =>
        setMissing([
          ...(h.elevenlabs ? [] : ["ELEVENLABS_API_KEY"]),
          ...(h.anthropic ? [] : ["ANTHROPIC_API_KEY"]),
        ]),
      )
      .catch(() => setMissing(["server"]));
  }, []);
  if (!missing.length) return null;
  if (missing[0] === "server") {
    return <div className="banner">The server is not running. Start it with npm run dev.</div>;
  }
  return (
    <div className="banner">
      Add {missing.join(" and ")} to the <code>.env</code> file, then restart <code>npm run dev</code>. Until
      then, videos can be uploaded but not transcribed or edited by AI.
    </div>
  );
}
