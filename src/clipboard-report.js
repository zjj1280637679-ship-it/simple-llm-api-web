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
