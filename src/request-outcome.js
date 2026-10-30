/** 开发态课题：send 返回向调用者证明了哪一层完成？
 * 状态/边界：无持久状态；有限 kind/completion/receipt 字段投影。
 * 扩展：增加结果维度先定义依据，不用一个 ok 代表全部效果。
 * 契约：docs/contracts/request-outcome.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Question: what did returning from send establish for its consumer?
 * Projection contains no content, credentials, endpoints or unbounded raw marker.
 * Legacy status=completed means control flow returned. These independent fields
 * keep an unknown protocol end or unknown goal from becoming a success claim.
 */
export function requestOutcome({kind,completion,receipt}={}) {
  const protocolCompletion=kind==='image'?'not-assessed':
    ['complete','unknown','incomplete','refused'].includes(completion?.status)?completion.status:'unknown';
  return {operation:'returned',basis:'producer-report-projection',kind:kind==='image'?'image':'text',protocolCompletion,
    workspaceDelivery:receipt?.stage==='stored' && receipt.checks?.delivered==='workspace'?'observed':'unknown',
    durablePersistence:'unknown',visibleToUser:'unknown',goalSatisfied:'unknown'};
}
