/* Browser workspace for static deployments. Projects and footage stay on this device. */
const BrowserEngine = (() => {
  const DB_NAME = 'advanced-ai-editor-v1';
  const urls = new Map();
  let database;
  const id = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const now = () => new Date().toISOString();
  const copy = value => structuredClone(value);

  async function db() {
    if (database) return database;
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', {keyPath: 'id'});
        request.result.createObjectStore('media', {keyPath: 'key'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('This browser could not open local project storage.'));
    });
    return database;
  }
  async function transact(store, mode, action) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction(store, mode);
      const request = action(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Local storage failed.'));
      tx.onerror = () => reject(tx.error || new Error('Local storage failed.'));
    });
  }
  const get = (store, key) => transact(store, 'readonly', os => os.get(key));
  const put = (store, value) => transact(store, 'readwrite', os => os.put(value));
  async function project(projectId) {
    const p = await get('projects', projectId);
    if (!p) throw new Error('This project is not available on this device.');
    return p;
  }
  async function hydrate(p) {
    for (const a of p.assets) {
      if (urls.has(a.id)) continue;
      const row = await get('media', `${p.id}/${a.id}`);
      if (!row?.blob) throw new Error(`Source file missing: ${a.name}`);
      urls.set(a.id, URL.createObjectURL(row.blob));
    }
  }
  const mediaUrl = assetId => urls.get(assetId) || '';
  const thumbnailUrl = a => a.thumbnail || '';

  async function metadata(blob, kind) {
    const element = document.createElement(kind === 'video' ? 'video' : 'audio');
    const url = URL.createObjectURL(blob);
    try {
      element.preload = 'metadata'; element.muted = true; element.src = url;
      await new Promise((resolve, reject) => {
        element.onloadedmetadata = resolve;
        element.onerror = () => reject(new Error(`This browser cannot read ${blob.name}. Try MP4, WebM, MP3 or WAV.`));
      });
      const result = {duration: Number(element.duration), width: element.videoWidth || 0, height: element.videoHeight || 0};
      if (!Number.isFinite(result.duration) || result.duration <= 0 || result.duration > 7200) throw new Error(`${blob.name} must be between 1 second and 2 hours.`);
      let thumbnail = null, suggestedBrightness = 0;
      if (kind === 'video') {
        try {
          element.currentTime = Math.min(1, result.duration * .2);
          await new Promise((resolve, reject) => { element.onseeked = resolve; element.onerror = reject; setTimeout(resolve, 1800); });
          const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = Math.max(1, Math.round(320 * result.height / result.width));
          const ctx = canvas.getContext('2d');ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
          const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let sum=0,count=0;
          for(let i=0;i<pixels.length;i+=128){sum+=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];count++;}
          suggestedBrightness=+Math.max(-.08,Math.min(.08,(112-sum/Math.max(1,count))/700)).toFixed(3);
          thumbnail = canvas.toDataURL('image/jpeg', .7);
        } catch { /* Missing thumbnails do not block editing. */ }
      }
      return {...result, thumbnail, suggestedBrightness};
    } finally { element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); }
  }

  async function quietIntervals(blob, duration, pace, brief) {
    if (blob.size > 120 * 1024 * 1024 || duration > 360 || /(?:keep|leave|don't cut|do not cut).{0,25}(?:pause|silence|quiet)/i.test(brief)) return null;
    const context = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const audio = await context.decodeAudioData(await blob.arrayBuffer());
      const channel = audio.getChannelData(0), sr = audio.sampleRate;
      const step = Math.max(1, Math.round(sr * .06));
      const minimum = {calm: 1.2, balanced: .75, brisk: .5}[pace] || .75;
      const spans = []; let start = -1;
      for (let at = 0; at < channel.length; at += step) {
        let energy = 0; const end = Math.min(channel.length, at + step);
        for (let i = at; i < end; i += 4) energy += channel[i] * channel[i];
        const rms = Math.sqrt(energy / Math.max(1, Math.ceil((end - at) / 4)));
        const quiet = rms < .009;
        if (quiet && start < 0) start = at / sr;
        if ((!quiet || end === channel.length) && start >= 0) {
          const finish = end / sr;
          if (finish - start >= minimum) spans.push([start, finish]);
          start = -1;
        }
      }
      if (!spans.length || spans.reduce((n, [s, e]) => n + e - s, 0) > duration * .85) return [[0, duration]];
      const output = []; let cursor = 0;
      for (const [s, e] of spans) {
        const keepTo = Math.min(duration, s + .14);
        if (keepTo - cursor > .24) output.push([cursor, keepTo]);
        cursor = Math.max(cursor, e - .16);
      }
      if (duration - cursor > .24) output.push([cursor, duration]);
      return output.length ? output : [[0, duration]];
    } catch { return null; }
    finally { await context.close(); }
  }

  async function analyze(p) {
    const videos = p.assets.filter(a => a.kind === 'video');
    if (!videos.length) throw new Error('Add a video clip first.');
    const clips = [], notes = []; let original = 0;
    for (const a of videos) {
      original += a.duration;
      const row = await get('media', `${p.id}/${a.id}`);
      const ranges = await quietIntervals(row.blob, a.duration, p.settings.pace, p.brief);
      for (const [start, end] of ranges || [[0, a.duration]]) clips.push({id:id(),assetId:a.id,sourceStart:+start.toFixed(3),sourceEnd:+end.toFixed(3),brightness:a.suggestedBrightness||0,contrast:1,saturation:1,volume:1});
      if (ranges === null) notes.push(`${a.name}: kept the full clip; audio analysis was unavailable or deliberately skipped.`);
    }
    const edited = clips.reduce((n, c) => n + c.sourceEnd - c.sourceStart, 0);
    const title = p.brief.match(/(?:^|\n)\s*(?:title|headline)\s*:\s*([^\n.]{3,70})/i)?.[1]?.trim();
    p.clips = clips; p.broll = [];
    p.overlays = title ? [{id:id(),type:'title',text:title,start:.2,end:Math.min(edited,2.8),position:{x:.5,y:.26}}] : [];
    p.captions = {enabled:false,style:'clean',overrides:{}};
    const noMusic = /\b(?:no music|without music|no soundtrack)\b/i.test(p.brief);
    const calm = /\b(?:calm|soft|gentle|relaxed|quiet)\b/i.test(p.brief) || p.settings.pace === 'calm';
    p.music = {bed:noMusic?null:calm?'warm-air':'soft-pulse',assetId:null,volume:.09};
    p.analysis = {originalDuration:+original.toFixed(2),editDuration:+edited.toFixed(2),removedDuration:+(original-edited).toFixed(2),graphicCount:p.overlays.length,notes:[...notes,'Quiet sections were measured from the audio. Review cuts before export.','Speech captions need manual text in this browser workspace.'],method:'Browser audio energy'};
    p.job = {status:'ready',phase:'First cut ready',progress:100}; p.updatedAt = now();
    await put('projects', p);
    return p;
  }

  function bedUrl(name) {
    const key = `bed:${name}`;
    if (urls.has(key)) return urls.get(key);
    const sr = 22050, seconds = 16, count = sr * seconds;
    const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
    const write = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    write(0,'RIFF');view.setUint32(4,36+count*2,true);write(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sr,true);view.setUint32(28,sr*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,count*2,true);
    const notes = name === 'warm-air' ? [196,246.94,293.66] : [174.61,220,261.63];
    for (let i=0;i<count;i++) {
      const t=i/sr; let sample=0;
      notes.forEach((hz,j)=>sample += Math.sin(2*Math.PI*hz*t+j)*(.037/(j+1)));
      if(name==='soft-pulse') {const beat=(t%(60/92));sample+=.025*Math.sin(2*Math.PI*(90-35*beat)*beat)*Math.exp(-17*beat);}
      const fade=Math.min(1,t/.4,(seconds-t)/.4);view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,sample*fade))*32767),true);
    }
    const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));urls.set(key,url);return url;
  }

  async function request(path, options={}) {
    const method=(options.method||'GET').toUpperCase(), bits=path.split('/').filter(Boolean);
    if(path==='/api/health') return {ok:true,mode:'browser'};
    if(path==='/api/projects' && method==='GET') {
      const all=await transact('projects','readonly',os=>os.getAll());
      return all.map(p=>({id:p.id,name:p.name,updatedAt:p.updatedAt,duration:p.clips.reduce((n,c)=>n+c.sourceEnd-c.sourceStart,0),status:p.job.status})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    }
    if(path==='/api/projects' && method==='POST') {
      const body=JSON.parse(options.body), stamp=now();
      const p={id:id(),name:body.name?.trim().slice(0,100)||'Untitled story',brief:body.brief?.trim().slice(0,4000)||'',settings:{format:body.format,pace:body.pace},assets:[],clips:[],broll:[],overlays:[],music:{bed:null,assetId:null,volume:.09},captions:{enabled:false,style:'clean',overrides:{}},analysis:null,job:{status:'draft',phase:'Add footage',progress:0},createdAt:stamp,updatedAt:stamp,editRevision:0};
      await put('projects',p);return copy(p);
    }
    if(bits[0]!=='api'||bits[1]!=='projects'||!bits[2]) throw new Error('Unknown local editor request.');
    const p=await project(bits[2]);
    if(bits.length===3&&method==='GET'){await hydrate(p);return copy(p);}
    if(bits.length===3&&method==='PATCH'){
      const payload=JSON.parse(options.body);
      for(const key of ['name','brief','settings','clips','broll','overlays','captions','music']) if(payload[key]!==undefined)p[key]=payload[key];
      p.updatedAt=now();p.editRevision++;
      await put('projects',p);return copy(p);
    }
    if(bits[3]==='assets'&&method==='POST'){
      const added=[];
      for(const file of options.body.getAll('files')){
        if(!(file instanceof File)) continue;
        if(file.size>600*1024*1024) throw new Error(`${file.name} exceeds the 600 MB browser limit.`);
        const kind=file.type.startsWith('audio/')||/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)?'audio':'video';
        const info=await metadata(file,kind), assetId=id();
        const a={id:assetId,name:file.name,storedName:file.name,duration:info.duration,width:info.width,height:info.height,kind,hasAudio:true,thumbnail:info.thumbnail,suggestedBrightness:info.suggestedBrightness,peaks:[],words:[]};
        await put('media',{key:`${p.id}/${assetId}`,blob:file});
        urls.set(assetId,URL.createObjectURL(file));p.assets.push(a);added.push(a);
      }
      p.updatedAt=now();await put('projects',p);return {assets:copy(added)};
    }
    if(bits[3]==='analyze'&&method==='POST') {await analyze(p);return {started:true};}
    if(bits[3]==='captions'&&method==='GET') return [];
    throw new Error('This action is unavailable in the browser workspace.');
  }
  return {request,mediaUrl,thumbnailUrl,bedUrl,hydrate};
})();
