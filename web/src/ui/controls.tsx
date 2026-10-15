import { useEffect, useRef, useState, type ReactNode } from "react";
import { FPS } from "../../../src/shared/project";
import { Icon } from "./Icons";

// SMPTE timecode, HH:MM:SS:FF at 30 fps.
export function tc(sec: number) {
  const f = Math.max(0, Math.round(sec * FPS));
  const ff = f % FPS;
  const s = Math.floor(f / FPS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
}
export const shortTc = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
export const secs = (sec: number) => `${sec.toFixed(1)} s`;

// Premiere's "hot text": a blue number you drag left/right to change, or click to type.
export function HotNumber({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  digits = 1,
  unit = "",
  label,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  unit?: string;
  label?: string;
  width?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const shown = Number.isFinite(value) ? value.toFixed(digits) : "–";

  if (editing) {
    return (
      <input
        className="hot-input"
        autoFocus
        value={text}
        aria-label={label}
        style={{ width: width ?? 56 }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text);
          if (Number.isFinite(v)) onChange(clamp(v));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="hot"
      aria-label={label ? `${label}: ${shown}${unit}` : undefined}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 2) d.moved = true;
        if (d.moved) onChange(clamp(Math.round((d.v + dx * step * (e.shiftKey ? 10 : 1)) / step) * step));
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) {
          setText(shown);
          setEditing(true);
        }
        drag.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          onChange(clamp(value + step));
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          onChange(clamp(value - step));
        }
      }}
    >
      {shown}
      {unit && <span className="hot-unit">{unit}</span>}
    </button>
  );
}

// A Lumetri-style slider row: label, thin track, hot value. Double-click resets.
export function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  digits = 1,
  neutral = 0,
  unit,
  track,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  digits?: number;
  neutral?: number;
  unit?: string;
  track?: string;
}) {
  return (
    <div className="slider-row" onDoubleClick={() => onChange(neutral)}>
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={track ? ({ "--track": track } as React.CSSProperties) : undefined}
        className={track ? "range tinted" : "range"}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <HotNumber value={value} onChange={onChange} min={min} max={max} step={step} digits={digits} unit={unit} label={label} />
    </div>
  );
}

// A twirl-down section, like the effect groups in Effect Controls and Lumetri.
export function Section({ title, children, defaultOpen = true, right, fx }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; fx?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section${open ? " open" : ""}`}>
      <header className="section-head">
        <button type="button" className="twirl" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
          {fx && <span className="fx-badge">fx</span>}
          <span>{title}</span>
        </button>
        {right}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-value">{children}</span>
    </div>
  );
}

export function Swatch({ value, onChange, label, allowNone }: { value: string | null; onChange: (v: string | null) => void; label: string; allowNone?: boolean }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : value?.startsWith("rgba") ? rgbaToHex(value) : "#000000";
  return (
    <span className="swatch-wrap">
      <label className={`swatch${value ? "" : " none"}`} style={{ background: value ?? undefined }} title={label}>
        <input type="color" value={hex} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      </label>
      {allowNone && (
        <button type="button" className="mini" onClick={() => onChange(value ? null : "#000000")}>
          {value ? "None" : "Add"}
        </button>
      )}
    </span>
  );
}

function rgbaToHex(v: string) {
  const m = v.match(/[\d.]+/g);
  if (!m) return "#000000";
  return `#${m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("")}`;
}

export function Select<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <span className={`select ${className ?? ""}`}>
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)} onKeyDown={(e) => e.stopPropagation()}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={10} />
    </span>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true">
        {checked && <Icon name="check" size={10} />}
      </span>
      <span>{label}</span>
    </label>
  );
}

// A panel frame with Premiere-style tabs and a panel menu.
export function Panel({
  tabs,
  active,
  onTab,
  children,
  className,
  actions,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onTab?: (id: string) => void;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`panel ${className ?? ""}`} aria-label={tabs.find((t) => t.id === active)?.label}>
      <header className="panel-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === active} className={`panel-tab${t.id === active ? " active" : ""}`} onClick={() => onTab?.(t.id)}>
            {t.label}
            {t.id === active && <Icon name="menu" size={12} className="panel-menu" />}
          </button>
        ))}
        <span className="panel-actions">{actions}</span>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

// Drag handle between panel groups. Sizes persist per handle.
export function useSize(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    try {
      const s = Number(localStorage.getItem(`ai-editor:size:${key}`));
      return Number.isFinite(s) && s > 0 ? s : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`ai-editor:size:${key}`, String(Math.round(v)));
    } catch {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV];
}

export function Splitter({ dir, onDrag }: { dir: "col" | "row"; onDrag: (delta: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className={`splitter splitter-${dir}`}
      role="separator"
      aria-orientation={dir === "col" ? "vertical" : "horizontal"}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        last.current = dir === "col" ? e.clientX : e.clientY;
        document.body.classList.add(dir === "col" ? "resizing-col" : "resizing-row");
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const now = dir === "col" ? e.clientX : e.clientY;
        onDrag(now - last.current);
        last.current = now;
      }}
      onPointerUp={() => {
        last.current = null;
        document.body.classList.remove("resizing-col", "resizing-row");
      }}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-note">{children}</div>;
}
