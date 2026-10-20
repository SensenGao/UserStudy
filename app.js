const $=s=>document.querySelector(s);
let api=globalThis.STUDY_API_BASE||'';
const apiBases=[...new Set([api,...(globalThis.STUDY_API_BASES||[])])];
const key='video-quality-study-participant-v1';
const videos=[$('#reference-video'),$('#a-video'),$('#b-video')],clock=videos[1];
let state={session:null,index:0,ready:false,playing:false,buffering:false,resuming:false,looping:false,zoom:1,origin:[50,50],load:0,controller:null,started:0,saving:false,restarting:false};
let lang=localStorage.getItem('video-study-language')||'zh';
const en={title:'Same scene.<br>Which version looks better?',intro:'You will review 10 video pairs. Each includes a reference and two versions, A and B. Choose the version with better visual quality.',step1:'Watch the reference',step2:'Compare A and B',step3:'Choose your preference',restart:'Start another response',restartNote:'Your previous answers stay saved. A new ID and ten new trials will be assigned.',prompt:'Generation prompt',buffering:'Buffering all three videos…',criteria:'Consider clarity, detail, visual naturalness, artifacts, and temporal stability.',loading:'Preparing…',privacy:'No account needed. A random participant ID is assigned, and your choices are saved automatically. Return anytime to continue.',studyEyebrow:'YOUR PERSPECTIVE, ONE PAIR AT A TIME',pair:'Pair',reference:'Reference video',hideReference:'Hide reference',showReference:'Show reference',synced:'Synchronized playback',fullFrame:'Full frame',versionA:'Version A',versionB:'Version B',question:'Which version has better visual quality?',preferA:'I prefer A',preferB:'I prefer B',previous:'← Previous',next:'Next →',hint:'Replay, slow down, or zoom in as needed. There is no correct answer; choose based on what you see.',thanks:'Thank you for looking closely.',doneCopy:'All 10 choices have been saved. Thank you for taking part in this video quality study.',review:'Review my choices',footer:'Anonymous · Automatically saved · About 3–5 minutes',start:'Start the study →',resume:'Continue the study →',waiting:'The study is being prepared. Please return later.',loadVideos:'Loading all three videos…',videoError:'Could not load this video. Please try the pair again.',saved:'Saved',saving:'Saving…',saveError:'Not saved yet. Please try again.',progress:(n)=>`${n} of 10 saved`,finish:'Finish →'};
const zh={title:'同一段画面，<br>哪个版本更好？',intro:'你将看到10组视频。每组提供一段参考视频和 A、B 两个版本，请选择你认为画面质量更好的一个。',step1:'观看参考视频',step2:'同步比较 A 与 B',step3:'选择更好的版本',restart:'再填写一份',restartNote:'已有答案会保留；重新填写会分配新编号和10组视频。',prompt:'生成提示词 · Prompt',buffering:'正在同步缓冲三段视频…',criteria:'请综合考虑清晰度、细节、画面自然度、瑕疵和时间稳定性。',loading:'正在准备…',privacy:'无需注册。系统分配匿名编号，选择会自动保存；再次打开可继续。',studyEyebrow:'YOUR PERSPECTIVE, ONE PAIR AT A TIME',pair:'第',reference:'参考视频',hideReference:'收起参考',showReference:'展开参考',synced:'三段视频同步播放',fullFrame:'全画面',versionA:'版本 A',versionB:'版本 B',question:'哪个版本的画面质量更好？',preferA:'我选择 A',preferB:'我选择 B',previous:'← 上一组',next:'下一组 →',hint:'可反复播放、慢放或放大查看。没有标准答案，请按自己的视觉感受选择。',thanks:'感谢你的观察。',doneCopy:'你的10组选择已全部保存。感谢你参与这次视频质量评估。',review:'回看我的选择',footer:'匿名参与 · 自动保存 · 约3–5分钟',start:'开始评估 →',resume:'继续评估 →',waiting:'评估正在准备中，请稍后再来。',loadVideos:'正在读取三段视频…',videoError:'视频读取失败，请重新进入这一组重试。',saved:'已保存',saving:'正在保存…',saveError:'暂未保存，请重试。',progress:n=>`已保存 ${n} / 10`,finish:'完成评估 →'};
const t=k=>(lang==='en'?en:zh)[k];
function language(){document.documentElement.lang=lang==='en'?'en':'zh-CN';document.querySelectorAll('[data-i18n]').forEach(e=>{const value=t(e.dataset.i18n);if(e.dataset.i18n==='title')e.innerHTML=value;else e.textContent=value;});$('#language').textContent=lang==='en'?'中文':'EN';if(state.session)renderProgress();if(!$('#start').disabled)$('#start').textContent=t(state.session?'resume':'start');}
$('#language').onclick=()=>{lang=lang==='en'?'zh':'en';localStorage.setItem('video-study-language',lang);language();};
function identity(){let saved;try{saved=JSON.parse(localStorage.getItem(key));}catch{}if(!saved?.resume_key){saved={resume_key:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')};localStorage.setItem(key,JSON.stringify(saved));}return saved;}
async function request(path,body){
 const local=identity();
 for(const base of [...new Set([api,...apiBases])]){
  let r;
  try{r=await fetch(base+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(8000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(local.token?{Authorization:'Bearer '+local.token}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{continue;}
  // Retry gateway/transport failures through another route to the same database.
  if(r.status>=500)continue;
  let d;try{d=await r.json();}catch{continue;}
  if(!r.ok)throw Error(d.error||'Request failed');
  api=base;return d;
 }
 throw Error(lang==='en'?'Cannot reach the study server. Please retry.':'暂时无法连接评估后台，请重试。');
}
// Keep complete clips in memory: playback never depends on a live CDN stream.
// At most the current and next triplet are retained, with shared in-flight work.
const mediaCache=new Map(),mediaJobs=new Map();
let protectedMedia=new Set(),prefetchController=null;
const mediaURL=url=>new URL(url,api||location.href).href;
function trimMedia(){for(const [url,item] of mediaCache){if(mediaCache.size<=6)break;if(!protectedMedia.has(url)){URL.revokeObjectURL(item.objectURL);mediaCache.delete(url);}}}
function downloadMedia(url,signal,onProgress=()=>{}){
 url=mediaURL(url);if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
 const cached=mediaCache.get(url);if(cached){mediaCache.delete(url);mediaCache.set(url,cached);onProgress({loaded:cached.bytes,total:cached.bytes,done:true});return Promise.resolve(cached.objectURL);}
 let job=mediaJobs.get(url);
 if(!job){
  job={controller:new AbortController(),listeners:new Set(),loaded:0,total:0,done:false};mediaJobs.set(url,job);
  const notify=()=>{for(const fn of job.listeners)fn(job);};
  job.promise=(async()=>{
   const timer=setTimeout(()=>job.controller.abort(),180000);
   try{
    const response=await fetch(url,{signal:job.controller.signal,credentials:'omit'});
    if(!response.ok)throw Error('Media download failed');
    job.total=Number(response.headers.get('content-length'))||0;notify();
    const reader=response.body.getReader(),chunks=[];
    while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);job.loaded+=value.byteLength;notify();}
    if(job.controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const blob=new Blob(chunks,{type:'video/mp4'}),objectURL=URL.createObjectURL(blob);
    job.done=true;job.total=blob.size;notify();mediaCache.set(url,{objectURL,bytes:blob.size});trimMedia();return objectURL;
   }finally{clearTimeout(timer);if(mediaJobs.get(url)===job)mediaJobs.delete(url);}
  })();
 }
 return new Promise((resolve,reject)=>{
  const progress=info=>onProgress({loaded:info.loaded,total:info.total,done:info.done});
  const clean=()=>{job.listeners.delete(progress);signal.removeEventListener('abort',abort);};
  const abort=()=>{clean();reject(new DOMException('Cancelled','AbortError'));queueMicrotask(()=>{if(!job.listeners.size&&mediaJobs.get(url)===job){job.controller.abort();mediaJobs.delete(url);}});};
  job.listeners.add(progress);signal.addEventListener('abort',abort,{once:true});progress(job);
  job.promise.then(objectURL=>{clean();if(!signal.aborted)resolve(objectURL);},error=>{clean();reject(error);});
 });
}
function prefetchNext(){
 prefetchController?.abort();prefetchController=null;
 const next=state.session?.trials[state.index+1];if(!next)return;
 prefetchController=new AbortController();const signal=prefetchController.signal;
 // A failed prefetch does not interrupt the current pair; selecting it retries.
 Promise.all([next.reference,next.A,next.B].map(url=>downloadMedia(url,signal))).catch(()=>{});
}
function downloadProgress(progress){
 const items=Object.values(progress),bytes=items.reduce((sum,item)=>sum+item.loaded,0),total=items.reduce((sum,item)=>sum+item.total,0),done=items.filter(item=>item.done).length;
 const size=(bytes/1e6).toFixed(1)+(items.length===3&&items.every(item=>item.total>0)?' / '+(total/1e6).toFixed(1):'')+' MB';
 $('#video-status').textContent=lang==='en'?`Preparing videos: ${size} · ${done}/3 ready`:`正在下载本组视频：${size} · 已完成 ${done}/3`;
}
const current=()=>state.session?.trials[state.index];
const end=()=>current()?.duration||121/24;
const count=()=>state.session.trials.filter(t=>t.choice).length;
function pause(){videos.forEach(v=>v.pause());state.playing=false;state.buffering=false;state.resuming=false;$('#play').textContent='▶';if(state.ready)$('#video-status').textContent='';}
function ahead(v){for(let i=0;i<v.buffered.length;i++)if(v.buffered.start(i)<=v.currentTime+.02&&v.buffered.end(i)>v.currentTime)return v.buffered.end(i)-v.currentTime;return 0;}
function enough(){return videos.every(v=>!v.seeking&&v.readyState>=3&&ahead(v)>=Math.min(.6,Math.max(.02,end()-v.currentTime-.02)));}
async function resumeGroup(){if(!state.playing||state.resuming||!enough())return;const token=state.load;state.resuming=true;try{await Promise.all(videos.map(v=>v.play()));if(token===state.load&&state.playing){state.buffering=false;$('#video-status').textContent='';}}catch{if(token===state.load)pause();}finally{if(token===state.load)state.resuming=false;}}
function bufferGroup(){if(!state.playing||state.buffering||state.looping)return;state.buffering=true;videos.forEach(v=>v.pause());const anchor=Math.min(...videos.map(v=>v.currentTime));for(const v of videos)if(Math.abs(v.currentTime-anchor)>.04)v.currentTime=anchor;$('#video-status').textContent=t('buffering');}
async function play(){if(!state.ready)return;if(clock.currentTime>=end()-.025)seek(0);state.playing=true;state.buffering=true;$('#play').textContent='Ⅱ';$('#video-status').textContent=t('buffering');await resumeGroup();}
function seek(time){const v=Math.max(0,Math.min(time,end()));videos.forEach(el=>{if(el.readyState>=1)el.currentTime=Math.min(v,el.duration-.001);});$('#timeline').value=v;$('#time').textContent=v.toFixed(2)+' / '+end().toFixed(2)+' s';}
function zoom(){videos.slice(1).forEach(v=>{v.style.transform=`scale(${state.zoom})`;v.style.transformOrigin=state.origin.join('% ')+'%';});document.querySelectorAll('[data-zoom]').forEach(b=>b.classList.toggle('active',Number(b.dataset.zoom)===state.zoom));}
async function loaded(video,url,signal,progress){const objectURL=await downloadMedia(url,signal,progress);if(signal.aborted)throw new DOMException('Cancelled','AbortError');return new Promise((resolve,reject)=>{let timer;const clean=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',ok);video.removeEventListener('error',bad);signal.removeEventListener('abort',abort);};const ok=()=>{if(video.readyState>=2){clean();resolve();}};const bad=()=>{clean();reject(Error('Media failed'));};const abort=()=>{clean();reject(new DOMException('Cancelled','AbortError'));};video.addEventListener('loadeddata',ok);video.addEventListener('error',bad);signal.addEventListener('abort',abort,{once:true});timer=setTimeout(bad,30000);video.src=objectURL;video.load();});}
function renderProgress(){const n=count();$('#participant-id').textContent=state.session.participant_id;$('#progress-text').textContent=t('progress')(n);$('#progress-bar').style.width=n*10+'%';$('#trial-dots').innerHTML=state.session.trials.map((r,i)=>`<button data-index="${i}" class="${r.choice?'done ':''}${i===state.index?'active':''}" aria-label="${i+1}"></button>`).join('');$('#previous').disabled=state.index===0;$('#next').textContent=t(state.index===9?'finish':'next');$('#next').disabled=!current().choice||state.saving;for(const b of document.querySelectorAll('[data-choice]')){const selected=current().choice===b.dataset.choice;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}}
async function select(index){if(state.saving)return;pause();state.index=index;state.ready=false;state.looping=false;state.zoom=1;state.origin=[50,50];zoom();state.controller?.abort();state.controller=new AbortController();const token=++state.load;$('#prompt-text').textContent=current().prompt||'';$('#prompt-panel').hidden=!current().prompt;$('#intro').hidden=true;$('#complete').hidden=true;$('#study').hidden=false;$('#trial-number').textContent=String(index+1).padStart(2,'0');$('#video-status').textContent=t('loadVideos');$('#play').disabled=true;$('#timeline').disabled=true;$('#save-status').textContent=current().choice?t('saved'):'';document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=true);renderProgress();
 const trial=current(),urls=[trial.reference,trial.A,trial.B],progress={};protectedMedia=new Set(urls.map(mediaURL));
 videos.forEach(video=>{video.removeAttribute('src');video.load();});$('#retry-media').hidden=true;
 const loading=Promise.all(urls.map((url,i)=>loaded(videos[i],url,state.controller.signal,info=>{if(token===state.load){progress[i]=info;downloadProgress(progress);}})));
 // Subscribe to shared downloads before releasing the previous prefetch.
 prefetchController?.abort();prefetchController=null;
 try{await loading;if(token!==state.load)return;seek(0);state.ready=true;state.started=performance.now();$('#video-status').textContent=lang==='en'?'Ready — press play':'视频已准备好，点击播放';$('#play').disabled=false;$('#timeline').disabled=false;$('#timeline').max=end();document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=false);videos.forEach(v=>v.playbackRate=Number($('#speed').value));trimMedia();prefetchNext();}
 catch(e){if(token===state.load){state.controller.abort();$('#video-status').textContent=t('videoError');$('#retry-media').hidden=false;}}
}
$('#retry-media').onclick=()=>select(state.index);
async function vote(choice){if(!state.ready||state.saving)return;state.saving=true;$('#save-status').textContent=t('saving');document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=true);try{await request('/api/vote',{assignment_id:current().id,choice,elapsed_ms:Math.round(performance.now()-state.started),media_profile:current().media_profile||'original'});current().choice=choice;$('#save-status').textContent=t('saved');}catch{$('#save-status').textContent=t('saveError');}finally{state.saving=false;renderProgress();document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=!state.ready);}}
function complete(){pause();$('#study').hidden=true;$('#complete').hidden=false;$('#complete-id').textContent=state.session.participant_id;$('#participant-id').textContent=state.session.participant_id;window.scrollTo({top:0,behavior:'smooth'});}
$('#start').onclick=async()=>{try{$('#start').disabled=true;const saved=identity();const s=await request('/api/session',{resume_key:saved.resume_key});state.session=s;localStorage.setItem(key,JSON.stringify({...saved,token:s.token,participant_id:s.participant_id}));if(count()===10)complete();else await select(Math.max(0,s.trials.findIndex(t=>!t.choice)));}catch(e){$('#status').textContent=e.message;}finally{$('#start').disabled=false;}};
async function restart(){
 if(state.saving||state.restarting)return;state.restarting=true;document.querySelectorAll('#restart-current,#restart-complete').forEach(b=>b.disabled=true);
 const pendingKey=key+'-pending-new-response';const prior=identity();let pending;try{pending=JSON.parse(localStorage.getItem(pendingKey));}catch{}
 if(!pending?.resume_key){pending={resume_key:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')};localStorage.setItem(pendingKey,JSON.stringify(pending));}
 try{const session=await request('/api/session',pending);let history;try{history=JSON.parse(localStorage.getItem(key+'-history'))||[];}catch{history=[];}
 if(prior.participant_id&&!history.some(p=>p.participant_id===prior.participant_id)){history.push(prior);localStorage.setItem(key+'-history',JSON.stringify(history.slice(-20)));}
 localStorage.setItem(key,JSON.stringify({...pending,token:session.token,participant_id:session.participant_id}));localStorage.removeItem(pendingKey);state.session=session;$('#restart-status').textContent='';await select(0);window.scrollTo({top:0,behavior:'smooth'});
 }catch{$('#restart-status').textContent=t('saveError');$('#save-status').textContent=t('saveError');}finally{state.restarting=false;document.querySelectorAll('#restart-current,#restart-complete').forEach(b=>b.disabled=false);}
}
$('#restart-current').onclick=restart;$('#restart-complete').onclick=restart;
$('#play').onclick=()=>state.playing?pause():play();$('#timeline').oninput=()=>{pause();seek(Number($('#timeline').value));};$('#speed').onchange=()=>videos.forEach(v=>v.playbackRate=Number($('#speed').value));$('#step-back').onclick=()=>{pause();seek(clock.currentTime-1/24);};$('#step-forward').onclick=()=>{pause();seek(clock.currentTime+1/24);};$('#previous').onclick=()=>select(Math.max(0,state.index-1));$('#next').onclick=()=>{if(!current().choice)return;if(state.index===9&&count()===10)complete();else if(state.index===9)select(state.session.trials.findIndex(t=>!t.choice));else select(state.index+1);};$('#review').onclick=()=>select(0);$('#trial-dots').onclick=e=>{const i=e.target.closest('[data-index]');if(i)select(Number(i.dataset.index));};document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>vote(b.dataset.choice));document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{state.zoom=Number(b.dataset.zoom);state.origin=[50,50];zoom();});document.querySelectorAll('.video-box').forEach(box=>box.onpointerdown=e=>{if(state.zoom===1)return;const r=box.getBoundingClientRect();state.origin=[Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))];zoom();});$('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():$('#viewer').requestFullscreen();$('#reference-toggle').onclick=()=>{$('#reference-frame').hidden=!$('#reference-frame').hidden;$('#reference-toggle').textContent=t($('#reference-frame').hidden?'showReference':'hideReference');};
addEventListener('keydown',e=>{if(['INPUT','SELECT','BUTTON'].includes(document.activeElement?.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;if(e.code==='Space'){e.preventDefault();state.playing?pause():play();}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();pause();seek(clock.currentTime+(e.key==='ArrowLeft'?-1:1)/24);}});
async function loop(){if(state.looping||!state.playing)return;state.looping=true;videos.forEach(v=>v.pause());seek(0);state.buffering=true;state.looping=false;await resumeGroup();}
clock.onended=loop;
for(const v of videos){v.addEventListener('waiting',bufferGroup);v.addEventListener('stalled',()=>{if(ahead(v)<.2)bufferGroup();});}
function animate(){if(state.playing&&state.ready&&!state.looping){const time=Math.min(clock.currentTime,end());$('#timeline').value=time;$('#time').textContent=time.toFixed(2)+' / '+end().toFixed(2)+' s';if(time>=end()-.02||clock.ended)loop();else if(state.buffering)resumeGroup();else if(!state.resuming){if(videos.some(v=>v.readyState<3))bufferGroup();else for(const v of [videos[0],videos[2]])if(Math.abs(v.currentTime-time)>.08&&!v.seeking)v.currentTime=Math.min(time,v.duration-.001);}}requestAnimationFrame(animate);}requestAnimationFrame(animate);
language();
let availabilityTimer;
async function availability(){clearTimeout(availabilityTimer);if(state.session)return;$('#retry-connection').hidden=true;try{const meta=await request('/api/meta');$('#start').disabled=!meta.active;$('#status').textContent=meta.active?'':t('waiting');$('#start').textContent=t(meta.active?(identity().token?'resume':'start'):'loading');if(!meta.active)availabilityTimer=setTimeout(availability,15000);}catch{$('#start').disabled=true;$('#status').textContent=lang==='en'?'Cannot reach the study server. Retrying automatically…':'暂时无法连接评估后台，正在自动重试…';$('#retry-connection').hidden=false;availabilityTimer=setTimeout(availability,5000);}}
$('#retry-connection').onclick=availability;
await availability();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!state.session)availability();});
globalThis.__study={get state(){return state;},select,play,pause,seek,vote,complete};
