#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARK_ENDPOINT, ARK_FLASH_MODEL, IMAGE_MODEL, canonicalEndpoint, dispatchCommand, normalizeImageOptions, validateEndpoint } from './src/core.js';

const HELP = `极简 LLM · 受控图片工作台 CLI

Usage:
  GEMINI_API_KEY=… node cli.mjs image.generate --prompt "提示词" \\
    --endpoint https://generativelanguage.googleapis.com/v1beta \\
    --model ${IMAGE_MODEL} --aspect-ratio 1:1 --image-size 1K \\
    --out ./generated --yes

Options:
  --prompt         必填，图片提示词
  --endpoint       必填，已核实可信的 API 基址（HTTPS）
  --model          Gemini 默认 ${IMAGE_MODEL}；Ark 默认 ${ARK_FLASH_MODEL}
  --protocol       gemini / ark，默认 gemini
  --aspect-ratio   默认 1:1
  --image-size     Gemini：1K / 2K / 4K，默认 1K；Ark 按模型能力，默认 2K
  --out            输出目录，默认 ./generated；已有文件不会覆盖
  --yes            明确授权向上述地址发送 API Key 并生成图片，可能产生费用
  --help           仅显示帮助，不读取密钥、不发起请求

Ark 示例：
  ARK_API_KEY=… node cli.mjs image.generate --protocol ark --prompt "提示词" \\
    --endpoint ${ARK_ENDPOINT} --image-size 2K --out ./generated --yes

Gemini 密钥只读 GEMINI_API_KEY；Ark 密钥只读 ARK_API_KEY，不回退或互相复制。
不接受命令行密钥。此本地图片入口与网页 Agent、图片页共享 image.generate dispatcher。
网页会话控制请使用独立 web-cli.mjs 入口；本入口不执行 shell 或任意命令。
`;

function parseArgs(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (argv[0] !== 'image.generate') throw new Error('只支持 image.generate 命令。');
  const allowed = new Set(['prompt', 'endpoint', 'model', 'protocol', 'aspect-ratio', 'image-size', 'out']);
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index].replace(/^--/, '');
    if (argv[index] === '--yes') {
      if (options.yes) throw new Error('参数不能重复。');
      options.yes = true;
      continue;
    }
    if (!argv[index].startsWith('--') || !allowed.has(name)) throw new Error('存在不支持的参数。');
    if (options[name] !== undefined) throw new Error('参数不能重复。');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('参数缺少值。');
    options[name] = value;
  }
  if (!options.prompt?.trim() || !options.endpoint) throw new Error('必须提供 --prompt 和 --endpoint。');
  if (!options.yes) throw new Error('未确认调用。请核实目标和模型后添加 --yes；未发送任何请求。');
  if (options.protocol && !['gemini', 'ark'].includes(options.protocol)) throw new Error('图片生成仅支持 gemini 或 ark 协议。');
  return options;
}

/** Exported for network-free tests; the executable path uses the same function. */
export async function main(argv, env = {}, io = {}, fetchImpl = globalThis.fetch) {
  const out = io.stdout || (text => process.stdout.write(text));
  const err = io.stderr || (text => process.stderr.write(text));
  let key = '';
  const redact = value => {
    let text = String(value);
    if (!key) return text;
    const forms = new Set([key, key.trim()]);
    for (const raw of [...forms]) {
      try { forms.add(encodeURIComponent(raw)); forms.add(encodeURI(raw)); } catch { /* Malformed Unicode still receives literal redaction. */ }
    }
    for (const form of [...forms].filter(Boolean).sort((a, b) => b.length - a.length)) {
      const literal = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // URL percent escapes are case-insensitive; treat their spelling alike.
      text = text.replace(new RegExp(literal, /%[0-9a-f]{2}/i.test(form) ? 'gi' : 'g'), '[REDACTED]');
    }
    return text;
  };
  try {
    const options = parseArgs(argv);
    if (options.help) { out(HELP); return 0; }
    const endpoint = canonicalEndpoint(options.endpoint);
    const protocol = options.protocol || 'gemini';
    const config = {
      protocol, url: endpoint, trustedTarget: endpoint,
      model: options.model || (protocol === 'ark' ? ARK_FLASH_MODEL : IMAGE_MODEL),
    };
    const { aspectRatio, imageSize } = normalizeImageOptions(config, {
      aspectRatio: options['aspect-ratio'], imageSize: options['image-size'],
    });
    const keyVariable = protocol === 'ark' ? 'ARK_API_KEY' : 'GEMINI_API_KEY';
    key = env[keyVariable] || '';
    if (!key.trim()) throw new Error(`请通过 ${keyVariable} 环境变量提供密钥。`);
    config.key = key;
    // Validate decoded URL paths before disclosing any target text to stdout.
    validateEndpoint(config);
    out(redact(`目标：${endpoint}\n模型：${config.model}\n比例：${aspectRatio}\n分辨率：${imageSize}\n`));
    const result = await dispatchCommand({
      command: 'image.generate',
      args: { prompt: options.prompt, aspectRatio, imageSize },
    }, { imageConfig: config, confirmed: true, fetchImpl });
    const directory = path.resolve(options.out || './generated');
    await mkdir(directory, { recursive: true });
    const stamp = `${Date.now()}-${process.pid}`;
    const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    for (let index = 0; index < result.images.length; index += 1) {
      const image = result.images[index];
      const extension = extensions[image.mimeType];
      if (!extension) throw new Error('返回的图片格式不受支持。');
      const destination = path.join(directory, `image-${stamp}-${index + 1}.${extension}`);
      await writeFile(destination, Buffer.from(image.data, 'base64'), { flag: 'wx' });
      out(`已保存：${redact(destination)}\n`);
    }
    return 0;
  } catch (error) {
    // Transport errors are sanitized by core; never print request objects,
    // server bodies, stack traces, or environment variables.
    err(`失败：${redact(error.message || '请求失败。')}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
