import { useState } from "react";
import { FONT_IDS, FPS, SHAPES, TEXT_PRESET_IDS, type FontId, type TextItem, type TextStyle } from "../../../src/shared/project";
import { SHAPE_LABELS, TEXT_PRESETS, makeShape, makeText } from "../../../src/shared/presets";
import { commit, get, set, useEditor } from "../lib/store";
import { Icon } from "./Icons";
import { Check, HotNumber, Row, Section, Select, Swatch } from "./controls";
import { animOptions, editItem } from "./Inspector";

export function EssentialGraphics() {
  const project = useEditor((s) => s.project)!;
  const id = useEditor((s) => s.selectedItem);
  const sel = project.items.find((i) => i.id === id);
  const [tab, setTab] = useState<"browse" | "edit">(sel?.type === "text" ? "edit" : "browse");
  const text = sel?.type === "text" ? sel : null;

  return (
    <div className="eg">
      <div className="seg-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "browse"} className={tab === "browse" ? "on" : ""} onClick={() => setTab("browse")}>
          Browse
        </button>
        <button type="button" role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>
          Edit
        </button>
      </div>
      {tab === "browse" ? <Browse onAdded={() => setTab("edit")} /> : text ? <EditText item={text} /> : <p className="empty-note">Select a text layer, or add one from Browse.</p>}
    </div>
  );
}

