/** 开发态课题：传输函数身份对应哪份宿主声明？
 * 状态/边界：WeakMap 声明随函数身份，宿主控制对象数。
 * 扩展：增加证据来源保留 basis 与 verified，声明不晋级实网证明。
 * 契约：docs/contracts/transport-evidence.json；局部宿主不替代完整 F/C/H/Q。
 */
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
