import { ANIMS, FORMATS, FORMAT_IDS, LOOK_IDS, NEUTRAL_EFFECTS, NEUTRAL_GRADE, SFX_IDS, TRANSITIONS, FPS, mainAsset, type AdjustItem, type Anim, type Effects, type FormatId, type Grade, type Item, type Motion, type Project, type SfxId, type TransitionKind } from "../../../src/shared/project";
import { LOOKS } from "../../../src/shared/presets";
import { placeItems } from "../../../src/shared/timeline";
import { describeItem } from "../../../src/shared/ops";
import { commit, get, importFiles, set, useEditor, type Workspace } from "../lib/store";
import { previewSfx } from "../lib/sfx";
import { Icon } from "./Icons";
import { Check, Empty, HotNumber, Panel, Row, Section, Select, SliderRow, tc } from "./controls";
import { EssentialGraphics } from "./EssentialGraphics";
import { TextPanel } from "./TextPanel";

const TABS: { id: Workspace; label: string }[] = [
  { id: "editing", label: "Effect Controls" },
  { id: "color", label: "Lumetri Color" },
  { id: "graphics", label: "Essential Graphics" },
  { id: "captions", label: "Text" },
  { id: "audio", label: "Essential Sound" },
];

export function Inspector() {
  const ws = useEditor((s) => s.workspace);
  return (
    <Panel tabs={TABS} active={ws} onTab={(id) => set({ workspace: id as Workspace })} className="inspector">
      {ws === "editing" && <EffectControls />}
      {ws === "color" && <Lumetri />}
      {ws === "graphics" && <EssentialGraphics />}
      {ws === "captions" && <TextPanel />}
      {ws === "audio" && <EssentialSound />}
    </Panel>
  );
}

export const animOptions = ANIMS.map((a) => ({ value: a, label: a === "none" ? "None" : a.replace("-", " ").replace(/^./, (c) => c.toUpperCase()) }));

export function editItem<T extends Item>(id: string, fn: (it: T) => void, key?: string) {
  commit((d) => {
    const it = d.items.find((i) => i.id === id) as T | undefined;
    if (it) fn(it);
  }, key ? `${id}:${key}` : undefined);
}

function Timing({ item }: { item: Item }) {
  const timeline = useEditor((s) => s.timeline)!;
  const p = placeItems([item], timeline)[0];
  const word = item.anchorWord ? get().project?.words.find((w) => w.id === item.anchorWord) : null;
  return (
    <Section title="Timing">
      <Row label="Start">
        <HotNumber value={p?.start ?? item.start} digits={2} step={1 / FPS} min={0} unit=" s" label="Start" onChange={(v) => editItem(item.id, (it) => ((it.start = v), (it.anchorWord = undefined)), "start")} />
      </Row>
      <Row label="Duration">
        <HotNumber value={item.duration} digits={2} step={1 / FPS} min={0.1} unit=" s" label="Duration" onChange={(v) => editItem(item.id, (it) => void (it.duration = v), "dur")} />
      </Row>
      {word && (
        <p className="fine">
          Follows the word “{word.text}”, so it stays in sync when the cut changes. Dragging it on the timeline unpins it.
        </p>
      )}
    </Section>
  );
}

function Anims({ item }: { item: Item & { animIn: Anim; animOut: Anim; animDuration?: number } }) {
  return (
    <Section title="Animation">
      <Row label="In">
        <Select<Anim> label="Entrance animation" value={item.animIn} options={animOptions} onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.animIn = v))} />
      </Row>
      <Row label="Out">
        <Select<Anim> label="Exit animation" value={item.animOut} options={animOptions} onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.animOut = v))} />
      </Row>
      {item.animDuration !== undefined && (
        <Row label="Speed">
          <HotNumber value={item.animDuration} digits={2} step={0.05} min={0.05} max={2} unit=" s" label="Animation duration" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.animDuration = v), "animdur")} />
        </Row>
      )}
    </Section>
  );
}

