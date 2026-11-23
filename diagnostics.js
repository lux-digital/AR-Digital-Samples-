/* LUX AR Diagnostics v1 — local-only, no camera images or network upload.
   Share a JSON test report from iPhone or save as a file for analysis. */
(function(){
'use strict';
const MAX_EVENTS=1100;
const events=[];
const startedAt=Date.now();
let active=false;
let state='not-started';
let sampleAt=0;
let counts={cameraStatuses:{},trackingStatuses:{},sampleCount:0,
  maxWorldPoints:0,seamFrames:0,cameraFrames:0,placements:0,errors:0};
const round=n=>Number.isFinite(n)?Math.round(n*1000)/1000:null;
const safe=(v,depth=0)=>{
  if(depth>4)return'[nested]';
  if(v==null||typeof v==='number'||typeof v==='boolean')return v;
  if(typeof v==='string')return v.slice(0,500);
  if(Array.isArray(v))return v.slice(0,15).map(x=>safe(x,depth+1));
  if(typeof v==='object'){
    const o={};
    for(const key of Object.keys(v).slice(0,25)){
      if(/stream|frame|image|texture|canvas|video|glctx|location|coords|deviceid|token/i.test(key)&&!/(videoReady|videoWidth|videoHeight|cameraFrames|imageReadable|seamFrames|cameraStatus)/i.test(key))continue;
      const item=v[key];
      if(typeof item==='function')continue;
      o[key]=safe(item,depth+1);
    }
    return o;
  }
  return String(v).slice(0,250);
};
function note(type,data){
  const entry={tMs:Math.max(0,Math.round(performance.now())),type};
  if(data!==undefined)entry.data=safe(data);
  events.push(entry);
  if(events.length>MAX_EVENTS)events.shift();
  if(type==='error'||type==='ar-failure'||type==='xr-exception')counts.errors++;
  if(type==='placement')counts.placements++;
  if(type==='camera-status'){
    const key=String(data&&data.status||'unknown');
    counts.cameraStatuses[key]=(counts.cameraStatuses[key]||0)+1;
  }
  if(type==='tracking-status'){
    const key=String(data&&data.status||'unknown')+'/'+String(data&&data.reason||'');
    counts.trackingStatuses[key]=(counts.trackingStatuses[key]||0)+1;
  }
}
function activate(){
  if(!active){active=true;note('diagnostics-activated',{version:'ar-test-10'});}
  document.body.classList.add('lux-diag-active');
}
function sample(reality,wall,cam){
  if(!active)return;
  const now=performance.now();
  if(now-sampleAt<950)return;
  sampleAt=now;
  counts.sampleCount++;
  const points=reality&&Array.isArray(reality.worldPoints)?reality.worldPoints.length:null;
  if(points!==null)counts.maxWorldPoints=Math.max(counts.maxWorldPoints,points);
  const d=wall&&typeof wall.getDebug==='function'?wall.getDebug():null;
  if(d){
    counts.seamFrames=Math.max(counts.seamFrames,d.seamFrames||0);
    counts.cameraFrames=Math.max(counts.cameraFrames,d.cameraFrames||0);
  }
  const pose=cam&&cam.position?{
    x:round(cam.position.x),y:round(cam.position.y),z:round(cam.position.z)
  }:null;
  note('frame',{
    realityPresent:!!reality,
    realityFields:reality?Object.keys(reality).filter(k=>!/(texture|image|cameraFrame)/i.test(k)).slice(0,22):null,
    trackingStatus:reality&&reality.trackingStatus,
    trackingReason:reality&&reality.trackingReason,
    worldPoints:points,
    cameraPosition:pose,
    wall:d
  });
}
function build(){
  return {
    format:'LUX_AR_WALL_TRACKING_REPORT_V1',
    generatedAt:new Date().toISOString(),
    startedAt:new Date(startedAt).toISOString(),
    appVersion:'ar-test-10',
    site:location.hostname,
    platform:{
      userAgent:navigator.userAgent,
      language:navigator.language,
      touchPoints:navigator.maxTouchPoints||0,
      viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},
      orientation:screen.orientation&&screen.orientation.type||null,
      isSecureContext:window.isSecureContext
    },
    description:'Technical telemetry only. No camera images, video, microphone, GPS, or uploaded data.',
    state,counts:JSON.parse(JSON.stringify(counts)),events:events.slice()
  };
}
const filename=()=> 'lux-ar-diagnostics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
const encode=()=>JSON.stringify(build(),null,2);
function download(json,name){
  const blob=new Blob([json],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=name;
  document.body.appendChild(a);
  a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),120000);
}
const root=document.createElement('div');
root.id='lux-diag-root';
root.innerHTML='<button type="button" class="lux-diag-fab" id="lux-diag-open" aria-label="Save AR diagnostics">SAVE DIAGNOSTICS</button>'+
'<div class="lux-diag-overlay" id="lux-diag-overlay" hidden role="dialog" aria-modal="true" aria-label="AR diagnostic report">'+
'<div class="lux-diag-sheet">'+
'<button type="button" class="lux-diag-close" id="lux-diag-close" aria-label="Close">×</button>'+
'<h2>AR Test Report</h2>'+
'<p>This report records camera readiness, tracking quality, wall-finding measurements, placement attempts and errors. No photos or video are included.</p>'+
'<pre class="lux-diag-summary" id="lux-diag-summary"></pre>'+
'<button type="button" class="lux-diag-save" id="lux-diag-save">SHARE / SAVE JSON REPORT</button>'+
'<button type="button" class="lux-diag-copy" id="lux-diag-copy">COPY REPORT TEXT</button>'+
'<p class="lux-diag-instructions">Send the saved <b>.json</b> file back in this ChatGPT conversation.</p>'+
'<p class="lux-diag-feedback" id="lux-diag-feedback" aria-live="polite"></p>'+
'</div></div>';
document.body.appendChild(root);
const $=id=>document.getElementById(id);
const open=$('lux-diag-open'),modal=$('lux-diag-overlay'),feedback=$('lux-diag-feedback');
function openReport(){
  note('report-opened',{state});
  const report=build();
  $('lux-diag-summary').textContent=[
    'Session: '+state,
    'Tracking samples: '+report.counts.sampleCount,
    'Camera frames scanned: '+report.counts.cameraFrames,
    'Seam candidates: '+report.counts.seamFrames,
    'Max 3D feature points: '+report.counts.maxWorldPoints,
    'Placement attempts: '+report.counts.placements,
    'Errors: '+report.counts.errors,
    'Events recorded: '+report.events.length
  ].join('\n');
  feedback.textContent='';
  modal.hidden=false;
}
open.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openReport();});
$('lux-diag-close').addEventListener('click',()=>{modal.hidden=true;});
modal.addEventListener('click',e=>{if(e.target===modal)modal.hidden=true;});
$('lux-diag-save').addEventListener('click',()=>{
  note('report-exported',{mechanism:'share-or-download'});
  const text=encode(),name=filename();
  // Must call navigator.share synchronously inside the user tap for iOS.
  // File may not exist on older browsers; fall back to a Blob download.
  try{
    const file=typeof File==='function'
      ? new File([text],name,{type:'application/json'}) : null;
    if(file && typeof navigator.share==='function' && typeof navigator.canShare==='function' &&
       navigator.canShare({files:[file]})){
      feedback.textContent='Choose Save to Files or share this report.';
      navigator.share({files:[file],title:'LUX AR tracking report'})
        .then(()=>{feedback.textContent='Report shared or saved.';})
        .catch(err=>{
          if(err&&err.name==='AbortError') {
            feedback.textContent='Share cancelled. Tap again or use COPY REPORT TEXT.';
          }else {
            download(text,name);
            feedback.textContent='Share was unavailable. Download requested instead.';
          }
        });
      return;
    }
    download(text,name);
    feedback.textContent='Downloaded '+name+'. Check Downloads or Files.';
  }catch(err){
    note('error',{source:'share-report',message:err.message});
    try{download(text,name);feedback.textContent='Download requested.';}
    catch(e){feedback.textContent='Download failed. Use COPY REPORT TEXT.';}
  }
});
$('lux-diag-copy').addEventListener('click',async()=>{
  note('report-copied');
  const text=encode();
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      feedback.textContent='Copied. Paste it into a message or a .json file.';
    }else{
      const ta=document.createElement('textarea');
      ta.value=text;
      ta.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
      document.body.appendChild(ta);ta.focus();ta.select();
      const copied=document.execCommand('copy');
      ta.remove();
      feedback.textContent=copied?'Copied. Paste into ChatGPT.':'Copy unavailable; use the Share / Save button.';
    }
  }catch(err){
    feedback.textContent='Copy unavailable. Use the Share / Save button.';
  }
});
window.addEventListener('error',e=>note('error',{message:e.message,filename:e.filename&&e.filename.split('/').pop(),line:e.lineno}));
window.addEventListener('unhandledrejection',e=>note('error',{source:'unhandled-rejection',message:String(e.reason&&e.reason.message||e.reason)}));
document.addEventListener('visibilitychange',()=>note('visibility',{hidden:document.hidden}));
note('page-loaded',{version:'ar-test-10'});
// Keep the reporting UI available even if app.js or the XR engine fails to
// initialize. A Start AR tap activates logging independently of the AR code.
const splashButton=document.getElementById('splash-start');
if(splashButton) splashButton.addEventListener('click',activate,{capture:true});
window.luxDiagnostics={
  activate,note,sample,
  state(v){state=String(v);note('state',{state});},
  export:openReport,
  getReport:build
};
})();
