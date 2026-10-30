/** 设置卡的关系表：分类与可走路径独立于字段视图及效果。
 * 3 个节点、4 条有向边；实际动作还须通过 dispatcher 的末项检查。
 */
const routes=Object.freeze({api:Object.freeze(['model','connection']),model:Object.freeze(['api']),connection:Object.freeze(['api'])});
export const settingTargets=kind=>Object.hasOwn(routes,kind)?routes[kind]:[];
export const canNavigateSettings=(from,to)=>settingTargets(from).includes(to);
