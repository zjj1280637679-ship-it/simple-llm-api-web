# 极简 LLM

一个以对话历史中的交互卡组织设置与工具的极简 AI 网页。自带 API Key，即可对话、生成图片和查看调用记录。

![极简 LLM 交互卡工作台](knowledge/media/workbench.jpg)

[打开网页](https://zjj1280637679-ship-it.github.io/simple-llm-api-web/) · [使用指南](docs/USAGE.md) · [文档入口](docs/README.md)

## 三步开始

1. 打开网页，选择「对话」或「图片」。
2. 点输入框左下角 **＋ → API 设置**，填写服务地址、API Key 和模型。
3. 输入内容并发送。图片调用会在历史中出现确认卡，确认后执行。

密钥只保留在当前页面内存，刷新后需重新填写。模型调用由所选供应商计费；浏览器直连需要该服务支持 CORS。

## 一切皆交互卡，探索中

设置、用量图表、日志快照和调用确认都进入同一条历史。**只有最后一项是卡片时，这张卡才可交互**；一旦后面出现消息或另一张卡，原卡成为冻结记录。需要继续设置时，从 ＋ 打开新卡。

卡片类型、展示数据和动作采用统一协议；活跃性按位置推导。当前是这套交互逻辑的第一版实现，详见 [协议与扩展方法](docs/INTERACTION_CARDS.md)。

## 本地运行

在仓库根目录的命令行运行：

```sh
python3 -m http.server 8000
```

浏览器打开 `http://localhost:8000`。开发验证与 CLI 需要 Node.js 20+；网页没有 npm 运行依赖。

```sh
npm test
npm run build
node cli/cli.mjs --help
node cli/web-cli.mjs --help
```

开发者从 [文档导航](docs/README.md) 进入；Agent 从 [AGENTS.md](AGENTS.md) 进入。

## 许可证

[MIT](LICENSE) · v0.4.0
