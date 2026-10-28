#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMAGE_MODEL, canonicalEndpoint, dispatchCommand } from './src/core.js';

const HELP = `极简 LLM · 受控图片工作台 CLI

Usage:
  GEMINI_API_KEY=… node cli.mjs image.generate --prompt "提示词" \\
    --endpoint https://generativelanguage.googleapis.com/v1beta \\
    --model ${IMAGE_MODEL} --aspect-ratio 1:1 --image-size 1K \\
    --out ./generated --yes

Options:
  --prompt         必填，图片提示词
  --endpoint       必填，已核实可信的 Gemini API 基址（HTTPS）
  --model          默认 ${IMAGE_MODEL}
  --protocol       gemini（本版本图片仅支持 Gemini 原生协议）
  --aspect-ratio   默认 1:1
  --image-size     1K / 2K / 4K，默认 1K
  --out            输出目录，默认 ./generated；已有文件不会覆盖
  --yes            明确授权向上述地址发送 API Key 并生成图片，可能产生费用
  --help           仅显示帮助，不读取密钥、不发起请求

密钥只从 GEMINI_API_KEY 环境变量读取，不接受命令行密钥。
此入口与网页 Agent、图片页共享同一个 image.generate dispatcher。
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
  if (options.protocol && options.protocol !== 'gemini') throw new Error('图片生成仅支持 gemini 原生协议。');
  return options;
}

/** Exported for network-free tests; the executable path uses the same function. */
export async function main(argv, env = {}, io = {}, fetchImpl = globalThis.fetch) {
  const out = io.stdout || (text => process.stdout.write(text));
  const err = io.stderr || (text => process.stderr.write(text));
  let key = '';
  const redact = value => key ? String(value).split(key).join('[REDACTED]') : String(value);
  try {
    const options = parseArgs(argv);
    if (options.help) { out(HELP); return 0; }
    const endpoint = canonicalEndpoint(options.endpoint);
    key = env.GEMINI_API_KEY || '';
    if (!key.trim()) throw new Error('请通过 GEMINI_API_KEY 环境变量提供密钥。');
    const config = {
      protocol: 'gemini', url: endpoint, trustedTarget: endpoint, key,
      model: options.model || IMAGE_MODEL,
    };
    out(redact(`目标：${endpoint}\n模型：${config.model}\n`));
    const result = await dispatchCommand({
      command: 'image.generate',
      args: { prompt: options.prompt, aspectRatio: options['aspect-ratio'] || '1:1', imageSize: options['image-size'] || '1K' },
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
