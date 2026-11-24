/* LUX experimental monocular depth inference worker.
   Loads only after the user explicitly enables DEPTH in the existing
   Floor → Wall page. Camera pixels stay on-device; model weights are downloaded
   from Hugging Face. Depth Anything V2 yields RELATIVE depth, not ARKit LiDAR. */
let estimate=null;
let processing=false;
const MODEL='onnx-community/depth-anything-v2-small';
const LIBRARY='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
function errorText(error){return error&&error.message?String(error.message):String(error);}
self.onmessage=async(event)=>{
  const msg=event.data||{};
  if(msg.type==='init'){
    if(estimate||processing)return;
    processing=true;
    try{
      const lib=await import(LIBRARY);
      // Prefer single-thread WASM on iOS, to avoid SharedArrayBuffer requirements
      // and competing WebGPU contexts with 8th Wall's renderer.
      if(lib.env&&lib.env.backends&&lib.env.backends.onnx&&lib.env.backends.onnx.wasm){
        lib.env.backends.onnx.wasm.numThreads=1;
      }
      if(lib.env)lib.env.allowLocalModels=false;
      estimate=await lib.pipeline('depth-estimation',MODEL,{
        device:'wasm',dtype:'q8'
      });
      self.postMessage({type:'ready',model:MODEL,backend:'wasm'});
    }catch(error){
      self.postMessage({type:'error',phase:'load',message:errorText(error)});
    }finally{processing=false;}
    return;
  }
  if(msg.type!=='frame'||!estimate||processing)return;
  processing=true;
  const started=performance.now();
  try{
    const {RawImage}=await import(LIBRARY);
    const rgba=new Uint8ClampedArray(msg.pixels);
    const raw=new RawImage(rgba,msg.width,msg.height,4);
    const result=await estimate(raw);
    const depth=result&&result.depth;
    if(!depth||!depth.data||!depth.width||!depth.height||depth.channels!==1)
      throw new Error('Depth model returned an invalid map');
    const samples=new Uint8Array(depth.data);
    self.postMessage({
      type:'depth',frameId:msg.frameId,
      width:depth.width,height:depth.height,
      pixels:samples.buffer,
      inferenceMs:Math.round(performance.now()-started)
    },[samples.buffer]);
  }catch(error){
    self.postMessage({type:'error',phase:'infer',message:errorText(error)});
  }finally{processing=false;}
};
