"""Local-first video editor API. Project files are intentionally portable JSON."""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import threading
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PROJECTS = DATA / "projects"
WEB = ROOT / "web"
PROJECTS.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Spool", docs_url="/api/docs")
LOCK = threading.RLock()
SUPPORTED_VIDEO = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
SUPPORTED_AUDIO = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
MAX_UPLOAD = 1024 * 1024 * 1024


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return uuid.uuid4().hex[:12]


def project_dir(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", project_id):
        raise HTTPException(404, "Project not found")
    folder = PROJECTS / project_id
    if not folder.is_dir():
        raise HTTPException(404, "Project not found")
    return folder


def read_project(project_id: str) -> dict[str, Any]:
    path = project_dir(project_id) / "project.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise HTTPException(500, "Could not read project") from exc


def save_project(project: dict[str, Any]) -> None:
    project["updatedAt"] = now()
    path = project_dir(project["id"]) / "project.json"
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(project, indent=2, ensure_ascii=False))
    temp.replace(path)


def run(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True)


def probe(path: Path) -> dict[str, Any]:
    try:
        result = run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], 30)
        info = json.loads(result.stdout)
    except Exception as exc:
        raise HTTPException(422, f"Could not read {path.name} as media") from exc
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    duration = float(info.get("format", {}).get("duration") or (video or audio or {}).get("duration") or 0)
    if duration <= 0 or duration > 7200:
        raise HTTPException(422, "Media must be between 1 second and 2 hours")
    return {"duration": round(duration, 3), "width": int((video or {}).get("width") or 0),
            "height": int((video or {}).get("height") or 0), "hasAudio": bool(audio),
            "kind": "video" if video else "audio"}


def asset_path(project_id: str, asset: dict) -> Path:
    return project_dir(project_id) / "media" / asset["storedName"]


def make_thumbnail(source: Path, output: Path, duration: float) -> None:
    try:
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(min(duration * .25, 3)),
             "-i", str(source), "-frames:v", "1", "-vf", "scale=480:-2", str(output)], 45)
    except Exception:
        pass


def make_peaks(path: Path) -> list[float]:
    try:
        raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
                              "-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "-"],
                             capture_output=True, timeout=120, check=True).stdout
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
        if not len(samples):
            return []
        edges = np.linspace(0, len(samples), 180, dtype=int)
        return [round(float(np.sqrt(np.mean(samples[edges[i]:max(edges[i]+1, edges[i+1])] ** 2))), 3)
                for i in range(179)]
    except Exception:
        return []


def detect_silences(path: Path, duration: float) -> list[tuple[float, float]]:
    try:
        result = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af",
                                 "silencedetect=noise=-34dB:d=0.45", "-f", "null", "-"],
                                capture_output=True, text=True, timeout=180)
        starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", result.stderr)]
        ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", result.stderr)]
        return [(max(0, s), min(duration, ends[i] if i < len(ends) else duration))
                for i, s in enumerate(starts)]
    except Exception:
        return []


def speech_intervals(words: list[dict], duration: float, silences: list[tuple[float, float]], pace: str) -> list[tuple[float, float]]:
    threshold = {"calm": .95, "balanced": .68, "brisk": .46}.get(pace, .68)
    intervals: list[tuple[float, float]] = []
    if words:
        group_start, group_end = float(words[0]["start"]), float(words[0]["end"])
        for word in words[1:]:
            s, e = float(word["start"]), float(word["end"])
            if s - group_end > threshold:
                intervals.append((max(0, group_start - .18), min(duration, group_end + .22)))
                group_start = s
            group_end = e
        intervals.append((max(0, group_start - .18), min(duration, group_end + .22)))
    elif silences:
        cursor = 0.0
        for s, e in silences:
            if s - cursor > .3:
                intervals.append((max(0, cursor - .06), min(duration, s + .12)))
            cursor = max(cursor, e - .12)
        if duration - cursor > .3:
            intervals.append((max(0, cursor), duration))
    else:
        intervals = [(0, duration)]
    merged: list[list[float]] = []
    for s, e in intervals:
        if e - s < .28:
            continue
        if merged and s - merged[-1][1] < .22:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return [(round(s, 3), round(e, 3)) for s, e in merged] or [(0, duration)]


