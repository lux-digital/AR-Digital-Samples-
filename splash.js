/* LUX entrance animation: After Effects-style fast ease-out, center pivots,
   with the play text pivoting with the entire button around the circle.
   Reverses in place on START AR; launch starts inside the trusted click. */
(() => {
  'use strict';
  const splash=document.getElementById('lux-splash');
  const start=document.getElementById('splash-start');
  if (!splash || !start) return;

  const reduce=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease='cubic-bezier(0.16, 1, 0.3, 1)';
  const entries=[
    {element:document.getElementById('splash-x'),       delay:0,   duration:1130,dy:110,scale:.76},
    {element:document.getElementById('splash-west'),    delay:90,  duration:1240,dy:130,scale:.79},
    {element:start,                                     delay:190, duration:1270,dy:100,scale:.72},
    {element:document.getElementById('splash-label'),   delay:420, duration:970, opacityOnly:true},
    {element:document.getElementById('splash-triangle'),delay:295, duration:1020, opacityOnly:true}
  ];

  const animated=entries.filter(e=>e.element && typeof e.element.animate==='function').map(e=>{
    const move=!e.opacityOnly;
    // The image and button elements are centered with translateX(-50%).
    // Keep that centering in BOTH keyframes to avoid a start/end jump.
    const from=move?
      {opacity:0,transform:'translate3d(-50%, '+e.dy+'px, 0) scale('+e.scale+')'}:
      {opacity:0};
    const to=move?
      {opacity:1,transform:'translate3d(-50%, 0px, 0) scale(1)'}:
      {opacity:1};
    return e.element.animate([from,to],{
      duration:reduce?1:e.duration,
      delay:reduce?0:e.delay,
      easing:ease,
      fill:'both'
    });
  });

  // Do not allow the transition to fire a second camera session.
  let exiting=false;
  function hideSplash(){
    if (splash.hidden) return;
    splash.hidden=true;
    document.body.classList.remove('splash-visible');
    for(const animation of animated) animation.cancel();
  }

  start.addEventListener('click',()=>{
    if(exiting) return;
    exiting=true;
    start.disabled=true;
    splash.classList.add('is-exiting');

    // Reverse every item's entrance curve. The entire button, including the
    // START AR label, scales about the center of the play circle.
    for(const animation of animated) animation.reverse();

    // Start camera permission within the user's real tap (important for iOS),
    // while the reversed opening screen briefly covers initialization.
    try{
      if(typeof window.luxStartAR==='function') {
        window.luxStartAR();
      } else {
        const fallback=document.getElementById('start-ar');
        if(fallback) fallback.click();
      }
    }catch(error){
      console.error('Unable to start LUX AR:',error);
    }

    if(reduce || animated.length===0){
      window.setTimeout(hideSplash,240);
    }else{
      Promise.allSettled(animated.map(animation=>animation.finished)).then(hideSplash);
      // A reliable fallback if Safari interrupts an animation while asking
      // the user for camera permission.
      window.setTimeout(hideSplash,1700);
    }
  });
})();
