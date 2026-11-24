/* LUX AR Digital Samples — prototype 01
   Real 3D: THREE.GLTFLoader; real mobile world tracking: 8th Wall distributed XR binary.
   AR uses manual wall alignment (not automatic vertical-plane detection).
   8th Wall license: https://github.com/8thwall/engine/blob/main/LICENSE
*/
(() => {
  'use strict';

  const T = window.THREE;
  const diag = window.luxDiagnostics || null;
  // Only the explicit ?wallTest=1 link changes wall placement. The ordinary
  // live AR experience remains unchanged while this experiment is evaluated.
  // Dedicated floor-test.html sets this flag before app.js loads; query
  // parameter support remains as a backwards-compatible shortcut.
  const floorTestMode=window.LUX_FLOOR_TEST===true ||
    new URLSearchParams(window.location.search).get('wallTest')==='1';
  if(floorTestMode){
    document.body.classList.add('floor-wall-test-mode');
    document.documentElement.setAttribute('data-lux-ar-mode','floor-wall-test');
  }
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const previewCanvas = $('preview');
  const cameraCanvas = $('camerafeed');
  const status = $('status');
  const profileRow = $('profiles');
  const finishRow = $('finishes');
  const handles = Array.from(document.querySelectorAll('.edge-handle'));
  const MIN_EDGE = 0.35;
  const DEFAULT_BOUNDS = {left:-0.8, right:0.8, bottom:-0.55, top:0.55};
  const PROFILES = [
    {id:'random', name:'RANDOM PLANK', file:'Profiles/RANDOM PLANK.glb', prefix:'random'},
    {id:'folded', name:'FOLDED WALL', file:'Profiles/FOLDED WALL.glb', prefix:'folded'},
    {id:'variable', name:'VARIABLE WALL', file:'Profiles/VARIABLE WALL.glb', prefix:'folded'},
    {id:'batten', name:'BOARD + BATTEN', file:'Profiles/BOARD+BATTEN.glb', prefix:'batten'},
    {id:'lap', name:'V-GROOVE / LAP', file:'Profiles/V-GRROOVE_LAP.glb', prefix:'lap'}
  ];
  const FINISHES = [
    {id:'Charwood', name:'CHARWOOD', folder:'Charwood', random:'RANDOM PLANK CHARWOOD.jpg', folded:'FOLDED WALL CHARWOOD.jpg', batten:'B+B CHARWOOD.jpg', lap:'LAP CHARWOOD.jpg', trim:'TRIM CHARWOOD.jpg', tone:0x5b4236},
    {id:'Coastal Sand', name:'COASTAL SAND', folder:'Coastal Sannd', random:'RANDOM COASTAL SAND.jpg', folded:'FOLDED WALL COASTAL SAND.jpg', batten:'B+B COASTAL SAND.jpg', lap:'LAP COASTAL SAND.jpg', tone:0xbb9b77},
    {id:'Fawn', name:'FAWN', folder:'Fawn', random:'RANDOMPLANK FWAN.jpg', folded:'FOLDEDWALL FWAN.jpg', batten:'B+B FWAN.jpg', lap:'LAP FWAN.jpg', tone:0x937158},
    {id:'Heartwood', name:'HEARTWOOD', folder:'Heartwood', random:'RANDOM PLANK HEARTWOOD.jpg', folded:'FOLDED WALL HEARTWOOD.jpg', batten:'B+B HEARTWOOD.jpg', lap:'LAP HEARTWOOD.jpg', trim:'TRIM HEARTWOOD.jpg', tone:0x65422d},
    {id:'Hemlock', name:'HEMLOCK', folder:'Hemlock', random:'RANDOM PLANK HEMLOCK.jpg', folded:'FOLDED WALL HEMLOCK.jpg', batten:'B+B HEMLOCK.jpg', lap:'LAP HEMLOCK.jpg', trim:'TRIM HEMLOCK.jpg', tone:0x9b836d},
    {id:'Hickory', name:'HICKORY', folder:'Hickory', random:'RANDOM PLANK HICKORY.jpg', folded:'FOLDED WALL HICKORY.jpg', batten:'B+B HICKORY.jpg', lap:'LAP HICKORY.jpg', tone:0x8e6a4c},
    {id:'Ironwood', name:'IRONWOOD', folder:'Ironwood', random:'RANDOM PLANK IRONWOOD.jpg', folded:'FOLDED WALL IRONWOOD.jpg', batten:'B+B IRONWOOD.jpg', lap:'LAP IRONWOOD.jpg', trim:'TRIM IRONWOOD.jpg', tone:0x514139},
    {id:'Mahogany', name:'MAHOGANY', folder:'Mahogany', random:'RANDOM PLANK MAHOGANY.jpg', folded:'FOLDED WALL MAHOGANY.jpg', batten:'B+B MAHOGANY.jpg', lap:'LAP MAHOGANY.jpg', trim:'TRIM MAHOGANY.jpg', tone:0x663723},
    {id:'Tobacco', name:'TOBACCO', folder:'Tobacco', random:'RANDOM PLANK TOBACCO.jpg', folded:'FOLDED WALL TOBACCO.png', batten:'B+B TOBACCO.jpg', lap:'LAP TOBACCO.png', trim:'TRIM TOBACCO.png', tone:0x654934}
  ];

  if (!T || !T.GLTFLoader) {
    status.textContent = '3D viewer could not load. Please refresh with an internet connection.';
    return;
  }

  const bounds = {...DEFAULT_BOUNDS};
  const clipRect = new T.Vector4(bounds.left, bounds.bottom, bounds.right, bounds.top);
  const loader = new T.GLTFLoader();
  const imageLoader = new T.TextureLoader();
  const modelCache = new Map();
  const textureCache = new Map();
  const raycaster = new T.Raycaster();
  const tempVector = new T.Vector3();
  const tempQuaternion = new T.Quaternion();
  const stageScene = new T.Scene();
  const previewCamera = new T.PerspectiveCamera(44, 1, .025, 200);
  let activeScene = stageScene;
  let activeCamera = previewCamera;
  let previewRenderer = null;
  let arRenderer = null;
  let arRunning = false;
  let arPlaced = false;
  let arStarting = false;
  let sampleManuallyResized = false;
  let firstARPlacement = true;
  let dragEdge = null;
  let orbitPointer = null;
  let orbitAngle = .22;
  let orbitElevation = .10;
  let selectedProfile = PROFILES[0];
  let selectedFinish = FINISHES[0];
  let lastModelToken = 0;
  let trackingNormal = false;
  let toastUntil = 0;
  let lastToast = '';

  const placement = new T.Group();
  const surfaceRoot = new T.Group();
  const trimRoot = new T.Group();
  const sceneLights = new T.Group();
  // Coated metal trim uses the selected finish's texture, not a flat tone.
  // The return is only slightly shaded to keep the fold visible.
  const trimMats = [new T.MeshStandardMaterial({color:0xffffff,roughness:.62,metalness:.16}),
                    new T.MeshStandardMaterial({color:0xdcdcdc,roughness:.68,metalness:.16})];
  placement.add(surfaceRoot, trimRoot);
  stageScene.add(placement, sceneLights);
  const wallGuide=!floorTestMode&&typeof window.createLuxWallGuide==='function'
    ? window.createLuxWallGuide(T) : null;
  const floorGuide=floorTestMode&&typeof window.createLuxFloorWallTest==='function'
    ? window.createLuxFloorWallTest(T) : null;
  if (wallGuide) stageScene.add(wallGuide.group);
  if (floorGuide) stageScene.add(floorGuide.group);
  // Optional depth layer only exists on the existing floor-test page.
  // It does not affect SLAM, placement, lighting, or the original main page.
  const depthOcclusion=floorTestMode&&typeof window.createLuxDepthOcclusion==='function'
    ?window.createLuxDepthOcclusion(T,{
      stage,button:$('depth-toggle'),diagnostics:diag
    }):null;
  if(depthOcclusion)trimMats.forEach(material=>depthOcclusion.decorate(material));
  if(floorTestMode && diag)diag.note('floor-test-mode',{
    enabled:true,method:'interactive-vertical-plane',groundY:0
  });
  // Preserve the original polished 3D preview. AR needs materially lower
  // lighting so sample colours aren't washed out over the live camera image.
  const fillLight = new T.HemisphereLight(0xffffff,0x6c6a64,1.75);
  sceneLights.add(fillLight);
  const keyLight = new T.DirectionalLight(0xffffff,2.1);
  const PREVIEW_LIGHTING={fill:1.75,key:2.1};
  const AR_LIGHTING={fill:.43,key:.55};
  function setSampleLighting(inAR){
    const preset=inAR?AR_LIGHTING:PREVIEW_LIGHTING;
    fillLight.intensity=preset.fill;
    keyLight.intensity=preset.key;
  }
  keyLight.position.set(-3,4,7);
  sceneLights.add(keyLight);

  const trimPieces = {};
  for (const edge of ['top','right','bottom','left']) {
    const face = new T.Mesh(new T.BoxGeometry(1,1,1),trimMats[0]);
    face.name = 'trim-face-' + edge;
    const returnLip = new T.Mesh(new T.BoxGeometry(1,1,1),trimMats[1]);
    trimPieces[edge] = {face,returnLip};
    trimRoot.add(face,returnLip);
  }

  function relative(path) { return encodeURI('./' + path); }
  function finishPath(finish, prefix) { return relative('Textures/' + finish.folder + '/' + finish[prefix]); }
  function tell(message, duration=0) {
    lastToast = message;
    toastUntil = duration ? performance.now()+duration : 0;
    status.textContent = message;
  }
  function restoreStatus() {
    if (toastUntil && performance.now()<toastUntil) return;
    toastUntil=0;
    let message = arRunning ?
      (arPlaced ? (trackingNormal ? 'Drag any edge to resize • walk around to inspect' : 'Move your phone slowly to improve tracking') :
        (floorTestMode ? 'FLOOR TEST • Drag grid to move, rotate, then place the wall' :
        'Align the white grid to your wall, then tap the screen')) :
      'Drag the view to rotate • drag any circular edge handle to resize';
    if (lastToast!==message) {lastToast=message;status.textContent=message;}
  }
  function updateDimensions() {
    const width = bounds.right-bounds.left, height=bounds.top-bounds.bottom;
    $('dimensions').textContent = width.toFixed(2) + ' × ' + height.toFixed(2) + ' m';
    clipRect.set(bounds.left,bounds.bottom,bounds.right,bounds.top);
  }
  function updateTrims() {
    const x=(bounds.left+bounds.right)/2, y=(bounds.top+bounds.bottom)/2;
    const w=bounds.right-bounds.left,h=bounds.top-bounds.bottom;
    const coverage=.0254; // approximately one inch, over the panel's visible edges
    const depth=.014;
    const z=.038;
    const def = [
      ['top',x,bounds.top-coverage/2,w+coverage,coverage],
      ['bottom',x,bounds.bottom+coverage/2,w+coverage,coverage],
      ['left',bounds.left+coverage/2,y,coverage,h-coverage],
      ['right',bounds.right-coverage/2,y,coverage,h-coverage]
    ];
    for (const [edge,px,py,sx,sy] of def) {
      const item=trimPieces[edge];
      item.face.position.set(px,py,z);
      item.face.scale.set(Math.max(.001,sx),Math.max(.001,sy),depth);
      // Tiny dark return to hint at real J trim without costly detail geometry.
      item.returnLip.position.set(px,py,z-depth/2-.008);
      item.returnLip.scale.set(Math.max(.001,sx),Math.max(.001,sy),.008);
    }
    updateDimensions();
  }
  function updateTrimMaterial(texture) {
    // Dedicated TRIM texture when supplied; otherwise the currently selected
    // profile's finish texture (e.g. Fawn) on every edge and return lip.
    trimMats[0].map=texture;
    trimMats[1].map=texture;
    trimMats[0].color.setHex(0xffffff);
    trimMats[1].color.setHex(0xdcdcdc);
    trimMats.forEach(mat=>{mat.needsUpdate=true;});
  }
  function setBounds(edge,value) {
    if (edge==='left') bounds.left=Math.min(bounds.right-MIN_EDGE,value);
    if (edge==='right') bounds.right=Math.max(bounds.left+MIN_EDGE,value);
    if (edge==='top') bounds.top=Math.max(bounds.bottom+MIN_EDGE,value);
    if (edge==='bottom') bounds.bottom=Math.min(bounds.top-MIN_EDGE,value);
    bounds.left=T.MathUtils.clamp(bounds.left,-4.5,4.5);
    bounds.right=T.MathUtils.clamp(bounds.right,-4.5,4.5);
    bounds.top=T.MathUtils.clamp(bounds.top,-2.4,2.4);
    bounds.bottom=T.MathUtils.clamp(bounds.bottom,-2.4,2.4);
    updateTrims();
  }
  updateTrims();

  function rawModel(file) {
    if (!modelCache.has(file)) {
      modelCache.set(file,new Promise((resolve,reject)=>{
        loader.load(relative(file),(gltf)=>{
          const meshes=[];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((child)=>{
            if (!child.isMesh) return;
            const geom=child.geometry.clone();
            geom.applyMatrix4(child.matrixWorld); // bake GLB node transforms into metre-scale mesh
            geom.computeBoundingSphere();
            const mats=Array.isArray(child.material)?child.material:[child.material];
            meshes.push({geometry:geom,materials:mats.map(m=>m.clone())});
          });
          if (!meshes.length) reject(new Error('GLB contains no mesh: '+file));
          else resolve(meshes);
        },undefined,reject);
      }));
    }
    return modelCache.get(file);
  }
  function getTexture(url) {
    if (!textureCache.has(url)) {
      textureCache.set(url,new Promise((resolve,reject)=>{
        imageLoader.load(url,texture=>{
          texture.flipY=false; // glTF UV orientation
          texture.encoding=T.sRGBEncoding;
          texture.anisotropy=4;
          resolve(texture);
        },undefined,reject);
      }));
    }
    return textureCache.get(url);
  }
  function applyCropShader(material) {
    // Mesh local geometry was baked into the same model-space coordinates.
    // Crop in the shader: no giant opaque occlusion planes, no stretched woodgrain.
    material.onBeforeCompile=(shader)=>{
      shader.uniforms.luxClipRect={value:clipRect};
      shader.vertexShader='varying vec2 luxLocalXY;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace(
        '#include <begin_vertex>','#include <begin_vertex>\n luxLocalXY = position.xy;');
      shader.fragmentShader='varying vec2 luxLocalXY;\nuniform vec4 luxClipRect;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n if (luxLocalXY.x < luxClipRect.x || luxLocalXY.x > luxClipRect.z || luxLocalXY.y < luxClipRect.y || luxLocalXY.y > luxClipRect.w) discard;');
    };
    material.customProgramCacheKey=()=> 'lux-clipping-1';
    material.needsUpdate=true;
  }
  async function loadSelected() {
    const token=++lastModelToken;
    tell('Loading '+selectedProfile.name.toLowerCase()+'…');
    const profile=selectedProfile, finish=selectedFinish;
    const trimTextureUrl=finish.trim
      ? relative('Textures/'+finish.folder+'/'+finish.trim)
      : finishPath(finish,profile.prefix);
    const [entries,texture,trimTexture]=await Promise.all([
      rawModel(profile.file),
      getTexture(finishPath(finish,profile.prefix)),
      getTexture(trimTextureUrl)
    ]);
    if (token!==lastModelToken) return;
    while (surfaceRoot.children.length) {
      const mesh=surfaceRoot.children[0];
      surfaceRoot.remove(mesh);
      const materialList=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      materialList.forEach(m=>m.dispose()); // share baked geometries across finish swaps
    }
    for (const entry of entries) {
      const materials=entry.materials.map(source=>{
        const material=source.clone();
        if (source.map) {
          material.map=texture;
          material.color.set(0xffffff);
          // Painted metal: retain subtle highlights without an uncalibrated
          // mirror-like or artificially flat appearance.
          material.metalness=.16;
          material.roughness=.64;
        }
        material.side=T.DoubleSide;
        applyCropShader(material);
        if(depthOcclusion)depthOcclusion.decorate(material);
        return material;
      });
      const mesh=new T.Mesh(entry.geometry,materials.length===1?materials[0]:materials);
      mesh.frustumCulled=false;
      surfaceRoot.add(mesh);
    }
    updateTrimMaterial(trimTexture);
    restoreStatus();
  }
  function loadSelectedSafe() {
    loadSelected().catch(err=>{
      console.error('LUX model/texture error',err);
      tell('Could not load this profile or finish. Try another, or refresh.',5500);
    });
  }
  function renderControls() {
    profileRow.replaceChildren();
    PROFILES.forEach((profile,i)=>{
      const button=document.createElement('button');
      button.className='profile-card'+(selectedProfile.id===profile.id?' active':'');
      button.setAttribute('aria-pressed',String(selectedProfile.id===profile.id));
      button.innerHTML='<span class="profile-number">'+String(i+1).padStart(2,'0')+'</span><span>'+profile.name+'</span><span class="profile-right">↗</span>';
      button.onclick=()=>{
        selectedProfile=profile;
        $('profile-count').textContent=String(i+1).padStart(2,'0')+' / 05';
        renderControls();loadSelectedSafe();
        if (arRunning && arPlaced) closeArPanel();
      };
      profileRow.append(button);
    });
    finishRow.replaceChildren();
    FINISHES.forEach(finish=>{
      const button=document.createElement('button');
      button.className='finish-card'+(selectedFinish.id===finish.id?' active':'');
      button.setAttribute('aria-label',finish.name);
      button.setAttribute('aria-pressed',String(selectedFinish.id===finish.id));
      const thumb=document.createElement('span');
      thumb.className='finish-thumb';
      thumb.style.backgroundImage='url("'+finishPath(finish,selectedProfile.prefix)+'")';
      thumb.style.backgroundColor='#'+finish.tone.toString(16).padStart(6,'0');
      const name=document.createElement('span');
      name.className='finish-name';
      name.textContent=finish.name;
      button.append(thumb,name);
      button.onclick=()=>{
        selectedFinish=finish;
        $('finish-label').textContent=finish.name;
        renderControls();loadSelectedSafe();
        if (arRunning && arPlaced) closeArPanel();
      };
      finishRow.append(button);
    });
  }
  renderControls();

  function updateOrbit() {
    const dist=3.1;
    previewCamera.position.set(Math.sin(orbitAngle)*dist,orbitElevation*dist,Math.cos(orbitAngle)*dist);
    previewCamera.lookAt(0,0,0);
  }
  function resizePreview() {
    if (!previewRenderer) return;
    const w=stage.clientWidth,h=stage.clientHeight;
    previewCamera.aspect=w/Math.max(1,h);
    previewCamera.updateProjectionMatrix();
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.8));
    previewRenderer.setSize(w,h,false);
  }
  function createPreviewRenderer() {
    previewRenderer=new T.WebGLRenderer({canvas:previewCanvas,antialias:true,alpha:true,powerPreference:'high-performance'});
    previewRenderer.outputEncoding=T.sRGBEncoding;
    previewRenderer.toneMapping=T.ACESFilmicToneMapping;
    previewRenderer.toneMappingExposure=1.35;
    resizePreview();
  }
  updateOrbit();
  createPreviewRenderer();
  window.addEventListener('resize',resizePreview);
  previewCanvas.addEventListener('pointerdown',e=>{
    if (arRunning) return;
    orbitPointer={id:e.pointerId,x:e.clientX,y:e.clientY};
    previewCanvas.setPointerCapture(e.pointerId);
  });
  previewCanvas.addEventListener('pointermove',e=>{
    if (!orbitPointer||orbitPointer.id!==e.pointerId) return;
    orbitAngle-=(e.clientX-orbitPointer.x)*.007;
    orbitElevation=T.MathUtils.clamp(orbitElevation+(e.clientY-orbitPointer.y)*.004,-.7,.7);
    orbitPointer.x=e.clientX;orbitPointer.y=e.clientY;
    updateOrbit();
  });
  previewCanvas.addEventListener('pointerup',()=>orbitPointer=null);
  previewCanvas.addEventListener('pointercancel',()=>orbitPointer=null);

  function screenToLocal(clientX,clientY) {
    if (!activeCamera) return null;
    const rect=stage.getBoundingClientRect();
    const ndc=new T.Vector2(((clientX-rect.left)/rect.width)*2-1,
      1-((clientY-rect.top)/rect.height)*2);
    activeCamera.updateMatrixWorld(true);
    placement.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc,activeCamera);
    const normal=new T.Vector3(0,0,1).transformDirection(placement.matrixWorld);
    const point=new T.Vector3().setFromMatrixPosition(placement.matrixWorld);
    const plane=new T.Plane().setFromNormalAndCoplanarPoint(normal,point);
    const hit=raycaster.ray.intersectPlane(plane,new T.Vector3());
    if (!hit) return null;
    return placement.worldToLocal(hit);
  }
  for (const handle of handles) {
    handle.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      if (arRunning&&!arPlaced) return;
      dragEdge=handle.dataset.edge;
      sampleManuallyResized = true;
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove',e=>{
      if (dragEdge!==handle.dataset.edge) return;
      e.preventDefault();
      const local=screenToLocal(e.clientX,e.clientY);
      if (!local) return;
      setBounds(dragEdge,dragEdge==='left'||dragEdge==='right'?local.x:local.y);
    });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) {
      handle.addEventListener(event,()=>{
        dragEdge=null;handle.classList.remove('dragging');
      });
    }
  }
  function updateHandles() {
    if (!activeCamera || (arRunning&&!arPlaced)) {
      handles.forEach(h=>h.classList.remove('visible'));
      return;
    }
    placement.updateMatrixWorld(true);
    activeCamera.updateMatrixWorld(true);
    const locations=[
      [ (bounds.left+bounds.right)/2,bounds.top],
      [ bounds.right,(bounds.top+bounds.bottom)/2],
      [ (bounds.left+bounds.right)/2,bounds.bottom],
      [ bounds.left,(bounds.top+bounds.bottom)/2]
    ];
    const width=stage.clientWidth,height=stage.clientHeight;
    handles.forEach((h,i)=>{
      const [x,y]=locations[i];
      const projected=new T.Vector3(x,y,.075).applyMatrix4(placement.matrixWorld).project(activeCamera);
      const px=(projected.x*.5+.5)*width;
      const py=(-projected.y*.5+.5)*height;
      const visible=projected.z<1&&projected.z>-1&&px>=15&&px<=width-15&&py>=15&&py<=height-15;
      h.classList.toggle('visible',visible);
      if (visible) {h.style.left=px+'px';h.style.top=py+'px';}
    });
  }
  function previewLoop() {
    requestAnimationFrame(previewLoop);
    if (arRunning || document.body.classList.contains('splash-visible')) return;
    restoreStatus();
    updateHandles();
    if (previewRenderer) previewRenderer.render(stageScene,previewCamera);
  }
  previewLoop();

  function resetSize() {
    sampleManuallyResized=false;
    firstARPlacement=true;
    Object.assign(bounds,DEFAULT_BOUNDS);
    updateTrims();
    if (!arRunning) {
      orbitAngle=.22;orbitElevation=.10;updateOrbit();
    } else if (arPlaced) {
      startPlacing();
    }
    tell('Sample reset',1800);
  }
  // Reset and Help are intentionally absent from the streamlined AR interface.
  function closeArPanel() {
    document.querySelector('.config-panel').classList.remove('panel-open');
    document.body.classList.remove('ar-panel-open');
    $('customize').textContent='FINISHES';
  }
  function toggleArPanel() {
    if (!arRunning || !arPlaced) return;
    const isOpen=document.querySelector('.config-panel').classList.toggle('panel-open');
    document.body.classList.toggle('ar-panel-open',isOpen);
    $('customize').textContent=isOpen?'HIDE FINISHES':'FINISHES';
  }
  $('customize').onclick=toggleArPanel;
  $('close-panel').onclick=closeArPanel;
  function fitARSampleToScreen(distance) {
    // Match the actual tracking camera's field of view; don't estimate it from CSS pixels.
    // This starts the sample at around 85% of the available screen width/height.
    // Preserve XR8 calibrated projection matrix; do not recalculate it.
    const projection=activeCamera.projectionMatrix.elements;
    const px=Math.abs(projection[0]),py=Math.abs(projection[5]);
    if (!Number.isFinite(px)||!Number.isFinite(py)||px<0.05||py<0.05) return;
    const visibleWidth=(2*distance/px)*.86;
    const visibleHeight=(2*distance/py)*.78;
    const width=T.MathUtils.clamp(visibleWidth,.5,3.8);
    const height=T.MathUtils.clamp(visibleHeight,.5,3.8);
    Object.assign(bounds,{left:-width/2,right:width/2,bottom:-height/2,top:height/2});
    updateTrims();
  }
  function startPlacing() {
    if (!arRunning) return;
    closeArPanel();
    arPlaced=false;
    placement.visible=false;
    if (wallGuide) wallGuide.setActive(true);
    if (floorGuide) floorGuide.setActive(true);
    if (depthOcclusion) depthOcclusion.setPlaced(false);
    if (diag){diag.state('scanning');diag.note('scan-started',{trackingNormal,mode:floorTestMode?'floor-live-plane':'seam-and-points'});}
    stage.classList.add('placing');
    document.body.classList.add('placing');
    $('reposition').hidden=true;
    $('customize').hidden=true;
    tell(floorTestMode?
      'FLOOR TEST: Drag the grid to align; rotate with ↻; tap PLACE WALL.' :
      'Scan the floor–wall seam or use two taps to align manually.');
  }
  function placeOnWall(pose) {
    if (!arRunning||arPlaced||!pose) return;
    // Copy ONCE in world coordinates. No frame-by-frame position correction
    // from the seam detector after placement. Tracking is owned by XR8.
    placement.position.copy(pose.position);
    placement.rotation.copy(pose.rotation);
    if(diag)diag.note('placement',{
      source:pose.source,detected:!!pose.detected,
      confidence:pose.confidence,
      position:{x:pose.position.x,y:pose.position.y,z:pose.position.z},
      yaw:pose.rotation.y,trackingNormal,
      baselineMeters:pose.baselineMeters||null,
      mode:floorTestMode?'floor-live-plane':'normal'
    });
    placement.visible=true;
    placement.updateMatrixWorld(true);
    firstARPlacement=false;
    arPlaced=true;
    if(diag)diag.state('placed');
    if(wallGuide)wallGuide.setActive(false);
    if(floorGuide)floorGuide.setActive(false);
    stage.classList.remove('placing');
    document.body.classList.remove('placing');
    $('reposition').hidden=false;
    $('customize').hidden=false;
    if(depthOcclusion)depthOcclusion.setPlaced(true);
    tell(pose.source==='floor-live-plane'||pose.source==='floor-two-point'
      ? 'Floor-anchored test: walk sideways and check alignment and stability.'
      : pose.source==='confirmed'
      ? 'Seam and 3D wall cues agreed. Check the sample from several angles.'
      : (pose.source==='approximate-test'
          ? 'TEST ONLY: this sample is not aligned to a detected wall.'
          : 'Manual wall alignment placed. Inspect from several angles.'),4500);
  }
  if(floorGuide){
    // Pointer events are routed into the interactive world-space grid before
    // placement. The existing two-dimensional edge handles remain untouched.
    const isAligning=()=>arRunning&&!arPlaced&&stage.classList.contains('placing');
    stage.addEventListener('pointerdown',event=>{
      if(isAligning())floorGuide.pointerDown(event,activeCamera);
    });
    stage.addEventListener('pointermove',event=>{
      if(isAligning())floorGuide.pointerMove(event,activeCamera);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture']){
      stage.addEventListener(type,event=>{
        if(isAligning())floorGuide.pointerUp(event);
      });
    }
    floorGuide.setPlacementHandler(pose=>placeOnWall(pose));
  }
  stage.addEventListener('pointerup',event=>{
    if(floorGuide)return; // PLACE WALL button replaces two-point taps.
    if (!arRunning||arPlaced||!stage.classList.contains('placing')) return;
    if(event.target.closest('button,a,input'))return;
    const rect=stage.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width;
    const y=(event.clientY-rect.top)/rect.height;
    const result=floorGuide?floorGuide.tap(activeCamera,x,y):
      (wallGuide?wallGuide.tap(activeCamera,x,y):null);
    const guide=floorGuide||wallGuide;
    if(diag)diag.note('placement-tap',{x:Number(x.toFixed(3)),y:Number(y.toFixed(3)),
      result:result&&result.action,trackingNormal,guide:guide&&guide.getDebug(),
      mode:floorTestMode?'floor-live-plane':'original'});
    if(result&&result.action==='place') {
      placeOnWall(result.pose);
    }else if(result&&result.action==='aim-down'){
      tell('Aim LOWER and tap where the wall meets the actual floor.',3200);
    }else if(result&&result.action==='first'){
      tell('First end marked. Tap the other end of the same floor–wall edge.',2200);
    }else if(result&&result.action==='wait'){
      tell('Move your phone slowly until ground tracking stabilizes.',2300);
    }else if(result&&result.action==='retry'){
      tell('Try selecting two points farther apart on the floor edge.',2800);
    }
  });
  // Expose camera solely to the guide's explicit approximate test-placement
  // control. Real wall placement still requires confirmed tracking or two taps.
  window.luxActiveCamera=()=>arRunning?activeCamera:null;
  if(wallGuide&&wallGuide.setTestPlacement){
    wallGuide.setTestPlacement(pose=>{
      if(diag)diag.note('test-placement-requested',{
        source:pose.source,trackingNormal
      });
      placeOnWall(pose);
    });
  }
  $('reposition').onclick=startPlacing;

  function setMode(ar) {
    closeArPanel();
    stage.classList.toggle('ar-mode',ar);
    document.body.classList.toggle('ar-active',ar);
    stage.classList.toggle('placing',ar);
    document.body.classList.toggle('placing',ar);
    $('mode-label').textContent=ar?(floorTestMode?'FLOOR TEST':'LIVE AR'):'3D PREVIEW';
    $('start-ar').hidden=ar;
     $('reposition').hidden=true;
    $('customize').hidden=true;
    $('close-panel').hidden=!ar;
    previewCanvas.hidden=ar;
    cameraCanvas.hidden=!ar;
  }
  function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  }
  function launchXR() {
    const XR8=window.XR8;
    if (!XR8) throw new Error('8th Wall engine has not loaded');
    const fullWindow=(window.XRExtras && window.XRExtras.FullWindowCanvas) || XR8.FullWindowCanvas;
    if (!fullWindow || !fullWindow.pipelineModule) {
      throw new Error('Full-screen camera helper unavailable. Please refresh.');
    }
    XR8.XrController.configure({
      disableWorldTracking:false,scale:'absolute',
      enableLighting:false,enableWorldPoints:true
    });
    let pixelModule=null;
    // The experimental floor wall runs on XR8's ground coordinate system;
    // disable camera-pixel processing entirely in that mode.
    if(!floorTestMode&&XR8.CameraPixelArray &&
       typeof XR8.CameraPixelArray.pipelineModule==='function'){
      try{
        pixelModule=XR8.CameraPixelArray.pipelineModule({
          luminance:true,width:112,height:176
        });
      }catch(pixelError){
        if(diag)diag.note('camera-pixel-unavailable',{
          message:pixelError.message||String(pixelError)
        });
      }
    }
    if(diag)diag.note('camera-pixel-module',{
      available:!!pixelModule
    });
    XR8.addCameraPipelineModules([
      ...(pixelModule?[pixelModule]:[]),
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      // Required on Safari: synchronize viewport and WebGL drawing buffer with
      // the full-screen canvas, including orientation and browser-bar changes.
      fullWindow.pipelineModule(),
      {
        name:'lux-scene',
        onAttach:({video,videoWidth,videoHeight,version,status})=>{
          if(wallGuide)wallGuide.attachVideo(video);
          if(depthOcclusion)depthOcclusion.attachVideo(video);
          if(diag)diag.note('xr-attached',{
            status,engineVersion:version||null,
            videoPresent:!!video,videoReadyState:video&&video.readyState,
            videoWidth,videoHeight
          });
        },
        onCameraStatusChange:({status,video,videoWidth,videoHeight})=>{
          if(wallGuide && video) wallGuide.attachVideo(video);
          if(depthOcclusion&&video)depthOcclusion.attachVideo(video);
          if(diag)diag.note('camera-status',{
            status,videoPresent:!!video,videoReadyState:video&&video.readyState,
            videoWidth,videoHeight
          });
        },
        onException:(error)=>{
          if(diag)diag.note('xr-exception',{
            message:error&&error.message||String(error)
          });
        },
        onStart:()=>{
          const xr=XR8.Threejs.xrScene();
          activeScene=xr.scene;
          activeCamera=xr.camera;
          arRenderer=xr.renderer;
          if(diag){diag.state('camera-running');diag.note('xr-started');}
          xr.renderer.outputEncoding=T.sRGBEncoding;
          xr.renderer.toneMapping=T.ACESFilmicToneMapping;
          // Bring the real coated-metal finish substantially closer to indoor
          // brightness. Preserve ACES, roughness and directional highlights;
          // do not flatten or permanently darken the source textures.
          xr.renderer.toneMappingExposure=.72;
          setSampleLighting(true);
          if(diag)diag.note('ar-lighting',{
            exposure:.72,hemisphere:AR_LIGHTING.fill,
            directional:AR_LIGHTING.key,material:'coated-metal'
          });
          activeScene.add(placement,sceneLights);
          if (wallGuide) activeScene.add(wallGuide.group);
          if (floorGuide) activeScene.add(floorGuide.group);
          // 8th Wall's official three.js sample synchronizes the initial
          // world-tracking origin to the same XR scene camera.
          XR8.XrController.updateCameraProjectionMatrix({
            origin: xr.camera.position,
            facing: xr.camera.quaternion
          });
          startPlacing();
          tell('Move phone slowly to let tracking initialize',2200);
        },
        onUpdate:({processCpuResult,processGpuResult}={})=>{
          if(!arRunning) return;
          const reality=processCpuResult&&processCpuResult.reality;
          if(reality&&reality.trackingStatus){
            trackingNormal=reality.trackingStatus==='NORMAL';
          }
          if (wallGuide && !arPlaced) {
            const pixelResult=processGpuResult&&processGpuResult.camerapixelarray;
            if(pixelResult&&wallGuide.samplePixels)wallGuide.samplePixels(pixelResult);
            wallGuide.update(activeCamera,reality&&reality.worldPoints,trackingNormal);
          }
          // Keep the floor reference and jump diagnostics alive after placement
          // rather than freezing the entire guide's monitoring.
          if(floorGuide)floorGuide.update(activeCamera,trackingNormal);
          if(depthOcclusion&&arPlaced){
            depthOcclusion.onFrame(activeCamera,arRenderer,placement,bounds);
          }
          if(diag)diag.sample(reality,floorGuide||wallGuide,activeCamera);
          updateHandles();
          restoreStatus();
        },
        listeners:[
          {event:'reality.trackingstatus',process:(e)=>{
            trackingNormal=e.detail && e.detail.status==='NORMAL';
            if(diag)diag.note('tracking-status',{
              status:e.detail&&e.detail.status,
              reason:e.detail&&e.detail.reason
            });
          }}
        ]
      }
    ]);
    // The fullscreen stage/canvas must already be visible before XR8.run().
    XR8.run({canvas:cameraCanvas,allowedDevices:XR8.XrConfig.device().MOBILE_AND_HEADSETS});
  }
  async function startAR() {
    if(diag){diag.activate();diag.state('ar-requested');}
    if (arRunning||arStarting) return;
    if (!isMobile()) {
      if(diag)diag.note('ar-failure',{message:'not mobile'});
      tell('Open this site on iPhone, iPad or Android to start real wall-tracked AR.',4600);
      return;
    }
    if (!window.isSecureContext) {
      if(diag)diag.note('ar-failure',{message:'requires HTTPS'});
      tell('AR camera access requires HTTPS. Enable GitHub Pages or another HTTPS host.',6000);
      return;
    }
    arStarting=true;
    tell('Preparing the AR tracking engine…');
    try {
      if (!window.XR8) {
        await Promise.race([
          new Promise((resolve)=>window.addEventListener('xrloaded',resolve,{once:true})),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error('AR engine could not load. Check internet connection.')),15000))
        ]);
      }
      if (!window.XR8) throw new Error('AR engine unavailable');
      if (previewRenderer) {previewRenderer.dispose();previewRenderer=null;}
      arRunning=true;
      arPlaced=false;
      firstARPlacement=true;
      setMode(true);
      launchXR();
    } catch(error) {
      if(diag){diag.state('ar-failed');diag.note('ar-failure',{message:error.message||String(error)});}
      console.error('AR start error',error);
      arRunning=false;
      if(depthOcclusion)depthOcclusion.stop();
      setSampleLighting(false);
      setMode(false);
      if (!previewRenderer) createPreviewRenderer();
      tell('AR start failed: '+error.message,6500);
    } finally {
      arStarting=false;
    }
  }
  function stopAR() {
    if(diag){diag.state('stopped');diag.note('ar-stopped');}
    if (!arRunning) return;
    if (window.XR8 && window.XR8.stop) window.XR8.stop();
    // XRExtras.FullWindowCanvas reparents this canvas into document.body;
    // return it to the stage after stopping, so a new AR session starts cleanly.
    if (cameraCanvas.parentElement !== stage) stage.appendChild(cameraCanvas);
    arRunning=false;
    arPlaced=false;
    trackingNormal=false;
    if(depthOcclusion)depthOcclusion.stop();
    setSampleLighting(false);
    placement.position.set(0,0,0);
    placement.rotation.set(0,0,0);
    placement.visible=true;
    activeScene=stageScene;
    activeCamera=previewCamera;
    stageScene.add(placement,sceneLights);
    stage.classList.remove('placing');
    document.body.classList.remove('placing');
    if (wallGuide) {
      wallGuide.setActive(false);
      stageScene.add(wallGuide.group);
    }
    if (floorGuide) {
      floorGuide.stop();
      stageScene.add(floorGuide.group);
    }
    setMode(false);
    if (!previewRenderer) createPreviewRenderer();
    tell('Back in the 3D preview',2500);
  }
  // Called directly from the branded startup button's trusted click,
  // preserving iOS camera gesture permissions during the exit animation.
  window.luxStartAR=startAR;
  $('start-ar').onclick=startAR;
   document.addEventListener('visibilitychange',()=>{
    if (document.hidden&&arRunning&&window.XR8&&window.XR8.pause) window.XR8.pause();
    else if(!document.hidden&&arRunning&&window.XR8&&window.XR8.resume) window.XR8.resume();
  });
  loadSelectedSafe();
})();