function Browse({ onAdded }: { onAdded: () => void }) {
  const add = (preset: (typeof TEXT_PRESET_IDS)[number]) => {
    const item = makeText(preset, undefined, get().frame / FPS);
    commit((d) => void d.items.push(item));
    set({ selectedItem: item.id });
    onAdded();
  };
  return (
    <>
      <Section title="Titles and text">
        <div className="templates">
          {TEXT_PRESET_IDS.map((id) => {
            const p = TEXT_PRESETS[id];
            return (
              <button key={id} type="button" className="template" onClick={() => add(id)} title={`${p.label}: ${p.hint}`}>
                <span className="template-thumb">
                  <span
                    className="template-sample"
                    style={{
                      fontFamily: `"${p.style.font ?? "Montserrat"}", sans-serif`,
                      fontWeight: p.style.weight ?? 900,
                      color: p.style.color ?? "#fff",
                      background: p.style.background ?? undefined,
                      borderRadius: p.style.background ? Math.min(12, (p.style.radius ?? 14) / 3) : 0,
                      padding: p.style.background ? "2px 6px" : 0,
                      textTransform: p.style.uppercase ? "uppercase" : "none",
                      fontStyle: p.style.italic ? "italic" : "normal",
                    }}
                  >
                    {p.sample.split("\n")[0].replace(/\*([^*]+)\*/g, "$1")}
                  </span>
                </span>
                <span className="template-label">{p.label}</span>
                <span className="template-hint">{p.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Shapes and graphics">
        <div className="chips">
          {SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className="chip"
              onClick={() => {
                const t = get().frame / FPS;
                const total = get().timeline!.durationInFrames / FPS;
                const item = makeShape(shape, shape === "progress" ? 0 : t, shape === "progress" ? total : 2);
                commit((d) => void d.items.push(item));
                set({ selectedItem: item.id, workspace: "editing" });
              }}
            >
              <Icon name="graphics" size={12} /> {SHAPE_LABELS[shape]}
            </button>
          ))}
        </div>
      </Section>
      <p className="fine pad">Templates land at the playhead. Or press T and click in the Program monitor to type anywhere.</p>
    </>
  );
}

function EditText({ item }: { item: TextItem }) {
  const s = item.style;
  const setS = (patch: Partial<TextStyle>, key: string) => editItem<TextItem>(item.id, (it) => void (it.style = { ...it.style, ...patch }), `style:${key}`);
  return (
    <>
      <Section title="Text">
        <textarea
          className="text-src"
          value={item.text}
          rows={3}
          aria-label="Text"
          onChange={(e) => editItem<TextItem>(item.id, (it) => void (it.text = e.target.value), "text")}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <p className="fine">Wrap a word in *asterisks* to colour it with the accent colour.</p>
        <Row label="Font">
          <Select<FontId> label="Font" value={s.font} options={FONT_IDS.map((f) => ({ value: f, label: f }))} onChange={(font) => setS({ font }, "font")} />
        </Row>
        <Row label="Style">
          <Select label="Weight" value={String(s.weight)} options={["400", "500", "600", "700", "800", "900"].map((w) => ({ value: w, label: { "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra Bold", "900": "Black" }[w]! }))} onChange={(w) => setS({ weight: Number(w) }, "weight")} />
          <HotNumber value={s.size} digits={0} min={10} max={400} label="Size" onChange={(size) => setS({ size }, "size")} />
        </Row>
        <Row label="Align">
          <span className="btn-group">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" className={`icon-btn sm${s.align === a ? " on" : ""}`} title={`Align ${a}`} onClick={() => setS({ align: a }, "align")}>
                <Icon name={a === "left" ? "alignL" : a === "center" ? "alignC" : "alignR"} size={13} />
              </button>
            ))}
          </span>
        </Row>
        <Row label="Tracking">
          <HotNumber value={s.letterSpacing} digits={0} min={-20} max={60} label="Tracking" onChange={(v) => setS({ letterSpacing: v }, "ls")} />
        </Row>
        <div className="checks">
          <Check label="All caps" checked={s.uppercase} onChange={(v) => setS({ uppercase: v }, "uc")} />
          <Check label="Italic" checked={s.italic} onChange={(v) => setS({ italic: v }, "it")} />
        </div>
      </Section>
      <Section title="Appearance">
        <Row label="Fill">
          <Swatch label="Fill colour" value={s.color} onChange={(v) => setS({ color: v ?? "#ffffff" }, "fill")} />
        </Row>
        <Row label="Accent">
          <Swatch label="Accent colour" value={s.accentColor} onChange={(v) => setS({ accentColor: v ?? "#ffe14d" }, "accent")} />
        </Row>
        <Row label="Stroke">
          <Swatch label="Stroke colour" value={s.strokeColor} onChange={(v) => setS({ strokeColor: v ?? "#000000" }, "sc")} />
          <HotNumber value={s.strokeWidth} digits={0} min={0} max={40} label="Stroke width" onChange={(v) => setS({ strokeWidth: v }, "sw")} />
        </Row>
        <Row label="Background">
          <Swatch label="Background colour" value={s.background} allowNone onChange={(v) => setS({ background: v }, "bg")} />
          {s.background && <HotNumber value={s.radius} digits={0} min={0} max={200} label="Corner radius" onChange={(v) => setS({ radius: v }, "rad")} />}
        </Row>
        <div className="checks">
          <Check label="Shadow" checked={s.shadow} onChange={(v) => setS({ shadow: v }, "shadow")} />
        </div>
      </Section>
      <Section title="Animation">
        <Row label="In">
          <Select label="Entrance animation" value={item.animIn} options={animOptions} onChange={(v) => editItem<TextItem>(item.id, (it) => void (it.animIn = v))} />
        </Row>
        <Row label="Out">
          <Select label="Exit animation" value={item.animOut} options={animOptions} onChange={(v) => editItem<TextItem>(item.id, (it) => void (it.animOut = v))} />
        </Row>
      </Section>
      <Section title="Position">
        <Row label="X / Y">
          <HotNumber value={item.x} digits={1} step={0.5} label="X" onChange={(v) => editItem<TextItem>(item.id, (it) => void (it.x = v), "x")} />
          <HotNumber value={item.y} digits={1} step={0.5} label="Y" onChange={(v) => editItem<TextItem>(item.id, (it) => void (it.y = v), "y")} />
        </Row>
        <Row label="Width">
          <HotNumber value={item.width} digits={0} min={10} max={100} unit="%" label="Width" onChange={(v) => editItem<TextItem>(item.id, (it) => void (it.width = v), "w")} />
        </Row>
      </Section>
    </>
  );
}
