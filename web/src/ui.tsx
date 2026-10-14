import { useEffect, useState } from "react";
import type { Project } from "../../src/shared/project";
import { api } from "./api";

export const formatDuration = (sec: number) => {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
};

// Script timecode: 0:07, 1:42
export const timecode = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

// The bias cut: a 9:16 frame sliced on a diagonal, the halves offset.
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M17 5H45V27L17 33Z" fill="currentColor" />
      <path d="M21 37L49 31V59H21Z" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ href = "#/" }: { href?: string }) {
  return (
    <a className="wordmark" href={href} aria-label="AI Editor, all edits">
      <Mark />
      <span>AI Editor</span>
    </a>
  );
}

const STATUS_WORD: Record<Project["status"], string> = {
  draft: "Draft",
  preparing: "Preparing",
  transcribing: "Transcribing",
  planning: "Cutting",
  ready: "Ready",
  error: "Needs attention",
};

export function StatusWord({ project }: { project: Project }) {
  return <span className={`status status-${project.status}`}>{STATUS_WORD[project.status]}</span>;
}

// Warns when an API key is missing, since the AI steps cannot run without it.
export function KeyStrip() {
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
    return (
      <p className="keystrip" role="status">
        The server is not running. Start it with <code>npm run dev</code>.
      </p>
    );
  }
  return (
    <details className="keystrip">
      <summary>
        AI is off until the API keys are added. <span className="keystrip-more">Show how</span>
      </summary>
      <p>
        Add {missing.map((k, i) => (
          <span key={k}>
            {i > 0 && " and "}
            <code>{k}</code>
          </span>
        ))}{" "}
        to <code>.env</code> in the AIEditor folder, then restart <code>npm run dev</code>. Until then videos upload
        but are not transcribed or cut.
      </p>
    </details>
  );
}