function EffectControls() {
  const project = useEditor((s) => s.project)!;
  const id = useEditor((s) => s.selectedItem);
  const clip = useEditor((s) => s.selectedClip);
  const timeline = useEditor((s) => s.timeline)!;
  const item = project.items.find((i) => i.id === id);

  if (!item) return <MasterControls project={project} clip={clip} timelineClip={clip !== null ? timeline.clips[clip] : null} />;

  return (
    <div className="ec">
      <div className="ec-head">
        <span className="ec-title">{describeItem(item)}</span>
        <button type="button" className="mini danger" onClick={() => (commit((d) => void (d.items = d.items.filter((i) => i.id !== item.id))), set({ selectedItem: null }))}>
          <Icon name="trash" size={12} /> Delete
        </button>
      </div>
      {(item.type === "text" || item.type === "shape" || item.type === "media") && (
        <Section title="Motion" fx>
          <Row label="Position">
            <HotNumber value={item.x} digits={1} step={0.5} label="Position X" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.x = v), "x")} />
            <HotNumber value={item.y} digits={1} step={0.5} label="Position Y" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.y = v), "y")} />
          </Row>
          {item.type === "text" && (
            <>
              <Row label="Size">
                <HotNumber value={item.style.size} digits={0} min={10} max={400} label="Font size" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.style.size = v), "size")} />
              </Row>
              <Row label="Width">
                <HotNumber value={item.width} digits={0} min={10} max={100} unit="%" label="Box width" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.width = v), "w")} />
              </Row>
            </>
          )}
          {item.type === "shape" && (
            <Row label="Size">
              <HotNumber value={item.w} digits={1} min={0.2} max={150} label="Width" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.w = v), "w")} />
              <HotNumber value={item.h} digits={1} min={0} max={150} label="Height" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.h = v), "h")} />
            </Row>
          )}
          {item.type === "media" && (
            <Row label="Scale">
              <HotNumber value={item.scale * 100} digits={0} min={10} max={300} unit="%" label="Scale" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.scale = v / 100), "scale")} />
            </Row>
          )}
          {"rotation" in item && (
            <Row label="Rotation">
              <HotNumber value={item.rotation} digits={0} min={-180} max={180} unit="°" label="Rotation" onChange={(v) => editItem<typeof item>(item.id, (it) => void ((it as { rotation: number }).rotation = v), "rot")} />
            </Row>
          )}
          <Row label="Opacity">
            <HotNumber value={item.opacity} digits={0} min={0} max={100} unit="%" label="Opacity" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.opacity = v), "op")} />
          </Row>
        </Section>
      )}
      {item.type === "shape" && (
        <Section title="Shape">
          <Row label="Color">
            <input type="color" className="color-in" value={item.color} onChange={(e) => editItem<typeof item>(item.id, (it) => void (it.color = e.target.value), "color")} aria-label="Shape colour" />
          </Row>
          <Row label="Thickness">
            <HotNumber value={item.thickness} digits={0} min={1} max={60} label="Stroke" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.thickness = v), "th")} />
          </Row>
        </Section>
      )}
      {item.type === "media" && (
        <Section title="B-roll">
          <Row label="Fit">
            <Select label="Fit" value={item.fit} options={[{ value: "cover", label: "Fill frame" }, { value: "contain", label: "Fit inside" }, { value: "pip", label: "Picture in picture" }]} onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.fit = v))} />
          </Row>
          <Row label="Volume">
            <HotNumber value={item.volume} digits={1} min={-60} max={6} unit=" dB" label="Volume" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.volume = v), "vol")} />
          </Row>
          <Check label="Slow zoom (Ken Burns)" checked={item.kenBurns} onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.kenBurns = v))} />
        </Section>
      )}
      {item.type === "adjust" && <AdjustControls item={item} />}
      {item.type === "transition" && (
        <Section title="Transition">
          <Row label="Style">
            <Select<TransitionKind> label="Transition style" value={item.kind} options={TRANSITIONS.map((t) => ({ value: t, label: t }))} onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.kind = v))} />
          </Row>
          <Row label="Color">
            <input type="color" className="color-in" value={item.color} onChange={(e) => editItem<typeof item>(item.id, (it) => void (it.color = e.target.value), "c")} aria-label="Flash colour" />
          </Row>
        </Section>
      )}
      {item.type === "sfx" && (
        <Section title="Sound">
          <Row label="Sound">
            <Select<SfxId> label="Sound" value={item.sound} options={SFX_IDS.map((s) => ({ value: s, label: s }))} onChange={(v) => (editItem<typeof item>(item.id, (it) => void (it.sound = v)), previewSfx(v))} />
            <button type="button" className="icon-btn sm" title="Preview" onClick={() => previewSfx(item.sound)}>
              <Icon name="play" size={12} />
            </button>
          </Row>
          <Row label="Level">
            <HotNumber value={item.volume} digits={1} min={-40} max={6} unit=" dB" label="Level" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.volume = v), "vol")} />
          </Row>
        </Section>
      )}
      {item.type === "music" && <MusicControls item={item} />}
      {(item.type === "text" || item.type === "shape" || item.type === "media") && <Anims item={item as never} />}
      {item.type === "text" && (
        <p className="fine pad">
          Edit the words, font and colours in <button type="button" className="link" onClick={() => set({ workspace: "graphics" })}>Essential Graphics</button>.
        </p>
      )}
      <Timing item={item} />
    </div>
  );
}

