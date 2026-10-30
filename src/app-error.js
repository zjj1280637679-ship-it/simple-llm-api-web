/** 开发态课题：如何保留本地错误类别而不冒称根因？
 * 状态/边界：单个 Error 实例，无共享状态；code/message 为调用者提供的字符串。
 * 扩展：新增 code 描述本地边界，消息不应携带请求秘密。
 * 契约：docs/contracts/app-error.json；局部宿主不替代完整 F/C/H/Q。
 */
/** Typed diagnostic identity only. A code names the local failure boundary;
 * it does not prove an upstream root cause. Keep request secrets out of messages.
 */
export class AppError extends Error {
  constructor(code,message,status) {
    super(message);this.name='AppError';this.code=code;
    if(status!==undefined)this.status=status;
  }
}
