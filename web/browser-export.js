/* Real-time WebM export for the browser workspace. */
const BrowserExporter = (() => {
  let audioContext, audioDestination;
  const attached = new WeakSet();
  const preferredMime = () => ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>window.MediaRecorder?.isTypeSupported(x));
  const extension = () => preferredMime()?.startsWith('video/mp4') ? 'mp4' : 'webm';
  function audioStream(elements) {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioContext.createMediaStreamDestination();
    }
    for (const element of elements) {
      if (attached.has(element)) continue;
      const source = audioContext.createMediaElementSource(element);
      source.connect(audioDestination);
      source.connect(audioContext.destination);
      attached.add(element);
    }
    audioContext.resume();
    return audioDestination.stream;
  }
  function cover(ctx, video, width, height) {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
    ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }
  function drawText(ctx, overlay, width, height) {
    const title = overlay.type === 'title';
    const size = Math.round(width * (title ? .07 : .053));
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';ctx.textBaseline = 'middle';
    const words = String(overlay.text).split(/\s+/), lines=[];let line='';
    for(const word of words){const trial=(line+' '+word).trim();if(line&&ctx.measureText(trial).width>width*.76){lines.push(line);line=word;}else line=trial;}
    if(line)lines.push(line);
    const shown=lines.slice(0,4), lineHeight=size*1.2, boxWidth=Math.min(width*.88,Math.max(...shown.map(x=>ctx.measureText(x).width),0)+size*.9), boxHeight=shown.length*lineHeight+size*.45;
    const pos=overlay.position||{x:.5,y:title?.25:.78};
    const cx=Math.max(boxWidth/2+8,Math.min(width-boxWidth/2-8,pos.x*width));
    const cy=Math.max(boxHeight/2+8,Math.min(height-boxHeight/2-8,pos.y*height));
    ctx.fillStyle='rgba(12,12,12,.78)';ctx.beginPath();ctx.roundRect(cx-boxWidth/2,cy-boxHeight/2,boxWidth,boxHeight,size*.2);ctx.fill();
    ctx.fillStyle='#fffdf8';shown.forEach((text,i)=>ctx.fillText(text,cx,cy+(i-(shown.length-1)/2)*lineHeight));
  }
  async function exportVideo({state,player,cutawayPlayer,musicPlayer,seek,duration,activeOverlays}) {
    if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot export video. Use a current Chrome, Edge or Safari.');
    const format=state.project.settings.format, [width,height]=format==='vertical'?[720,1280]:format==='wide'?[1280,720]:[900,900];
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});
    const videoStream=canvas.captureStream(30);
    let sound;
    try {sound=audioStream([player,musicPlayer]);} catch(err) {throw new Error(`Could not prepare export audio: ${err.message}`);}
    const stream=new MediaStream([...videoStream.getVideoTracks(),...sound.getAudioTracks()]);
    const mime=preferredMime();
    if(!mime) throw new Error('This browser cannot encode MP4 or WebM video.');
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5_000_000,audioBitsPerSecond:128_000});
    const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const result=new Promise((resolve,reject)=>{recorder.onstop=()=>chunks.length?resolve(new Blob(chunks,{type:mime})):reject(new Error('The browser produced an empty export.'));recorder.onerror=()=>reject(new Error('Video encoding failed.'));});
    let drawing=true;
    const frame=()=>{
      if(!drawing)return;
      ctx.fillStyle='#101010';ctx.fillRect(0,0,width,height);
      const visible=!cutawayPlayer.hidden&&cutawayPlayer.readyState>=2?cutawayPlayer:player;
      const clip=state.project.clips.find(c=>c.assetId===state.activeAsset);
      ctx.save();ctx.filter=`brightness(${1+(clip?.brightness||0)}) contrast(${clip?.contrast||1}) saturate(${clip?.saturation||1})`;
      cover(ctx,visible,width,height);ctx.restore();
      for(const overlay of activeOverlays())drawText(ctx,overlay,width,height);
      requestAnimationFrame(frame);
    };
    seek(0,false);
    await new Promise(resolve=>setTimeout(resolve,220));
    frame();recorder.start();seek(0,true);
    const total=duration();
    const monitor=setInterval(()=>{
      const progress=Math.min(99,Math.round(state.time/Math.max(.1,total)*100));
      document.querySelector('#projectStatus').textContent=`Exporting · ${progress}%`;
      if(recorder.state!=='inactive'&&(state.time>=total-.045||(!state.playing&&state.time>=total-.2)))recorder.stop();
    },150);
    const safety=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},Math.max(30000,(total*3+20)*1000));
    try{return {blob:await result,extension:extension()};}
    finally{drawing=false;clearInterval(monitor);clearTimeout(safety);videoStream.getTracks().forEach(t=>t.stop());seek(0,false);}
  }
  return {exportVideo,extension};
})();
