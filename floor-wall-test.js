/* LUX floor-to-wall experiment v1.
   This is NOT automatic vertical-plane recognition. 8th Wall's absolute-scale
   world uses a tracked horizontal ground reference at Y=0. Two floor-edge taps
   determine a horizontal wall direction; we erect a vertical plane on it.
   No camera-pixel analysis, seam detection, or point-cloud wall fitting.
*/
(function(){
'use strict';
window.createLuxFloorWallTest=function(THREE){
  const stage=document.getElementById('stage');
  if(!stage)throw new Error('Floor-wall test: stage unavailable');
  const group=new THREE.Group();
  group.name='lux-floor-wall-reference';
  const floorMaterial=new THREE.MeshBasicMaterial({
    color:0xffffff,transparent:true,opacity:.92,depthTest:false,depthWrite:false,
    side:THREE.DoubleSide
  });
  const floorDotGeo=new THREE.RingGeometry(.035,.055,32);
  floorDotGeo.rotateX(-Math.PI/2);
  const reticle=new THREE.Mesh(floorDotGeo,floorMaterial);
  reticle.position.y=.017;
  reticle.renderOrder=12;
  group.add(reticle);

  const dotGeo=new THREE.SphereGeometry(.055,12,10);
  const dotMat=new THREE.MeshBasicMaterial({
    color:0x9af5b5,depthTest:false,depthWrite:false
  });
  const firstDot=new THREE.Mesh(dotGeo,dotMat);
  const secondDot=new THREE.Mesh(dotGeo,dotMat);
  firstDot.visible=false;secondDot.visible=false;
  firstDot.renderOrder=12;secondDot.renderOrder=12;
  group.add(firstDot,secondDot);

  const baseMat=new THREE.LineBasicMaterial({
    color:0xffffff,transparent:true,opacity:.92,depthTest:false,depthWrite:false
  });
  const gridMat=new THREE.LineBasicMaterial({
    color:0x9af5b5,transparent:true,opacity:.48,depthTest:false,depthWrite:false
  });
  let baseLine=null,wallGrid=null;

  const overlay=document.createElement('div');
  overlay.className='lux-floor-test-overlay';
  overlay.setAttribute('aria-label','Experimental wall-from-floor guide');
  overlay.innerHTML=
    '<div class="lux-floor-test-tag">EXPERIMENT · FLOOR → WALL</div>'+
    '<div class="lux-floor-test-instructions" id="lux-floor-test-instructions">'+
      'Move phone slowly to establish floor tracking'+
    '</div>'+
    '<button class="lux-floor-test-reset" type="button" aria-label="Clear points and start again">'+
      'CLEAR POINTS'+
    '</button>'+
    '<div class="lux-floor-test-footnote">Two points on the TRUE floor–wall junction. No automatic wall detection.</div>';
  stage.appendChild(overlay);
  const message=overlay.querySelector('.lux-floor-test-instructions');
  const resetButton=overlay.querySelector('.lux-floor-test-reset');
  const raycaster=new THREE.Raycaster();
  const ndc=new THREE.Vector2();
  const temp=new THREE.Vector3();
  const normal=new THREE.Vector3();
  const direction=new THREE.Vector3();
  let active=false,placed=false,trackingNormal=false,normalSince=0;
  let pointA=null,pointB=null,wallPose=null;
  let lastCamera=null,lastCameraAt=0,lastJump=null,attempts=0;
  let priorMessage='',lastMessageAt=0;
  const diag=()=>window.luxDiagnostics||null;
  function note(name,data){const d=diag();if(d)d.note(name,data);}
  function setMessage(value){
    if(value===priorMessage)return;
    priorMessage=value;message.textContent=value;
  }
  function replaceLine(oldLine,coords,material){
    if(oldLine){group.remove(oldLine);oldLine.geometry.dispose();}
    if(!coords.length)return null;
    const geometry=new THREE.BufferGeometry().setFromPoints(coords);
    const line=new THREE.LineSegments(geometry,material);
    line.frustumCulled=false;line.renderOrder=11;
    group.add(line);
    return line;
  }
  function hideGuides(){
    if(baseLine){group.remove(baseLine);baseLine.geometry.dispose();baseLine=null;}
    if(wallGrid){group.remove(wallGrid);wallGrid.geometry.dispose();wallGrid=null;}
    pointA=null;pointB=null;wallPose=null;placed=false;
    firstDot.visible=false;secondDot.visible=false;
    reticle.visible=false;
  }
  function setActive(value){
    active=!!value;
    if(active){
      hideGuides();
      attempts=0;normalSince=0;lastCamera=null;lastJump=null;
      trackingNormal=false;
      setMessage('Move phone slowly until floor tracking is ready');
      note('floor-test-started',{method:'two-floor-taps',groundY:0});
    }
    overlay.classList.toggle('is-active',active||placed);
    group.visible=active||placed;
    reticle.visible=false;
  }
  resetButton.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    hideGuides();active=true;
    overlay.classList.add('is-active');
    group.visible=true;
    note('floor-test-reset',{});
    setMessage(trackingNormal?'Tap first point on the wall’s TRUE floor junction':
      'Move phone slowly until floor tracking is ready');
  });

  // Raycast THREE's calibrated XR8 camera into its WORLD-TRACKED floor Y=0.
  // This is not a picture-space guess or an arbitrary camera-facing plane.
  function floorHit(camera,x,y){
    if(!camera)return null;
    ndc.set(x*2-1,1-y*2);
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc,camera);
    const ray=raycaster.ray;
    if(!Number.isFinite(ray.origin.y)||!Number.isFinite(ray.direction.y)
       ||ray.direction.y>=-.045)return null;
    const t=-ray.origin.y/ray.direction.y;
    if(!Number.isFinite(t)||t<.20||t>8)return null;
    const point=ray.at(t,new THREE.Vector3());
    if(!Number.isFinite(point.x)||!Number.isFinite(point.z))return null;
    point.y=0;
    return point;
  }
  function makePlane(camera){
    const dx=pointB.x-pointA.x,dz=pointB.z-pointA.z;
    const span=Math.hypot(dx,dz);
    direction.set(dx/span,0,dz/span);
    const centre=pointA.clone().add(pointB).multiplyScalar(.5);
    // Rotation makes the front of the LUX geometry face the test camera.
    normal.set(-direction.z,0,direction.x);
    camera.getWorldPosition(temp);
    if(normal.dot(temp.clone().sub(centre))<0)normal.negate();
    const yaw=Math.atan2(normal.x,normal.z);
    const pose={
      position:centre.clone().setY(1.12),
      rotation:new THREE.Euler(0,yaw,0),
      confidence:null,detected:false,
      source:'floor-two-point',
      baselineMeters:span
    };
    wallPose=pose;
    // A WORLD-SPACE 2.3m-tall grid that should remain stable while walking.
    // Coordinates are baked once; no further camera-facing adjustments.
    const half=Math.max(.9,span*.5+.16),wallWidth=half*2;
    const start=centre.clone().addScaledVector(direction,-half);
    const pts=[];
    for(let x=0;x<=wallWidth+.01;x+=.23){
      const a=start.clone().addScaledVector(direction,x);
      const b=a.clone();a.y=.025;b.y=2.32;pts.push(a,b);
    }
    for(let y=.025;y<2.38;y+=.25){
      const a=start.clone();a.y=y;
      const b=a.clone().addScaledVector(direction,wallWidth);
      pts.push(a,b);
    }
    wallGrid=replaceLine(wallGrid,pts,gridMat);
    baseLine=replaceLine(baseLine,[
      pointA.clone().setY(.028),pointB.clone().setY(.028)
    ],baseMat);
    return pose;
  }
  function tap(camera,x,y){
    if(!active||placed)return{action:'inactive'};
    attempts++;
    if(!trackingNormal||!normalSince||performance.now()-normalSince<600){
      note('floor-test-tap-rejected',{reason:'tracking-not-stable',attempt:attempts});
      setMessage('Tracking not ready. Move slowly until the floor reference settles.');
      return{action:'wait'};
    }
    const p=floorHit(camera,x,y);
    if(!p){
      note('floor-test-tap-rejected',{reason:'no-ground-intersection',x,y});
      setMessage('Aim LOWER: tap where the wall meets the actual floor.');
      return{action:'aim-down'};
    }
    if(!pointA){
      pointA=p;
      firstDot.position.copy(p).setY(.035);firstDot.visible=true;
      setMessage('Point 1 saved. Tap another point FARTHER ALONG the same wall base.');
      note('floor-test-point',{index:1,x:p.x,y:0,z:p.z});
      return{action:'first'};
    }
    const distance=Math.hypot(p.x-pointA.x,p.z-pointA.z);
    if(distance<.55||distance>5){
      note('floor-test-tap-rejected',{reason:'point-distance',distance});
      setMessage(distance<.55?
        'Second point too close. Move along the wall and tap farther away.':
        'Second point too far away. Select another point within 5 metres.');
      return{action:'retry'};
    }
    pointB=p;
    secondDot.position.copy(p).setY(.035);secondDot.visible=true;
    const pose=makePlane(camera);
    placed=true;active=false;reticle.visible=false;
    setMessage('FLOOR-BASED WALL PLACED · Walk around and check alignment.');
    note('floor-test-point',{index:2,x:p.x,y:0,z:p.z});
    note('floor-test-plane',{
      baselineMeters:distance,
      yawRadians:pose.rotation.y,
      centre:{x:pose.position.x,y:pose.position.y,z:pose.position.z},
      source:'two-floor-points'
    });
    return{action:'place',pose};
  }
  function update(camera,normalState){
    const now=performance.now();
    if(normalState){
      if(!trackingNormal)normalSince=now;
    }else normalSince=0;
    trackingNormal=!!normalState;
    if(!active&&!placed)return;
    // Don't conflate a tracking failure with detector failure. Preserve
    // visual 3D reference in world coordinates and report loss separately.
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
    if(active){
      const hit=trackingNormal?floorHit(camera,.5,.74):null;
      reticle.visible=!!hit;
      if(hit)reticle.position.copy(hit).setY(.017);
      if(now-lastMessageAt>1500){
        lastMessageAt=now;
        if(!trackingNormal)setMessage('TRACKING LIMITED · Move slowly and scan the FLOOR first.');
        else if(now-normalSince<600)setMessage('Floor tracking stabilizing…');
        else if(!pointA)setMessage('Tap POINT 1 where the wall meets the floor.');
        else setMessage('Tap POINT 2 farther along that same wall base.');
      }
    }else{
      reticle.visible=false;
      if(now-lastMessageAt>1500){
        lastMessageAt=now;
        setMessage(trackingNormal?
          'PLACED · Walk sideways to test whether the wall grid stays fixed.':
          'TRACKING LIMITED · Check whether the grid jumps when tracking returns.');
      }
    }
  }
  function getDebug(){
    return{
      mode:'floor-two-point',
      groundY:0,trackingNormal,
      phase:placed?'placed':pointA?'second-point':'first-point',
      hasPoint1:!!pointA,hasPoint2:!!pointB,
      baselineMeters:pointA&&pointB?pointA.distanceTo(pointB):null,
      yawRadians:wallPose&&wallPose.rotation.y,
      lastJump,attempts,
      cameraFrames:0,seamFrames:0
    };
  }
  return{group,setActive,tap,update,getDebug,floorHit};
};
})();
