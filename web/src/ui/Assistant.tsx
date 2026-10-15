import { useEffect, useRef, useState } from "react";
import { FPS } from "../../../src/shared/project";
import { describeItem } from "../../../src/shared/ops";
import { ask, canRevert, cancelAssistant, revertMessage, resume, useEditor } from "../lib/store";
import { api, type Health } from "../lib/api";
import { Icon } from "./Icons";
import { Panel, tc } from "./controls";

const SUGGESTIONS = [
  "Make the colour warmer and more cinematic",
  "Add a bold hook title in the first 2 seconds",
  "Punch-in zoom on every key point",
  "Hormozi-style captions with green key words",
  "Tighten the pacing and cut every pause",
  "Add “Link in bio →” as a CTA at the end",
  "Make a 4:5 version for Meta feed ads",
  "Whoosh on every transition, pop on every callout",
];

type Rec = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

export function Assistant() {
  const project = useEditor((s) => s.project)!;
  const busy = useEditor((s) => s.assistantBusy);
  const frame = useEditor((s) => s.frame);
  const selId = useEditor((s) => s.selectedItem);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const rec = useRef<Rec | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const selected = project.items.find((i) => i.id === selId);

  useEffect(() => void api.health().then(setHealth), []);
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [project.chat.length, project.chat[project.chat.length - 1]?.text]);

  const send = (text = draft) => {
    const t = text.trim();
    if (!t || busy) return;
    setDraft("");
    void ask(t);
  };

  const SpeechRec = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
  const dictate = () => {
    if (!SpeechRec) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new SpeechRec();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    const base = draft ? `${draft.trim()} ` : "";
    r.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setDraft(base + s);
    };
    r.onend = () => {
      setListening(false);
      input.current?.focus();
    };
    rec.current = r;
    r.start();
    setListening(true);
  };

  const off = health && !health.anthropic;
  const noTranscript = !project.words.length && project.mainAssetId && project.status === "ready";

  return (
    <Panel tabs={[{ id: "ai", label: "Assistant" }]} active="ai" className="assistant">
      <div className="chat" ref={thread} aria-live="polite">
        {project.chat.length === 0 && (
          <div className="chat-intro">
            <p className="chat-intro-title">Edit by describing it.</p>
            <p>
              Say what you want to change, as specifically as you like: colour, light, text, where it goes, how it moves, pacing, captions, format. The changes land on the timeline, where you can adjust them by hand or undo them.
            </p>
            {noTranscript && (
              <button type="button" className="btn btn-blue" onClick={() => void resume()}>
                Transcribe and make the first cut
              </button>
            )}
          </div>
        )}
        {project.chat.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}${m.error ? " msg-error" : ""}${m.pending ? " msg-pending" : ""}`}>
            {m.role === "assistant" && <span className="msg-who">Assistant</span>}
            <p>
              {m.pending && <span className="spinner sm" />}
              {m.text}
            </p>
            {m.changes && m.changes.length > 0 && (
              <ul className="changes">
                {m.changes.map((c, i) => (
                  <li key={i} className={`change change-${c.op}`}>
                    {c.text}
                  </li>
                ))}
              </ul>
            )}
            {m.undoable && canRevert(m.id) && (
              <button type="button" className="mini" onClick={() => revertMessage(m.id)}>
                <Icon name="undo" size={12} /> Revert these changes
              </button>
            )}
          </div>
        ))}
      </div>

      {project.chat.length < 3 && !busy && (
        <div className="suggestions">
          {SUGGESTIONS.slice(0, 6).map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={Boolean(off)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="composer">
        <div className="context">
          <span className="ctx-chip" title="“Here” means the playhead">
            <Icon name="marker" size={10} /> {tc(frame / FPS)}
          </span>
          {selected && (
            <span className="ctx-chip sel" title="“This” means the selected layer">
              {describeItem(selected)}
            </span>
          )}
        </div>
        {off ? (
          <p className="fine warn">The AI is off on this server: ANTHROPIC_API_KEY is not set. Everything else works.</p>
        ) : null}
        <div className="prompt">
          <textarea
            ref={input}
            value={draft}
            rows={3}
            placeholder="e.g. Make the lighting brighter and warmer, put “3 mistakes” as a big title here, and zoom in when I say “never”"
            aria-label="Describe the change"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="prompt-actions">
            {SpeechRec && (
              <button type="button" className={`icon-btn${listening ? " rec" : ""}`} title={listening ? "Stop dictation" : "Dictate"} onClick={dictate}>
                <Icon name="mic" />
              </button>
            )}
            {busy ? (
              <button type="button" className="btn btn-quiet" onClick={cancelAssistant}>
                <Icon name="stop" size={12} /> Stop
              </button>
            ) : (
              <button type="button" className="btn btn-blue" onClick={() => send()} disabled={!draft.trim() || Boolean(off)}>
                <Icon name="send" size={13} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