function MasterControls({ project, clip, timelineClip }: { project: Project; clip: number | null; timelineClip: { srcStartFrame: number; srcEndFrame: number } | null }) {
  const v = project.video;
  const asset = mainAsset(project);
  const setV = (patch: Partial<Project["video"]>, key: string) => commit((d) => void Object.assign(d.video, patch), `video:${key}`);
  return (
    <div className="ec">
      <div className="ec-head">
        <span className="ec-title">{clip !== null ? `Clip ${clip + 1}` : "Sequence"} · {asset?.name ?? "No video"}</span>
        {clip !== null && (
          <button type="button" className="mini danger" title="Ripple delete (Delete)" onClick={() => rippleDeleteClip(clip)}>
            <Icon name="trash" size={12} /> Ripple delete
          </button>
        )}
      </div>
      {timelineClip && (
        <p className="fine pad">
          Source {tc(timelineClip.srcStartFrame / FPS)} → {tc(timelineClip.srcEndFrame / FPS)}. Motion and colour apply to the whole video; use an adjustment layer for one part.
        </p>
      )}
      <Section title="Sequence">
        <Row label="Format">
          <Select<FormatId> label="Format" value={project.format} options={FORMAT_IDS.map((f) => ({ value: f, label: `${FORMATS[f].label}` }))} onChange={(f) => commit((d) => void (d.format = f))} />
        </Row>
        <SliderRow label="Trim pauses over" value={project.settings.maxPauseSec} min={0.1} max={1.5} step={0.05} digits={2} neutral={0.35} unit=" s" onChange={(x) => commit((d) => void (d.settings.maxPauseSec = x), "pause")} />
      </Section>
      <Section title="Motion" fx>
        <Row label="Reframe">
          <HotNumber value={v.focusX} digits={0} min={0} max={100} label="Horizontal framing" onChange={(x) => setV({ focusX: x }, "fx")} />
          <HotNumber value={v.focusY} digits={0} min={0} max={100} label="Vertical framing" onChange={(x) => setV({ focusY: x }, "fy")} />
        </Row>
        <Row label="Scale">
          <HotNumber value={v.scale * 100} digits={0} min={30} max={400} unit="%" label="Scale" onChange={(x) => setV({ scale: x / 100 }, "s")} />
        </Row>
        <Row label="Rotation">
          <HotNumber value={v.rotation} digits={1} min={-180} max={180} unit="°" label="Rotation" onChange={(x) => setV({ rotation: x }, "r")} />
        </Row>
        <Row label="Fit">
          <Select label="Fit" value={v.fit} options={[{ value: "cover", label: "Fill frame" }, { value: "contain", label: "Fit inside" }]} onChange={(fit) => setV({ fit }, "fit")} />
        </Row>
      </Section>
      <Section title="Opacity" fx>
        <SliderRow label="Opacity" value={v.opacity} min={0} max={100} digits={0} neutral={100} unit="%" onChange={(x) => setV({ opacity: x }, "o")} />
      </Section>
      <Section title="Volume" fx>
        <SliderRow label="Level" value={v.volume} min={-60} max={12} step={0.5} digits={1} neutral={0} unit=" dB" onChange={(x) => setV({ volume: x }, "vol")} />
      </Section>
      {!project.items.length && <Empty>Select a layer on the timeline or in the Program monitor to see its controls.</Empty>}
    </div>
  );
}

