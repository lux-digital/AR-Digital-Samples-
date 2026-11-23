/* LUX multi-sensor wall guidance, v2 (experimental).
   Three signals: calibrated 8th Wall floor (Y=0), lightweight camera seam
   contrast, and SLAM world points. A confirmed wall requires temporal stability.
   No native vertical-plane API is implied. After placement the anchor stays
   fixed in world coordinates; this module never moves placed content.
*/
(function(){
'use strict';
window.createLuxWallGuide=function(THREE){
  const stage=document.getElementById('stage');
  const svgNS='http://www.w3.org/2000/svg';
  const overlay=document.createElement('div');
  overlay.className='lux-wall-guide';
  overlay.setAttribute('aria-live','polite');
  const svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio','none');
  svg.classList.add('lux-seam-svg');
  const line=document.createElementNS(svgNS,'path');
  line.setAttribute('fill','none');
  line.setAttribute('stroke-width','3');
  line.setAttribute('stroke-linecap','round');
  svg.appendChild(line);
  // Screen-space reference grid always visible while searching. This is NOT
  // detected geometry; it prevents an empty AR screen if video pixels are absent.
  const referenceGrid=document.createElementNS(svgNS,'path');
  referenceGrid.setAttribute('class','lux-wall-reference-grid');
  let gridPath='';
  for(let i=0;i<=6;i++){
    const x=170+i*110;
    gridPath+='M '+x+' 300 L '+x+' 750 ';
  }
  for(let i=0;i<=5;i++){
    const y=300+i*90;
    gridPath+='M 170 '+y+' L 830 '+y+' ';
  }
  referenceGrid.setAttribute('d',gridPath);
  svg.insertBefore(referenceGrid,line);
  const instructions=document.createElement('div');
  instructions.className='lux-wall-instructions';
  instructions.textContent='Slowly scan the bottom edge of a wall';
  const controls=document.createElement('div');
  controls.className='lux-wall-actions';
  const manualHint=document.createElement('div');
  manualHint.className='lux-wall-manual-hint';
  manualHint.textContent='Tap two points on the floor–wall edge for manual alignment.';
  const testButton=document.createElement('button');
  testButton.type='button';
  testButton.className='lux-wall-test-place';
  testButton.textContent='PLACE TEST SAMPLE';
  testButton.setAttribute('aria-label','Place approximate test sample without detected wall');
  controls.append(manualHint,testButton);
  overlay.append(svg,instructions,controls);
  overlay.hidden=true;
  stage.appendChild(overlay);
  const debugMode=new URLSearchParams(window.location.search).get('arDebug')==='1';
  const diagnostics=debugMode?document.createElement('div'):null;
  if(diagnostics){
    diagnostics.className='lux-wall-debug';
    diagnostics.textContent='LUX AR / initializing';
    stage.appendChild(diagnostics);
  }
  let lastDebugAt=0;

  const group=new THREE.Group();
  const vertices=[];
  for(let i=-5;i<=5;i++){
    const v=i*.22;
    vertices.push(v,-1.1,0,v,1.1,0);
    vertices.push(-1.1,v,0,1.1,v,0);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  const material=new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.27,depthTest:false,depthWrite:false});
  const grid=new THREE.LineSegments(geo,material);
  grid.renderOrder=70;
  group.add(grid);
  group.visible=false;

  const pixelCanvas=document.createElement('canvas');
  pixelCanvas.width=176;pixelCanvas.height=112;
  const ctx=pixelCanvas.getContext('2d',{willReadFrequently:true});
  const raycaster=new THREE.Raycaster();
  const floor=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const v2=new THREE.Vector2();
  const camPos=new THREE.Vector3(),dir=new THREE.Vector3();
  let video=null,enabled=false,lastImageAt=0,lastPointsAt=0;
  let imageLine=null,pointsPlane=null,pointsAt=0;
  let candidate=null,stable=0,locked=null,confirmedLock=null,lastDecisionAt=0;
  let manualStart=null,manualPose=null,manualStep=0;
  let lastUi='',imageReady=false,debug={
    cameraFrames:0,seamFrames:0,worldPoints:0,
    imageAttempts:0,imageError:null
  };
  let trackedNormal=false;
  let onTestPlace=null;
  testButton.addEventListener('pointerup',e=>{e.stopPropagation();});
  testButton.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(!enabled||!onTestPlace)return;
    const camera=window.luxActiveCamera && window.luxActiveCamera();
    if(!camera)return;
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(dir).normalize();
    const position=camPos.clone().addScaledVector(dir,1.5);
    const normal=new THREE.Vector3(-dir.x,0,-dir.z);
    if(normal.lengthSq()<.00001)normal.set(0,0,1);
    normal.normalize();
    const pose={
      position,rotation:new THREE.Euler(0,Math.atan2(normal.x,normal.z),0),
      confidence:0,detected:false,source:'approximate-test'
    };
    onTestPlace(pose);
  });
  function setTestPlacement(handler){onTestPlace=typeof handler==='function'?handler:null;}

  const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
  const angleDifference=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

  function setText(t){
    if(lastUi===t)return;
    lastUi=t;instructions.textContent=t;
  }
  function setActive(active){
    enabled=!!active;
    overlay.hidden=!enabled;
    if(diagnostics)diagnostics.hidden=!enabled;
    group.visible=enabled;
    line.setAttribute('d','');
    referenceGrid.style.opacity=enabled?'1':'0';
    if(enabled){
      stable=0;locked=null;confirmedLock=null;lastDecisionAt=0;
      manualStart=null;manualPose=null;manualStep=0;
      imageLine=null;pointsPlane=null;pointsAt=0;
      setText('Scan slowly along the floor–wall junction');
    }
  }
  function attachVideo(element){video=element||null;}

  // No heavy ML dependency. Sample a low-resolution camera image at ~3 FPS;
  // detect a *candidate* long floor/wall contrast edge, not semantic certainty.
  function sampleImage(now){
    if(!ctx||!video||video.readyState<2||now-lastImageAt<330)return;
    lastImageAt=now;
    debug.imageAttempts++;
    const W=pixelCanvas.width,H=pixelCanvas.height;
    try{
      const vw=video.videoWidth||W,vh=video.videoHeight||H;
      const stagePortrait=stage.clientHeight>stage.clientWidth;
      const rotate=stagePortrait && vw>vh*1.12;
      ctx.save();
      ctx.clearRect(0,0,W,H);
      if(rotate){
        ctx.translate(W/2,H/2);ctx.rotate(Math.PI/2);
        ctx.drawImage(video,-H/2,-W/2,H,W);
      }else ctx.drawImage(video,0,0,W,H);
      ctx.restore();
      const img=ctx.getImageData(0,0,W,H).data;
      const luma=new Float32Array(W*H);
      for(let i=0,j=0;i<img.length;i+=4,j++){
        luma[j]=img[i]*.299+img[i+1]*.587+img[i+2]*.114;
      }
      let best=null;
      // Scan plausible seams in the lower half, allowing moderate perspective
      // slope. Confidence is contrast + cross-column support, not ML semantics.
      for(let slope=-.23;slope<=.231;slope+=.046){
        for(let intercept=.44;intercept<=.841;intercept+=.021){
          let sum=0,support=0,squares=0;
          for(let i=0;i<16;i++){
            const x=(i+.5)/16,px=Math.round(x*(W-1));
            const y=intercept+slope*(x-.5),py=Math.round(y*H);
            if(py<7||py>H-8)continue;
            const d=Math.abs(luma[(py+3)*W+px]-luma[(py-3)*W+px]);
            const dd=Math.max(0,d-13);
            sum+=Math.min(85,dd);squares+=d*d;
            if(d>22)support++;
          }
          // Reject narrow/local edges even if they are very strong.
          if(support<11)continue;
          const avg=sum/16;
          const score=avg*(support/16);
          if(!best||score>best.score)best={score,support,slope,intercept};
        }
      }
      imageReady=true;debug.cameraFrames++;
      debug.imageError=null;
      if(best&&best.score>12.5) {
        imageLine={...best,confidence:clamp(best.score/35,0,1),timestamp:now};
        debug.seamFrames++;
      }else imageLine=null;
    }catch(err){
      imageReady=false;imageLine=null;
      debug.imageError=String(err&&err.message||err).slice(0,160);
      // Some browsers restrict reading their camera video. Keep manual fallback.
      if(debug.cameraFrames===0)console.warn('LUX seam sampling unavailable:',err.message);
    }
  }

  function detectPointWall(raw,camera){
    if(!Array.isArray(raw)||raw.length<16)return null;
    camera.getWorldPosition(camPos);camera.getWorldDirection(dir);
    const pts=[];
    for(let i=0;i<raw.length;i+=Math.max(1,Math.ceil(raw.length/180))){
      const r=raw[i],p=r&&r.position;
      if(!p||![p.x,p.y,p.z].every(Number.isFinite))continue;
      const dx=p.x-camPos.x,dy=p.y-camPos.y,dz=p.z-camPos.z;
      const distance=Math.hypot(dx,dy,dz);
      if(distance<.45||distance>5||dx*dir.x+dy*dir.y+dz*dir.z<.25)continue;
      if(r.confidence!=null && r.confidence<.28)continue;
      pts.push(p);
    }
    debug.worldPoints=pts.length;
    if(pts.length<14)return null;
    // Deterministic RANSAC candidate selection: reproducible test runs.
    let best=null;
    for(let i=0;i<Math.min(110,pts.length*3);i++){
      const a=pts[(i*29+7)%pts.length],b=pts[(i*17+Math.floor(i/3)*11+13)%pts.length];
      const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
      if(len<.38)continue;
      let nx=-dz/len,nz=dx/len,score=0,sumX=0,sumZ=0,minY=1e9,maxY=-1e9,minU=1e9,maxU=-1e9;
      for(const p of pts){
        if(Math.abs((p.x-a.x)*nx+(p.z-a.z)*nz)>.065)continue;
        const u=((p.x-a.x)*dx+(p.z-a.z)*dz)/len;
        minU=Math.min(minU,u);maxU=Math.max(maxU,u);
        minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
        sumX+=p.x;sumZ+=p.z;score++;
      }
      if(score<13||maxY-minY<.50||maxU-minU<.55)continue;
      const merit=score*Math.min(maxY-minY,2)*Math.min(maxU-minU,2);
      if(!best||merit>best.merit){
        const cx=sumX/score,cz=sumZ/score;
        if((camPos.x-cx)*nx+(camPos.z-cz)*nz<0){nx=-nx;nz=-nz;}
        best={merit,count:score,position:new THREE.Vector3(cx,1.10,cz),
          yaw:Math.atan2(nx,nz),confidence:clamp(merit/40,0,1)};
      }
    }
    return best;
  }

  function floorPoint(camera,x,y){
    // Convert normalized device screen coordinates to world floor intersection.
    v2.set(x*2-1,1-y*2);
    raycaster.setFromCamera(v2,camera);
    const hit=raycaster.ray.intersectPlane(floor,new THREE.Vector3());
    if(!hit)return null;
    camera.getWorldPosition(camPos);
    const d=hit.distanceTo(camPos);
    if(!Number.isFinite(d)||d<.4||d>7)return null;
    return hit;
  }
  function poseFromFloorEnds(left,right,camera){
    const p0=floorPoint(camera,left.x,left.y),p1=floorPoint(camera,right.x,right.y);
    if(!p0||!p1)return null;
    const d=p1.clone().sub(p0),len=Math.hypot(d.x,d.z);
    if(len<.32||len>6)return null;
    let nx=-d.z/len,nz=d.x/len;
    camera.getWorldPosition(camPos);
    const cx=(p0.x+p1.x)/2,cz=(p0.z+p1.z)/2;
    if((camPos.x-cx)*nx+(camPos.z-cz)*nz<0){nx=-nx;nz=-nz;}
    return {position:new THREE.Vector3(cx,1.10,cz),
      yaw:Math.atan2(nx,nz),confidence:.72,source:'seam'};
  }
  function imageCandidate(camera){
    if(!imageLine||performance.now()-imageLine.timestamp>700)return null;
    const l=imageLine;
    const p=poseFromFloorEnds(
      {x:.14,y:l.intercept+l.slope*(.14-.5)},
      {x:.86,y:l.intercept+l.slope*(.86-.5)},camera);
    if(p){p.confidence=clamp(l.confidence*.87+.08,0,1);}
    return p;
  }
  function reconcile(a,b){
    if(!a)return b?{...b,source:'world-points'}:null;
    if(!b)return a;
    const dist=Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z);
    const yaw=angleDifference(a.yaw,b.yaw);
    if(dist<.40 && yaw<.50){
      const combined={position:a.position.clone().lerp(b.position,.25),
        yaw:a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*.25,
        confidence:Math.min(1,.84+.12*Math.min(a.confidence,b.confidence)),
        source:'confirmed'};
      return combined;
    }
    // Disagreement means no confirmed wall, not the average of bad guesses.
    return null;
  }
  function update(camera,worldPoints,normal){
    if(!enabled||!camera)return;
    const now=performance.now();
    trackedNormal=normal;
    camera.updateMatrixWorld(true);
    // Read the video for diagnostics even during LIMITED tracking; only
    // claim a wall once XR tracking is NORMAL.
    if(now-lastImageAt>330)sampleImage(now);
    if(trackedNormal&&Array.isArray(worldPoints)&&now-lastPointsAt>450){
      lastPointsAt=now;
      pointsPlane=detectPointWall(worldPoints,camera);
      pointsAt=now;
    }
    const seam=trackedNormal?imageCandidate(camera):null;
    const wall=trackedNormal&&now-pointsAt<1200?pointsPlane:null;
    const next=trackedNormal?reconcile(seam,wall):null;
    // Require sustained agreement across separate video/tracking measurements,
    // not merely five fast render frames (which would accept false positives).
    if(now-lastDecisionAt>=340 && !confirmedLock){
      lastDecisionAt=now;
      if(next&&next.confidence>=.70){
        if(candidate && candidate.position.distanceTo(next.position)<.28
           &&angleDifference(candidate.yaw,next.yaw)<.24){
          candidate.position.lerp(next.position,.30);
          candidate.yaw+=Math.atan2(Math.sin(next.yaw-candidate.yaw),
                                     Math.cos(next.yaw-candidate.yaw))*.30;
          candidate.confidence=next.confidence;
          candidate.source=next.source;
          stable=Math.min(stable+1,20);
        }else {candidate=next;stable=1;}
      } else {
        stable=Math.max(0,stable-1);
      }
      if(candidate && stable>=5){
        confirmedLock={
          position:candidate.position.clone(),
          rotation:new THREE.Euler(0,candidate.yaw,0),
          confidence:candidate.confidence,detected:true,
          source:candidate.source
        };
      }
    }
    // After sufficient evidence, preserve the world anchor while looking away
    // from the seam. DO NOT recalculate wall pose from a camera-facing fallback.
    const ready=!!(confirmedLock&&trackedNormal);
    referenceGrid.classList.toggle('is-estimated',ready);
    locked=confirmedLock||manualPose;
    if(locked){
      group.position.copy(locked.position);
      group.rotation.copy(locked.rotation);
      material.opacity=ready?.69:.42;
      material.color.setHex(ready?0x89e4ae:0xffffff);
    }else{
      // A visual *guide* only: no object gets placed here automatically.
      camera.getWorldPosition(camPos);camera.getWorldDirection(dir);
      group.position.copy(camPos).addScaledVector(dir,1.5);
      group.rotation.set(0,Math.atan2(-dir.x,-dir.z),0);
      material.opacity=.20;material.color.setHex(0xffffff);
    }
    group.updateMatrixWorld(true);
    const showSeam=seam&&imageLine;
    if(showSeam){
      const p=imageLine;
      const y0=clamp(p.intercept-p.slope*.5,0,1)*1000;
      const y1=clamp(p.intercept+p.slope*.5,0,1)*1000;
      line.setAttribute('d','M 0 '+y0+' L 1000 '+y1);
      line.setAttribute('stroke',ready?'#83edb1':'#ffffff');
      line.setAttribute('stroke-dasharray',ready?'none':'9 7');
    }else line.setAttribute('d','');
    if(diagnostics && now-lastDebugAt>650){
      lastDebugAt=now;
      diagnostics.textContent=[
        'LUX AR • experimental wall tracker',
        'XR: '+(trackedNormal?'NORMAL':'LIMITED'),
        'Video: '+(imageReady?'readable':(video?'waiting':'unavailable')),
        'Seam candidates: '+debug.seamFrames,
        'SLAM wall points: '+debug.worldPoints,
        'Stable checks: '+stable+'/5',
        'Pose: '+(locked?locked.source:'none'),
        'Ready: '+(ready?'yes':'no')
      ].join('\n');
    }
    if(manualStep===1)setText('Tap the other end of the floor–wall edge');
    else if(ready)setText('Wall alignment ready — tap to place');
    else if(!trackedNormal)setText('Move slowly to initialize tracking');
    else if(seam&&wall)setText('Checking floor edge against 3D wall features…');
    else if(seam)setText('Floor edge found — verifying wall position…');
    else if(wall)setText('3D wall features found — scan the floor edge');
    else setText('Scan the floor–wall junction; or tap two ends manually');
  }
  function getPose(){
    return locked&&{
      position:locked.position.clone(),rotation:locked.rotation.clone(),
      confidence:locked.confidence,detected:locked.detected,
      source:locked.source
    };
  }
  function isReady(){return !!(confirmedLock&&trackedNormal);}
  function tap(camera,x,y){
    if(!enabled)return{action:'inactive'};
    if(isReady())return{action:'place',pose:getPose()};
    if(!trackedNormal)return{action:'wait'};
    const p=floorPoint(camera,x,y);
    if(!p)return{action:'aim-down'};
    if(!manualStart){manualStart={x,y};manualStep=1;return{action:'first'};}
    const pose=poseFromFloorEnds(manualStart,{x,y},camera);
    if(!pose){manualStart={x,y};return{action:'retry'};}
    manualPose={position:pose.position,rotation:new THREE.Euler(0,pose.yaw,0),
      confidence:.72,detected:false,source:'manual'};
    locked=manualPose;manualStep=2;
    return{action:'place',pose:getPose()};
  }
  function getDebug(){return{
    ...debug,
    trackingNormal:trackedNormal,
    source:locked&&locked.source,
    stable,ready:isReady(),
    videoPresent:!!video,
    videoReadyState:video&&video.readyState,
    videoWidth:video&&video.videoWidth,
    videoHeight:video&&video.videoHeight,
    imageReadable:imageReady,
    seamCandidate:imageLine&&{
      score:Math.round(imageLine.score*10)/10,
      slope:imageLine.slope,
      intercept:imageLine.intercept,
      support:imageLine.support,
      confidence:imageLine.confidence
    },
    pointWall:pointsPlane&&{
      count:pointsPlane.count,
      confidence:pointsPlane.confidence,
      position:{
        x:pointsPlane.position.x,
        y:pointsPlane.position.y,
        z:pointsPlane.position.z
      }
    },
    candidateSource:candidate&&candidate.source,
    confirmed:!!confirmedLock,
    manualStep
  };}
  return{group,setActive,update,attachVideo,getPose,isReady,tap,getDebug,setTestPlacement};
};
})();