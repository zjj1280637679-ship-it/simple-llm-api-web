/** 开发态课题：何时允许写入，journal 失败是否掩盖完整存档？
 * 状态/边界：hydrated/disposed 两布尔值 + 一个防抖计时器；store事务外置。
 * 扩展：扩展存储 backend 时保持协调器与事务语义分离。
 * 契约：docs/contracts/workspace-storage.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Coordinates hydration, the synchronous journal and debounced snapshots.
 * The host owns workspace data; the store owns transaction/conflict semantics.
 */
export function createWorkspaceStorage({store, capture, captureJournal, getPage, restore, onStatus, beforeCapture=()=>{}, clock=globalThis}) {
  let hydrated=false, disposed=false, timer;
  async function initialize() {
    const saved=await store.load(capture());
    if(disposed)return;
    if(saved)try { restore(saved); }
    catch { store.close(); onStatus('schema'); }
    hydrated=true;
  }
  function save(immediate=false, protectDraft=false, clear=[]) {
    if(!hydrated || disposed)return;
    if(protectDraft)try { store.journal(captureJournal(),{clear}); }
    catch(error) {
      if(clear.length)try { store.journal({page:getPage(),workspaces:{}},{clear}); }
      catch { onStatus('journal-error'); }
      if(error?.code==='CREDENTIAL_COLLISION')store.reportError(error);
      else onStatus('journal-error');
    }
    clock.clearTimeout(timer);
    const commit=()=>{
      if(disposed)return;
      try { beforeCapture(); return store.schedule(capture(),{immediate:true}); }
      catch(error) { store.reportError(error); }
    };
    if(immediate)return commit();
    timer=clock.setTimeout(commit,250);
  }
  return {initialize,save,get hydrated(){return hydrated;},dispose(){
    if(disposed)return;
    disposed=true;clock.clearTimeout(timer);store.close();
  }};
}
