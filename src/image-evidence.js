/** 开发态课题：签名、解码、尺寸、工作区交付能支持哪些效果结论？
 * 状态/边界：无持久状态；finite普通数组；检查器穷举0..3项的9类状态，任意长度另有归纳义务。
 * 扩展：新增效果必须有自己的观察者与判据；候选签名摘要以 core 已检查为前提。
 * 契约：docs/contracts/image-evidence.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Question: which image effects have witnesses, and which remain unknown?
 * Pure bounded summaries. File signature, decoding, pixels, workspace storage,
 * durable commit, visibility and goal satisfaction are separate predicates.
 * No inference from an empty set; no upgrade from an arbitrary host goal claim.
 */
export function aggregateCheck(values, positive, negative) {
  if (!values.length) return 'unknown';
  if (values.includes(negative)) return negative;
  return values.every(value=>value===positive) ? positive : 'unknown';
}
export function imageWorkspaceReceipt(images) {
  const populated=Array.isArray(images) && images.length>0;
  return {stage:populated?'stored':'empty',artifactCount:populated?images.length:0,
    basis:'workspace-write-observation',checks:{
      decoded:aggregateCheck((images || []).map(i=>i.checks?.decoded),'passed','failed'),
      dimensions:aggregateCheck((images || []).map(i=>i.checks?.dimensions),'matched','mismatch'),
      delivered:populated?'workspace':'unknown',persisted:'unknown',visible:'unknown',goalSatisfied:'unknown'
    }};
}
/** Precondition: candidates returned by core.generateImage after signature checks. */
export function receivedImageSummary(result) {
  return {ok:true,message:'图片 API 已返回候选文件，待宿主交付；尚未证明解码、尺寸或用户目标达成。',
    stage:'received',checks:{rasterSignature:'matched',decoded:'unknown',delivered:'unknown',goalSatisfied:'unknown'},
    text:result.text || '',imageCount:result.images.length,images:result.images.map(i=>({mimeType:i.mimeType})),
    model:result.model,aspectRatio:result.aspectRatio,imageSize:result.imageSize};
}
export function applyImageReceipt(summary,receipt) {
  if (receipt?.stage!=='stored' || receipt.checks?.delivered!=='workspace') return summary;
  return {...summary,stage:'stored',message:'候选图片已存入工作区；解码与尺寸见 checks，持久化、屏幕可见及用户目标分别验收。',
    checks:{...summary.checks,delivered:'workspace',
      decoded:['passed','failed'].includes(receipt.checks.decoded)?receipt.checks.decoded:'unknown',
      dimensions:['matched','mismatch'].includes(receipt.checks.dimensions)?receipt.checks.dimensions:'unknown',
      persisted:'unknown',visible:'unknown',goalSatisfied:'unknown'},
    deliveryBasis:'host-workspace-receipt'};
}
