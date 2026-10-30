# 线上发布观察

2026-10-30，主线提交 `47eb37a7098ba8e2d6aaa581183726b44563f9c9`。GitHub Actions [41024194460](https://github.com/zjj1280637679-ship-it/simple-llm-api-web/actions/runs/41024194460) 的 build/deploy 均成功。

浏览器重新加载 [原网址](https://zjj1280637679-ship-it.github.io/simple-llm-api-web/)，脚本构建标识 `67890a3c225df77a901f`，与本地47文件构建一致。此前0.4.0浏览器中的旧设置/模型/日志/确认/图表记录被保留，历史页显示一项“旧存档”。新建会话后打开设置→模型设置，DOM观察父卡7禁用、子卡8可操作。

1363px视口下body宽1363px、主容器宽1348px；没有横向溢出。截图见 [线上设置卡](../../media/settings-history-v050-live.jpg)。这是Chrome桌面云浏览器观察，不是iOS真机或供应商验收。未填写密钥，也未发起模型请求。

本记录是知识发布附加项，不改变冻结项目源提交与输入指纹。
