const $ = (id) => document.getElementById(id);
const state = { sources: [], recording: false, streams: [], previewStream: null, outputDir: '', resultPath: '', chunkQueue: Promise.resolve() };
const duration = (ms) => { const s=Math.floor(ms/1000); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const status = (text,error=false) => { $('status').textContent=text; $('status').style.color=error?'#ff6676':''; };

async function loadSources(){
  $('refresh').disabled=true;
  try { state.sources=await window.recAPI.getSources(); $('source').replaceChildren(...state.sources.map(x=>Object.assign(document.createElement('option'),{value:x.id,textContent:x.name}))); updatePreview(); }
  catch(error){status(navigator.platform.includes('Mac')?error.message:`画面一覧を取得できません: ${error.message}`,true)}
  $('refresh').disabled=false;
}
async function loadMacSources(){
  $('refresh').disabled=true;
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videoInputs=devices.filter(device=>device.kind==='videoinput');
    const audioInputs=devices.filter(device=>device.kind==='audioinput');
    state.sources=[{id:'mac-system-picker',name:'Macの画面',kind:'screen'},...videoInputs.map((device,index)=>({
      id:`capture:${device.deviceId}`,name:device.label||`外部映像 ${index+1}`,kind:'capture',deviceId:device.deviceId,
      audioId:audioInputs.find(audio=>audio.groupId&&audio.groupId===device.groupId)?.deviceId||''
    }))];
    const previous=$('source').value;
    $('source').replaceChildren(...state.sources.map(source=>Object.assign(document.createElement('option'),{value:source.id,textContent:source.name})));
    if(state.sources.some(source=>source.id===previous))$('source').value=previous;
    await updatePreview();
  }catch(error){status(`入力を取得できません: ${error.message}`,true)}
  $('refresh').disabled=false;
}
async function updatePreview(){
  state.previewStream?.getTracks().forEach(track=>track.stop());state.previewStream=null;
  const source=state.sources.find(item=>item.id===$('source').value);$('preview').replaceChildren();
  $('systemAudioLabel').textContent=source?.kind==='capture'?'入力音声':'PCの音声';
  if(source?.kind==='capture'){
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:source.deviceId},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:60}},audio:false});
      state.previewStream=stream;const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=stream;$('preview').append(video);
      if(!source.audioId){
        try{const permission=await navigator.mediaDevices.getUserMedia({video:false,audio:true});permission.getTracks().forEach(track=>track.stop())}catch{}
        const devices=await navigator.mediaDevices.enumerateDevices();
        const videoDevice=devices.find(device=>device.kind==='videoinput'&&device.deviceId===source.deviceId);
        const audioDevice=devices.find(device=>device.kind==='audioinput'&&device.groupId&&device.groupId===videoDevice?.groupId);
        if(videoDevice?.label){source.name=videoDevice.label;$('source').selectedOptions[0].textContent=videoDevice.label}
        if(audioDevice)source.audioId=audioDevice.deviceId;
      }
    }catch(error){$('preview').textContent=`入力を表示できません: ${error.message}`}
  }else if(source?.kind==='screen')$('preview').textContent='録画開始時に画面を選択';
  else if(source?.thumbnail){const img=document.createElement('img');img.alt=source.name;img.src=source.thumbnail;$('preview').append(img)}
  else $('preview').textContent='画面が見つかりません';
}
function lock(value){['source','refresh','fps','quality','systemAudio','micAudio','chooseFolder'].forEach(id=>$(id).disabled=value)}
function cleanup(){state.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));state.audioContext?.close();state.streams=[];state.recording=false;state.recorder=null;$('record').classList.remove('active');$('record').querySelector('b').textContent='録画を開始';lock(false)}

