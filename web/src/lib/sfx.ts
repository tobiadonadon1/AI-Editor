// Sound effects synthesised in the browser, so there are no files to license or download.
import { SFX_IDS, type SfxId } from "../../../src/shared/project";

const RATE = 44100;

function noiseBuffer(ctx: BaseAudioContext, sec: number) {
  const b = ctx.createBuffer(1, Math.ceil(sec * RATE), RATE);
  const d = b.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 16807) % 2147483647;
    d[i] = (seed / 2147483647) * 2 - 1;
  }
  return b;
}

type Build = (ctx: OfflineAudioContext) => void;

const env = (g: GainNode, t: number, points: [number, number][]) => {
  g.gain.setValueAtTime(points[0][1], t + points[0][0]);
  for (const [at, v] of points.slice(1)) g.gain.linearRampToValueAtTime(v, t + at);
};

function noise(ctx: OfflineAudioContext, sec: number, type: BiquadFilterType, f: [number, number][], q: number, gain: [number, number][]) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, sec);
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f[0][1], f[0][0]);
  for (const [at, v] of f.slice(1)) filt.frequency.exponentialRampToValueAtTime(v, at);
  const g = ctx.createGain();
  env(g, 0, gain);
  src.connect(filt).connect(g).connect(ctx.destination);
  src.start();
}

function tone(ctx: OfflineAudioContext, type: OscillatorType, at: number, f: [number, number][], gain: [number, number][]) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f[0][1], at + f[0][0]);
  for (const [t, v] of f.slice(1)) o.frequency.exponentialRampToValueAtTime(v, at + t);
  const g = ctx.createGain();
  env(g, at, gain);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + gain[gain.length - 1][0] + 0.05);
}

const SOUNDS: Record<SfxId, { sec: number; build: Build }> = {
  whoosh: { sec: 0.7, build: (c) => noise(c, 0.7, "bandpass", [[0, 300], [0.28, 1800], [0.6, 500]], 0.9, [[0, 0], [0.24, 0.55], [0.62, 0]]) },
  "swoosh-up": { sec: 0.8, build: (c) => noise(c, 0.8, "bandpass", [[0, 220], [0.7, 7000]], 2, [[0, 0], [0.55, 0.8], [0.78, 0]]) },
  // A soft bubble pop: a quick upward blip that dies away in under 0.1 s, rounded off with a low-pass.
  pop: {
    sec: 0.18,
    build: (c) => {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(380, 0);
      o.frequency.exponentialRampToValueAtTime(1100, 0.035);
      o.frequency.exponentialRampToValueAtTime(900, 0.1);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2200;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.55, 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, 0.11);
      o.connect(lp).connect(g).connect(c.destination);
      o.start(0);
      o.stop(0.15);
    },
  },
  click: { sec: 0.08, build: (c) => noise(c, 0.06, "bandpass", [[0, 2200]], 1.2, [[0, 0.6], [0.02, 0]]) },
  impact: {
    sec: 1.2,
    build: (c) => {
      tone(c, "sine", 0, [[0, 110], [0.5, 38]], [[0, 1], [1.1, 0]]);
      noise(c, 0.5, "lowpass", [[0, 1800], [0.4, 120]], 0.8, [[0, 0.8], [0.45, 0]]);
    },
  },
  ding: {
    sec: 1.4,
    build: (c) => {
      tone(c, "sine", 0, [[0, 1318]], [[0, 0.6], [1.3, 0]]);
      tone(c, "sine", 0, [[0, 2637]], [[0, 0.25], [0.7, 0]]);
      tone(c, "triangle", 0, [[0, 1975]], [[0, 0.12], [0.9, 0]]);
    },
  },
  riser: {
    sec: 1.6,
    build: (c) => {
      tone(c, "sawtooth", 0, [[0, 160], [1.45, 900]], [[0, 0], [1.3, 0.22], [1.5, 0]]);
      noise(c, 1.6, "bandpass", [[0, 400], [1.45, 6000]], 1.5, [[0, 0], [1.35, 0.5], [1.55, 0]]);
    },
  },
  camera: {
    sec: 0.35,
    build: (c) => {
      noise(c, 0.05, "bandpass", [[0, 3200]], 1, [[0, 0.9], [0.04, 0]]);
      tone(c, "square", 0.09, [[0, 1800]], [[0, 0.15], [0.03, 0]]);
      noise(c, 0.35, "bandpass", [[0, 2400]], 1, [[0, 0], [0.12, 0], [0.13, 0.7], [0.2, 0]]);
    },
  },
  typing: {
    sec: 0.9,
    build: (c) => {
      for (const at of [0, 0.11, 0.19, 0.33, 0.41, 0.55, 0.62, 0.78]) {
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c, 0.03);
        const f = c.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 2400 + at * 900;
        const g = c.createGain();
        env(g, at, [[0, 0.7], [0.02, 0]]);
        src.connect(f).connect(g).connect(c.destination);
        src.start(at);
      }
    },
  },
  "bass-drop": { sec: 1.3, build: (c) => tone(c, "sine", 0, [[0, 160], [0.9, 32]], [[0, 0], [0.03, 1], [1.2, 0]]) },
};

function toWav(buffer: AudioBuffer): Blob {
  const ch = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + ch.length * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + ch.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, ch.length * 2, true);
  for (let i = 0; i < ch.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i] * 0.9)) * 0x7fff, true);
  return new Blob([out], { type: "audio/wav" });
}

let built: Promise<Record<SfxId, string>> | null = null;

export function sfxLibrary(): Promise<Record<SfxId, string>> {
  built ??= (async () => {
    const entries = await Promise.all(
      SFX_IDS.map(async (id) => {
        const s = SOUNDS[id];
        const ctx = new OfflineAudioContext(1, Math.ceil(s.sec * RATE), RATE);
        s.build(ctx);
        return [id, URL.createObjectURL(toWav(await ctx.startRendering()))] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<SfxId, string>;
  })();
  return built;
}

export async function previewSfx(id: SfxId) {
  const lib = await sfxLibrary();
  void new Audio(lib[id]).play().catch(() => undefined);
}
