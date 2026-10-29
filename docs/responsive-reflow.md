# 内容驱动的响应式重排

版本：0.1.1；更新时间：2026-10-29T11:58:00Z。

目标是让界面随可用宽度和内容长度自然换行，而非按设备名称锁死尺寸。术语为 responsive layout / reflow；具体策略包括 Flexbox wrap、可收缩子项、内容驱动 Grid 和 overflow-wrap。

## 改动范围

- 页眉、导航、状态、操作按钮组、底部指标和日志操作允许换行，内容不靠省略号藏掉。
- 表单行空间不足时按钮换行；二列参数按可用宽度重排。只读说明使用可换行 output。
- 供应商名、长模型名、矩阵尺寸与说明可断行；矩阵按钮高度随内容增长。
- 图片参数与工具菜单展开为文档流面板，内容自然占位；矩阵保留内部纵向滚动。
- 原生密码/数字/API地址/模型ID输入仍保留单行编辑语义，可在输入框内横向移动光标。原生 select 仍用于选择，完整选中协议另有可换行说明。没有为了“全换行”给密钥添加副本或改变请求值。

这只是当前生产网页的布局策略，不要求采用模块库的任何候选。协议、密钥保存、请求和工具确认逻辑未调整。

## 验证及边界

`npm test` 包含三项静态策略回归；静态检查不能证明像素布局。`npm run check` 与 `npm run build` 检查脚本并构建12文件白名单（后续加入usage模块；历史初版为11文件）。

本地静态服务器根目录打开 `tests/browser/reflow.html`：

1. 依次使用320、375、430、768、1280 CSS px 宽度，800、568、400 px 高度。
2. 用真实页面控件打开API/模型设置、图片矩阵、日志页，观察焦点、滚动和菜单。
3. 点击“插入长内容”添加标记为合成的中文/英文连续字段与日志；“200%字体”为字体压力实验，不等同实际浏览器缩放。
4. “测量”输出页面横向范围越界元素。输入控件内部水平编辑不意味着页面溢出；图标内坐标不算文字字段。测量不替代查看按钮可达性、视觉遮挡和键盘焦点。
5. 用实际浏览器400%缩放补测1280到约320 CSS px的reflow，另检200%文字与实际手机键盘。未执行的步骤记录为未验证。

测试页加载同源真实应用，加载完成后禁用其fetch；不填凭据，不发送API。它不进入生产dist。每次重新加载清除合成页面状态。报告与截图应注明真实浏览器、视口、字体比例、测试场景及时间。

当前执行环境启动独立Chromium失败（socket权限；正式提权工具又在挂载阶段报只读错误），因此提交前的命令行验证仅是离线回归，不宣称浏览器矩阵已通过；真实浏览器验收由可用云电脑继续完成。

## 官方依据

- [W3C Reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow)：一般横排内容在320 CSS px宽度重排，不丢信息或功能；确需二维布局内容有例外。
- [MDN flex-wrap](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/flex-wrap)：弹性项目允许移到新行。
- [MDN overflow-wrap](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-wrap)：避免不可断长字符串撑破容器。

以上是设计依据，并非宣称网站达到完整WCAG合规。

## 2026-10-29T11:54Z · CUA finding and correction

Real CUA preview at 320 × 800 with synthetic long content and 200% text found no horizontal overflow, but the wrapped composer squeezed history to 42px. The history now reserves `min(18rem,45dvh)` and the outer shell scrolls when needed. This changes layout only; short-screen document-flow rules remain in effect. Correction requires a fresh browser check; the prior no-horizontal-overflow result is not sufficient acceptance.

## 补充研究：先判断可用空间，不把断点当目标

- [W3C C34](https://www.w3.org/WAI/WCAG21/Techniques/css/C34) 说明固定或粘性区域在横屏、放大时可能占据大部分屏幕，空间不足时解除固定可恢复内容可见性和键盘焦点可达性。这是建议技术，并非唯一合规实现。这里虽采用 flex 固定视口而非 sticky，同样需要验证剩余正文空间。
- [Chrome CSS Layouts and Responsive Design](https://developer.chrome.com/docs/modern-web-guidance/guides/css/css-layout) 推荐内容驱动的内在尺寸、弹性及网格布局。选用自然换行与最小可读空间，让布局适应真实内容，而不是只针对设备名称补丁。
- [MDN position-try-fallbacks](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position-try-fallbacks) 提供 anchor 定位的备选位置，可在溢出时尝试另一侧；文档标记为2026年新近可用，旧浏览器可能不支持。若未来采用，应先检查目标浏览器并保留普通文档流兜底，不能把新定位能力作为默认硬前提。

验收目标是内容、操作及焦点实际可达；“横向溢出为零”只是一个指标。若菜单顶部超出滚动容器，优先考虑自然占位面板，或有兼容兜底的空间感知定位；再多的高度断点也不能替代内容压力测试。

## 2026-10-29T11:59Z · 菜单真实回归

主代理 CUA 复验确认历史区恢复288px；但800px高、200%字体及长footer时，图片菜单在768/1280宽的顶部坐标分别为-10.094/-11.094px。由此将图片和同类工具菜单都改为正常文档流面板，保留矩阵45dvh内部滚动，避免向上绝对定位造成顶部不可达。此修复不改变菜单按钮、选择事件或API请求。最终菜单修复仍须真实浏览器复验。

## 2026-10-29T12:02Z · 最终本地预览验收记录

由主代理在云电脑 Chromium 中以 CUA 操作真实应用 iframe；最终 CSS SHA256 为 `6c9043c176f805b9f83f214f918efef9d6dd2c8a65946ca81c4a81a6f184bb2a`，与候选仓库一致。

- 320/375/430/768/1280 × 800 CSS px，200%字体：图片矩阵无横向越界，菜单以正常流展开，无负顶部坐标；历史区保持288px。
- 320 × 800，先打开矩阵再加入合成长字段并维持200%字体：菜单高度随内容增长至约1820.7px，无横向越界且可滚动访问。
- 矩阵首尾选项均经真实点击成功选择；此前320 × 400、200%字体下API/模型卡及长日志场景无横向越界。
- 早期42px历史区压缩及菜单负顶部坐标是实际发现的问题，不作为通过结果；上述最终CSS修复后已复验。

范围：真实 Chromium 布局与交互、合成显示内容、禁用API请求。没有测试 Safari、真实手机软键盘、实际浏览器400%缩放或真实模型API，因此不作这些范围的完成声明。线上部署仍应另行检查，不把本地预览当作生产发布成功。
