// Thin-stroke icons in the manner of a desktop NLE, 16px grid.
const P: Record<string, string> = {
  play: "M5 3.5v9l7-4.5z",
  pause: "M5 3.5h2v9H5zM9 3.5h2v9H9z",
  stepBack: "M11 4L6 8l5 4zM5 4v8",
  stepFwd: "M5 4l5 4-5 4zM11 4v8",
  toStart: "M4 4v8M12 4L7 8l5 4z",
  toEnd: "M12 4v8M4 4l5 4-5 4z",
  markIn: "M6 3H4v10h2",
  markOut: "M10 3h2v10h-2",
  goIn: "M4 3v10M13 4L8 8l5 4z",
  goOut: "M12 3v10M3 4l5 4-5 4z",
  select: "M4 2.5l8 6.2-3.6.6 2.2 4.2-1.6.8-2.2-4.3L4 12.6z",
  razor: "M3 13l7.5-7.5M9 3.5l3.5 3.5M5.5 3a2 2 0 1 1 0 .01M3 6.5a2 2 0 1 1 0 .01",
  type: "M3.5 4V3h9v1M8 3v10M6 13h4",
  hand: "M5 8V4.5a1 1 0 0 1 2 0V8M7 7.5V3.5a1 1 0 0 1 2 0v4M9 7.5V4.5a1 1 0 0 1 2 0V9M11 7.5a1 1 0 0 1 2 0V10a4 4 0 0 1-4 4H8a4 4 0 0 1-3.3-1.8L2.8 9.4a1 1 0 0 1 1.6-1.1L5 9",
  magnet: "M4 3h2.5v5a1.5 1.5 0 0 0 3 0V3H12v5a4 4 0 0 1-8 0zM4 5.5h2.5M9.5 5.5H12",
  link: "M6.5 9.5l3-3M5 7.5L3.8 8.7a2.3 2.3 0 0 0 3.3 3.3L8.3 10.8M11 8.5l1.2-1.2a2.3 2.3 0 0 0-3.3-3.3L7.7 5.2",
  marker: "M4.5 2.5h7v8L8 13.5l-3.5-3z",
  wrench: "M10.5 2.5a3 3 0 0 0-2.8 4L2.8 11.4a1.2 1.2 0 0 0 1.7 1.7l4.9-4.9a3 3 0 0 0 4-2.8l-1.8 1.8-1.7-.4-.4-1.7z",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  eyeOff: "M2 2l12 12M6.4 4A6.5 6.5 0 0 1 14.5 8a10 10 0 0 1-1.8 2.3M10 11.9A6.3 6.3 0 0 1 1.5 8 10.4 10.4 0 0 1 4 5",
  lock: "M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2",
  unlock: "M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 0 1 3.9-.6",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  folder: "M2 4.5h4l1.5 1.5H14v7H2z",
  film: "M2.5 3.5h11v9h-11zM5 3.5v9M11 3.5v9M2.5 6.5H5M2.5 9.5H5M11 6.5h2.5M11 9.5h2.5",
  image: "M2.5 3.5h11v9h-11zM2.5 10.5l3.5-3 3 2.5 2-1.5 2.5 2M10.5 6a1 1 0 1 0 0 .01",
  music: "M6 12V4l7-1.5v8M6 12a1.6 1.6 0 1 1-3.2 0A1.6 1.6 0 0 1 6 12zM13 10.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z",
  search: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5",
  list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h1M2.5 8h1M2.5 12h1",
  grid: "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z",
  chevronDown: "M4 6l4 4 4-4",
  chevronRight: "M6 4l4 4-4 4",
  close: "M4 4l8 8M12 4l-8 8",
  undo: "M5 6.5H10a3 3 0 0 1 0 6H6.5M5 6.5L7.5 4M5 6.5L7.5 9",
  redo: "M11 6.5H6a3 3 0 0 0 0 6h3.5M11 6.5L8.5 4M11 6.5L8.5 9",
  share: "M8 2.5v8M5 5.5l3-3 3 3M3.5 9v4h9V9",
  home: "M2.5 7.5L8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5",
  chat: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
  send: "M2.5 8L13.5 3 10 13.5 8 9z M8 9l5.5-6",
  mic: "M8 2.5a2 2 0 0 1 2 2V8a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2zM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5",
  stop: "M4.5 4.5h7v7h-7z",
  camera: "M2.5 5h2.5l1-1.5h4l1 1.5h2.5v7.5h-11zM8 6.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z",
  fullscreen: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  safe: "M2.5 3.5h11v9h-11zM4.5 5.5h7v5h-7z",
  settings: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9",
  wave: "M2 8h1M4 5v6M6 3v10M8 6v4M10 4v8M12 6v4M14 8h-1",
  menu: "M3 4.5h10M3 8h10M3 11.5h10",
  alignL: "M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7",
  alignC: "M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7",
  alignR: "M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7",
  color: "M8 2.5a5.5 5.5 0 1 0 0 11c1 0 1.5-.6 1.5-1.3 0-.9-.8-1.2-.8-2 0-.7.6-1.2 1.4-1.2h1.4a2 2 0 0 0 2-2c0-2.5-2.5-4.5-5.5-4.5zM5 7.5a.8.8 0 1 0 0 .01M7 5a.8.8 0 1 0 0 .01M10 5.5a.8.8 0 1 0 0 .01",
  sparkle: "M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z",
  zoomIn: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5M5 7h4M7 5v4",
  zoomOut: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5M5 7h4",
  split: "M8 2v12M4 5l-2 3 2 3M12 5l2 3-2 3",
  captions: "M2.5 4h11v8h-11zM5 9.5h2M8.5 9.5h2.5M5 7h6",
  graphics: "M3 3h5v5H3zM10.5 8.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM11 2.5l2.5 4h-5z",
  sliders: "M3 4h5M11 4h2M3 8h2M8 8h5M3 12h7M13 12h0M9.5 2.5v3M6.5 6.5v3M11.5 10.5v3",
  dot: "M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  check: "M3.5 8.5l3 3 6-7",
  upload: "M8 10.5v-8M5 5.5l3-3 3 3M3 10v3.5h10V10",
  download: "M8 2.5v8M5 7.5l3 3 3-3M3 12v1.5h10V12",
  edit: "M10.5 2.5l3 3-8 8H2.5v-3z",
};

export function Icon({ name, size = 16, className, title }: { name: keyof typeof P | string; size?: number; className?: string; title?: string }) {
  const filled = name === "play" || name === "pause" || name === "stop" || name === "dot" || name === "marker";
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      {title && <title>{title}</title>}
      <path d={P[name] ?? ""} />
    </svg>
  );
}

// The app mark: a 9:16 frame cut on the bias, kept from the earlier brand work.
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2d6bd8" />
      <path d="M19 9H43V29L19 34Z" fill="#fff" />
      <path d="M22 38L46 33V55H22Z" fill="#fff" />
    </svg>
  );
}
