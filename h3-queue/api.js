/** MiniMax-H3 queue API /api/v1 adapter. Deliberately separate from /v1/jobs.
 * No browser storage or UI dependency; the key is never placed in a URL. */
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const STATUSES = new Set(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
const TYPES = { images: 9, videos: 3, audios: 3 };

export class QueueApiError extends Error {
  constructor(message, { code = 'API', status = null, unknown = false } = {}) {
    super(message);
    this.name = 'QueueApiError';
    this.code = code;
    this.status = status;
    this.unknown = unknown;
  }
}

function invalid(message) { throw new QueueApiError(message, { code: 'INPUT' }); }
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${name}必须是 ${min}～${max} 的整数。`);
  return value;
}
export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) invalid('请填写 API 服务地址。');
  let url;
  try { url = new URL(raw.trim()); } catch { invalid('API 地址格式不正确。'); }
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) || url.username || url.password || url.search || url.hash) {
    invalid('请使用 HTTPS 服务地址（localhost 可用 HTTP），不要在地址中放密钥或查询参数。');
  }
  if (/%(?:2e|2f|5c)/i.test(url.pathname) || url.pathname.includes('\\')) invalid('API 路径包含不安全的编码。');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  return url.origin + path;
}
export function validateId(raw) {
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  return integer(value, '任务 ID', 1, Number.MAX_SAFE_INTEGER);
}
function refs(value, label, max) {
  if (!Array.isArray(value) || value.length > max) invalid(`${label}最多 ${max} 项。`);
  for (const ref of value) {
    if (typeof ref !== 'string' || !ref.trim() || ref.length > 2000000) invalid(`${label}存在无效引用。`);
  }
  return value.map(ref => ref.trim());
}
export function validateTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('任务配置无效。');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt || prompt.length > 12000) invalid('视频描述需要 1～12000 个字符。');
  if (title.length > 240) invalid('任务备注不能超过 240 字符。');
  const ref_images = refs(input.ref_images || [], '图片', TYPES.images);
  const ref_videos = refs(input.ref_videos || [], '视频', TYPES.videos);
  const ref_audios = refs(input.ref_audios || [], '音频', TYPES.audios);
  const width = integer(Number(input.width), '宽度', 128, 8192);
  const height = integer(Number(input.height), '高度', 128, 8192);
  const duration = Number(input.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) invalid('视频时长必须大于 0、且不超过 600 秒。');
  const priority = integer(Number(input.priority), '优先级', -100000, 100000);
  const seed = integer(Number(input.seed), '种子', -1, 2147483647);
  if (typeof input.turbo !== 'boolean') invalid('Turbo 配置应为布尔值。');
  return { ...(title ? { title } : {}), prompt, ref_images, ref_videos, ref_audios,
    width, height, duration, turbo: input.turbo, priority, seed };
}
async function boundedText(response, limit = MAX_JSON_BYTES) {
  const header = response.headers?.get('content-length');
  if (header !== null && header !== undefined && /^\d+$/.test(header) && Number(header) > limit) {
    throw new QueueApiError('服务器响应超过安全读取上限。', { code: 'RESPONSE' });
  }
  if (!response.body?.getReader) {
    const value = await response.text();
    if (new TextEncoder().encode(value).byteLength > limit) throw new QueueApiError('响应太大。', { code: 'RESPONSE' });
    return value;
  }
  const reader = response.body.getReader();
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new QueueApiError('响应太大。', { code: 'RESPONSE' });
      parts.push(value);
    }
  } catch (error) { try { await reader.cancel(); } catch {} throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let start = 0;
  for (const part of parts) { bytes.set(part, start); start += part.byteLength; }
  return new TextDecoder().decode(bytes);
}
function extractTasks(value) {
  const result = Array.isArray(value?.tasks) ? value.tasks
    : Array.isArray(value?.items) ? value.items
      : Array.isArray(value?.data?.tasks) ? value.data.tasks
        : Array.isArray(value?.data?.items) ? value.data.items : null;
  if (!result) throw new QueueApiError('任务列表响应不包含 tasks/items 数组，请核对服务协议。', { code: 'RESPONSE' });
  return result;
}
export function createQueueClient({ url, key, fetchImpl = globalThis.fetch, timeoutMs = 30000, uploadTimeoutMs = 180000 } = {}) {
  const base = normalizeBaseUrl(url);
  if (typeof key !== 'string' || !key.trim() || /[^\x21-\x7e]/.test(key.trim())) invalid('请填写有效的 API Key。');
  if (typeof fetchImpl !== 'function') invalid('当前环境不支持网络请求。');
  const secret = key.trim();
  const safe = value => String(value).split(secret).join('[密钥已隐藏]');
  function route(path) { return base + '/api/v1' + path; }

  async function request(path, { method = 'GET', body, timeout = timeoutMs, signal } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetchImpl(route(path), {
        method, headers: { 'X-API-Key': secret, Accept: 'application/json', ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
        ...(body === undefined ? {} : { body }), signal: controller.signal,
        mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store'
      });
      let text = await boundedText(response);
      let data;
      try { data = text ? JSON.parse(text) : { ok: response.ok }; }
      catch { throw new QueueApiError('服务器返回的不是有效 JSON。', { code: 'RESPONSE', status: response.status }); }
      if (!response.ok || data?.ok === false) {
        const detail = typeof data?.error === 'string' ? data.error : typeof data?.detail === 'string' ? data.detail
          : typeof data?.message === 'string' ? data.message : '请求未成功。';
        throw new QueueApiError(`HTTP ${response.status}: ${safe(detail).slice(0, 300)}`, { code: 'HTTP', status: response.status });
      }
      return data;
    } catch (error) {
      if (error instanceof QueueApiError) throw error;
      throw new QueueApiError(controller.signal.aborted ? '网络请求已中断或超时，服务器操作结果可能未知。'
        : '连接失败，请检查 API 地址、服务状态和跨域 CORS 配置。', { code: 'NETWORK' });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
  async function mutation(path, options) {
    try { return await request(path, options); }
    catch (error) {
      if (error.code === 'NETWORK' || error.code === 'RESPONSE' || error.status >= 500) {
        throw new QueueApiError('请求回执未确认，服务器可能已经执行。请先刷新状态，不要直接重复提交。',
          { code: 'UNKNOWN', status: error.status, unknown: true });
      }
      throw error;
    }
  }
  function taskPath(id) { return '/tasks/' + validateId(id); }
  return Object.freeze({
    base,
    status: () => request('/status'),
    listTasks: ({ status = '', limit = 50 } = {}) => {
      integer(limit, '查询数量', 1, 200);
      if (status && !STATUSES.has(status)) invalid('未知的任务状态过滤条件。');
      const params = new URLSearchParams({ limit: String(limit) });
      if (status) params.set('status', status);
      return request('/tasks?' + params.toString()).then(extractTasks);
    },
    task: id => request(taskPath(id)).then(data => {
      if (!data?.task || validateId(data.task.id) !== validateId(id)) {
        throw new QueueApiError('服务器返回的任务 ID 不匹配。', { code: 'RESPONSE' });
      }
      return data.task;
    }),
    upload: async files => {
      if (!Array.isArray(files) || !files.length || files.some(file => !file || typeof file.name !== 'string')) invalid('请选择要上传的参考文件。');
      const form = new FormData();
      for (const file of files) form.append('files', file, file.name);
      const result = await mutation('/upload', { method: 'POST', body: form, timeout: uploadTimeoutMs });
      if (!Array.isArray(result?.uploaded) || result.uploaded.length !== files.length || result.uploaded.some(item => typeof item.filename !== 'string' || !item.filename)) {
        throw new QueueApiError('素材上传回执未提供对应文件名；不要直接提交任务。', { code: 'RESPONSE' });
      }
      return result.uploaded;
    },
    createTask: async input => {
      const data = await mutation('/tasks', { method: 'POST', body: JSON.stringify(validateTask(input)) });
      let id;
      try { id = validateId(data?.task_id ?? data?.task?.id); }
      catch { throw new QueueApiError('任务可能已入队，但返回回执缺少有效任务 ID；请先查队列，勿重复提交。', { code: 'UNKNOWN', unknown: true }); }
      return { id, task: data.task || null };
    },
    createBatch: async tasks => {
      if (!Array.isArray(tasks) || !tasks.length || tasks.length > 20) invalid('批量任务数量必须在 1～20 之间。');
      return mutation('/tasks/batch', { method: 'POST', body: JSON.stringify({ tasks: tasks.map(validateTask) }) });
    },
    taskAction: (id, action) => {
      if (!['top', 'cancel', 'retry', 'delete'].includes(action)) invalid('不支持的任务操作。');
      return mutation(taskPath(id) + (action === 'delete' ? '' : '/' + action), { method: action === 'delete' ? 'DELETE' : 'POST' });
    },
    queueAction: action => {
      if (!['pause', 'resume', 'clear'].includes(action)) invalid('不支持的队列操作。');
      return mutation('/queue/' + action, { method: 'POST' });
    },
    async video(id, onProgress = () => {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180000);
      try {
        const response = await fetchImpl(route(taskPath(id) + '/video'), {
          headers: { 'X-API-Key': secret, Accept: 'video/mp4' }, signal: controller.signal,
          mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store'
        });
        if (!response.ok) throw new QueueApiError(`视频下载失败：HTTP ${response.status}`, { code: 'HTTP', status: response.status });
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) throw new QueueApiError('视频超过浏览器 256 MiB 下载上限。', { code: 'RESPONSE' });
        const parts = [];
        let count = 0;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              count += value.byteLength;
              if (count > MAX_VIDEO_BYTES) throw new QueueApiError('视频超过浏览器 256 MiB 下载上限。', { code: 'RESPONSE' });
              parts.push(value);
              onProgress(count, Number.isFinite(declared) && declared > 0 ? declared : null);
            }
          } finally { reader.releaseLock(); }
        } else {
          const buffer = await response.arrayBuffer();
          count = buffer.byteLength;
          if (count > MAX_VIDEO_BYTES) throw new QueueApiError('视频太大。', { code: 'RESPONSE' });
          parts.push(buffer);
        }
        if (count === 0) throw new QueueApiError('下载到空视频文件。', { code: 'RESPONSE' });
        return new Blob(parts, { type: 'video/mp4' });
      } catch (error) {
        if (error instanceof QueueApiError) throw error;
        throw new QueueApiError('视频下载失败或超时，请重试下载，不会重新生成。', { code: 'NETWORK' });
      } finally { clearTimeout(timer); }
    }
  });
}
