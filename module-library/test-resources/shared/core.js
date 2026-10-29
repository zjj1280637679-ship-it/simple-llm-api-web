/** Browser/Node kernel. All request oracles are fixture data, never production builders. */
export const DUMMY_KEY = 'SIMULATOR_ONLY_NOT_A_REAL_KEY';
export class SimulatorError extends Error {
  constructor(code, fields = []) {
    super(`${code}${fields.length ? ': ' + fields.join(', ') : ''}`);
    this.name = 'SimulatorError'; this.code = code;
    // Do not echo request values, credentials, prompt text, or supplied URLs.
    this.diff = fields.map(field => ({field, expected:'fixture contract', actual:'[REDACTED mismatch]'}));
  }
}
const equal = (a,b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a).sort(), other = Object.keys(b).sort();
  return keys.length === other.length && keys.every((key,i)=>key===other[i] && equal(a[key],b[key]));
};
function bind(value, parameters) {
  if (value && typeof value === 'object') {
    if (Object.keys(value).length===1 && Object.hasOwn(value,'$parameter')) return parameters[value.$parameter];
    return Array.isArray(value) ? value.map(item=>bind(item,parameters))
      : Object.fromEntries(Object.entries(value).map(([key,item])=>[key,bind(item,parameters)]));
  }
  return value;
}
async function readRequestText(request, disposalSignal, requestSignal) {
  const reader=request.clone().body.getReader(),signals=[disposalSignal,requestSignal].filter(Boolean),listeners=[];
  const cancelled=new Promise((_,reject)=>{for(const signal of signals) {
    const cancel=()=>{
      // Cancelling a tee branch may await its untouched sibling; never await that promise.
      reject(signal.reason);void reader.cancel(signal.reason).catch(()=>{});
    };
    listeners.push([signal,cancel]);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  }});
  try {
    const decoder=new TextDecoder();let text='';
    for(;;) {const chunk=await Promise.race([reader.read(),cancelled]);if(chunk.done)break;text+=decoder.decode(chunk.value,{stream:true});}
    return text+decoder.decode();
  } finally {for(const [signal,cancel] of listeners)signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
async function normalize(input, init = {}, disposalSignal) {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request;
  const method = String(init.method ?? (isRequest ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init.headers ?? (isRequest ? input.headers : undefined));
  const url = String(isRequest ? input.url : input);
  const signal = init.signal !== undefined ? init.signal : isRequest ? input.signal : undefined;
  let body = init.body;
  if (body === undefined && isRequest && input.body !== null) body = await readRequestText(input,disposalSignal,signal);
  let json;
  if (body !== undefined && body !== null) {
    if (typeof body !== 'string') throw new SimulatorError('SIMULATOR_UNSUPPORTED_FEATURE',['body.transport']);
    try { json = JSON.parse(body); } catch { throw new SimulatorError('SIMULATOR_REQUEST_MISMATCH',['body.json']); }
  }
  return {method,headers,url,body:json,signal};
}
function match(actual, expected) {
  const fields=[];
  if (actual.method!==expected.method) fields.push('method');
  // Exact origin/path/query: unknown routes and query credentials never fall back to fetch.
  if (actual.url!==expected.url) fields.push('url');
  const headers=Object.fromEntries(actual.headers.entries());
  if (!equal(headers,expected.headers)) fields.push('headers');
  if (!equal(actual.body,expected.body)) fields.push('body');
  if (fields.length) throw new SimulatorError('SIMULATOR_REQUEST_MISMATCH',fields);
}

/** A fixture is a closed, ordered script; rejected contracts never consume a step. */
export function createSimulatorCore({fixture, revision, parameters = {}, clock = () => 0, scheduler} = {}) {
  if (!fixture?.steps?.length || typeof clock !== 'function') throw new SimulatorError('SIMULATOR_CONFIGURATION');
  fixture=structuredClone(fixture); revision=structuredClone(revision);
  const values={};
  for (const [name,rule] of Object.entries(fixture.parameters || {})) {
    values[name]=Object.hasOwn(parameters,name)?parameters[name]:rule.default;
    if (rule.type!=='string' || typeof values[name]!=='string' || !values[name].trim())
      throw new SimulatorError('SIMULATOR_CONFIGURATION',['parameters.'+name]);
  }
  if (Object.keys(parameters).some(name=>!Object.hasOwn(values,name))) throw new SimulatorError('SIMULATOR_CONFIGURATION',['parameters']);
  const steps=bind(fixture.steps,values), events=[], failures=[];
  let consumed=0, entered=0, pending=0, active=0, closed=false, admission=Promise.resolve();
  const cleanups=new Set(),disposal=new AbortController();
  const event = (sequence,outcome,details={}) => events.push({sequence,logicalTime:clock(),outcome,...details});
  const failure = (sequence,error) => {
    const safe=error instanceof SimulatorError ? error : new SimulatorError('SIMULATOR_REQUEST_MISMATCH',['request.transport']);
    failures.push({sequence,code:safe.code,diff:safe.diff}); event(sequence,'mismatch',{code:safe.code}); return safe;
  };
  function deliver(step, request, sequence) {
    // Abort can arrive after asynchronous request admission but before immediate delivery.
    if(request.signal?.aborted) {event(sequence,'aborted');return Promise.reject(request.signal.reason);}
    const response=step.response;
    if (response.reject) { event(sequence,'transport-rejected'); return Promise.reject(new TypeError('SIMULATED network failure')); }
    const output=()=>new Response(response.raw ?? JSON.stringify(response.json),{
      status:response.status,headers:{'content-type':'application/json','x-simulator-evidence':'SIMULATED',...response.headers}});
    if (!response.delayMs && !response.hang) { event(sequence,'response',{status:response.status}); return output(); }
    if (!scheduler || typeof scheduler.setTimeout!=='function' || typeof scheduler.clearTimeout!=='function')
      throw new SimulatorError('SIMULATOR_CONFIGURATION',['scheduler']);
    pending++;
    return new Promise((resolve,reject)=>{
      let settled=false,timer;
      const finish=(kind,value)=>{
        if (settled) return;
        settled=true; pending--;
        if(timer!==undefined) {
          try { scheduler.clearTimeout(timer); }
          catch { kind='delivery-error'; value=new SimulatorError('SIMULATOR_CONFIGURATION',['scheduler.cleanup']); }
        }
        request.signal?.removeEventListener('abort',abort); cleanups.delete(dispose);
        event(sequence,kind,kind==='response'?{status:response.status}:{});
        if (kind==='response') resolve(value); else reject(value);
      };
      const abort=()=>finish('aborted',request.signal.reason);
      const dispose=()=>finish('disposed',new SimulatorError('SIMULATOR_DISPOSED'));
      cleanups.add(dispose); request.signal?.addEventListener('abort',abort,{once:true});
      if(request.signal?.aborted) {abort();return;}
      if(!response.hang) {
        try { timer=scheduler.setTimeout(()=>{
          try { finish('response',output()); }
          catch { finish('delivery-error',new SimulatorError('SIMULATOR_CONFIGURATION',['response'])); }
        },response.delayMs); }
        catch { finish('delivery-error',new SimulatorError('SIMULATOR_CONFIGURATION',['scheduler'])); }
      }
    });
  }
  function fetch(input, init) {
    const sequence=++entered; active++;
    const signal=init?.signal ?? (typeof Request!=='undefined' && input instanceof Request ? input.signal : undefined);
    let admitted=false,queuedAbort,hasQueuedAbort=false;
    const queueListeners=[];
    const cancelledWhileQueued=new Promise((_,reject)=>{
      for(const source of [signal,disposal.signal].filter(Boolean)) {
        const cancel=()=>{
          if(admitted||hasQueuedAbort)return;
          hasQueuedAbort=true;queuedAbort=source.reason;
          if(source===disposal.signal)queuedAbort=failure(sequence,new SimulatorError('SIMULATOR_DISPOSED'));
          else event(sequence,'aborted-while-queued');
          reject(queuedAbort);
        };
        source.addEventListener('abort',cancel,{once:true});queueListeners.push([source,cancel]);
        if(source.aborted)cancel();
      }
    });
    const detachQueue=()=>{for(const [source,cancel] of queueListeners.splice(0))source.removeEventListener('abort',cancel);};
    // Serialize admission only, not completion: Request.clone().text() cannot reorder script slots.
    const accepted=admission.then(async()=>{
      admitted=true;detachQueue();
      if(hasQueuedAbort)return {aborted:queuedAbort};
      if(closed) throw failure(sequence,new SimulatorError('SIMULATOR_DISPOSED'));
      if(signal?.aborted) {event(sequence,'aborted-before-request'); throw signal.reason;}
      try {
        const request=await normalize(input,init,disposal.signal);
        if(closed) throw new SimulatorError('SIMULATOR_DISPOSED');
        if(request.signal?.aborted) {event(sequence,'aborted-before-request'); return {aborted:request.signal.reason};}
        const step=steps[consumed];
        if(!step) throw new SimulatorError('SIMULATOR_REQUEST_MISMATCH',['sequence']);
        match(request,step.request); consumed++;
        event(sequence,'request-matched',{step:consumed,method:request.method,route:new URL(step.request.url).pathname});
        return {step,request};
      } catch(error) {
        if(closed)throw failure(sequence,new SimulatorError('SIMULATOR_DISPOSED'));
        if(signal?.aborted) {event(sequence,'aborted-before-request');return {aborted:signal.reason};}
        throw failure(sequence,error);
      }
    });
    admission=accepted.then(()=>{},()=>{});
    const delivered=accepted.then(result=>{
      if(Object.hasOwn(result,'aborted')) throw result.aborted;
      try {
        return Promise.resolve(deliver(result.step,result.request,sequence)).catch(error=>{
          if(error instanceof SimulatorError && error!==result.request.signal?.reason) throw failure(sequence,error);
          throw error; // Expected fixture network rejection or signal.reason.
        });
      } catch(error) {
        throw failure(sequence,error instanceof SimulatorError?error:new SimulatorError('SIMULATOR_CONFIGURATION',['response']));
      }
    });
    return Promise.race([delivered,cancelledWhileQueued]).finally(()=>{detachQueue();active--;});
  }
  const inspect=()=>({evidenceType:'SIMULATED',realApiCalled:false,resourceRevisions:[structuredClone(revision)],
    scenarioId:fixture.id,entered,consumed,remaining:steps.length-consumed,pending,active,failed:failures.length>0,
    events:structuredClone(events),failures:structuredClone(failures)});
  const assertComplete=()=>{
    if(failures.length) throw new SimulatorError('SIMULATOR_ASSERTION_FAILED',['previous-request-mismatch']);
    if(consumed!==steps.length || pending || active) throw new SimulatorError('SIMULATOR_INCOMPLETE',['remaining-or-pending']);
    return inspect();
  };
  return {fetch,inspect,assertComplete,dispose(){closed=true;disposal.abort(new SimulatorError('SIMULATOR_DISPOSED'));for(const cleanup of [...cleanups]) cleanup();}};
}