def transcribe(path: Path) -> tuple[list[dict], str]:
    """Download a local model on first use. A failed download leaves editing usable."""
    try:
        from faster_whisper import WhisperModel
        model_name = os.getenv("SPOOL_WHISPER_MODEL", "small")
        model = WhisperModel(model_name, device="cpu", compute_type="int8", download_root=str(DATA / "models"))
        segments, _ = model.transcribe(str(path), word_timestamps=True, vad_filter=True, beam_size=5)
        words = []
        for segment in segments:
            for word in segment.words or []:
                token = word.word.strip()
                if token and word.start is not None and word.end is not None:
                    words.append({"start": round(word.start, 3), "end": round(word.end, 3), "text": token,
                                  "confidence": round(float(word.probability or 0), 3)})
        return words, "Local Whisper " + model_name
    except Exception as exc:
        return [], f"Transcription unavailable: {str(exc)[:180]}"


def exposure_suggestion(path: Path, duration: float) -> float:
    try:
        import cv2
        cap = cv2.VideoCapture(str(path))
        means = []
        for sec in [duration * .2, duration * .5, duration * .8]:
            cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000)
            ok, frame = cap.read()
            if ok:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                means.append(float(np.mean(gray)))
        cap.release()
        if not means:
            return 0
        return round(float(np.clip((112 - np.median(means)) / 700, -.08, .08)), 3)
    except Exception:
        return 0


def story_intent(brief: str, pace: str) -> dict:
    lower = brief.lower()
    wanted = re.search(r"(?:under|about|around|roughly|approximately|in)?\s*(\d{1,3})\s*(?:second|sec)s?\b", lower)
    title_match = re.search(r"(?:title|headline)\s*:\s*([^\n.]{3,70})", brief, re.I)
    mood = "calm" if re.search(r"\b(calm|gentle|quiet|soft|thoughtful|relaxed)\b", lower) else "brisk" if re.search(r"\b(fast|energetic|punchy|dynamic|urgent)\b", lower) else pace
    keywords = [x for x in re.findall(r"[a-zA-ZÀ-ÿ']{4,}", lower) if x not in {
        "video", "make", "create", "with", "that", "this", "about", "really", "short", "story", "clips", "clip", "seconds", "second", "want", "please", "edit", "editing", "them", "then", "have", "should", "some"}]
    return {"targetDuration": min(180, max(8, int(wanted.group(1)))) if wanted else None,
            "title": title_match.group(1).strip() if title_match else None,
            "mood": mood, "keywords": list(dict.fromkeys(keywords))[:12]}


def suggest_graphics(brief: str, clips: list[dict], assets: list[dict], intent: dict) -> list[dict]:
    graphics = []
    total = sum(c["sourceEnd"] - c["sourceStart"] for c in clips)
    if intent["title"] and total > 2:
        graphics.append({"id": uid(), "type": "title", "text": intent["title"], "start": .2,
                         "end": min(total, 2.8), "position": {"x": .5, "y": .27}, "motion": "slide"})
    if total < 14:
        return graphics
    by_id = {a["id"]: a for a in assets}
    timeline = 0.0
    candidates = []
    keywords = set(intent["keywords"])
    for clip in clips:
        words = by_id[clip["assetId"]].get("words", [])
        selected = [w for w in words if w["start"] >= clip["sourceStart"] and w["end"] <= clip["sourceEnd"]]
        for i in range(0, max(0, len(selected) - 3), 2):
            group = selected[i:i+6]
            if len(group) < 4:
                continue
            at = timeline + group[0]["start"] - clip["sourceStart"]
            if at < 4 or at > total - 3:
                continue
            confidence = float(np.mean([w.get("confidence", .5) for w in group]))
            tokens = {re.sub(r"[^a-zA-ZÀ-ÿ]", "", w["text"].lower()) for w in group}
            score = len(tokens & keywords) * 2 + confidence - abs(at - total * .5) / total
            if confidence >= .72 and score >= 2.45:
                candidates.append((score, at, " ".join(w["text"] for w in group)))
        timeline += clip["sourceEnd"] - clip["sourceStart"]
    chosen = []
    for _, at, text in sorted(candidates, reverse=True):
        if all(abs(at - previous) > 6 for previous in chosen):
            cleaned = text.strip().strip(".,!?;:")
            graphics.append({"id": uid(), "type": "title", "text": cleaned, "start": round(at, 2),
                             "end": round(min(total, at + 2.1), 2), "position": {"x": .5, "y": .31}, "motion": "slide"})
            chosen.append(at)
        if len(chosen) >= 2:
            break
    return graphics


