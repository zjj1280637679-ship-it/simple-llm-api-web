# 独立菜单浮层

版本0.1.0，2026-10-29T13:06Z。用户要求API/模型菜单上拉时不撑大输入区，并保留透明外置指标与空聊天placeholder。

## 现成方案取舍

- [MDN Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)：支持时把菜单放入原生top layer，避免祖先裁切/层叠；用manual模式，由已有按钮状态管理开关、Escape和外点关闭。
- [Floating UI computePosition](https://floating-ui.com/docs/computePosition)：成熟库将定位分为测量、offset/flip/shift/size，适合更多复杂锚点。当前仅两个底部菜单，采用小型同类定位函数避免新增依赖；不声称实现库的全部行为。
- [MDN position-try-fallbacks](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position-try-fallbacks)：较新的原生锚点回退，旧浏览器条件不同，暂不作为唯一实现。

菜单DOM移到app根节点，不再属于composer高度。支持Popover时showPopover；否则使用相同固定定位portal。定位读取当前visual viewport和触发按钮，选择上下空间、限制宽高、边缘留8px，内容超高时浮层自身滚动。矩阵只保留一个浮层滚动层。滚动、resize、visualViewport和菜单ResizeObserver更新坐标；rerender与关闭断开旧观察器。独立浮层内部焦点不再触发composer遮挡保护。

打开后聚焦菜单首按钮，Escape关闭并回触发按钮；外点关闭不重建输入DOM，避免打断编辑。矩阵选择仍保留原值、滚动与焦点策略。菜单使用普通按钮组而非虚假的ARIA menu角色；不新增API请求。

Node测试验证定位边界、长内容及离屏锚点、portal/原生分支策略；仍需真实CUA检查开关前后composer高度不变、菜单所有选项可滚达、Escape/焦点及窄屏。iOS真机未验证。
