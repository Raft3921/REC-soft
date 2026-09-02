const $ = (id) => document.getElementById(id);
const state = { sources: [], recording: false, streams: [], outputDir: '', resultPath: '', chunkQueue: Promise.resolve() };
const duration = (ms) => { const s=Math.floor(ms/1000); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const status = (text,error=false) => { $('status').textContent=text; $('status').style.color=error?'#ff6676':''; };

async function loadSources(){
  $('refresh').disabled=true;
  try { state.sources=await window.recAPI.getSources(); $('source').replaceChildren(...state.sources.map(x=>Object.assign(document.createElement('option'),{value:x.id,textContent:x.name}))); updatePreview(); }
  catch(error){status(navigator.platform.includes('Mac')?'macOSの「システム設定 → プライバシーとセキュリティ → 画面収録」で許可すると画面一覧を確認できます。':`画面一覧を取得できません: ${error.message}`,true)}
  $('refresh').disabled=false;
}
function updatePreview(){ const x=state.sources.find(x=>x.id===$('source').value); $('preview').replaceChildren(); if(x){const img=document.createElement('img');img.alt=x.name;img.src=x.thumbnail;$('preview').append(img)}else $('preview').textContent='画面が見つかりません'; }
function lock(value){['source','refresh','fps','quality','systemAudio','micAudio','chooseFolder'].forEach(id=>$(id).disabled=value)}
function cleanup(){state.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));state.audioContext?.close();state.streams=[];state.recording=false;state.recorder=null;$('record').classList.remove('active');$('record').querySelector('b').textContent='録画を開始';lock(false)}

async function startRecording(){
  if(!$('source').value)return status('録画する画面を選択してください',true);
  $('record').disabled=true;$('openResult').hidden=true;
  try{
    await window.recAPI.beginRecording({sourceId:$('source').value,outputDir:state.outputDir});
    const screen=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:Number($('fps').value),max:Number($('fps').value)}},audio:$('systemAudio').checked});
    state.streams.push(screen);
    const context=new AudioContext({sampleRate:48000});state.audioContext=context;const destination=context.createMediaStreamDestination();
    if($('systemAudio').checked&&screen.getAudioTracks().length)context.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(destination);
    if($('micAudio').checked){const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});state.streams.push(mic);context.createMediaStreamSource(mic).connect(destination)}
    const combined=new MediaStream([...screen.getVideoTracks(),...destination.stream.getAudioTracks()]);
    const types=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];const mimeType=types.find(t=>MediaRecorder.isTypeSupported(t));
    state.recorder=new MediaRecorder(combined,{mimeType,videoBitsPerSecond:Number($('quality').value),audioBitsPerSecond:192000});
    state.chunkQueue=Promise.resolve();
    state.recorder.ondataavailable=({data})=>{if(data.size)state.chunkQueue=state.chunkQueue.then(()=>data.arrayBuffer()).then(buffer=>window.recAPI.writeChunk(buffer))};
    screen.getVideoTracks()[0].addEventListener('ended',()=>state.recording&&stopRecording());
    state.recorder.start(1000);state.recording=true;state.startedAt=Date.now();state.timer=setInterval(()=>status(`● 録画中  ${duration(Date.now()-state.startedAt)}  /  ${$('fps').value} fps`),250);
    $('record').classList.add('active');$('record').querySelector('b').textContent='録画を停止して保存';lock(true);
  }catch(error){await window.recAPI.cancelRecording().catch(()=>{});cleanup();status(`録画を開始できません: ${error.message}`,true)}
  $('record').disabled=false;
}
async function stopRecording(){
  $('record').disabled=true;clearInterval(state.timer);status('MKVを安全に保存しています…');
  try{await new Promise(resolve=>{state.recorder.addEventListener('stop',resolve,{once:true});state.recorder.stop()});await state.chunkQueue;const result=await window.recAPI.finishRecording();state.resultPath=result.path;status(`保存しました：${result.path}`);$('openResult').hidden=false}
  catch(error){status(`保存に失敗しました: ${error.message}`,true)}cleanup();$('record').disabled=false;
}
$('record').addEventListener('click',()=>state.recording?stopRecording():startRecording());$('source').addEventListener('change',updatePreview);$('refresh').addEventListener('click',loadSources);
$('chooseFolder').addEventListener('click',async()=>{const folder=await window.recAPI.chooseFolder();if(folder){state.outputDir=folder;$('folder').textContent=folder}});$('openResult').addEventListener('click',()=>window.recAPI.showInFolder(state.resultPath));
window.recAPI.onError(message=>status(message,true));window.recAPI.onUpdate(update=>{const badge=$('updateBadge');if(update.state==='available'){badge.textContent=`v${update.version} へ更新`;badge.onclick=()=>window.recAPI.downloadUpdate()}else if(update.state==='downloading')badge.textContent=`更新を取得中 ${update.percent}%`;else if(update.state==='ready'){badge.textContent='クリックして再起動・更新';badge.onclick=()=>window.recAPI.installUpdate()}else if(update.state==='current')badge.textContent='最新版です';else if(update.state==='error')badge.textContent='更新確認に失敗'});loadSources();
