/* LUX prototype wall-alignment guide.
   8th Wall offers floor-plane tracking + metric scale, not native vertical-plane
   detection. We estimate a wall from SLAM world feature points when possible.
   If insufficient evidence exists, show a camera-aligned guide at 1.45m.
   A white grid alone must NEVER be presented as proof of wall detection. */
(function () {
  'use strict';

  window.createLuxWallGuide = function createLuxWallGuide(THREE) {
    const width=2.30, height=2.25, cell=.25;
    const vertices=[];
    for (let x=-width/2;x<=width/2+.001;x+=cell) {
      vertices.push(x,-height/2,0,x,height/2,0);
    }
    for (let y=-height/2;y<=height/2+.001;y+=cell) {
      vertices.push(-width/2,y,0,width/2,y,0);
    }
    const geom=new THREE.BufferGeometry();
    geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const mat=new THREE.LineBasicMaterial({
      color:0xffffff, transparent:true, opacity:.48,
      depthTest:false,depthWrite:false
    });
    const grid=new THREE.LineSegments(geom,mat);
    grid.renderOrder=50;
    const group=new THREE.Group();
    group.add(grid);
    group.visible=false;

    const position=new THREE.Vector3();
    const facing=new THREE.Vector3();
    const forward=new THREE.Vector3();
    const cameraPos=new THREE.Vector3();
    const target=new THREE.Vector3();
    let active=false;
    let locked=null;
    let updatedAt=0;
    let filteredPlane=null;
    let lastEstimateAt=0;
    const smooth=.27;

    // RANSAC on x/z with a substantial vertical spread. A vertical wall is a
    // line in top-down space; the floor cannot satisfy the Y-span requirement.
    function estimateVerticalPlane(raw,camera) {
      if (!Array.isArray(raw)||raw.length<12) return null;
      camera.getWorldPosition(cameraPos);
      camera.getWorldDirection(forward);
      const candidates=[];
      const stride=Math.max(1,Math.ceil(raw.length/180));
      for (let i=0;i<raw.length;i+=stride) {
        const item=raw[i],p=item&&item.position;
        if (!p||![p.x,p.y,p.z].every(Number.isFinite)) continue;
        const dx=p.x-cameraPos.x,dy=p.y-cameraPos.y,dz=p.z-cameraPos.z;
        const distance=Math.hypot(dx,dy,dz);
        const front=dx*forward.x+dy*forward.y+dz*forward.z;
        if (distance<.45||distance>4||front<.35) continue;
        candidates.push({x:p.x,y:p.y,z:p.z});
      }
      if (candidates.length<12) return null;
      let best=null;
      const n=candidates.length;
      const attempts=Math.min(85,n*2);
      for(let i=0;i<attempts;i++){
        const a=candidates[(i*37+7)%n];
        const b=candidates[(i*19+Math.floor(i/2)*23+13)%n];
        const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
        if(len<.38) continue;
        const nx=-dz/len,nz=dx/len;
        let sumX=0,sumY=0,sumZ=0,minY=Infinity,maxY=-Infinity;
        let minAlong=Infinity,maxAlong=-Infinity,count=0;
        for(const p of candidates) {
          if(Math.abs((p.x-a.x)*nx+(p.z-a.z)*nz)>.075) continue;
          const along=(p.x-a.x)*dx/len+(p.z-a.z)*dz/len;
          minAlong=Math.min(minAlong,along);
          maxAlong=Math.max(maxAlong,along);
          minY=Math.min(minY,p.y);
          maxY=Math.max(maxY,p.y);
          sumX+=p.x;sumY+=p.y;sumZ+=p.z;count++;
        }
        const ySpan=maxY-minY,hSpan=maxAlong-minAlong;
        if(count<12||ySpan<.52||hSpan<.55) continue;
        const score=count*Math.min(ySpan,2)*Math.min(hSpan,2);
        if(!best||score>best.score) {
          best={score,count,x:sumX/count,y:sumY/count,z:sumZ/count,nx,nz};
        }
      }
      if(!best) return null;
      // Put the grid at the detected feature plane center, with its normal
      // pointing toward the person holding the phone.
      if((cameraPos.x-best.x)*best.nx+(cameraPos.z-best.z)*best.nz<0){
        best.nx*=-1;best.nz*=-1;
      }
      return {
        position:new THREE.Vector3(best.x,best.y,best.z),
        rotation:new THREE.Euler(0,Math.atan2(best.nx,best.nz),0),
        count:best.count
      };
    }

    function setActive(value){
      active=Boolean(value);
      group.visible=active;
      if(!active){filteredPlane=null;locked=null;}
    }
    function update(camera,worldPoints,trackingNormal){
      if(!active||!camera) return;
      const now=performance.now();
      camera.updateMatrixWorld(true);
      camera.getWorldPosition(cameraPos);
      camera.getWorldDirection(forward);
      if(trackingNormal&&now-lastEstimateAt>360) {
        lastEstimateAt=now;
        const result=estimateVerticalPlane(worldPoints,camera);
        if(result){
          filteredPlane=result;
          updatedAt=now;
        }
      }
      const usable=trackingNormal&&filteredPlane&&(now-updatedAt<2600);
      if(usable){
        target.copy(filteredPlane.position);
        facing.set(Math.sin(filteredPlane.rotation.y),0,Math.cos(filteredPlane.rotation.y));
      }else{
        target.copy(cameraPos).addScaledVector(forward,1.45);
        facing.set(-forward.x,0,-forward.z);
        if(facing.lengthSq()<.0001) facing.set(0,0,1);
        facing.normalize();
      }
      const yaw=Math.atan2(facing.x,facing.z);
      if(!locked||(!locked.detected&&usable)) {
        group.position.copy(target);
        group.rotation.set(0,yaw,0);
      } else {
        group.position.lerp(target,smooth);
        let diff=Math.atan2(Math.sin(yaw-group.rotation.y),Math.cos(yaw-group.rotation.y));
        group.rotation.y+=diff*smooth;
      }
      group.updateMatrixWorld(true);
      locked={position:group.position.clone(),rotation:group.rotation.clone(),detected:!!usable};
      mat.opacity=usable?.63:.32;
    }
    function getPose(){
      return locked&&{
        position:locked.position.clone(),
        rotation:locked.rotation.clone(),
        detected:locked.detected
      };
    }
    return {group,setActive,update,getPose};
  };
})();