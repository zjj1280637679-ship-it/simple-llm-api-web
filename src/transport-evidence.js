// Declarations bind to a function identity. They are host assertions, not network proofs.
const declarations=new WeakMap();
export function declareTransport(fetchImpl,{kind,hostId,evidenceId}={}) {
  if(typeof fetchImpl!=='function'||!['synthetic','network'].includes(kind)||typeof hostId!=='string'||!hostId.trim())throw new TypeError('Transport host and kind required');
  const transport=(...args)=>fetchImpl(...args);
  declarations.set(transport,Object.freeze({kind,hostId,evidenceId:typeof evidenceId==='string'?evidenceId:null,basis:'host-declaration',verified:false}));
  return transport;
}
export function describeTransport(fetchImpl) {
  return declarations.get(fetchImpl) || Object.freeze({kind:'unknown',basis:'no-host-declaration',verified:false});
}