async function startRecording(){
  if(!$('source').value)return status('録画する画面を選択してください',true);
  $('record').disabled=true;$('openResult').hidden=true;
  try{
    await window.recAPI.beginRecording({sourceId:$('source').value,outputDir:state.outputDir});
    state.previewStream?.getTracks().forEach(track=>track.stop());state.previewStream=null;
    const selected=state.sources.find(source=>source.id===$('source').value);
    const fps=Number($('fps').value);
    const primary=selected?.kind==='capture'
      ?await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:selected.deviceId},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:fps,max:fps}},audio:$('systemAudio').checked?{...(selected.audioId?{deviceId:{exact:selected.audioId}}:{}),echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false})
      :await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:fps,max:fps}},audio:$('systemAudio').checked});
    primary.getVideoTracks()[0].contentHint='motion';
    state.streams.push(primary);
    const context=new AudioContext({sampleRate:48000});state.audioContext=context;const destination=context.createMediaStreamDestination();
    if($('systemAudio').checked&&primary.getAudioTracks().length)context.createMediaStreamSource(new MediaStream(primary.getAudioTracks())).connect(destination);
    if($('micAudio').checked){const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});state.streams.push(mic);context.createMediaStreamSource(mic).connect(destination)}
    const combined=new MediaStream([...primary.getVideoTracks(),...destination.stream.getAudioTracks()]);
    const types=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];const mimeType=types.find(t=>MediaRecorder.isTypeSupported(t));
    state.recorder=new MediaRecorder(combined,{mimeType,videoBitsPerSecond:Number($('quality').value),audioBitsPerSecond:192000});
    state.chunkQueue=Promise.resolve();
    state.recorder.ondataavailable=({data})=>{if(data.size)state.chunkQueue=state.chunkQueue.then(()=>data.arrayBuffer()).then(buffer=>window.recAPI.writeChunk(buffer))};
    primary.getVideoTracks()[0].addEventListener('ended',()=>state.recording&&stopRecording());
    state.recorder.start(2000);state.recording=true;state.startedAt=Date.now();state.timer=setInterval(()=>status(`● 録画中  ${duration(Date.now()-state.startedAt)}  /  ${$('fps').value} fps`),500);
    $('record').classList.add('active');$('record').querySelector('b').textContent='録画を停止して保存';lock(true);
  }catch(error){await window.recAPI.cancelRecording().catch(()=>{});cleanup();status(`録画を開始できません: ${error.message}`,true)}
  $('record').disabled=false;
}
async function stopRecording(){
  $('record').disabled=true;clearInterval(state.timer);status('MKVを安全に保存しています…');
  try{
    await new Promise(resolve=>{state.recorder.addEventListener('stop',resolve,{once:true});state.recorder.stop()});
    await state.chunkQueue;
    const result=await window.recAPI.finishRecording();state.resultPath=result.path;status(`MKVを保存しました：${result.path}`);$('openResult').hidden=false;
    if(await window.recAPI.askConvertMov(result.path)){
      status('MOVに変換しています… 録画時間によって数分かかります');
      const converted=await window.recAPI.convertToMov(result.path);state.resultPath=converted.path;status(`MOVを保存しました：${converted.path}`);
    }
  }
  catch(error){status(`保存に失敗しました: ${error.message}`,true)}cleanup();$('record').disabled=false;
}
$('record').addEventListener('click',()=>state.recording?stopRecording():startRecording());$('source').addEventListener('change',updatePreview);$('refresh').addEventListener('click',()=>window.recAPI.platform==='darwin'?loadMacSources():loadSources());
$('chooseFolder').addEventListener('click',async()=>{const folder=await window.recAPI.chooseFolder();if(folder){state.outputDir=folder;$('folder').textContent=folder}});$('openResult').addEventListener('click',()=>window.recAPI.showInFolder(state.resultPath));
window.recAPI.onError(message=>status(message,true));window.recAPI.onUpdate(update=>{const badge=$('updateBadge');if(update.state==='available'){badge.textContent=`v${update.version} へ更新`;badge.onclick=()=>window.recAPI.downloadUpdate()}else if(update.state==='downloading')badge.textContent=`更新を取得中 ${update.percent}%`;else if(update.state==='ready'){badge.textContent='クリックして再起動・更新';badge.onclick=()=>window.recAPI.installUpdate()}else if(update.state==='current')badge.textContent='最新版です';else if(update.state==='error')badge.textContent='更新確認に失敗'});
window.recAPI.onRecovery(result=>{if(result.ok){state.resultPath=result.path;$('openResult').hidden=false;status(`前回の録画を復旧しました：${result.path}`)}else status(`録画を復旧できませんでした：${result.message}`,true)});
async function initialize(){
  try{const settings=await window.recAPI.getSettings();state.outputDir=settings.outputDir;$('folder').textContent=settings.outputDir}
  catch(error){status(`設定を読み込めません: ${error.message}`,true)}
  if(window.recAPI.platform==='darwin'){
    await window.recAPI.ensureCaptureAccess();
    await loadMacSources();
  }else await loadSources();
}
initialize();
