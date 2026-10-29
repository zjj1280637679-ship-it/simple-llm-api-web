# 全屏滚动与悬浮导航

版本0.1.0；2026-10-29T12:12:00Z；基于main 1c981949。

目标：全屏背景统一滚动，只有对话、图片生成、通讯日志三个切换按钮悬浮。移除顶部API状态文字与底部模型名称和固定“今天”占位，但设置卡、配置校验和请求错误保持原功能。

## 依据与策略

- [W3C C43](https://www.w3.org/WAI/WCAG22/Techniques/css/C43)：用scroll-padding给固定层遮挡范围留出滚动空间，保护键盘焦点。
- [W3C C34](https://www.w3.org/WAI/WCAG21/Techniques/css/C34)：可用空间不足时解除固定，而不是让导航覆盖正文。
- [MDN ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)：观察导航实际尺寸。换行、字体放大后重新计算留白，不假设固定导航高度。
- [MDN scroll-padding-top](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scroll-padding-top)：指定滚动容器顶部优化可视区域。

页面外层成为全屏滚动容器；顶部不占整行背景。导航居中、小范围胶囊，避开safe-area。ResizeObserver将实际导航底部+12px作为首屏内容与scroll-padding的空间。导航高度超过当前视口三分之一时转正常流，保证极端放大/短屏内容可达；这个比例是当前策略，可随实际体验调整，不是产品硬条件。无ResizeObserver时初次渲染/resize仍测量。键盘焦点落在固定层之下时补充滚动调整。

API密钥、调用和确认协议未变；测试不调用真实API。Node新增测试验证测量/观察器清理/正常流兜底/焦点滚动，但不能证明真实像素布局。需CUA复验320/375/430/768/1280宽、400/800高、200%字体、长内容、导航滚动与焦点可达；候选未部署前不称生产成功。

## 2026-10-29T12:21Z · 联合候选真实验收

主代理在云电脑Chromium通过CUA测试候选 `1e3834360874816a2c13995420ca6adc6fc5ff3d` 的真实应用iframe：

- 320/375/430/768/1280 × 800 CSS px、200%字体、API卡长内容fixture：无横向越界。
- 320 × 400、200%字体：悬浮导航高115.375px、top10px，无横向越界；导航保留三个按钮。
- 键盘Enter切换通讯日志后activeElement保持日志tab；切回图片后，矩阵首行按Enter选择仍聚焦对应 `set-image-options` 按钮。
- 独立usage测试页面真实渲染：缓存25/100显示25%，0/100显示0%，缺失字段显示未知，零分母不计算百分比。

这些是Chromium真实布局/交互与合成显示数据验证，不包含真实模型API、Safari、物理手机键盘或真正浏览器400%缩放。Node联合回归132通过、1个原有可选MCP跳过；语法检查和12文件白名单构建通过。生产发布另由CI部署及线上页面复验确认。
