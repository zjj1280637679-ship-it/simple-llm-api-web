/** Bounded upstream-reported error fields. Content is untrusted and never a verified root cause. */
export async function readErrorDiagnostic(response,{sanitize,signal,maxBytes=8192,timeoutMs=1200}={}) {
  if(typeof response?.body?.getReader!=='function')return null;
  const reader=response.body.getReader();let timer,listener;
  const read=(async()=>{
    const decoder=new TextDecoder();let text='',bytes=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes)return {available:false,reason:'size-limit'};
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
    let parsed;try{parsed=JSON.parse(text);}catch{return {available:false,reason:'not-json'};}
    const fields=parsed?.error && typeof parsed.error==='object'?parsed.error:parsed;
    const reported={};
    for(const key of ['message','code','type','request_id'])if(['string','number'].includes(typeof fields?.[key]))reported[key]=fields[key];
    return {available:Object.keys(reported).length>0,basis:'upstream-reported',verified:false,fields:sanitize(reported)};
  })();
  const deadline=new Promise(resolve=>{
    const stop=reason=>resolve({available:false,reason});
    timer=setTimeout(()=>stop('time-limit'),timeoutMs);
    listener=()=>stop('cancelled');
    signal?.addEventListener('abort',listener,{once:true});
    if(signal?.aborted)listener();
  });
  try {return await Promise.race([read,deadline]);}
  catch {return {available:false,reason:'read-failed'};}
  finally {
    clearTimeout(timer);signal?.removeEventListener('abort',listener);
    try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
}
