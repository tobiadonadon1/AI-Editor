// The project file is the single source of truth for an edit.
// The AI writes it, the editor UI changes it, and Remotion renders it.

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export type WordKind = "word" | "audio_event";

export interface Word {
  id: string;
  text: string;
  start: number; // seconds in the source video
  end: number;
  kind: WordKind;
}

export const CUT_REASONS = [
  "retake",
  "false_start",
  "filler",
  "stumble",
  "off_brief",
  "manual",
] as const;
export type CutReason = (typeof CUT_REASONS)[number];

export interface EditSettings {
  maxPauseSec: number; // pauses longer than this are cut out
  padBeforeSec: number; // breathing room kept before a phrase
  padAfterSec: number; // breathing room kept after a phrase
}

export interface CaptionStyle {
  highlightColor: string;
  emphasisColor: string;
  position: "lower" | "center";
  maxWordsPerPage: number;
  uppercase: boolean;
}

export interface Edit {
  cuts: Record<string, CutReason>; // word id -> why it was removed
  emphasis: string[]; // word ids shown as key words in captions
  settings: EditSettings;
  captionStyle: CaptionStyle;
  summary?: string; // the AI's description of what it did
}

export interface SourceMedia {
  originalName: string;
  width: number;
  height: number;
  durationSec: number;
}

export type ProjectStatus =
  | "draft"
  | "preparing"
  | "transcribing"
  | "planning"
  | "ready"
  | "error";

export interface RenderState {
  status: "idle" | "rendering" | "done" | "error";
  progress: number;
  error?: string;
  finishedAt?: string;
  stale?: boolean; // the edit changed after this export
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  brief: string;
  status: ProjectStatus;
  statusDetail?: string;
  error?: string;
  source?: SourceMedia;
  language?: string;
  words: Word[];
  edit: Edit;
  render: RenderState;
}

export const DEFAULT_SETTINGS: EditSettings = {
  maxPauseSec: 0.35,
  padBeforeSec: 0.08,
  padAfterSec: 0.14,
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  highlightColor: "#FFE14D",
  emphasisColor: "#5CE1FF",
  position: "lower",
  maxWordsPerPage: 3,
  uppercase: true,
};

export const emptyEdit = (): Edit => ({
  cuts: {},
  emphasis: [],
  settings: { ...DEFAULT_SETTINGS },
  captionStyle: { ...DEFAULT_CAPTION_STYLE },
});

// Props passed to the Remotion composition, both in the browser player and when rendering.
export interface EditVideoProps {
  project: Project;
  videoSrc: string;
  [key: string]: unknown;
}
