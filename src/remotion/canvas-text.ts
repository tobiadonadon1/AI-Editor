// The export draws text outlines (-webkit-text-stroke) with canvas strokeText, whose default "miter" joins put
// long spikes on the corners of heavy letters (M, V, W, A, K) once the outline is thick: the jagged borders seen
// around titles and captions in exported videos. Round joins follow the letter shapes, like a designer's outline.
let done = false;

export function smoothTextOutlines() {
  if (done || typeof window === "undefined") return;
  done = true;
  const protos = [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean) as (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D)[];
  for (const proto of protos) {
    const strokeText = proto.strokeText;
    proto.strokeText = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["strokeText"]>) {
      this.lineJoin = "round";
      this.lineCap = "round";
      return strokeText.apply(this, args);
    } as typeof strokeText;
  }
}
