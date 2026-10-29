# 页面滚动记忆与移动端视口

版本0.1.0 · 2026-10-29T14:48Z。

## 定位结果

旧实现把三页共用的app.scrollTop当作当前页位置。进入内容较短的页面时滚动偏移被浏览器截到0，再回对话页就继承了0。现在DOM替换前记录实际已渲染页面的偏移与贴底意图，替换后恢复目标页自身状态。非底部阅读保留像素位置，离开时贴底则返回时跟随新底部；requestAnimationFrame二次校准浮层尺寸，但若用户已滚动或切到别页则不覆盖。仅保存本次页面会话内状态，不写入密钥、浏览记录或外部存储。

手机无需另建独立站点：原index已经有width=device-width、initial-scale=1，无autofocus。既有draft字号14px、部分表单继承15px，是iOS输入聚焦放大的候选原因；触屏/窄屏可编辑控件现在最小16px且保持用户字体放大。未设置user-scalable=no、maximum-scale，也不主动重设浏览器缩放。用户所述“刚进入页面放大”未在iOS真机复现，不将字号修正当成其根因已证实；还可能涉及浏览器已有页面缩放、系统辅助设置或焦点恢复，需设备证据区分。

## 官方资料与边界

- [MDN viewport](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)：视口宽度/initial-scale语义、用户缩放可访问性。
- [MDN 响应式设计](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design)：同一站点通过流式布局适配设备。
- [MDN scrollHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight)：结合clientHeight、scrollTop与容差判定贴底。
- [WebKit bug157771](https://bugs.webkit.org/show_bug.cgi?id=157771)：记录iOS文字输入聚焦与页面缩放的区别；它并非当前站点iOS问题的复现证明，也不作为禁止缩放依据。

## 验证

离线测试覆盖三页独立偏移、短页返回、贴底页面内容增长、显式发送滚底、排队布局校准不覆盖用户或新页面、允许缩放与字号规则。tests/browser/reflow.html新增“生成离线长对话”：只在独立iframe用合成fetch驱动真实应用状态，随后恢复禁止网络；四轮长内容可切页往返，避免只插DOM夹具在重渲染后消失。本次最终浏览器滚动/iOS验证另记，不以Node测试冒充。

此前df2ce9a附件CUA：真实文件选择器读取无敏感TXT/PNG/PDF，附件-only模拟200；429/取消恢复图片，删除通过；日志只含元数据、不含PNG base64，REDACTED存在。报告synthetic:true、outboundNetwork:false、count3。它证明文件处理与模拟传输链，而非实际供应商模型接收能力。

底部标签按用户要求缩为“词元 / 命中 / 输入”，保留详细title说明与原统计语义。

异步结果也遵守阅读意图：主动发送开始仍滚到底部；请求期间用户上滚或切页后返回阅读旧内容，成功、错误和工具图片到达不会强制跳底，仅在此前仍贴底时自然跟随。新增延迟成功/失败回归验证这一点。
