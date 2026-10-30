/** 开发态课题：复制异步结束时是否仍属于发起的视图？
 * 状态/边界：一次调用持有视图身份；剪贴板是外部效果。
 * 扩展：替换 clipboard 接口，不把 resolved 当作用户已使用内容。
 * 契约：docs/contracts/clipboard-report.json；局部宿主不替代完整 F/C/H/Q。
 */
/** An async clipboard result belongs only to the view that requested it. */
export async function copyDiagnosticReport({app,getPage,clipboard,text}) {
  const field=app.querySelector('#scroll-diagnostic-text');
  const currentStatus=()=>getPage()==='logs' && app.querySelector('#scroll-diagnostic-text')===field
    ? app.querySelector('#scroll-diagnostic-status') : null;
  try {
    await clipboard.writeText(text);
    const target=currentStatus();if(target)target.textContent='已复制';
  } catch {
    const target=currentStatus();
    if(target){
      if(field?.isConnected){field.focus({preventScroll:true});field.select();}
      target.textContent='请长按文本框复制，或使用导出';
    }
  }
}