def update_phase(project_id: str, phase: str, progress: int, status: str = "analyzing") -> None:
    with LOCK:
        p = read_project(project_id)
        p["job"] = {"status": status, "phase": phase, "progress": progress}
        save_project(p)


def analyse_project(project_id: str) -> None:
    try:
        with LOCK:
            p = read_project(project_id)
            video_assets = [a for a in p["assets"] if a["kind"] == "video"]
            if not video_assets:
                raise ValueError("Add at least one video clip")
        all_clips: list[dict] = []
        notes = []
        for index, asset in enumerate(video_assets):
            path = asset_path(project_id, asset)
            update_phase(project_id, f"Listening to {asset['name']}", int(8 + index / len(video_assets) * 65))
            words, transcript_status = transcribe(path) if asset["hasAudio"] else ([], "No audio in clip")
            silences = detect_silences(path, asset["duration"]) if asset["hasAudio"] else []
            exposure = exposure_suggestion(path, asset["duration"])
            intervals = speech_intervals(words, asset["duration"], silences, p["settings"]["pace"]) if asset["hasAudio"] else [(0, asset["duration"])]
            for start, end in intervals:
                all_clips.append({"id": uid(), "assetId": asset["id"], "sourceStart": start, "sourceEnd": end,
                                  "brightness": exposure, "contrast": 1.0, "saturation": 1.0, "volume": 1.0})
            asset["words"] = words
            asset["suggestedBrightness"] = exposure
            notes.append(transcript_status)
            update_phase(project_id, f"Finding the best cuts in {asset['name']}", int(18 + (index + 1) / len(video_assets) * 65))
        original = sum(a["duration"] for a in video_assets)
        edited = sum(c["sourceEnd"] - c["sourceStart"] for c in all_clips)
        intent = story_intent(p.get("brief", ""), p["settings"]["pace"])
        graphics = suggest_graphics(p.get("brief", ""), all_clips, video_assets, intent)
        with LOCK:
            p = read_project(project_id)
            by_id = {a["id"]: a for a in video_assets}
            for asset in p["assets"]:
                if asset["id"] in by_id:
                    asset.update({k: by_id[asset["id"]][k] for k in ("words", "suggestedBrightness")})
            p["clips"] = all_clips
            p["broll"] = []
            p["music"] = {"bed": "warm-air" if intent["mood"] == "calm" else "soft-pulse", "assetId": None, "volume": .09}
            p["captions"] = {"enabled": any(a.get("words") for a in p["assets"]), "style": "clean", "overrides": {}}
            p["overlays"] = graphics
            p["analysis"] = {"originalDuration": round(original, 2), "editDuration": round(edited, 2),
                             "removedDuration": round(original - edited, 2), "notes": notes,
                             "method": "Local speech timing and quiet-section detection", "intent": intent,
                             "graphicCount": len(graphics)}
            p["job"] = {"status": "ready", "phase": "First cut ready", "progress": 100}
            save_project(p)
    except Exception as exc:
        with LOCK:
            p = read_project(project_id)
            p["job"] = {"status": "error", "phase": str(exc)[:260], "progress": 0}
            save_project(p)


def target_size(format_name: str) -> tuple[int, int]:
    return (720, 1280) if format_name == "vertical" else (1280, 720) if format_name == "wide" else (1080, 1080)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    paths = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def text_png(text: str, size: tuple[int, int], style: str, position: tuple[float, float], path: Path) -> None:
    w, h = size
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    title = style == "title"
    f = font(round(w * (.075 if title else .055)))
    max_width = w * (.78 if title else .86)
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = (current + " " + word).strip()
        if draw.textlength(trial, font=f) > max_width and current:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)
    lines = lines[:4]
    spacing = round(f.size * .22)
    metrics = [draw.textbbox((0, 0), line, font=f) for line in lines]
    line_h = f.size + spacing
    box_h = len(lines) * line_h + round(f.size * .55)
    widest = max((m[2] - m[0] for m in metrics), default=0)
    box_w = min(w - 20, widest + round(f.size * .9))
    cx, cy = position[0] * w, position[1] * h
    x = max(10, min(w - box_w - 10, cx - box_w / 2))
    y = max(10, min(h - box_h - 10, cy - box_h / 2))
    draw.rounded_rectangle((x, y, x + box_w, y + box_h), radius=round(f.size * .23), fill=(8, 8, 8, 205))
    for i, line in enumerate(lines):
        line_w = draw.textlength(line, font=f)
        draw.text((cx - line_w / 2, y + round(f.size * .2) + i * line_h), line, font=f, fill=(255, 255, 250, 255))
    im.save(path)


