# 输入与指标悬浮小岛

版本0.1.0，2026-10-29T12:43Z；基于main7834124。

按用户两张参考：移除全宽白底footer/横分隔，将原有输入、按钮及指标合为一个居中、圆角、轻半透明模糊的小岛；正文从后方滚动。没有添加语音等未请求功能。样式不支持模糊时仍有高不透明背景，深色及减少透明度偏好有兜底。

## 官方方案与条件

- [W3C C43](https://www.w3.org/WAI/WCAG22/Techniques/css/C43)：底部固定层需配合内容padding与scroll-padding，确保最后内容和键盘焦点能滚至可见区域。
- [W3C C34](https://www.w3.org/WAI/WCAG21/Techniques/css/C34)：可用空间不足时解除固定。这里以顶部+底部实际高度相对可视区域判断；长菜单/大字体导致合计超过65%时底部转正常流，不裁剪内容。
- [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)：移动键盘可能缩小视觉视口而不改变布局视口。监听resize/scroll，在scale约1时按height/offsetTop计算底部位移；缩放时不把pinch pan误当键盘。
- [MDN env](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)：safe-area-inset用于底部及左右避让。是否有非零安全区取决于宿主浏览器与viewport设置。

沿用统一ResizeObserver生命周期，rerender断开旧观察器后观察新导航/输入区，计算上下clearance。切到日志页自动清空底部clearance。焦点保护兼顾上下边界；自然流与输入区内部焦点交给浏览器原生行为。

## 验证边界

Node测试覆盖测量、联合占屏兜底、上下焦点、视觉视口键盘位移与pinch区别；这些是合成单测，不是iOS真机证明。还需真实Chromium各宽度/字体、长矩阵、最后消息、键盘Tab测试。当前没有iOS真机软键盘/Safari测量，因此明确未实测；真实API不参与此次UI验证。

## 2026-10-29T12:50Z · 真实浏览器验收

主代理在云电脑以CUA操作真实Chromium iframe，候选7755b1d：

- 320 × 800初始小岛position fixed，top627/bottom790/height163px；截图确认圆角半透明输入与指标同岛，没有全宽footer。
- 插入4条合成长内容后滚至末端，最后气泡bottom504.25px，小岛top565px，末条完整可读。
- 320 × 400、200%字体及长内容：小岛自动position relative进入文档流，无横向越界。
- 矩阵首末按钮均用Enter成功操作；重渲染后重新应用200%字体，320/375/430/768/1280 × 400的矩阵均无横向越界。

测试使用合成显示内容，未发真实API；未验证iOS真机软键盘和真实pinch缩放。VisualViewport相关单测不能代替这些移动实测。最终Node回归138通过、1个原有可选MCP跳过；check及12文件白名单build通过。生产部署由CI和线上复验另行确认。

## 2026-10-29T13:00Z · 用户修正：指标在输入框之外

最新需求覆盖此前共同小岛外观：定位wrapper继续悬浮，但完全透明、无边框阴影或模糊；只有输入区域保留圆角半透明面板，指标作为其下方外部透明悬浮文字。共同测量高度仍覆盖输入+指标，底部clearance、键盘位移及短屏文档流策略保持。聊天placeholder清空，aria-label继续为“聊天消息”；图片提示未被要求移除，因此保留。此次视觉修正需另做CUA验收，不能沿用上一外观截图宣称通过。

## 紧凑待机输入（2026-10-29T13:48Z）

聊天空闲/单行布局改为三列胶囊：44px工具按钮、可收缩输入、44px发送按钮同一行；面板6px内边距和边框使常规空闲高度约58px。指标仍为面板外透明文字，图片页的额外参数按钮保留独立第二行，不增加语音功能。

多行草稿根据scrollHeight自动增高、删除后缩回；最多占可视视口30%且不超过240px，更多内容在输入区内滚动。放大字体时至少显示完整一行。只变更几何，不改value/selection或IME、Enter/Shift+Enter语义。沿用既有composer测量、safe-area和软键盘视口策略；本次iOS真机未测。离线几何/控件测试不替代真实浏览器验收。

### 请求加载指示（2026-10-29T13:56Z）

历史区原“正在请求 API…”文字替换为小型旋转环，保留role=status和aria-label“正在加载”，没有可见说明文字。prefers-reduced-motion下为静态点状环，不强制旋转。沿用busy状态控制出现/消失，取消按钮和真实错误信息保留。

`tests/browser/reflow.html` 的“离线加载指示/清除加载指示”用于真实浏览器视觉检查：这是无请求的合成展示夹具，不冒充真实请求生命周期。Node事件测试另外覆盖完成、取消、异常时指示消失，且取消/异常信息仍保留。
