/* LUX opt-in scene-depth occlusion experiment.
   A separate worker estimates RELATIVE depth from the XR camera frame.
   This cannot provide native metric scene depth: the reference is calibrated
   heuristically against the wall pixels within the projected sample area.
   Never enabled by default; XR8 SLAM is not modified.
*/
(function(){
'use strict';
window.createLuxDepthOcclusion=function(THREE,opts={}){
  const stage=opts.stage||document.getElementById('stage');
  const button=opts.button||document.getElementById('depth-toggle');
  if(!stage||!button)return null;
  const note=(kind,data)=>opts.diagnostics&&opts.diagnostics.note(kind,data);
  const glyph='DEPTH ';
  let enabled=false,ready=false,failed=false,hasMask=false,worker=null;
  let video=null,captureCanvas=null,captureContext=null;
  let busy=false,frameId=0,processed=0,lastSend=0,lastFrameAt=0;
  let lastError='',currentCamera=null,currentFrame=null,lastAccepted=null;
  let modelStart=0,downloadTimer=null,workerName='depth-occlusion-worker.js?v=1';
  const captureWidth=176;
  const minFrameDelayMs=1850;
  const cameraMovementLimit=.28;
  const cameraRotationLimit=.16;
  const sampleViewport=new THREE.Vector2(1,1);

  // RGBA mask, not an uploaded image. Each pixel says whether camera imagery
  // should be drawn IN FRONT of the virtual panel. Transparent when disabled.
  let map=new THREE.DataTexture(
    new Uint8Array([0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255]),
    2,2,THREE.RGBAFormat
  );
  map.magFilter=THREE.LinearFilter;
  map.minFilter=THREE.LinearFilter;
  map.generateMipmaps=false;
  map.needsUpdate=true;
  const uMap={value:map};
  const uActive={value:0};
  const uViewport={value:sampleViewport};
  const materials=new WeakSet();

  // Hook into each existing MeshStandardMaterial without changing its colour,
  // metalness, roughness, texture, lights, or existing crop shader.
  function decorate(material){
    if(!material||materials.has(material))return;
    materials.add(material);
    const previous=material.onBeforeCompile;
    const priorKey=material.customProgramCacheKey&&material.customProgramCacheKey.bind(material);
    material.onBeforeCompile=(shader,renderer)=>{
      if(previous)previous.call(material,shader,renderer);
      shader.uniforms.luxDepthMask=uMap;
      shader.uniforms.luxDepthActive=uActive;
      shader.uniforms.luxDepthViewport=uViewport;
      shader.fragmentShader=
        'uniform sampler2D luxDepthMask;\n'+
        'uniform float luxDepthActive;\n'+
        'uniform vec2 luxDepthViewport;\n'+
        shader.fragmentShader;
      const token='#include <dithering_fragment>';
      if(shader.fragmentShader.includes(token)){
        shader.fragmentShader=shader.fragmentShader.replace(token,
          'if (luxDepthActive > 0.5) {\n'+
          '  vec2 luxScreen = gl_FragCoord.xy / luxDepthViewport;\n'+
          '  if (luxScreen.x >= 0.0 && luxScreen.x <= 1.0 && luxScreen.y >= 0.0 && luxScreen.y <= 1.0) {\n'+
          '    float luxHide = texture2D(luxDepthMask, vec2(luxScreen.x, 1.0 - luxScreen.y)).r;\n'+
          '    if (luxHide > 0.55) discard;\n'+
          '  }\n'+
          '}\n'+token);
      }
    };
    material.customProgramCacheKey=()=>(priorKey?priorKey():'lux-standard')+'-lux-relative-depth-1';
    material.needsUpdate=true;
  }
  function viewport(renderer){
    if(!renderer||!renderer.domElement)return;
    const canvas=renderer.domElement;
    const w=canvas.width||stage.clientWidth;
    const h=canvas.height||stage.clientHeight;
    if(w>0&&h>0)sampleViewport.set(w,h);
  }
  function updateButton(){
    button.setAttribute('aria-pressed',String(enabled));
    button.classList.toggle('depth-enabled',enabled&&ready&&hasMask);
    button.classList.toggle('depth-loading',enabled&&!ready);
    if(failed){button.textContent='DEPTH RETRY';button.title='Depth unavailable; tap to retry';}
    else if(!enabled){button.textContent=glyph+'OFF';button.title='Try foreground occlusion (experimental)';}
    else if(!ready){button.textContent='LOADING DEPTH';button.title='Downloading and starting depth model on this iPhone';}
    else if(!hasMask){button.textContent='DEPTH READY';button.title='Waiting for a stable depth frame';}
    else {button.textContent=glyph+'ON';button.title='Tap to disable experimental foreground occlusion';}
  }
  function clearMask(){
    uActive.value=0;
    hasMask=false;
    lastAccepted=null;
  }
  function resetWorker(){
    if(downloadTimer){clearTimeout(downloadTimer);downloadTimer=null;}
    if(worker){worker.terminate();worker=null;}
    ready=false;busy=false;currentFrame=null;
    clearMask();
  }
  function fail(phase,err){
    lastError=String(err||'Unknown depth error').slice(0,300);
    note('depth-error',{phase,message:lastError});
    enabled=false;failed=true;
    resetWorker();
    updateButton();
  }
  function attachVideo(el){
    if(el&&typeof el.readyState==='number')video=el;
  }
  function captureFrame(){
    if(!video||video.readyState<2||!video.videoWidth||!video.videoHeight)return null;
    const stageW=stage.clientWidth||window.innerWidth;
    const stageH=stage.clientHeight||window.innerHeight;
    if(stageW<1||stageH<1)return null;
    const width=captureWidth;
    const height=Math.max(96,Math.min(384,Math.round(width*stageH/stageW)));
    if(!captureCanvas){
      captureCanvas=document.createElement('canvas');
      captureContext=captureCanvas.getContext('2d',{willReadFrequently:true,alpha:false});
    }
    if(!captureContext)throw new Error('2D capture context unavailable');
    captureCanvas.width=width;captureCanvas.height=height;
    const vW=video.videoWidth,vH=video.videoHeight;
    const targetRatio=width/height,sourceRatio=vW/vH;
    let sx=0,sy=0,sw=vW,sh=vH;
    // Approximate XR8's fullscreen camera crop. Accurate FOV/crop alignment
    // requires calibration on the test phone.
    if(sourceRatio>targetRatio){
      sw=vH*targetRatio;sx=(vW-sw)*.5;
    }else{
      sh=vW/targetRatio;sy=(vH-sh)*.5;
    }
    captureContext.drawImage(video,sx,sy,sw,sh,0,0,width,height);
    const pixels=captureContext.getImageData(0,0,width,height).data;
    return{pixels:pixels.buffer,width,height};
  }
  function poseOf(camera){
    if(!camera)return null;
    camera.updateMatrixWorld(true);
    const position=new THREE.Vector3();
    const quaternion=new THREE.Quaternion();
    camera.getWorldPosition(position);
    camera.getWorldQuaternion(quaternion);
    return{position,quaternion};
  }
  function closeToPose(a,b){
    if(!a||!b)return false;
    return a.position.distanceTo(b.position)<cameraMovementLimit &&
      a.quaternion.angleTo(b.quaternion)<cameraRotationLimit;
  }
  function sampleBox(camera,placement,bounds){
    if(!camera||!placement||!bounds)return null;
    placement.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const points=[
      [bounds.left,bounds.bottom],[bounds.left,bounds.top],
      [bounds.right,bounds.bottom],[bounds.right,bounds.top]
    ];
    const xy=[];
    for(const [x,y] of points){
      const p=new THREE.Vector3(x,y,0).applyMatrix4(placement.matrixWorld).project(camera);
      if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.z>1||p.z< -1)return null;
      xy.push([p.x*.5+.5,1-(p.y*.5+.5)]);
    }
    return{
      left:Math.max(0,Math.min(...xy.map(p=>p[0]))),
      right:Math.min(1,Math.max(...xy.map(p=>p[0]))),
      top:Math.max(0,Math.min(...xy.map(p=>p[1]))),
      bottom:Math.min(1,Math.max(...xy.map(p=>p[1])))
    };
  }
  function applyDepth(data){
    if(!enabled||!ready||!currentFrame||!data||!data.pixels)return;
    if(!closeToPose(currentFrame.pose,poseOf(currentCamera))){
      note('depth-frame-dropped',{reason:'camera-moved-during-inference'});
      return;
    }
    const {width,height}=data;
    const pixels=new Uint8Array(data.pixels);
    if(width<16||height<16||pixels.length<width*height)return;
    const rect=currentFrame.box;
    if(!rect||rect.right-rect.left<.10||rect.bottom-rect.top<.10)return;
    const inner={
      left:rect.left+(rect.right-rect.left)*.12,
      right:rect.right-(rect.right-rect.left)*.12,
      top:rect.top+(rect.bottom-rect.top)*.12,
      bottom:rect.bottom-(rect.bottom-rect.top)*.12
    };
    // The model yields relative inverse-depth: large values are nearer.
    // Calibrate expected wall depth from the lower percentile of pixels
    // within the virtual wall, where we expect the background to dominate.
    const histogram=new Uint32Array(256);
    let count=0;
    const x0=Math.max(0,Math.floor(inner.left*width));
    const x1=Math.min(width,Math.ceil(inner.right*width));
    const y0=Math.max(0,Math.floor(inner.top*height));
    const y1=Math.min(height,Math.ceil(inner.bottom*height));
    for(let y=y0;y<y1;y+=2){
      for(let x=x0;x<x1;x+=2){histogram[pixels[y*width+x]]++;count++;}
    }
    if(count<45)return;
    let seen=0,reference=0;
    for(let value=0;value<256;value++){
      seen+=histogram[value];
      if(seen>=count*.30){reference=value;break;}
    }
    const cutoff=reference+29;
    const rgba=new Uint8Array(width*height*4);
    let foreground=0,inside=0;
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const i=y*width+x;
        // A soft 12-value transition; fragment shader uses >0.55.
        const mask=Math.max(0,Math.min(255,Math.round((pixels[i]-cutoff)*17)));
        const dst=i*4;
        rgba[dst]=mask;rgba[dst+1]=mask;rgba[dst+2]=mask;rgba[dst+3]=255;
        if(x>=x0&&x<x1&&y>=y0&&y<y1){
          inside++;
          if(mask>140)foreground++;
        }
      }
    }
    const fraction=foreground/Math.max(1,inside);
    // Fail safe: do not erase most of the wall if the depth heuristic
    // incorrectly labels the wall itself as a foreground object.
    if(fraction>.68){clearMask();note('depth-mask-suppressed',{fraction:+fraction.toFixed(3),reason:'excessive-occlusion'});return;}
    if(map)map.dispose();
    map=new THREE.DataTexture(rgba,width,height,THREE.RGBAFormat);
    map.magFilter=THREE.LinearFilter;
    map.minFilter=THREE.LinearFilter;
    map.generateMipmaps=false;
    map.needsUpdate=true;
    uMap.value=map;
    hasMask=true;
    lastAccepted={pose:currentFrame.pose,at:performance.now()};
    uActive.value=1;
    processed++;
    if(processed<=3||processed%8===0)note('depth-mask',{
      width,height,reference,cutoff,foregroundRatio:+fraction.toFixed(3),
      inferenceMs:data.inferenceMs||null,accepted:processed
    });
    updateButton();
  }
  function onWorkerMessage(event){
    const data=event.data||{};
    if(data.type==='ready'){
      if(downloadTimer){clearTimeout(downloadTimer);downloadTimer=null;}
      ready=true;busy=false;
      if(!enabled){resetWorker();updateButton();return;}
      note('depth-ready',{ms:Math.round(performance.now()-modelStart),backend:data.backend,model:data.model});
      updateButton();
    }else if(data.type==='depth'){
      busy=false;
      applyDepth(data);
    }else if(data.type==='error'){
      busy=false;fail(data.phase,data.message);
    }
  }
  function start(){
    if(enabled){enabled=false;clearMask();updateButton();note('depth-disabled',{});return;}
    enabled=true;failed=false;ready=false;hasMask=false;lastError='';
    resetWorker();
    enabled=true;modelStart=performance.now();
    updateButton();
    try{
      worker=new Worker('./'+workerName,{type:'module'});
      worker.onmessage=onWorkerMessage;
      worker.onerror=e=>{if(e.preventDefault)e.preventDefault();fail('worker',e.message||'Worker could not start');};
      worker.onmessageerror=()=>fail('worker','Depth worker message invalid');
      worker.postMessage({type:'init'});
      downloadTimer=setTimeout(()=>{
        if(enabled&&!ready)fail('timeout','Depth model did not initialize');
      },90000);
      note('depth-enabled',{model:'depth-anything-v2-small',worker:true,relativeDepth:true});
    }catch(error){fail('worker',error&&error.message||String(error));}
  }
  button.addEventListener('click',start);
  function onFrame(camera,renderer,placement,bounds){
    currentCamera=camera;
    viewport(renderer);
    if(!enabled||!ready||!camera||!placement||!video)return;
    const now=performance.now();
    if(lastAccepted&&(!closeToPose(lastAccepted.pose,poseOf(camera))||
       now-lastAccepted.at>3200)){
      // Never reuse a stale screen-space mask while moving the camera.
      uActive.value=0;
    }
    if(busy||now-lastSend<minFrameDelayMs||document.hidden)return;
    const box=sampleBox(camera,placement,bounds);
    if(!box)return;
    try{
      const frame=captureFrame();
      if(!frame)return;
      const pose=poseOf(camera);
      currentFrame={pose,box};
      frameId++;
      busy=true;
      lastSend=now;
      worker.postMessage({type:'frame',frameId,
        width:frame.width,height:frame.height,pixels:frame.pixels
      },[frame.pixels]);
    }catch(error){busy=false;fail('capture',error&&error.message||String(error));}
  }
  function setPlaced(on){
    button.hidden=!on;
    if(!on){uActive.value=0;}
    updateButton();
  }
  function stop(){
    enabled=false;failed=false;resetWorker();
    video=null;currentCamera=null;currentFrame=null;lastSend=0;
    button.hidden=true;
    updateButton();
  }
  updateButton();
  return{decorate,attachVideo,onFrame,setPlaced,stop,
    getDebug:()=>({enabled,ready,hasMask,frames:processed,lastError})};
};
})();