def captions_for_project(p: dict) -> list[dict]:
    assets = {a["id"]: a for a in p["assets"]}
    output = []
    timeline = 0.0
    overrides = p.get("captions", {}).get("overrides", {})
    for clip in p["clips"]:
        words = assets[clip["assetId"]].get("words", [])
        selected = [(i, word) for i, word in enumerate(words)
                    if word["end"] > clip["sourceStart"] and word["start"] < clip["sourceEnd"]]
        group = []
        def flush():
            if not group:
                return
            first_i, first = group[0]
            last_i, last = group[-1]
            cid = f"{clip['id']}-{first_i}-{last_i}"
            text = " ".join(word["text"] for _, word in group)
            base_start = timeline + max(0, first["start"] - clip["sourceStart"])
            base_end = timeline + min(clip["sourceEnd"] - clip["sourceStart"], last["end"] - clip["sourceStart"] + .08)
            override = overrides.get(cid, {})
            if isinstance(override, str):
                override = {"text": override}
            start = max(0, base_start + float(override.get("startOffset", 0)))
            end = max(start + .05, base_end + float(override.get("endOffset", 0)))
            output.append({"id": cid, "start": round(start, 3), "end": round(end, 3),
                           "baseStart": round(base_start, 3), "baseEnd": round(base_end, 3),
                           "text": override.get("text", text), "type": "caption"})
        for item in selected:
            if group and (len(group) >= 5 or item[1]["start"] - group[-1][1]["end"] > .3 or group[-1][1]["text"].endswith((".", "?", "!"))):
                flush()
                group = []
            group.append(item)
        flush()
        timeline += clip["sourceEnd"] - clip["sourceStart"]
    return output


def generate_bed(name: str) -> Path:
    folder = DATA / "beds"
    folder.mkdir(exist_ok=True)
    output = folder / f"{name}.wav"
    if output.exists():
        return output
    sr, seconds = 24000, 16
    t = np.arange(sr * seconds) / sr
    frequencies = [196, 246.94, 293.66, 369.99] if name == "warm-air" else [174.61, 220, 261.63, 329.63]
    y = np.zeros_like(t)
    for i, hz in enumerate(frequencies):
        y += (np.sin(2 * np.pi * hz * t + i) + .20 * np.sin(2 * np.pi * hz * 2 * t)) / (i + 2) * .06
    y *= (.78 + .22 * np.sin(2 * np.pi * t / seconds))
    if name == "soft-pulse":
        beat = 60 / 92
        for k in range(int(seconds / beat)):
            start = int(k * beat * sr)
            length = min(int(.24 * sr), len(y) - start)
            tt = np.arange(length) / sr
            y[start:start+length] += .034 * np.sin(2 * np.pi * (90 - 35 * tt) * tt) * np.exp(-18 * tt)
    fade = np.minimum(1, np.minimum(t / .4, (seconds - t) / .4))
    y = np.clip(y * fade, -1, 1)
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sr)
        wav.writeframes((y * 32767).astype(np.int16).tobytes())
    return output