export function rippleDeleteClip(index: number) {
  const t = get().timeline;
  const c = t?.clips[index];
  if (!c) return;
  commit((d) => void d.rangeCuts.push({ id: `r${Date.now().toString(36)}`, start: c.srcStartFrame / FPS, end: c.srcEndFrame / FPS, reason: "manual" }));
  set({ selectedClip: null });
}

function AdjustControls({ item }: { item: AdjustItem }) {
  const fx = { ...NEUTRAL_EFFECTS, ...item.effects };
  const setFx = (patch: Partial<Effects>, key: string) => editItem<AdjustItem>(item.id, (it) => void (it.effects = { ...it.effects, ...patch }), key);
  const m = item.motion;
  const setM = (patch: Partial<Motion>, key: string) => editItem<AdjustItem>(item.id, (it) => void (it.motion = { ...(it.motion ?? { scale: 1.15, x: 50, y: 40, rotation: 0, ease: "punch" }), ...patch }), key);
  return (
    <>
      <Section title="Camera" fx>
        {m ? (
          <>
            <Row label="Move">
              <Select label="Camera move" value={m.ease} options={[{ value: "punch", label: "Punch-in" }, { value: "smooth", label: "Smooth zoom" }, { value: "push", label: "Push in" }, { value: "pull", label: "Pull out" }, { value: "drift", label: "Drift" }]} onChange={(ease) => setM({ ease }, "ease")} />
            </Row>
            <SliderRow label="Zoom" value={m.scale * 100} min={100} max={250} digits={0} neutral={115} unit="%" onChange={(v) => setM({ scale: v / 100 }, "zs")} />
            <Row label="Focus">
              <HotNumber value={m.x} digits={0} min={0} max={100} label="Focus X" onChange={(v) => setM({ x: v }, "zx")} />
              <HotNumber value={m.y} digits={0} min={0} max={100} label="Focus Y" onChange={(v) => setM({ y: v }, "zy")} />
            </Row>
          </>
        ) : (
          <button type="button" className="mini" onClick={() => setM({}, "add")}>
            Add a camera move
          </button>
        )}
      </Section>
      <Section title="Effects" fx>
        <SliderRow label="Blur" value={fx.blur} min={0} max={40} digits={0} onChange={(v) => setFx({ blur: v }, "blur")} />
        <SliderRow label="Zoom blur" value={fx.zoomBlur} min={0} max={80} digits={0} onChange={(v) => setFx({ zoomBlur: v }, "zb")} />
        <SliderRow label="RGB split" value={fx.chromatic} min={0} max={30} digits={0} onChange={(v) => setFx({ chromatic: v }, "ch")} />
        <SliderRow label="Black & white" value={fx.mono} min={0} max={100} digits={0} onChange={(v) => setFx({ mono: v }, "mono")} />
        <SliderRow label="Glitch" value={fx.glitch} min={0} max={100} digits={0} onChange={(v) => setFx({ glitch: v }, "gl")} />
        <SliderRow label="Light leak" value={fx.lightLeak} min={0} max={100} digits={0} onChange={(v) => setFx({ lightLeak: v }, "ll")} />
        <SliderRow label="Pixelate" value={fx.pixelate} min={0} max={60} digits={0} onChange={(v) => setFx({ pixelate: v }, "px")} />
        <Check label="Light sweep" checked={fx.shine} onChange={(v) => setFx({ shine: v }, "sh")} />
      </Section>
      <Section title="Layer">
        <SliderRow label="Fade in/out" value={item.fade} min={0} max={2} step={0.05} digits={2} unit=" s" onChange={(v) => editItem<AdjustItem>(item.id, (it) => void (it.fade = v), "fade")} />
        <p className="fine">Colour for this layer is in <button type="button" className="link" onClick={() => set({ workspace: "color" })}>Lumetri Color</button>.</p>
      </Section>
    </>
  );
}

