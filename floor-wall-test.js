/* LUX floor-to-wall experiment · interactive live plane.
   8th Wall supplies one tracked horizontal Y=0 world. We erect a vertical
   plane on it and let the user align the plane IN THREE DIMENSIONS before
   locking the LUX sample into the same tracked world space.
   No image seam detector, no automatic wall claim, no added AR service.
*/
(function(){
'use strict';
window.createLuxFloorWallTest=function(THREE){
  const stage=document.getElementById('stage');
  if(!stage)throw new Error('Floor-wall test: stage unavailable');

  const group=new THREE.Group();
  group.name='lux-live-wall-reference';
  const wall=new THREE.Group();
  wall.name='lux-adjustable-vertical-grid';
  group.add(wall);

  // Dense ~12cm cells; independent dark outline and bright core per line.
  // WebGL lineWidth is ignored on iOS, so use inexpensive ribbon meshes
  // instead of line primitives. They remain legible on white OR dark walls.
  const height=2.32,width=2.8,step=.12;
  const gridSegments=[],borderSegments=[],floorSegments=[];
  for(let x=-width/2+step;x<width/2-.001;x+=step){
    gridSegments.push([x,.015,x,height]);
  }
  for(let y=step;y<height-.001;y+=step){
    gridSegments.push([-width/2,y,width/2,y]);
  }
  borderSegments.push(
    [-width/2,.012,width/2,.012],
    [width/2,.012,width/2,height],
    [width/2,height,-width/2,height],
    [-width/2,height,-width/2,.012]
  );
  floorSegments.push([-width/2,.022,width/2,.022]);
  function ribbonMesh(segments,thickness,z,colour,opacity,renderOrder){
    const xyz=[];
    const half=thickness*.5;
    for(const [ax,ay,bx,by] of segments){
      const dx=bx-ax,dy=by-ay;
      const length=Math.hypot(dx,dy);
      if(length<.00001)continue;
      const nx=-dy/length*half,ny=dx/length*half;
      const a=[ax+nx,ay+ny,z], b=[ax-nx,ay-ny,z];
      const c=[bx+nx,by+ny,z], d=[bx-nx,by-ny,z];
      xyz.push(...a,...b,...c,...c,...b,...d);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
    geometry.computeBoundingSphere();
    const material=new THREE.MeshBasicMaterial({
      color:colour,transparent:true,opacity,
      depthTest:false,depthWrite:false,side:THREE.DoubleSide,
      toneMapped:false
    });
    const mesh=new THREE.Mesh(geometry,material);
    mesh.frustumCulled=false;mesh.renderOrder=renderOrder;
    wall.add(mesh);
    return mesh;
  }
  // Soft dark outline separates the white grid from bright walls.
  ribbonMesh(gridSegments,.010,0,0x090c0f,.78,10);
  ribbonMesh(gridSegments,.004,.001,0xffffff,.98,11);
  ribbonMesh(borderSegments,.017,.002,0x090c0f,.94,12);
  ribbonMesh(borderSegments,.008,.003,0xffffff,1,13);
  ribbonMesh(floorSegments,.020,.004,0x060c09,.92,14);
  ribbonMesh(floorSegments,.009,.005,0xc5ffd6,1,15);
  group.visible=false;

  const overlay=document.createElement('div');
  overlay.className='lux-floor-test-overlay';
  overlay.setAttribute('aria-label','Live vertical wall alignment');
  overlay.innerHTML=
    '<div class="lux-floor-track" role="status" aria-live="polite">'+
      '<span class="lux-floor-track-spinner" aria-hidden="true"></span>'+
      '<div class="lux-floor-track-copy">'+
        '<strong class="lux-floor-track-title">Finding floor</strong>'+
        '<span class="lux-floor-track-detail">Move your phone slowly across the floor</span>'+
      '</div>'+
    '</div>'+
    '<div class="lux-floor-test-instructions">Drag grid to move · ↻ to rotate</div>'+
    '<button class="lux-floor-test-rotate" type="button" aria-label="Drag left or right to rotate the vertical wall">'+
      '<svg viewBox="0 0 96 96" aria-hidden="true">'+
        '<path d="M19 48a29 29 0 0 1 49-21 M77 48a29 29 0 0 1-49 21" '+
          'fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'+
        '<path d="M60 13 L72 26 L55 30 M36 83 L24 70 L41 66" '+
          'fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'+
      '</svg>'+
    '</button>'+
    '<div class="lux-floor-test-actions">'+
      '<button class="lux-floor-test-reset" type="button" aria-label="Reset wall alignment">RESET</button>'+
      '<button class="lux-floor-test-place" type="button" disabled>PLACE WALL</button>'+
    '</div>';
  stage.appendChild(overlay);
  const message=overlay.querySelector('.lux-floor-test-instructions');
  const trackTitle=overlay.querySelector('.lux-floor-track-title');
  const trackDetail=overlay.querySelector('.lux-floor-track-detail');
  const rotateButton=overlay.querySelector('.lux-floor-test-rotate');
  const resetButton=overlay.querySelector('.lux-floor-test-reset');
  const placeButton=overlay.querySelector('.lux-floor-test-place');
  function refreshUI(){
    const ready=active&&initialized&&trackingNormal;
    overlay.classList.toggle('is-ready',ready);
    overlay.classList.toggle('is-waiting',active&&!ready);
    placeButton.disabled=!ready;
    if(!initialized){
      trackTitle.textContent='Finding floor';
      trackDetail.textContent='Move your phone slowly across the floor';
    }else if(!trackingNormal){
      trackTitle.textContent='Tracking paused';
      trackDetail.textContent='Move slowly until tracking recovers';
    }
  }

  const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2();
  const temp=new THREE.Vector3(),forward=new THREE.Vector3();
  const cameraPos=new THREE.Vector3();
  let active=false,placed=false,trackingNormal=false,normalSince=0;
  let initialized=false,adjusted=false;
  let lastCamera=null,lastCameraAt=0,lastJump=null,attempts=0;
  let pointer=null,lastMessage='',lastMessageAt=0;
  let lastCameraForPlace=null,onPlacement=null;
  let dragCount=0,rotateCount=0;

  const diag=()=>window.luxDiagnostics||null;
  function note(name,data){const d=diag();if(d)d.note(name,data);}
  function setMessage(value){
    if(value!==lastMessage){lastMessage=value;message.textContent=value;}
  }
  function isReady(){
    return active && initialized && trackingNormal;
  }
  function floorHit(camera,x,y){
    if(!camera)return null;
    ndc.set(x*2-1,1-y*2);
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc,camera);
    const ray=raycaster.ray;
    if(!Number.isFinite(ray.origin.y)||!Number.isFinite(ray.direction.y)||
      ray.direction.y>=-.045)return null;
    const t=-ray.origin.y/ray.direction.y;
    if(!Number.isFinite(t)||t<.2||t>8)return null;
    const hit=ray.at(t,new THREE.Vector3());
    if(!Number.isFinite(hit.x)||!Number.isFinite(hit.z))return null;
    return hit.setY(0);
  }
  function initialize(camera){
    if(initialized||!camera)return;
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(cameraPos);
    camera.getWorldDirection(forward);
    forward.y=0;
    if(forward.lengthSq()<.0001)return;
    forward.normalize();
    // Prefer an actual ground ray. Fallback is a horizontal world direction,
    // never an estimated image-space wall seam.
    const hit=floorHit(camera,.5,.72) ||
      cameraPos.clone().addScaledVector(forward,1.25).setY(0);
    if(!hit)return;
    wall.position.copy(hit);
    const toCamera=cameraPos.clone().sub(hit).setY(0);
    if(toCamera.lengthSq()<.0001)toCamera.copy(forward).negate();
    wall.rotation.y=Math.atan2(toCamera.x,toCamera.z);
    initialized=true;
    group.visible=true;
    rotateButton.style.display='block';
    refreshUI();
    note('floor-live-initialized',{
      x:hit.x,z:hit.z,yaw:wall.rotation.y,groundY:0,
      source:'ground-ray-or-forward'
    });
    setMessage('Drag grid to move · ↻ to rotate');
  }
  function resetAlignment(){
    initialized=false;adjusted=false;pointer=null;lastCameraForPlace=null;
    wall.position.set(0,0,0);
    wall.rotation.set(0,0,0);
    group.visible=false;
    placeButton.disabled=true;
    rotateButton.style.display='none';
    attempts=0;dragCount=0;rotateCount=0;
  }
  function setActive(value){
    active=!!value;
    if(active){
      placed=false;
      resetAlignment();
      normalSince=0;trackingNormal=false;
      lastCamera=null;lastCameraAt=0;lastJump=null;
      setMessage('Move your phone slowly to establish floor tracking');
      note('floor-test-started',{method:'interactive-vertical-plane',groundY:0});
    }
    group.visible=active&&initialized;
    overlay.classList.toggle('is-active',active);
    overlay.classList.toggle('is-placed',placed);
    refreshUI();
  }
  resetButton.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(!active)return;
    resetAlignment();
    refreshUI();
    note('floor-live-reset',{});
    setMessage('Drag grid to move · ↻ to rotate');
  });

  // The plane remains exactly vertical. Dragging the screen changes only its
  // XZ floor position; the dedicated rotation handle changes only yaw.
  function pointerDown(e,camera){
    if(!isReady()||!camera||pointer||!Number.isFinite(e.clientX))return false;
    if(e.target.closest('button,a,input') &&
       !e.target.closest('.lux-floor-test-rotate'))return false;
    const rotating=!!e.target.closest('.lux-floor-test-rotate');
    pointer={
      id:e.pointerId,mode:rotating?'rotate':'move',
      lastX:e.clientX,lastY:e.clientY,
      startX:e.clientX,startY:e.clientY,
      moved:false
    };
    lastCameraForPlace=camera;
    if(stage.setPointerCapture){
      try{stage.setPointerCapture(e.pointerId);}catch(_){}
    }
    e.preventDefault();
    return true;
  }
  function pointerMove(e,camera){
    if(!pointer||pointer.id!==e.pointerId||!active)return false;
    const dx=e.clientX-pointer.lastX,dy=e.clientY-pointer.lastY;
    pointer.lastX=e.clientX;pointer.lastY=e.clientY;
    if(Math.abs(dx)+Math.abs(dy)<.01)return true;
    pointer.moved=true;
    if(!trackingNormal){
      setMessage('Tracking limited. Hold still until the floor stabilizes.');
      return true;
    }
    if(pointer.mode==='rotate'){
      // Linear manual rotation, no automatic reorientation or smoothing drift.
      wall.rotation.y+=dx*.009;
    }else if(camera){
      camera.updateMatrixWorld(true);
      camera.getWorldPosition(cameraPos);
      camera.getWorldDirection(forward);
      forward.y=0;
      if(forward.lengthSq()>.0001)forward.normalize();
      else forward.set(0,0,-1);
      const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
      const distance=Math.max(.7,Math.min(3.2,Math.hypot(
        wall.position.x-cameraPos.x,wall.position.z-cameraPos.z)));
      const pixels=Math.max(250,Math.min(stage.clientWidth||440,stage.clientHeight||780));
      const metresPerPx=distance*1.2/pixels;
      wall.position.addScaledVector(right,dx*metresPerPx);
      wall.position.addScaledVector(forward,-dy*metresPerPx);
      wall.position.y=0;
    }
    adjusted=true;
    e.preventDefault();
    return true;
  }
  function pointerUp(e){
    if(!pointer||pointer.id!==e.pointerId)return false;
    const info=pointer;
    pointer=null;
    if(stage.hasPointerCapture&&stage.hasPointerCapture(e.pointerId)){
      try{stage.releasePointerCapture(e.pointerId);}catch(_){}
    }
    if(info.moved){
      if(info.mode==='rotate')rotateCount++;else dragCount++;
      note('floor-live-adjusted',{
        action:info.mode,
        x:wall.position.x,z:wall.position.z,yaw:wall.rotation.y,
        dragCount,rotateCount
      });
    }
    return true;
  }
  // Any GUI button (including PLACE WALL) acts independently of the stage
  // pointer gestures. The handler is supplied by app.js.
  function setPlacementHandler(handler){onPlacement=handler;}
  function confirm(){
    attempts++;
    if(!isReady()){
      setMessage('Wait until floor tracking is stable before placing.');
      note('floor-live-rejected',{reason:'tracking-limited'});
      return {action:'wait'};
    }
    const pose={
      position:wall.position.clone().setY(1.12),
      rotation:new THREE.Euler(0,wall.rotation.y,0),
      detected:false,confidence:null,
      source:'floor-live-plane',
      groundY:0
    };
    placed=true;active=false;
    group.visible=false; // LUX cladding replaces the alignment grid.
    overlay.classList.remove('is-active','is-ready','is-waiting');
    overlay.classList.add('is-placed');
    note('floor-live-placed',{
      x:pose.position.x,y:pose.position.y,z:pose.position.z,
      yaw:pose.rotation.y,
      adjusted,dragCount,rotateCount
    });
    if(onPlacement)onPlacement(pose);
    return{action:'place',pose};
  }
  placeButton.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();confirm();
  });

  function update(camera,normalState){
    const now=performance.now();
    if(normalState){
      if(!trackingNormal)normalSince=now;
    }else{
      normalSince=0;
    }
    trackingNormal=!!normalState;
    if(!active&&!placed)return;
    if(camera){
      camera.updateMatrixWorld(true);
      camera.getWorldPosition(temp);
      if(lastCamera){
        const dt=now-lastCameraAt;
        const delta=temp.distanceTo(lastCamera);
        if(dt>0&&dt<600&&delta>.80){
          lastJump={deltaMeters:delta,elapsedMs:Math.round(dt),at:Math.round(now)};
          note('floor-test-camera-jump',lastJump);
        }
      }
      if(!lastCamera)lastCamera=temp.clone();
      else lastCamera.copy(temp);
      lastCameraAt=now;
    }
    if(!active)return;
    lastCameraForPlace=camera||lastCameraForPlace;
    // 8th Wall already declares NORMAL when SLAM is initialized.
    // Don't add another arbitrary 600ms delay before showing the grid.
    if(trackingNormal&&!initialized)initialize(camera);
    refreshUI();
    // Rotate button follows the projected base of the world-space wall.
    if(initialized&&camera){
      const base=wall.position.clone().setY(.02).project(camera);
      const w=stage.clientWidth||440,h=stage.clientHeight||780;
      const x=(base.x*.5+.5)*w;
      const y=(-base.y*.5+.5)*h;
      if(base.z>-1&&base.z<1&&Number.isFinite(x)&&Number.isFinite(y)){
        rotateButton.style.left=Math.max(53,Math.min(w-53,x))+'px';
        rotateButton.style.top=Math.max(h*.49,Math.min(h-225,y+48))+'px';
        rotateButton.style.display='block';
      }else rotateButton.style.display='none';
    }
    if(now-lastMessageAt>1350){
      lastMessageAt=now;
      if(initialized&&trackingNormal)setMessage('Drag grid to move · ↻ to rotate');
    }
  }
  function getDebug(){
    return{
      mode:'floor-live-plane',groundY:0,trackingNormal,
      phase:placed?'placed':initialized?'adjusting':'waiting-for-floor',
      initialized,adjusted,dragCount,rotateCount,
      x:initialized||placed?wall.position.x:null,
      z:initialized||placed?wall.position.z:null,
      yawRadians:initialized||placed?wall.rotation.y:null,
      lastJump,attempts,cameraFrames:0,seamFrames:0
    };
  }
  function stop(){
    active=false;placed=false;trackingNormal=false;normalSince=0;
    resetAlignment();
    overlay.classList.remove('is-active','is-placed','is-ready','is-waiting');
  }
  return{
    group,setActive,update,getDebug,floorHit,
    pointerDown,pointerMove,pointerUp,
    setPlacementHandler,confirm,stop
  };
};
})();
