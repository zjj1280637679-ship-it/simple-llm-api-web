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