function MusicControls({ item }: { item: Extract<Item, { type: "music" }> }) {
  return (
    <Section title="Music">
      <SliderRow label="Level" value={item.volume} min={-40} max={0} step={0.5} digits={1} neutral={-18} unit=" dB" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.volume = v), "vol")} />
      <Check label="Duck under dialogue" checked={item.duck} onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.duck = v))} />
      <SliderRow label="Fade in" value={item.fadeIn} min={0} max={5} step={0.1} digits={1} unit=" s" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.fadeIn = v), "fi")} />
      <SliderRow label="Fade out" value={item.fadeOut} min={0} max={8} step={0.1} digits={1} unit=" s" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.fadeOut = v), "fo")} />
      <SliderRow label="Start at" value={item.trimStart} min={0} max={240} step={0.5} digits={1} unit=" s" onChange={(v) => editItem<typeof item>(item.id, (it) => void (it.trimStart = v), "ts")} />
    </Section>
  );
}

// ---------- Lumetri ----------

type NumKey = Exclude<keyof Grade, "look" | "lookIntensity">;

function Lumetri() {
  const project = useEditor((s) => s.project)!;
  const selId = useEditor((s) => s.selectedItem);
  const sel = project.items.find((i) => i.id === selId);
  const layer = sel?.type === "adjust" ? sel : null;
  const grade: Grade = layer ? { ...NEUTRAL_GRADE, ...layer.grade } : project.grade;

  const setG = (patch: Partial<Grade>, key: string) => {
    if (layer) editItem<AdjustItem>(layer.id, (it) => void (it.grade = { ...it.grade, ...patch }), `g:${key}`);
    else commit((d) => void Object.assign(d.grade, patch), `grade:${key}`);
  };
  const s = (key: NumKey, label: string, min: number, max: number, step = 1, digits = 1, track?: string) => (
    <SliderRow label={label} value={grade[key]} min={min} max={max} step={step} digits={digits} neutral={NEUTRAL_GRADE[key]} track={track} onChange={(v) => setG({ [key]: v }, key)} />
  );

  const addLayer = () => {
    const t = get().frame / FPS;
    const item: AdjustItem = { id: `a${Date.now().toString(36)}`, type: "adjust", start: t, duration: 3, name: "Colour", grade: {}, fade: 0.3 };
    commit((d) => void d.items.push(item));
    set({ selectedItem: item.id });
  };

  return (
    <div className="lumetri">
      <div className="ec-head">
        <span className="ec-title">{layer ? `Adjustment layer · ${layer.name ?? "Colour"}` : `Master · ${project.name}`}</span>
        <span>
          <button type="button" className="mini" onClick={() => (layer ? editItem<AdjustItem>(layer.id, (it) => void (it.grade = {})) : commit((d) => void (d.grade = { ...NEUTRAL_GRADE })))}>
            Reset
          </button>
          {!layer && (
            <button type="button" className="mini" onClick={addLayer} title="Grade only part of the video">
              + Layer at playhead
            </button>
          )}
        </span>
      </div>
      <Section title="Basic Correction">
        <h4 className="sub">White Balance</h4>
        {s("temperature", "Temperature", -100, 100, 1, 1, "linear-gradient(90deg,#4f8ff7,#d8d8d8,#f5b041)")}
        {s("tint", "Tint", -100, 100, 1, 1, "linear-gradient(90deg,#3fbf5f,#d8d8d8,#d64fd6)")}
        <h4 className="sub">Tone</h4>
        {s("exposure", "Exposure", -4, 4, 0.05, 1)}
        {s("contrast", "Contrast", -100, 100)}
        {s("highlights", "Highlights", -100, 100)}
        {s("shadows", "Shadows", -100, 100)}
        {s("whites", "Whites", -100, 100)}
        {s("blacks", "Blacks", -100, 100)}
        {s("saturation", "Saturation", 0, 200, 1, 1, "linear-gradient(90deg,#888,#e04f4f,#e0c84f,#4fe07a,#4f8fe0)")}
        {s("vibrance", "Vibrance", -100, 100)}
      </Section>
      <Section title="Creative">
        <div className="looks">
          <button type="button" className={`look${grade.look === null ? " on" : ""}`} onClick={() => setG({ look: null }, "look")}>
            <span className="look-swatch none" />
            None
          </button>
          {LOOK_IDS.map((id) => (
            <button key={id} type="button" className={`look${grade.look === id ? " on" : ""}`} onClick={() => setG({ look: id }, "look")}>
              <span className="look-swatch" style={{ background: `linear-gradient(135deg, ${LOOKS[id].swatch[0]}, ${LOOKS[id].swatch[1]})` }} />
              {LOOKS[id].label}
            </button>
          ))}
        </div>
        <SliderRow label="Intensity" value={grade.lookIntensity} min={0} max={100} digits={0} neutral={100} onChange={(v) => setG({ lookIntensity: v }, "li")} />
      </Section>
      <Section title="Vignette">{s("vignette", "Amount", 0, 100, 1, 0)}</Section>
      <Section title="Film">
        {s("grain", "Grain", 0, 100, 1, 0)}
        {s("glow", "Glow", 0, 100, 1, 0)}
      </Section>
    </div>
  );
}

