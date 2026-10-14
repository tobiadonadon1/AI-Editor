const $ = (selector) => document.querySelector(selector);
const state = { project: null, captions: [], selected: null, time: 0, playing: false, zoom: 38, history: [], future: [], saveTimer: null, saveQueue: Promise.resolve(), pollTimer: null, activeAsset: null, activeCutaway: null, toastTimer: null, overlayKey: '' };
const player = $('#player');
const cutawayPlayer = $('#cutawayPlayer');
const miniPlayer = $('#miniPlayer');
const musicPlayer = new Audio();
musicPlayer.loop = true;
const editableKeys = ['name', 'brief', 'settings', 'clips', 'broll', 'overlays', 'captions', 'music'];
const fmt = (seconds) => { const s = Math.max(0, Math.floor(seconds || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(16).slice(2, 14);
const duration = () => state.project?.clips.reduce((sum, c) => sum + (c.sourceEnd - c.sourceStart), 0) || 0;
const asset = (id) => state.project?.assets.find(a => a.id === id);
const sourceUrl = (a) => `/media/${state.project.id}/${encodeURIComponent(a.storedName)}`;
const thumbnailUrl = (a) => a.thumbnail ? `/media/${state.project.id}/${encodeURIComponent(a.thumbnail)}` : '';

async function api(url, options = {}) {
  let response;
  try { response = await fetch(url, options); } catch { throw new Error('Cannot connect to the local editor. Check that the server is running.'); }
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  return data;
}
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.hidden = false; el.style.borderLeftColor = error ? '#ea8a7d' : 'var(--accent)';
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.hidden = true, error ? 7000 : 3600);
}
function snapshot() { return JSON.stringify(Object.fromEntries(editableKeys.map(k => [k, state.project[k]]))); }
function remember() { if (!state.project) return; state.history.push(snapshot()); if (state.history.length > 60) state.history.shift(); state.future = []; }
function restore(json) { Object.assign(state.project, JSON.parse(json)); state.selected = null; state.time = Math.min(state.time, duration()); renderEditor(); saveNow().then(loadCaptions); }
function undo() { if (!state.history.length) return; state.future.push(snapshot()); restore(state.history.pop()); }
function redo() { if (!state.future.length) return; state.history.push(snapshot()); restore(state.future.pop()); }
function scheduleSave() { if (state.project?.job.status === 'exported') {state.project.job={status:'ready',phase:'Changes not exported',progress:100};$('#projectStatus').textContent='Changes not exported';} $('#saveState').textContent = 'Saving…'; clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveNow, 550); }
function saveNow() {
  if (!state.project) return Promise.resolve();
  clearTimeout(state.saveTimer);
  const id = state.project.id;
  const payload = JSON.parse(snapshot());
  state.saveQueue = state.saveQueue.catch(() => {}).then(async () => {
    await api(`/api/projects/${id}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
    $('#saveState').textContent = 'Saved locally';
  }).catch(err => { $('#saveState').textContent = 'Not saved'; toast(err.message, true); });
  return state.saveQueue;
}
function changed(recaption = false) { if (state.project.job.status === 'exported') state.project.job = {status:'ready',phase:'Changes not exported',progress:100}; renderEditor(); if (recaption) saveNow().then(loadCaptions); else scheduleSave(); }
function intervalFor(time) {
  const clips = state.project?.clips || [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i], end = cursor + clip.sourceEnd - clip.sourceStart;
    if (time < end - .001 || i === clips.length - 1) return { clip, index: i, start: cursor, end, sourceTime: clip.sourceStart + Math.max(0, Math.min(time - cursor, end - cursor)) };
    cursor = end;
  }
  return null;
}
function timeOfClip(id) { let start = 0; for (const c of state.project?.clips || []) { if (c.id === id) return start; start += c.sourceEnd - c.sourceStart; } return 0; }
function currentMusicUrl() {
  const m = state.project?.music || {};
  if (m.assetId) { const a = asset(m.assetId); return a ? sourceUrl(a) : ''; }
  return m.bed ? `/beds/${m.bed}` : '';
}
function syncMusic() {
  const url = currentMusicUrl();
  if (!url || (state.project.music?.volume || 0) <= 0) { musicPlayer.pause(); return; }
  if (!musicPlayer.src.endsWith(url)) musicPlayer.src = url;
  musicPlayer.volume = Math.min(.5, Number(state.project.music.volume) || 0);
  const bedDuration = state.project.music.assetId ? asset(state.project.music.assetId)?.duration : 16;
  if (bedDuration && Number.isFinite(bedDuration) && Math.abs(musicPlayer.currentTime - state.time % bedDuration) > .35) {
    try { musicPlayer.currentTime = state.time % bedDuration; } catch { /* metadata pending */ }
  }
  if (state.playing && musicPlayer.paused) musicPlayer.play().catch(() => {});
  if (!state.playing && !musicPlayer.paused) musicPlayer.pause();
}
function syncCutaway() {
  const active = state.project?.broll?.find(b => state.time >= b.start && state.time < b.start + b.sourceEnd - b.sourceStart);
  if (!active) { cutawayPlayer.pause(); cutawayPlayer.hidden = true; state.activeCutaway = null; return; }
  const a = asset(active.assetId); if (!a) return;
  if (state.activeCutaway !== active.id) { cutawayPlayer.src = sourceUrl(a); state.activeCutaway = active.id; }
  cutawayPlayer.hidden = false;
  const sourceTime = active.sourceStart + state.time - active.start;
  if (Math.abs(cutawayPlayer.currentTime - sourceTime) > .16) {
    try { cutawayPlayer.currentTime = sourceTime; } catch { /* metadata pending */ }
  }
  if (state.playing && cutawayPlayer.paused) cutawayPlayer.play().catch(()=>{});
  if (!state.playing && !cutawayPlayer.paused) cutawayPlayer.pause();
}
function seek(time, keepPlaying = state.playing) {
  state.time = Math.max(0, Math.min(duration(), Number(time) || 0));
  if (state.time >= duration() && duration() > 0) keepPlaying = false;
  state.playing = keepPlaying;
  const hit = intervalFor(state.time);
  if (!hit) { player.pause(); player.removeAttribute('src'); state.activeAsset = null; $('#previewPoster').hidden = true; $('#emptyStage').hidden = false; state.playing = false; }
  else {
    $('#emptyStage').hidden = true;
    const a = asset(hit.clip.assetId);
    if (state.activeAsset !== a.id) { player.src = sourceUrl(a); state.activeAsset = a.id; }
    const poster = $('#previewPoster');
    if (a.thumbnail) poster.src = thumbnailUrl(a);
    poster.hidden = !a.thumbnail || (state.playing || state.time > .02) && player.readyState >= 2;
    player.volume = Math.min(1, Math.max(0, Number(hit.clip.volume) || 0));
    player.style.filter = `brightness(${1 + (hit.clip.brightness || 0)}) contrast(${hit.clip.contrast || 1}) saturate(${hit.clip.saturation || 1})`;
    poster.style.filter = player.style.filter;
    if (Math.abs(player.currentTime - hit.sourceTime) > .08) {
      try { player.currentTime = hit.sourceTime; } catch { /* metadata pending */ }
    }
    if (state.playing) player.play().catch(() => { state.playing = false; updateTransport(); }); else player.pause();
  }
  syncMusic(); syncCutaway(); updateTransport(); updatePlayhead(); updatePreviewOverlays(); syncMiniPreview();
}
function togglePlay() { if (!duration()) return; if (state.time >= duration() - .05) state.time = 0; seek(state.time, !state.playing); }
function tick() {
  if (state.playing && state.project) {
    const hit = intervalFor(state.time);
    if (hit && state.activeAsset === hit.clip.assetId && !player.paused) {
      const local = Math.max(0, player.currentTime - hit.clip.sourceStart);
      state.time = hit.start + local;
      if (player.currentTime >= hit.clip.sourceEnd - .035 || state.time >= hit.end - .035) seek(hit.end + .001, true);
      else { updateTransport(); updatePlayhead(); updatePreviewOverlays(); syncCutaway(); if (Math.random() < .015) syncMusic(); }
    }
  }
  requestAnimationFrame(tick);
}
function updateTransport() {
  $('#playButton').textContent = state.playing ? 'Ⅱ' : 'Play';
  $('#playButton').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  $('#timecode').innerHTML = `${fmt(state.time)} <span>/ ${fmt(duration())}</span>`;
}
function updatePlayhead() { $('#playhead').style.left = `${state.time * state.zoom}px`; }
function activeOverlays() {
  if (!state.project) return [];
  const captions = state.project.captions.enabled ? state.captions : [];
  return [...state.project.overlays, ...captions].filter(o => state.time >= o.start && state.time <= (o.end ?? o.start + o.duration) && o.text);
}
function updatePreviewOverlays() {
  const container = $('#previewOverlays');
  const active = activeOverlays();
  const key = JSON.stringify(active.map(o => [o.id,o.text,o.position,o.motion,state.selected?.id===o.id]));
  if (key === state.overlayKey) return;
  state.overlayKey = key;
  container.innerHTML = active.map(o => {
    const pos = o.position || { x: .5, y: o.type === 'caption' ? .78 : .25 };
    const sel = state.selected?.id === o.id ? ' selected' : '';
    return `<div class="preview-overlay ${o.type === 'title' ? 'title' : ''}${o.motion === 'slide' ? ' motion-slide' : ''}${sel}" data-select="${o.type === 'caption' ? 'caption' : 'overlay'}" data-id="${esc(o.id)}" style="left:${pos.x * 100}%;top:${pos.y * 100}%">${esc(o.text)}</div>`;
  }).join('');
  syncMiniPreview();
}
function syncMiniPreview() {
  if (!state.project || !state.selected || !window.matchMedia('(max-width:650px)').matches) { miniPlayer.pause(); return; }
  const hit = intervalFor(state.time);
  if (!hit) { miniPlayer.pause(); miniPlayer.removeAttribute('src'); $('#miniOverlays').innerHTML = ''; return; }
  const a = asset(hit.clip.assetId);
  if (!a) return;
  const url = sourceUrl(a);
  if (!miniPlayer.src.endsWith(url)) miniPlayer.src = url;
  if (Math.abs(miniPlayer.currentTime - hit.sourceTime) > .12) { try { miniPlayer.currentTime = hit.sourceTime; } catch { /* metadata pending */ } }
  miniPlayer.style.filter = `brightness(${1 + (hit.clip.brightness || 0)}) contrast(${hit.clip.contrast || 1}) saturate(${hit.clip.saturation || 1})`;
  if (state.playing && miniPlayer.paused) miniPlayer.play().catch(() => {});
  if (!state.playing && !miniPlayer.paused) miniPlayer.pause();
  $('#miniOverlays').innerHTML = activeOverlays().map(o => { const pos=o.position||{x:.5,y:o.type==='caption'?.78:.25}; return `<span style="left:${pos.x*100}%;top:${pos.y*100}%">${esc(o.text)}</span>`; }).join('');
}
function renderWelcome(projects = []) {
  document.body.classList.add('on-welcome');
  document.body.classList.remove('mobile-adjusting'); miniPlayer.pause();
  $('#welcome').hidden = false; $('#editor').hidden = true; $('#projectTitle').textContent = 'New edit'; $('#exportButton').disabled = true;
  $('#recentProjects').hidden = !projects.length;
  $('#recentList').innerHTML = projects.map(p => `<button class="recent-item" type="button" data-open="${p.id}"><span>${esc(p.name)}</span><small>${p.duration ? fmt(p.duration) : 'Draft'} · ${esc(p.status)}</small></button>`).join('');
}
function renderEditor() {
  const p = state.project; if (!p) return;
  document.body.classList.remove('on-welcome');
  $('#welcome').hidden = true; $('#editor').hidden = false;
  $('#projectTitle').textContent = p.name;
  $('#mobileProjectTitle').textContent = p.name;
  $('#miniPreview .mini-stage').className = `mini-stage ${p.settings.format}`;
  $('#exportButton').disabled = !p.clips.length || ['analyzing', 'rendering'].includes(p.job.status);
  if (document.activeElement !== $('#briefEditor')) $('#briefEditor').value = p.brief || '';
  $('#stageFormat').textContent = {vertical:'Vertical · 9:16',wide:'Landscape · 16:9',square:'Square · 1:1'}[p.settings.format];
  $('#videoStage').className = `video-stage ${p.settings.format}`;
  const quiet = Number(p.analysis?.removedDuration || 0);
  const editSummary = p.analysis && p.job.status === 'ready' ? ` · ${p.clips.length} clips · ${state.captions.length} captions${quiet >= .5 ? ` · ${fmt(quiet)} quiet removed` : ''}` : '';
  $('#projectStatus').innerHTML = `${esc(p.job.phase || 'Ready to edit')}<span class="edit-summary">${esc(editSummary)}</span>`;
  $('#mediaCount').textContent = p.assets.length;
  $('#mediaList').innerHTML = p.assets.map(a => `<div class="media-item"><button class="media-main" type="button" data-asset="${a.id}" title="${a.kind === 'video' ? 'Add clip to timeline' : 'Use as music'}"><span class="media-thumb">${a.thumbnail ? `<img src="${thumbnailUrl(a)}" width="45" height="41" alt="">` : '♫'}</span><span class="media-info"><strong>${esc(a.name)}</strong><small>${fmt(a.duration)} · ${a.kind === 'video' ? `${a.width}×${a.height}` : 'Audio'}</small></span><span class="media-add">＋</span></button>${a.kind === 'video' && p.clips.length ? `<button class="media-cutaway" type="button" data-cutaway="${a.id}" aria-label="Use ${esc(a.name)} as a cutaway at the playhead">Add cutaway</button>` : ''}</div>`).join('') || '<div class="inspector-empty">Add a clip to this project.</div>';
  renderAnalysis(); renderTimeline(); renderInspector();
  $('#captionsToggle').setAttribute('aria-pressed', String(!!p.captions.enabled));
  updateTransport(); updatePreviewOverlays();
  if (!p.clips.length) $('#emptyStage').hidden = false;
}
function renderAnalysis() {
  const p = state.project, a = p.analysis;
  if (['analyzing', 'rendering'].includes(p.job.status)) {
    $('#analysisNotes').innerHTML = `<div>${esc(p.job.phase)}</div><div class="progress-rail"><i style="width:${p.job.progress}%"></i></div><div class="phase">${p.job.progress}% complete</div>`; return;
  }
  if (p.job.status === 'error') { $('#analysisNotes').innerHTML = `<div class="inline-error">${esc(p.job.phase)}</div><p>Try rebuilding the cut or exporting again.</p>`; return; }
  if (!a) { $('#analysisNotes').textContent = 'Your edit decisions will appear here once the footage is analyzed.'; return; }
  const notes = (a.notes || []).map(n => `<div class="analysis-note">${esc(n)}</div>`).join('');
  $('#analysisNotes').innerHTML = `<div class="analysis-stat"><span>Source footage</span><strong>${fmt(a.originalDuration)}</strong></div><div class="analysis-stat"><span>First cut</span><strong>${fmt(a.editDuration)}</strong></div><div class="analysis-stat"><span>Quiet time removed</span><strong>${fmt(a.removedDuration)}</strong></div>${a.intent?.targetDuration ? `<div class="analysis-stat"><span>Requested length</span><strong>${fmt(a.intent.targetDuration)}</strong></div>` : ''}${a.graphicCount ? `<div class="analysis-stat"><span>Suggested graphics</span><strong>${a.graphicCount}</strong></div>` : ''}${notes}`;
}
function renderTimeline() {
  const p = state.project, px = state.zoom, len = duration(), trackWidth = Math.max(700, Math.ceil(len * px) + 120);
  $('#timelineInner').style.width = `${trackWidth + 86}px`;
  for (const el of document.querySelectorAll('.track,.ruler')) el.style.width = `${trackWidth}px`;
  const rulerStep = px < 32 ? 10 : px < 60 ? 5 : 2;
  let ticks = ''; for (let t = 0; t <= Math.max(len + rulerStep, 20); t += rulerStep) ticks += `<span class="ruler-tick" style="left:${t * px}px">${fmt(t)}</span>`;
  $('#ruler').innerHTML = ticks;
  let cursor = 0;
  $('#videoTrack').innerHTML = p.clips.map((c, index) => {
    const a = asset(c.assetId), width = Math.max(4, (c.sourceEnd - c.sourceStart) * px), x = cursor * px; cursor += c.sourceEnd - c.sourceStart;
    return `<div class="clip-block${state.selected?.id === c.id ? ' selected' : ''}" role="button" tabindex="0" draggable="true" data-select="clip" data-id="${c.id}" data-index="${index}" style="left:${x}px;width:${width}px" title="${esc(a?.name || 'Clip')} · source ${c.sourceStart.toFixed(1)}–${c.sourceEnd.toFixed(1)}s">${a?.thumbnail ? `<img src="${thumbnailUrl(a)}" width="45" height="32" alt="">` : ''}<span>${c.sourceStart.toFixed(1)}–${c.sourceEnd.toFixed(1)}s</span></div>`;
  }).join('');
  $('#cutawayTrack').innerHTML = (p.broll || []).map(b => { const a=asset(b.assetId);return `<div class="cutaway-block${state.selected?.id===b.id?' selected':''}" role="button" tabindex="0" data-select="cutaway" data-id="${b.id}" style="left:${b.start*px}px;width:${Math.max(6,(b.sourceEnd-b.sourceStart)*px)}px" title="Cutaway: ${esc(a?.name||'Video')}">${a?.thumbnail?`<img src="${thumbnailUrl(a)}" width="45" height="32" alt="">`:''}<span>${esc(a?.name||'Cutaway')}</span></div>`; }).join('');
  $('#captionTrack').innerHTML = p.captions.enabled ? state.captions.map(c => `<div class="caption-block${state.selected?.id === c.id ? ' selected' : ''}" role="button" tabindex="0" data-select="caption" data-id="${esc(c.id)}" style="left:${Math.max(0,c.start) * px}px;width:${Math.max(6,(c.end - c.start) * px)}px" title="${esc(c.text)}"><span>${esc(c.text)}</span></div>`).join('') : '';
  $('#graphicTrack').innerHTML = p.overlays.map(o => `<div class="graphic-block${state.selected?.id === o.id ? ' selected' : ''}" role="button" tabindex="0" data-select="overlay" data-id="${o.id}" style="left:${o.start * px}px;width:${Math.max(6,(o.end-o.start) * px)}px" title="${esc(o.text)}"><span>${esc(o.text)}</span></div>`).join('');
  const m = p.music, label = m.assetId ? asset(m.assetId)?.name : m.bed === 'warm-air' ? 'Warm Air' : m.bed === 'soft-pulse' ? 'Soft Pulse' : '';
  $('#musicTrack').innerHTML = label ? `<div class="music-block${state.selected?.type === 'music' ? ' selected' : ''}" role="button" tabindex="0" data-select="music" data-id="music" style="left:0;width:${Math.max(4,len * px)}px"><span>♫ ${esc(label)} · ${Math.round(m.volume * 100)}%</span></div>` : '';
  updatePlayhead();
}
function fieldRange(label, name, value, min, max, step, display) {
  return `<div class="inspector-field"><label for="ins-${name}">${label}<span id="val-${name}">${display}</span></label><input id="ins-${name}" data-field="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}
function renderInspector() {
  const p = state.project, sel = state.selected, el = $('#inspector');
  const mobileAdjusting = !!sel && window.matchMedia('(max-width:650px)').matches;
  document.body.classList.toggle('mobile-adjusting', mobileAdjusting);
  if (mobileAdjusting) { $('.inspector-panel').setAttribute('role','dialog'); $('.inspector-panel').setAttribute('aria-modal','true'); }
  else { $('.inspector-panel').removeAttribute('role'); $('.inspector-panel').removeAttribute('aria-modal'); }
  $('#miniPreview').hidden = !sel;
  syncMiniPreview();
  if (!sel) {
    el.innerHTML = `<div class="inspector-type">Project</div><div class="inspector-name">Sound & captions</div><div class="toggle-row"><label for="projectCaptions">Show captions</label><input id="projectCaptions" type="checkbox" ${p.captions.enabled ? 'checked' : ''}></div><div class="inspector-field" style="margin-top:19px"><label for="projectMusic">Music</label><select id="projectMusic"><option value="none" ${!p.music.bed && !p.music.assetId ? 'selected' : ''}>No music</option><option value="warm-air" ${p.music.bed === 'warm-air' ? 'selected' : ''}>Warm Air · ambient</option><option value="soft-pulse" ${p.music.bed === 'soft-pulse' ? 'selected' : ''}>Soft Pulse · quiet beat</option>${p.assets.filter(a=>a.kind==='audio').map(a=>`<option value="asset:${a.id}" ${p.music.assetId===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div>${fieldRange('Music volume','musicVolume',p.music.volume,0,.5,.01,`${Math.round(p.music.volume * 100)}%`)}`;
    return;
  }
  if (sel.type === 'clip') {
    const c = p.clips.find(x=>x.id===sel.id); if (!c) { state.selected=null; return renderInspector(); }
    const a = asset(c.assetId);
    el.innerHTML = `<div class="inspector-type">Video clip</div><div class="inspector-name">${esc(a.name)}</div><div class="inspector-grid"><div class="inspector-field"><label for="ins-sourceStart">In point</label><input id="ins-sourceStart" data-field="sourceStart" type="number" step="0.01" min="0" max="${a.duration}" value="${c.sourceStart.toFixed(2)}"></div><div class="inspector-field"><label for="ins-sourceEnd">Out point</label><input id="ins-sourceEnd" data-field="sourceEnd" type="number" step="0.01" min="0" max="${a.duration}" value="${c.sourceEnd.toFixed(2)}"></div></div><p class="inspector-hint" style="margin-top:-9px;margin-bottom:23px">Source clip: ${fmt(a.duration)}. Adjust either point to change the cut.</p>${fieldRange('Brightness','brightness',c.brightness,-.3,.3,.01,`${Math.round(c.brightness*100)}%`)}${fieldRange('Contrast','contrast',c.contrast,.5,1.6,.02,`${Math.round(c.contrast*100)}%`)}${fieldRange('Saturation','saturation',c.saturation,0,2,.02,`${Math.round(c.saturation*100)}%`)}${fieldRange('Original sound','volume',c.volume,0,2,.02,`${Math.round(c.volume*100)}%`)}<div class="section-rule"></div><div class="inspector-actions"><button class="button outline" type="button" data-move="left">Move left</button><button class="button outline" type="button" data-move="right">Move right</button></div><p class="inspector-hint">Cut order and image settings remain editable after the first cut.</p>`;
    return;
  }
  if (sel.type === 'cutaway') {
    const b = (p.broll || []).find(x=>x.id===sel.id); if (!b) {state.selected=null;return renderInspector();}
    const a = asset(b.assetId);
    el.innerHTML = `<div class="inspector-type">Cutaway</div><div class="inspector-name">${esc(a.name)}</div><p class="inspector-hint" style="margin-bottom:20px">This visual covers the main video while its original narration continues.</p><div class="inspector-field"><label for="ins-cutawayStart">On timeline at</label><input id="ins-cutawayStart" data-field="cutawayStart" type="number" min="0" max="${duration()}" step="0.1" value="${b.start.toFixed(1)}"></div><div class="inspector-grid"><div class="inspector-field"><label for="ins-cutawayIn">Source in</label><input id="ins-cutawayIn" data-field="cutawayIn" type="number" min="0" max="${a.duration}" step="0.1" value="${b.sourceStart.toFixed(1)}"></div><div class="inspector-field"><label for="ins-cutawayOut">Source out</label><input id="ins-cutawayOut" data-field="cutawayOut" type="number" min="0" max="${a.duration}" step="0.1" value="${b.sourceEnd.toFixed(1)}"></div></div><p class="inspector-hint">Place supporting footage where the explanation needs a visual change.</p>`;
    return;
  }
  if (sel.type === 'caption') {
    const c = state.captions.find(x=>x.id===sel.id); if (!c) { state.selected=null; return renderInspector(); }
    el.innerHTML = `<div class="inspector-type">Caption</div><div class="inspector-name">${fmt(c.start)} – ${fmt(c.end)}</div><div class="inspector-field"><label for="ins-captionText">On-screen words</label><textarea id="ins-captionText" rows="4">${esc(c.text)}</textarea></div><div class="inspector-grid"><div class="inspector-field"><label for="ins-captionStart">Start</label><input id="ins-captionStart" data-field="captionStart" type="number" min="0" max="${duration()}" step="0.01" value="${c.start.toFixed(2)}"></div><div class="inspector-field"><label for="ins-captionEnd">End</label><input id="ins-captionEnd" data-field="captionEnd" type="number" min="0" max="${duration()}" step="0.01" value="${c.end.toFixed(2)}"></div></div><p class="inspector-hint">Change the words and timing here. If you reorder clips, this timing moves with the source speech.</p><button class="button outline full" type="button" id="hideCaptionButton">Hide this caption</button>`;
    return;
  }
  if (sel.type === 'overlay') {
    const o = p.overlays.find(x=>x.id===sel.id); if (!o) { state.selected=null; return renderInspector(); }
    el.innerHTML = `<div class="inspector-type">Title graphic</div><div class="inspector-name">On-screen title</div><div class="inspector-field"><label for="ins-overlayText">Text</label><textarea id="ins-overlayText" rows="3">${esc(o.text)}</textarea></div><div class="inspector-grid"><div class="inspector-field"><label for="ins-start">Start</label><input id="ins-start" data-field="start" type="number" min="0" max="${duration()}" step="0.1" value="${o.start.toFixed(1)}"></div><div class="inspector-field"><label for="ins-end">End</label><input id="ins-end" data-field="end" type="number" min="0" max="${duration()}" step="0.1" value="${o.end.toFixed(1)}"></div></div>${fieldRange('Horizontal','x',o.position?.x??.5,.05,.95,.01,`${Math.round((o.position?.x??.5)*100)}%`)}${fieldRange('Vertical','y',o.position?.y??.25,.05,.95,.01,`${Math.round((o.position?.y??.25)*100)}%`)}<p class="inspector-hint">You can also drag the title on the preview.</p>`;
    return;
  }
  if (sel.type === 'music') {
    state.selected = null; renderInspector();
  }
}
async function loadCaptions() {
  if (!state.project) return;
  try { state.captions = await api(`/api/projects/${state.project.id}/captions`); renderTimeline(); renderInspector(); updatePreviewOverlays(); }
  catch (err) { toast(err.message, true); }
}
async function loadProject(id) {
  clearInterval(state.pollTimer); state.playing = false; player.pause(); musicPlayer.pause(); cutawayPlayer.pause(); state.activeAsset = null; state.activeCutaway = null; state.overlayKey = '';
  try {
    state.project = await api(`/api/projects/${id}`); state.project.broll ||= []; state.selected = null; state.time = 0; state.history = []; state.future = [];
    history.replaceState({}, '', `/?project=${id}`);
    await loadCaptions(); renderEditor(); seek(0, false);
    if (['analyzing','rendering'].includes(state.project.job.status)) pollJob();
  } catch (err) { toast(err.message, true); }
}
function pollJob() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.project) return;
    try {
      const fresh = await api(`/api/projects/${state.project.id}`);
      state.project.job = fresh.job; state.project.analysis = fresh.analysis;
      $('#projectStatus').textContent = fresh.job.phase;
      renderAnalysis();
      if (!['analyzing','rendering'].includes(fresh.job.status)) {
        clearInterval(state.pollTimer);
        if (fresh.job.status === 'ready' || fresh.job.status === 'exported') {
          const wasExport = fresh.job.status === 'exported';
          await loadProject(fresh.id);
          if (wasExport) toast('Video ready. Download it from Export video.');
          else toast('First cut ready. Review each choice on the timeline.');
        } else { renderEditor(); toast(fresh.job.phase, true); }
      }
    } catch (err) { clearInterval(state.pollTimer); toast(err.message, true); }
  }, 1100);
}
async function createProject(event) {
  event.preventDefault();
  const files = $('#welcomeFiles').files;
  if (!files.length || ![...files].some(f=>f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name))) { toast('Add at least one video clip.', true); return; }
  const button = $('#createForm button[type=submit]'); button.disabled = true; button.textContent = 'Preparing footage…';
  try {
    const idea = $('#storyIdea').value.trim();
    const p = await api('/api/projects', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:idea.slice(0,52) || 'Untitled story',brief:idea,format:$('#videoFormat').value,pace:$('#videoPace').value})});
    const form = new FormData(); for (const file of files) form.append('files',file);
    await api(`/api/projects/${p.id}/assets`,{method:'POST',body:form});
    await api(`/api/projects/${p.id}/analyze`,{method:'POST'});
    await loadProject(p.id);
  } catch(err) { toast(err.message,true); }
  finally { button.disabled=false; button.innerHTML='Create first cut <span aria-hidden="true">↗</span>'; }
}
async function addMedia(files) {
  if (!state.project || !files.length) return;
  try {
    const form = new FormData(); for (const file of files) form.append('files',file);
    const result = await api(`/api/projects/${state.project.id}/assets`,{method:'POST',body:form});
    state.project.assets.push(...result.assets); renderEditor(); toast(`${result.assets.length} file${result.assets.length===1?'':'s'} added. Click a file to place it.`);
  } catch(err) { toast(err.message,true); }
}
function addAsset(id) {
  const a = asset(id); if (!a) return; remember();
  if (a.kind === 'audio') { state.project.music={bed:null,assetId:id,volume:.09}; state.selected=null; changed(); syncMusic(); toast('Music track added. Adjust its level in the Inspector.'); return; }
  const clip={id:uid(),assetId:id,sourceStart:0,sourceEnd:a.duration,brightness:a.suggestedBrightness||0,contrast:1,saturation:1,volume:1};
  const start=duration(); state.project.clips.push(clip); state.selected={type:'clip',id:clip.id}; changed(true); seek(start,false); toast('Clip added to the end of the story.');
}
function addCutaway(id) {
  const a=asset(id);if(!a||a.kind!=='video')return;
  if(!duration()){addAsset(id);return;}
  remember();const length=Math.min(3.2,a.duration,duration());const start=Math.min(state.time,Math.max(0,duration()-length));
  const b={id:uid(),assetId:id,start:Number(start.toFixed(2)),sourceStart:0,sourceEnd:Number(length.toFixed(2))};
  state.project.broll.push(b);state.selected={type:'cutaway',id:b.id};changed();seek(start,false);toast('Cutaway placed. The main narration continues underneath.');
}
function splitAtPlayhead() {
  const hit=intervalFor(state.time); if(!hit) return;
  const offset=state.time-hit.start; if(offset<.13||hit.end-state.time<.13){toast('Move the playhead farther inside a clip to split it.',true);return;}
  remember(); const c=hit.clip, split=c.sourceStart+offset; const left={...c,sourceEnd:Number(split.toFixed(3))}; const right={...c,id:uid(),sourceStart:Number(split.toFixed(3))};
  state.project.clips.splice(hit.index,1,left,right); state.selected={type:'clip',id:right.id}; changed(true); toast('Clip split at the playhead.');
}
function deleteSelected() {
  if(!state.selected){toast('Select something on the timeline first.');return;}
  remember(); const s=state.selected;
  if(s.type==='clip') state.project.clips=state.project.clips.filter(c=>c.id!==s.id);
  if(s.type==='cutaway') state.project.broll=state.project.broll.filter(b=>b.id!==s.id);
  if(s.type==='overlay') state.project.overlays=state.project.overlays.filter(o=>o.id!==s.id);
  if(s.type==='caption') state.project.captions.overrides[s.id]={...(typeof state.project.captions.overrides[s.id]==='object'?state.project.captions.overrides[s.id]:{}),text:''};
  if(s.type==='music') state.project.music={bed:null,assetId:null,volume:0};
  state.selected=null; state.time=Math.min(state.time,duration()); changed(s.type==='clip'||s.type==='caption'); seek(state.time,false);
}
function moveClip(direction) {
  const i=state.project.clips.findIndex(c=>c.id===state.selected?.id); const j=i+direction;
  if(i<0||j<0||j>=state.project.clips.length)return;
  remember(); const [clip]=state.project.clips.splice(i,1); state.project.clips.splice(j,0,clip); changed(true); seek(timeOfClip(clip.id),false);
}
function addTitle() {
  if(!state.project?.clips.length){toast('Add footage before placing a title.',true);return;}
  const total=duration(), length=Math.min(2.5,total), occupied=state.project.overlays.filter(o=>o.type==='title').sort((a,b)=>a.start-b.start);
  const findSpace=(from)=>{let at=from;for(const o of occupied){if(o.end<=at)continue;if(at+length<=o.start)return at;at=Math.max(at,o.end+.08);}return at+length<=total?at:null;};
  const start=findSpace(Math.min(state.time,Math.max(0,total-length)))??findSpace(0);
  if(start===null){toast('No free space for another title. Move or shorten an existing title first.',true);return;}
  remember(); const o={id:uid(),type:'title',text:'Your title',start,end:Math.min(total,start+length),position:{x:.5,y:.25}};
  state.project.overlays.push(o); state.selected={type:'overlay',id:o.id}; changed(); seek(start,false);
  setTimeout(()=>$('#ins-overlayText')?.focus(),0);
}
function select(type,id) {
  state.selected={type,id}; renderTimeline(); renderInspector(); updatePreviewOverlays();
  if(window.matchMedia('(max-width:650px)').matches) { $('.inspector-panel').scrollTop = 0; $('#returnPreviewButton').focus(); }
  if(type==='clip') seek(timeOfClip(id),false);
  if(type==='caption') seek(state.captions.find(c=>c.id===id)?.start||0,false);
  if(type==='overlay') seek(state.project.overlays.find(o=>o.id===id)?.start||0,false);
  if(type==='cutaway') seek(state.project.broll.find(b=>b.id===id)?.start||0,false);
}
function editInspector(event) {
  const target=event.target, field=target.dataset.field, p=state.project;
  if(!p) return;
  if(target.id==='projectCaptions'){remember();p.captions.enabled=target.checked;changed();return;}
  if(target.id==='projectMusic'){remember();const v=target.value;p.music.assetId=v.startsWith('asset:')?v.slice(6):null;p.music.bed=v!=='none'&&!v.startsWith('asset:')?v:null;changed();syncMusic();return;}
  if(target.id==='ins-captionText'){const c=state.captions.find(x=>x.id===state.selected?.id);if(c){const old=p.captions.overrides[c.id];p.captions.overrides[c.id]={...(typeof old==='object'?old:{}),text:target.value};c.text=target.value;renderTimeline();updatePreviewOverlays();scheduleSave();}return;}
  if(target.id==='ins-overlayText'){const o=p.overlays.find(x=>x.id===state.selected?.id);if(o){o.text=target.value;renderTimeline();updatePreviewOverlays();scheduleSave();}return;}
  if(!field)return;
  const val=Number(target.value); if(!Number.isFinite(val))return;
  if(state.selected?.type==='caption' && (field==='captionStart'||field==='captionEnd')){
    const c=state.captions.find(x=>x.id===state.selected.id);if(!c)return;
    const old=p.captions.overrides[c.id];const override={...(typeof old==='object'?old:{text:typeof old==='string'?old:c.text})};
    if(field==='captionStart'){c.start=Math.max(0,Math.min(val,c.end-.05));override.startOffset=Number((c.start-c.baseStart).toFixed(3));}
    else {c.end=Math.min(duration(),Math.max(val,c.start+.05));override.endOffset=Number((c.end-c.baseEnd).toFixed(3));}
    p.captions.overrides[c.id]=override;scheduleSave();renderTimeline();updatePreviewOverlays();return;
  }
  if(field==='musicVolume'){p.music.volume=val;$('#val-musicVolume').textContent=`${Math.round(val*100)}%`;scheduleSave();syncMusic();renderTimeline();return;}
  if(state.selected?.type==='cutaway'){
    const b=p.broll.find(x=>x.id===state.selected.id),a=asset(b?.assetId);if(!b||!a)return;
    if(field==='cutawayStart')b.start=Math.max(0,Math.min(val,duration()-.1));
    if(field==='cutawayIn')b.sourceStart=Math.max(0,Math.min(val,b.sourceEnd-.1));
    if(field==='cutawayOut')b.sourceEnd=Math.min(a.duration,Math.max(val,b.sourceStart+.1));
    scheduleSave();renderTimeline();syncCutaway();return;
  }
  if(state.selected?.type==='clip'){
    const c=p.clips.find(x=>x.id===state.selected.id),a=asset(c.assetId);if(!c)return;
    if(field==='sourceStart') c.sourceStart=Math.max(0,Math.min(val,c.sourceEnd-.1));
    else if(field==='sourceEnd') c.sourceEnd=Math.min(a.duration,Math.max(val,c.sourceStart+.1));
    else c[field]=val;
    if($('#val-'+field))$('#val-'+field).textContent=`${Math.round(val*100)}%`;
    if(field==='volume')player.volume=Math.min(1,val);
    if(field==='sourceStart'||field==='sourceEnd') { renderTimeline(); scheduleSave(); }
    else { scheduleSave(); renderTimeline(); player.style.filter = `brightness(${1 + (c.brightness || 0)}) contrast(${c.contrast || 1}) saturate(${c.saturation || 1})`; syncMiniPreview(); }
    return;
  }
  if(state.selected?.type==='overlay'){
    const o=p.overlays.find(x=>x.id===state.selected.id);if(!o)return;
    if(field==='start')o.start=Math.max(0,Math.min(val,o.end-.1));
    else if(field==='end')o.end=Math.min(duration(),Math.max(val,o.start+.1));
    else {o.position=o.position||{x:.5,y:.25};o.position[field]=val;$('#val-'+field).textContent=`${Math.round(val*100)}%`;}
    scheduleSave();renderTimeline();updatePreviewOverlays();
  }
}
function startOverlayDrag(event) {
  const target=event.target.closest('.preview-overlay'); if(!target||target.dataset.select!=='overlay')return;
  event.preventDefault(); select('overlay',target.dataset.id);
  const stage=$('#videoStage');const id=target.dataset.id;remember();
  const move=(e)=>{const rect=stage.getBoundingClientRect(),o=state.project.overlays.find(x=>x.id===id);if(!o)return;o.position={x:Math.max(.05,Math.min(.95,(e.clientX-rect.left)/rect.width)),y:Math.max(.05,Math.min(.95,(e.clientY-rect.top)/rect.height))};updatePreviewOverlays();};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);renderInspector();scheduleSave();};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
}
function handleSelection(event) {
  const item=event.target.closest('[data-select]'); if(!item)return;
  event.stopPropagation();select(item.dataset.select,item.dataset.id);
}
function configureDragDrop() {
  const drop=$('#welcomeDrop');
  for(const eventName of ['dragenter','dragover'])drop.addEventListener(eventName,e=>{e.preventDefault();drop.classList.add('dragover');});
  for(const eventName of ['dragleave','drop'])drop.addEventListener(eventName,e=>{e.preventDefault();drop.classList.remove('dragover');});
  drop.addEventListener('drop',e=>{if(e.dataTransfer.files.length){$('#welcomeFiles').files=e.dataTransfer.files;updateFiles();}});
  $('#welcomeFiles').addEventListener('change',updateFiles);
}
let filePreviewRun = 0;
async function videoStills(file) {
  const url = URL.createObjectURL(file), video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true; video.src = url;
  try {
    await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Preview timed out')),6500); video.onloadedmetadata=()=>{clearTimeout(timer);resolve();}; video.onerror=()=>{clearTimeout(timer);reject(new Error('Preview unavailable'));}; });
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
    canvas.width=120;canvas.height=160;
    const stills=[];
    for (const fraction of [.08,.5,.9]) {
      const time=Math.min(Math.max(.06,video.duration*fraction),Math.max(.06,video.duration-.06));
      await new Promise(resolve=>{const timer=setTimeout(resolve,2200);video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=time;});
      const scale=Math.max(canvas.width/video.videoWidth,canvas.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
      context.drawImage(video,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
      stills.push(canvas.toDataURL('image/jpeg',.78));
    }
    return stills;
  } finally { video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url); }
}
function updateFiles() {
  const files=[...$('#welcomeFiles').files], art=$('#welcomeDrop .drop-art'), frames=[...art.querySelectorAll('.film-frame')], run=++filePreviewRun;
  $('#welcomeDrop strong').textContent=files.length?`${files.length} file${files.length===1?'':'s'} ready`:'Add your clips';
  $('#welcomeDrop > span').textContent=files.length?'Click to change selection':'Drop videos here or choose files';
  $('#welcomeFileNames').textContent=files.length?files.map(f=>f.name).join(' · '):'';
  $('#welcomeDrop').classList.toggle('has-files',!!files.length);
  art.classList.remove('has-thumbnails');frames.forEach(frame=>frame.style.backgroundImage='');
  const videoFile=files.find(f=>f.type.startsWith('video/')||/\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
  if (videoFile) videoStills(videoFile).then(stills=>{if(run!==filePreviewRun)return;frames.forEach((frame,i)=>frame.style.backgroundImage=`url("${stills[i]}")`);art.classList.add('has-thumbnails');}).catch(()=>{});
}
async function goHome() { state.playing=false;player.pause();musicPlayer.pause();cutawayPlayer.pause();state.project=null;state.captions=[];clearInterval(state.pollTimer);history.replaceState({},'','/');try{renderWelcome(await api('/api/projects'));}catch(err){renderWelcome([]);toast(err.message,true);} }
function renameProject() { if(!state.project)return;const v=prompt('Project name',state.project.name);if(v?.trim()){remember();state.project.name=v.trim().slice(0,100);changed();} }
async function init() {
  configureDragDrop();
  $('#createForm').addEventListener('submit',createProject);
  $('#brandButton').addEventListener('click',goHome);
  $('#returnPreviewButton').addEventListener('click',()=>{if(document.body.classList.contains('mobile-adjusting')){state.selected=null;renderTimeline();renderInspector();updatePreviewOverlays();}else $('#videoStage').scrollIntoView({behavior:'smooth',block:'center'});});
  $('#newProjectButton').addEventListener('click',goHome);
  $('#projectTitle').addEventListener('click',renameProject);
  $('#mobileProjectTitle').addEventListener('click',renameProject);
  $('#recentList').addEventListener('click',e=>{const b=e.target.closest('[data-open]');if(b)loadProject(b.dataset.open);});
  $('#briefEditor').addEventListener('input',e=>{if(!state.project)return;state.project.brief=e.target.value;scheduleSave();});
  $('#rebuildButton').addEventListener('click',async()=>{if(!state.project)return;if(!confirm('Rebuild the first cut? This replaces your clip order, captions and titles.'))return;try{await api(`/api/projects/${state.project.id}/analyze`,{method:'POST'});state.project.job={status:'analyzing',phase:'Preparing footage',progress:2};renderEditor();pollJob();}catch(err){toast(err.message,true);}});
  $('#addMediaInput').addEventListener('change',e=>{addMedia(e.target.files);e.target.value='';});
  $('#mediaList').addEventListener('click',e=>{const cutaway=e.target.closest('[data-cutaway]');if(cutaway){addCutaway(cutaway.dataset.cutaway);return;}const b=e.target.closest('[data-asset]');if(b)addAsset(b.dataset.asset);});
  $('#playButton').addEventListener('click',togglePlay);
  $('#skipBack').addEventListener('click',()=>seek(state.time-5,false));
  $('#skipForward').addEventListener('click',()=>seek(state.time+5,false));
  $('#captionsToggle').addEventListener('click',()=>{if(!state.project)return;remember();state.project.captions.enabled=!state.project.captions.enabled;changed();});
  $('#addTitleButton').addEventListener('click',addTitle);
  $('#splitButton').addEventListener('click',splitAtPlayhead);
  $('#deleteButton').addEventListener('click',deleteSelected);
  $('#undoButton').addEventListener('click',undo);
  $('#redoButton').addEventListener('click',redo);
  $('#zoomRange').addEventListener('input',e=>{state.zoom=Number(e.target.value);renderTimeline();});
  $('#timelineInner').addEventListener('click',e=>{if(e.target.closest('[data-select]'))return;const rect=$('#videoTrack').getBoundingClientRect();seek((e.clientX-rect.left)/state.zoom,false);state.selected=null;renderTimeline();renderInspector();});
  for(const selector of ['#videoTrack','#cutawayTrack','#captionTrack','#graphicTrack','#musicTrack','#previewOverlays'])$(selector).addEventListener('click',handleSelection);
  $('#previewOverlays').addEventListener('pointerdown',startOverlayDrag);
  $('#timelineInner').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.dataset.select){e.preventDefault();select(e.target.dataset.select,e.target.dataset.id);}});
  $('#videoTrack').addEventListener('dragstart',e=>{const el=e.target.closest('[data-index]');if(el)e.dataTransfer.setData('text/plain',el.dataset.id);});
  $('#videoTrack').addEventListener('dragover',e=>{if(e.target.closest('[data-index]'))e.preventDefault();});
  $('#videoTrack').addEventListener('drop',e=>{e.preventDefault();const target=e.target.closest('[data-index]');const id=e.dataTransfer.getData('text/plain');if(!target||!id||target.dataset.id===id)return;const from=state.project.clips.findIndex(c=>c.id===id),to=state.project.clips.findIndex(c=>c.id===target.dataset.id);if(from<0||to<0)return;remember();const [clip]=state.project.clips.splice(from,1);state.project.clips.splice(to,0,clip);changed(true);seek(timeOfClip(id),false);});
  $('#inspector').addEventListener('input',editInspector);
  $('#inspector').addEventListener('change',e=>{if(e.target.dataset.field==='sourceStart'||e.target.dataset.field==='sourceEnd'){saveNow().then(loadCaptions);seek(state.time,false);}});
  $('#inspector').addEventListener('click',e=>{const move=e.target.closest('[data-move]');if(move)moveClip(move.dataset.move==='left'?-1:1);if(e.target.id==='hideCaptionButton')deleteSelected();});
  $('#exportButton').addEventListener('click',async()=>{if(!state.project)return;if(state.project.job.status==='exported'){window.location.href=`/api/projects/${state.project.id}/export`;return;}try{await saveNow();await api(`/api/projects/${state.project.id}/render`,{method:'POST'});state.project.job={status:'rendering',phase:'Preparing export',progress:1};renderEditor();pollJob();}catch(err){toast(err.message,true);}});
  document.addEventListener('keydown',e=>{if(!state.project)return;if(e.key==='Escape'&&document.body.classList.contains('mobile-adjusting')){state.selected=null;renderTimeline();renderInspector();updatePreviewOverlays();return;}if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(e.key.toLowerCase()==='s'&&!e.metaKey&&!e.ctrlKey){e.preventDefault();splitAtPlayhead();}if(e.key==='Delete'||e.key==='Backspace')deleteSelected();if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}});
  player.addEventListener('ended',()=>{if(state.playing)seek(Math.min(duration(),state.time+.05),true);});
  requestAnimationFrame(tick);
  const id=new URLSearchParams(location.search).get('project');if(id)await loadProject(id);else await goHome();
}
init();