def render_project(project_id: str) -> None:
    try:
        with LOCK:
            p = read_project(project_id)
        render_revision = p.get("editRevision", 0)
        if not p["clips"]:
            raise ValueError("There are no clips to export")
        folder = project_dir(project_id)
        temp = folder / "render-work"
        temp.mkdir(exist_ok=True)
        output = folder / "export.mp4"
        w, h = target_size(p["settings"]["format"])
        assets = {a["id"]: a for a in p["assets"]}
        parts = []
        total = sum(max(0, c["sourceEnd"] - c["sourceStart"]) for c in p["clips"])
        for i, clip in enumerate(p["clips"]):
            update_phase(project_id, f"Rendering clip {i+1} of {len(p['clips'])}", int(5 + i / len(p["clips"]) * 58), "rendering")
            asset = assets[clip["assetId"]]
            src = asset_path(project_id, asset)
            part = temp / f"part-{i:04d}.mp4"
            duration = float(clip["sourceEnd"] - clip["sourceStart"])
            if duration < .05:
                continue
            brightness = max(-.3, min(.3, float(clip.get("brightness", 0))))
            contrast = max(.5, min(1.6, float(clip.get("contrast", 1))))
            saturation = max(0, min(2, float(clip.get("saturation", 1))))
            filt = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},eq=brightness={brightness}:contrast={contrast}:saturation={saturation},fps=30,format=yuv420p"
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(clip["sourceStart"]), "-i", str(src)]
            if not asset["hasAudio"]:
                cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
            cmd += ["-t", str(duration), "-map", "0:v:0", "-map", "0:a:0" if asset["hasAudio"] else "1:a:0",
                    "-vf", filt, "-af", f"volume={max(0,min(2,float(clip.get('volume',1))))},aresample=48000",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "aac", "-b:a", "160k",
                    "-ar", "48000", "-ac", "2", "-shortest", str(part)]
            run(cmd, 1200)
            parts.append(part)
        if not parts:
            raise ValueError("All clips are empty")
        list_file = temp / "parts.txt"
        list_file.write_text("".join(f"file '{str(path).replace(chr(39), chr(39)+chr(92)+chr(39)+chr(39))}'\n" for path in parts))
        joined = temp / "joined.mp4"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
             "-c", "copy", str(joined)], 300)
        update_phase(project_id, "Adding graphics and sound", 68, "rendering")
        cutaways = [b for b in p.get("broll", []) if b.get("assetId") in assets and assets[b["assetId"]]["kind"] == "video"
                    and min(float(b.get("sourceEnd", 0)) - float(b.get("sourceStart", 0)),
                            total - max(0, float(b.get("start", 0)))) > .05]
        overlays = list(p.get("overlays", []))
        if p.get("captions", {}).get("enabled"):
            overlays += captions_for_project(p)
        overlays = [o for o in overlays if o.get("text") and float(o.get("end", float(o.get("start", 0)) + float(o.get("duration", 0)))) > float(o.get("start", 0))]
        overlays = overlays[:150]
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(joined)]
        filter_parts = []
        video_label = "[0:v]"
        for i, cutaway in enumerate(cutaways):
            source = asset_path(project_id, assets[cutaway["assetId"]])
            source_start = max(0, float(cutaway.get("sourceStart", 0)))
            length = min(float(cutaway.get("sourceEnd", 0)) - source_start,
                         total - max(0, float(cutaway.get("start", 0))))
            cmd += ["-ss", str(source_start), "-t", str(length), "-i", str(source)]
            start = max(0, float(cutaway.get("start", 0)))
            b_label = f"[b{i}]"
            v_label = f"[vb{i}]"
            filter_parts.append(f"[{i+1}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps=30,format=yuv420p,setpts=PTS-STARTPTS+{start:.3f}/TB{b_label}")
            filter_parts.append(f"{video_label}{b_label}overlay=0:0:enable='between(t,{start:.3f},{start+length:.3f})':eof_action=pass{v_label}")
            video_label = v_label
        for i, overlay in enumerate(overlays):
            png = temp / f"overlay-{i:04d}.png"
            pos = overlay.get("position", {"x": .5, "y": .78 if overlay.get("type") == "caption" else .25})
            text_png(str(overlay["text"]), (w, h), "title" if overlay.get("type") == "title" else "caption",
                     (float(pos.get("x", .5)), float(pos.get("y", .78))), png)
            cmd += ["-loop", "1", "-i", str(png)]
            start = max(0, float(overlay.get("start", 0)))
            end = min(total, float(overlay.get("end", start + float(overlay.get("duration", 0)))))
            next_label = f"[v{i}]"
            x_value = f"'if(lt(t,{start+.3:.3f}),W*(1-(t-{start:.3f})/0.3),0)'" if overlay.get("motion") == "slide" else "0"
            filter_parts.append(f"{video_label}[{len(cutaways)+i+1}:v]overlay=x={x_value}:y=0:enable='between(t,{start:.3f},{end:.3f})':shortest=1{next_label}")
            video_label = next_label
        music = p.get("music", {})
        music_path = None
        if music.get("assetId") in assets and assets[music["assetId"]]["kind"] == "audio":
            music_path = asset_path(project_id, assets[music["assetId"]])
        elif music.get("bed") in {"warm-air", "soft-pulse"}:
            music_path = generate_bed(music["bed"])
        if music_path and float(music.get("volume", 0)) > 0:
            music_input = len(cutaways) + len(overlays) + 1
            cmd += ["-stream_loop", "-1", "-i", str(music_path)]
            filter_parts.append(f"[{music_input}:a]volume={max(0,min(.5,float(music['volume']))):.3f}[bed]")
            filter_parts.append("[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0[aout]")
            audio_label = "[aout]"
        else:
            audio_label = "0:a"
        if filter_parts:
            cmd += ["-filter_complex", ";".join(filter_parts)]
        cmd += ["-map", video_label if overlays or cutaways else "0:v", "-map", audio_label,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-t", str(total), "-movflags", "+faststart", str(output)]
        run(cmd, 1800)
        with LOCK:
            current = read_project(project_id)
            current["job"] = {"status": "exported" if current.get("editRevision", 0) == render_revision else "ready",
                              "phase": "Video ready" if current.get("editRevision", 0) == render_revision else "Changes not exported",
                              "progress": 100}
            save_project(current)
    except Exception as exc:
        with LOCK:
            p = read_project(project_id)
            p["job"] = {"status": "error", "phase": f"Export failed: {str(exc)[:250]}", "progress": 0}
            save_project(p)


class ProjectCreate(BaseModel):
    name: str = "Untitled story"
    brief: str = ""
    format: str = "vertical"
    pace: str = "balanced"


class ProjectEdit(BaseModel):
    name: str | None = None
    brief: str | None = None
    settings: dict | None = None
    clips: list[dict] | None = None
    broll: list[dict] | None = None
    overlays: list[dict] | None = None
    captions: dict | None = None
    music: dict | None = None


@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": bool(shutil.which("ffmpeg")), "transcriptionInstalled": _transcription_installed()}


def _transcription_installed() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


@app.get("/api/projects")
def list_projects():
    items = []
    for path in PROJECTS.glob("*/project.json"):
        try:
            p = json.loads(path.read_text())
            items.append({"id": p["id"], "name": p["name"], "updatedAt": p["updatedAt"],
                          "duration": round(sum(c["sourceEnd"] - c["sourceStart"] for c in p.get("clips", [])), 1),
                          "status": p.get("job", {}).get("status", "draft")})
        except Exception:
            pass
    return sorted(items, key=lambda p: p["updatedAt"], reverse=True)


@app.post("/api/projects")
def create_project(body: ProjectCreate):
    if body.format not in {"vertical", "wide", "square"} or body.pace not in {"calm", "balanced", "brisk"}:
        raise HTTPException(422, "Unsupported format or pace")
    project_id = uid()
    folder = PROJECTS / project_id
    (folder / "media").mkdir(parents=True)
    p = {"id": project_id, "name": body.name.strip()[:100] or "Untitled story",
         "brief": body.brief.strip()[:4000], "settings": {"format": body.format, "pace": body.pace},
         "assets": [], "clips": [], "broll": [], "overlays": [], "music": {"bed": None, "assetId": None, "volume": .09},
         "captions": {"enabled": False, "style": "clean", "overrides": {}},
         "analysis": None, "job": {"status": "draft", "phase": "Add footage", "progress": 0},
         "createdAt": now(), "updatedAt": now(), "editRevision": 0}
    save_project(p)
    return p


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    return read_project(project_id)


@app.patch("/api/projects/{project_id}")
def edit_project(project_id: str, body: ProjectEdit):
    with LOCK:
        p = read_project(project_id)
        payload = body.model_dump(exclude_unset=True)
        if "clips" in payload:
            asset_ids = {a["id"] for a in p["assets"] if a["kind"] == "video"}
            for clip in payload["clips"]:
                if clip.get("assetId") not in asset_ids or float(clip.get("sourceEnd", 0)) <= float(clip.get("sourceStart", 0)):
                    raise HTTPException(422, "Invalid clip")
        if "broll" in payload:
            asset_ids = {a["id"] for a in p["assets"] if a["kind"] == "video"}
            for cutaway in payload["broll"]:
                if cutaway.get("assetId") not in asset_ids or float(cutaway.get("sourceEnd", 0)) <= float(cutaway.get("sourceStart", 0)):
                    raise HTTPException(422, "Invalid cutaway")
        for key in ("name", "brief", "settings", "clips", "broll", "overlays", "captions", "music"):
            if key in payload and payload[key] is not None:
                p[key] = payload[key]
        p["editRevision"] = p.get("editRevision", 0) + 1
        if p["job"]["status"] == "exported":
            p["job"] = {"status": "ready", "phase": "Changes not exported", "progress": 100}
        save_project(p)
    return p


@app.post("/api/projects/{project_id}/assets")
async def upload_assets(project_id: str, files: list[UploadFile] = File(...)):
    with LOCK:
        p = read_project(project_id)
    added = []
    for upload in files:
        name = Path(upload.filename or "media").name[:180]
        ext = Path(name).suffix.lower()
        if ext not in SUPPORTED_VIDEO | SUPPORTED_AUDIO:
            raise HTTPException(422, f"Unsupported file: {name}")
        asset_id = uid()
        stored = asset_id + ext
        path = project_dir(project_id) / "media" / stored
        written = 0
        with path.open("wb") as target:
            while chunk := await upload.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD:
                    path.unlink(missing_ok=True)
                    raise HTTPException(413, f"{name} is over the 1 GB local limit")
                target.write(chunk)
        try:
            details = probe(path)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        asset = {"id": asset_id, "name": name, "storedName": stored, **details,
                 "thumbnail": None, "peaks": make_peaks(path) if details["hasAudio"] else [], "words": []}
        if details["kind"] == "video":
            thumbnail = asset_id + ".jpg"
            make_thumbnail(path, project_dir(project_id) / "media" / thumbnail, details["duration"])
            if (project_dir(project_id) / "media" / thumbnail).exists():
                asset["thumbnail"] = thumbnail
        added.append(asset)
    with LOCK:
        p = read_project(project_id)
        p["assets"].extend(added)
        save_project(p)
    return {"assets": added}


@app.post("/api/projects/{project_id}/analyze")
def start_analysis(project_id: str):
    with LOCK:
        p = read_project(project_id)
        if not any(a["kind"] == "video" for a in p["assets"]):
            raise HTTPException(422, "Add a video first")
        if p["job"]["status"] in {"analyzing", "rendering"}:
            raise HTTPException(409, "Already processing")
        p["job"] = {"status": "analyzing", "phase": "Preparing footage", "progress": 2}
        save_project(p)
    threading.Thread(target=analyse_project, args=(project_id,), daemon=True).start()
    return {"started": True}


@app.get("/api/projects/{project_id}/captions")
def get_captions(project_id: str):
    return captions_for_project(read_project(project_id))


@app.post("/api/projects/{project_id}/render")
def start_render(project_id: str):
    with LOCK:
        p = read_project(project_id)
        if p["job"]["status"] in {"analyzing", "rendering"}:
            raise HTTPException(409, "Already processing")
        if not p["clips"]:
            raise HTTPException(422, "There are no clips to export")
        p["job"] = {"status": "rendering", "phase": "Preparing export", "progress": 1}
        save_project(p)
    threading.Thread(target=render_project, args=(project_id,), daemon=True).start()
    return {"started": True}


@app.get("/api/projects/{project_id}/export")
def download_export(project_id: str):
    path = project_dir(project_id) / "export.mp4"
    if not path.exists():
        raise HTTPException(404, "No export yet")
    return FileResponse(path, media_type="video/mp4", filename=f"spool-{project_id}.mp4")


@app.get("/media/{project_id}/{filename}")
def media(project_id: str, filename: str):
    if Path(filename).name != filename:
        raise HTTPException(404)
    path = project_dir(project_id) / "media" / filename
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)


@app.get("/beds/{name}")
def bed(name: str):
    if name not in {"warm-air", "soft-pulse"}:
        raise HTTPException(404)
    return FileResponse(generate_bed(name), media_type="audio/wav")


app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