// ---------- Essential Sound ----------

function EssentialSound() {
  const project = useEditor((s) => s.project)!;
  const music = project.items.find((i) => i.type === "music");
  const audioAssets = project.assets.filter((a) => a.kind === "audio");
  const setMusic = (assetId: string) =>
    commit((d) => {
      d.items = d.items.filter((i) => i.type !== "music");
      if (!assetId) return;
      const total = get().timeline ? get().timeline!.durationInFrames / FPS : 10;
      d.items.push({ id: `mu${Date.now().toString(36)}`, type: "music", assetId, start: 0, duration: total, trimStart: 0, volume: -18, duck: true, fadeIn: 0.5, fadeOut: 1.5 });
    });
  return (
    <div className="ec">
      <Section title="Dialogue">
        <SliderRow label="Clip volume" value={project.video.volume} min={-60} max={12} step={0.5} digits={1} unit=" dB" onChange={(v) => commit((d) => void (d.video.volume = v), "dvol")} />
        <SliderRow label="Trim silences over" value={project.settings.maxPauseSec} min={0.1} max={1.5} step={0.05} digits={2} neutral={0.35} unit=" s" onChange={(v) => commit((d) => void (d.settings.maxPauseSec = v), "pause")} />
      </Section>
      <Section title="Music">
        <Row label="Track">
          <Select label="Music track" value={music?.type === "music" ? music.assetId : ""} options={[{ value: "", label: "None" }, ...audioAssets.map((a) => ({ value: a.id, label: a.name }))]} onChange={setMusic} />
        </Row>
        <label className="mini file-btn">
          <Icon name="upload" size={12} /> Import music…
          <input type="file" accept="audio/*" onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            const added = await importFiles(files);
            const a = added.find((x) => x.kind === "audio");
            if (a) setMusic(a.id);
          }} />
        </label>
        {music?.type === "music" && <MusicControls item={music} />}
        <p className="fine">Use music you have the rights to. It ducks under speech automatically.</p>
      </Section>
      <Section title="Sound effects">
        <div className="sfx-grid">
          {SFX_IDS.map((id) => (
            <span key={id} className="sfx-cell">
              <button type="button" className="icon-btn sm" title={`Preview ${id}`} onClick={() => previewSfx(id)}>
                <Icon name="play" size={11} />
              </button>
              <button type="button" className="sfx-add" title="Add at the playhead" onClick={() => commit((d) => void d.items.push({ id: `x${Date.now().toString(36)}`, type: "sfx", sound: id, start: get().frame / FPS, duration: 1.2, volume: -6 }))}>
                {id}
              </button>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
