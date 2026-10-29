# 独立菜单浮层

版本0.1.0，2026-10-29T13:06Z。用户要求API/模型菜单上拉时不撑大输入区，并保留透明外置指标与空聊天placeholder。

## 现成方案取舍

- [MDN Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)：支持时把菜单放入原生top layer，避免祖先裁切/层叠；用manual模式，由已有按钮状态管理开关、Escape和外点关闭。
- [Floating UI computePosition](https://floating-ui.com/docs/computePosition)：成熟库将定位分为测量、offset/flip/shift/size，适合更多复杂锚点。当前仅两个底部菜单，采用小型同类定位函数避免新增依赖；不声称实现库的全部行为。
- [MDN position-try-fallbacks](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position-try-fallbacks)：较新的原生锚点回退，旧浏览器条件不同，暂不作为唯一实现。

菜单DOM移到app根节点，不再属于composer高度。支持Popover时showPopover；否则使用相同固定定位portal。定位读取当前visual viewport和触发按钮，选择上下空间、限制宽高、边缘留8px，内容超高时浮层自身滚动。矩阵只保留一个浮层滚动层。滚动、resize、visualViewport和菜单ResizeObserver更新坐标；rerender与关闭断开旧观察器。独立浮层内部焦点不再触发composer遮挡保护。

打开后聚焦菜单首按钮，Escape关闭并回触发按钮；外点关闭不重建输入DOM，避免打断编辑。矩阵选择仍保留原值、滚动与焦点策略。菜单使用普通按钮组而非虚假的ARIA menu角色；不新增API请求。

Node测试验证定位边界、长内容及离屏锚点、portal/原生分支策略；仍需真实CUA检查开关前后composer高度不变、菜单所有选项可滚达、Escape/焦点及窄屏。iOS真机未验证。

## 真实浏览器复验（2026-10-29T13:16Z）

主代理在独立 Chromium CUA 预览固定提交 `a47dafeb5c77f3f61c497f4c2759be16c2d99fd3`，使用离线测试夹具，无真实 API 请求：

- 320×800：工具菜单连续三次打开/Escape关闭，composer 高度在打开前、打开中、关闭后均为 161px；关闭后焦点回到“展开工具菜单”。图片矩阵打开前后同为 161px，首末选项通过 Enter 成功选择。
- 320 宽、200%字体：156字符模型字段 clientHeight/scrollHeight 均为609px，clientWidth/scrollWidth均为245px；183字符URL字段对应为654px和245px。字段值没有因视觉换行增加换行符；密码说明为独立 helper。
- 320×400、200%字体：菜单 top=60.59px、bottom=287px，无横向溢出；375/430/768/1280宽度同样未发现横向溢出。
- composer wrapper 背景透明、边框0、阴影none，聊天placeholder为空；指标位于独立输入面板外。

范围限制：这是桌面 Chromium 中真实 iframe 布局与键盘操作，不等于 iOS Safari 真机、真实软键盘、浏览器 pinch zoom 或真实 API 验收；原生 Popover 不支持时的固定定位回退仅有离线策略/几何测试。

## 设置卡下拉结果（2026-10-29T13:26Z）

供应商选择和拉取模型结果复用独立浮层，锚定对应完整输入行而不是右侧按钮；按输入行宽度左对齐，优先在输入行下方显示。下方空间不足时限高滚动，极少空间时改向上方；保持视口边界。底部工具菜单/图片矩阵定位策略不变。原生协议 select 仍由浏览器/操作系统控制，不声称可统一其弹出位置。

拉取模型校验与错误使用当前设置卡内一个 `role=status` 状态位，不再重复追加对话消息；缺密钥、地址无效或未确认时没有模型请求。编辑字段清空旧提示，成功或新错误替换旧状态。原有busy防并发、地址确认与真实错误保留；没有增加自动重试或真实测试请求。

离线新增测试：连续10次缺key只保留一个提示、历史长度不变且零网络；纠正输入后可以继续；请求中连续10次点击仍仅一个请求；无效/未确认地址不请求且不堆积。真实浏览器的设置下拉锚定与新状态位尚待本次复验。

### 本次 CUA 验收（2026-10-29T13:31Z）

主代理在独立 Chromium iframe 预览固定候选 `aa1ce295a89925050f5d386c6ad9d58cdfd4a15e`：320×800 时 API 输入行 left=29px、width=247px、bottom=303.328px；供应商浮层 left=29px、width=247px、top=311.328px，验证整行同宽、正下方8px。缺 Key 时真实键盘连续10次 Enter 触发拉取，始终只显示一个卡内状态“请先填写 API Key；尚未发送模型列表请求。”，消息数仍为原设置卡1条；填入离线假值后状态清空，未发 API 请求。

模型列表网络成功/失败及并发路径本次由离线合成测试覆盖，不冒充真实上游验收；未做 iOS Safari 真机验收。
