/** 开发态课题：历史中的确认如何对应一次正在等待的调用？
 * 状态边界：默认两个工作区各至多一个 Promise 资源；销毁清空；不持久化继续执行能力。
 * 扩展：增加确认场景时声明目标快照与释放点；不从历史数据构造 handler。
 * 契约：docs/contracts/card-confirmations.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Own only live promise continuations (at most one per workspace), not card life
 * states. Appending later history cancels the displaced wait. Reload never revives
 * a continuation from serialized card data; resolving consumes it exactly once.
 */
export function createCardConfirmations({append,record}) {
  const pending=new Map();let disposed=false;
  function interrupt(workspace) {const item=pending.get(workspace);if(!item)return false;pending.delete(workspace);item.resolve(false);return true;}
  return {
    has:workspace=>pending.has(workspace),
    available:(workspace,id)=>pending.get(workspace)?.id===id,
    request(workspace,values) {
      if(disposed)return Promise.resolve(false);
      interrupt(workspace);
      return new Promise(resolve=>{const card=append(workspace,values);pending.set(workspace,{id:card.id,resolve});});
    },
    settle(workspace,id,approved) {
      const item=pending.get(workspace);
      if(!item||item.id!==id)return {ok:false,reason:'missing-continuation'};
      pending.delete(workspace);record(workspace,approved);item.resolve(approved);
      return {ok:true,approved};
    },
    interrupt,
    dispose() {disposed=true;for(const workspace of [...pending.keys()])interrupt(workspace);}
  };
}
