import { createQueueClient, normalizeBaseUrl, validateId, validateTask } from './api.js';

const KINDS = {
  images: { token: 'Picture', max: 9 },
  videos: { token: 'Video', max: 3 },
  audios: { token: 'Audio', max: 3 }
};
const labels = { PENDING: '排队中', RUNNING: '生成中', COMPLETED: '已完成', FAILED: '失败', CANCELLED: '已取消' };
const STORAGE = 'simple-llm-h3-queue-v1';
const $ = id => document.getElementById(id);
const el = (name, className = '', content = '') => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (content !== '') node.textContent = String(content);
  return node;
};
const state = {
  client: null, refs: { images: [], videos: [], audios: [] },
  tasks: [], extras: new Map(), ids: [], media: new Map(), status: null,
  submitting: false, polling: false, pollTimer: null, connectEpoch: 0, connecting: false,
  history: {}, base: '',
};
function flash(message, kind = 'info') {
  $('message').textContent = message;
  $('message').dataset.kind = kind;
}
function safeStore() {
  if (state.base) state.history[state.base] = state.ids.slice(0, 40);
  try { localStorage.setItem(STORAGE, JSON.stringify({ url: $('api-url').value.trim(), history: state.history })); }
  catch { flash('本机存储不可用。刷新后不会自动恢复任务 ID，请自行保留。', 'warn'); }
}
function restore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    if (typeof value.url === 'string') $('api-url').value = value.url;
    if (value.history && typeof value.history === 'object' && !Array.isArray(value.history)) {
      for (const [url, ids] of Object.entries(value.history).slice(0, 12)) {
        try { if (normalizeBaseUrl(url) === url && Array.isArray(ids)) state.history[url] = ids.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 40); } catch {}
      }
    }
    try { state.base = normalizeBaseUrl($('api-url').value); state.ids = [...(state.history[state.base] || [])]; } catch {}
  } catch { /* Corrupt local preferences must not block operation. */ }
}
function disconnect() {
  state.connectEpoch++;
  state.connecting = false;
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.client = null;
  state.status = null;
  state.tasks = []; state.extras.clear();
  $('connection-state').textContent = '尚未连接';
  $('connection-state').className = 'connection muted';
  $('status-json').textContent = '连接后显示服务器返回的状态。';
  for (const { url } of state.media.values()) URL.revokeObjectURL(url);
  state.media.clear();
  renderTasks();
}
function remember(id) {
  id = validateId(id);
  state.ids = [id, ...state.ids.filter(value => value !== id)].slice(0, 40);
  safeStore();
}
function renderRefs() {
  for (const [kind, definition] of Object.entries(KINDS)) {
    const list = $('refs-' + kind);
    list.replaceChildren();
    state.refs[kind].forEach((item, i) => {
      const row = el('div', 'reference');
      const token = el('code', 'tag', `<${definition.token} ${i + 1}>`);
      const name = el('span', 'ref-name', item.kind === 'file' ? item.file.name : item.value);
      name.title = name.textContent;
      row.append(token);
      if (item.previewUrl) { const img = el('img', 'thumbnail'); img.src = item.previewUrl; img.alt = ''; row.append(img); }
      row.append(name);
      for (const [action, symbol, title, disabled] of [
        ['up', '↑', '上移', i === 0], ['down', '↓', '下移', i === state.refs[kind].length - 1], ['remove', '×', '删除', false]
      ]) {
        const button = el('button', 'icon-button', symbol);
        button.type = 'button'; button.title = title; button.setAttribute('aria-label', title + ' ' + token.textContent);
        button.disabled = disabled;
        button.addEventListener('click', () => {
          if (action === 'remove') {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
            state.refs[kind].splice(i, 1);
          } else {
            const next = action === 'up' ? i - 1 : i + 1;
            [state.refs[kind][i], state.refs[kind][next]] = [state.refs[kind][next], state.refs[kind][i]];
          }
          renderRefs();
        });
        row.append(button);
      }
      list.append(row);
    });
    $('count-' + kind).textContent = `${state.refs[kind].length}/${definition.max}`;
  }
}
function addFile(kind, files) {
  const list = state.refs[kind];
  for (const file of files) {
    if (list.length >= KINDS[kind].max) { flash(`${KINDS[kind].token} 参考数量已达上限。`, 'warn'); break; }
    const item = { kind: 'file', file };
    if (kind === 'images' && file.type.startsWith('image/')) item.previewUrl = URL.createObjectURL(file);
    list.push(item);
  }
  renderRefs();
}
function addUrl(kind) {
  const input = $('url-' + kind);
  const value = input.value.trim();
  if (state.refs[kind].length >= KINDS[kind].max) return flash('该类型参考数量已满。', 'warn');
  const http = /^https?:\/\/\S+$/i.test(value);
  const imageData = kind === 'images' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value);
  if (!http && !imageData) return flash('请输入完整的 http(s) 素材 URL；图片也支持 data:image/...;base64。', 'error');
  state.refs[kind].push({ kind: 'url', value });
  input.value = '';
  renderRefs();
}
function formValues() {
  const resolution = $('resolution').value;
  const [width, height] = resolution === 'custom' ? [Number($('width').value), Number($('height').value)]
    : resolution.split('x').map(Number);
  const ref = kind => state.refs[kind].map(item => item.kind === 'file' ? item.file.name : item.value);
  return validateTask({
    title: $('task-title').value, prompt: $('prompt').value,
    ref_images: ref('images'), ref_videos: ref('videos'), ref_audios: ref('audios'),
    width, height, duration: Number($('duration').value), turbo: $('turbo').checked,
    priority: Number($('priority').value), seed: Number($('seed').value)
  });
}
async function materializeRefs(draft) {
  const refs = Object.values(state.refs).flat().filter(item => item.kind === 'file');
  if (!refs.length) return draft;
  flash(`正在上传 ${refs.length} 个参考素材…`);
  const uploaded = await state.client.upload(refs.map(item => item.file));
  const filenames = new Map(refs.map((item, index) => [item, uploaded[index].filename]));
  const select = kind => state.refs[kind].map(item => item.kind === 'file' ? filenames.get(item) : item.value);
  return validateTask({ ...draft, ref_images: select('images'), ref_videos: select('videos'), ref_audios: select('audios') });
}
async function submit(batch = false) {
  if (state.submitting) return;
  if (!state.client) return flash('先填写 API 地址与密钥并连接。', 'warn');
  let count = 1, draft;
  try {
    count = batch ? Number($('batch-count').value) : 1;
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('批量数量必须为 1～20。');
    draft = formValues();
  } catch (error) { return flash(error.message, 'error'); }
  state.submitting = true;
  $('submit-task').disabled = true; $('submit-batch').disabled = true;
  try {
    const ready = await materializeRefs(draft);
    flash(batch ? `正在一次性提交 ${count} 个任务…` : '正在提交排队任务…');
    if (batch) {
      const result = await state.client.createBatch(Array.from({ length: count }, () => ({ ...ready })));
      const returned = Array.isArray(result?.tasks) ? result.tasks : [];
      for (const task of returned) { const id = task?.id ?? task?.task_id; if (Number.isSafeInteger(Number(id)) && Number(id) > 0) remember(Number(id)); }
      flash('批量入队请求已收到成功回执。实际任务 ID 以队列刷新结果为准。', 'ok');
    } else {
      const created = await state.client.createTask(ready);
      remember(created.id);
      state.extras.set(created.id, { id: created.id, status: created.task?.status || 'PENDING', title: ready.title || `任务 #${created.id}` });
      flash(`已接收任务 #${created.id}。生成将在服务端队列进行。`, 'ok');
    }
    await refresh();
  } catch (error) {
    flash(error.unknown ? error.message + ' 特别注意：上传/排队的网络回执可能丢失，请先查询队列，避免重复生成。' : error.message, 'error');
  } finally {
    state.submitting = false;
    $('submit-task').disabled = false; $('submit-batch').disabled = false;
  }
}
function renderStatus() {
  $('status-json').textContent = state.status ? JSON.stringify(state.status, null, 2).slice(0, 10000) : '暂无服务器状态。';
  const queue = state.status?.queue ?? state.status?.tasks ?? null;
  $('server-summary').textContent = queue && typeof queue === 'object' ? '队列统计见下方服务端回执' : 'API 服务已连接';
}
function serverTask(task) {
  const id = Number(task?.id ?? task?.task_id);
  return Number.isSafeInteger(id) && id > 0 ? { ...task, id } : null;
}
function allTasks() {
  const combined = new Map();
  for (const task of state.tasks) {
    const valid = serverTask(task);
    if (valid) combined.set(valid.id, valid);
  }
  const filter = $('status-filter').value;
  for (const [id, task] of state.extras) if (!combined.has(id) && (!filter || task.status === filter)) combined.set(id, task);
  return [...combined.values()];
}
function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value == null ? '' : String(value);
}
function actionButton(action, text, id) {
  const button = el('button', 'small-button', text);
  button.type = 'button';
  button.addEventListener('click', () => taskAction(id, action));
  return button;
}
function taskNode(task) {
  const article = el('article', 'task-card');
  article.dataset.id = String(task.id);
  article.append(el('div', 'task-heading'));
  article.querySelector('.task-heading').append(el('strong', 'task-title'), el('span', 'pill status-pill'));
  article.append(el('div', 'task-id'));
  const progress = el('progress', 'task-progress'); progress.max = 100; article.append(progress);
  article.append(el('div', 'task-progress-text'), el('div', 'task-node'));
  article.append(el('div', 'task-error'));
  article.append(el('div', 'actions task-actions'));
  article.append(el('div', 'video-slot'));
  return article;
}
function patchTask(node, task) {
  const status = String(task.status || 'UNKNOWN').toUpperCase();
  setText(node, '.task-title', task.title || `任务 #${task.id}`);
  setText(node, '.task-id', `#${task.id}`);
  const pill = node.querySelector('.status-pill');
  pill.textContent = labels[status] || status;
  pill.dataset.status = status;
  const value = Number(task.progress_percent);
  const percentage = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const progress = node.querySelector('progress');
  if (percentage === null) progress.removeAttribute('value'); else progress.value = percentage;
  setText(node, '.task-progress-text', percentage === null ? '服务端未报告进度' : `${percentage.toFixed(1).replace(/\.0$/, '')}%`);
  setText(node, '.task-node', task.current_node || '');
  setText(node, '.task-error', task.error_msg || '');
  const actionList = node.querySelector('.task-actions');
  if (node.dataset.actions !== status) {
    actionList.replaceChildren(actionButton('refresh', '刷新', task.id));
    if (status === 'PENDING') actionList.append(actionButton('top', '置顶', task.id), actionButton('cancel', '取消', task.id));
    if (status === 'RUNNING') actionList.append(actionButton('cancel', '中断', task.id));
    if (status === 'FAILED' || status === 'CANCELLED') actionList.append(actionButton('retry', '重试', task.id));
    if (status === 'COMPLETED') actionList.append(actionButton('preview', '预览', task.id), actionButton('download', '下载 MP4', task.id));
    actionList.append(actionButton('delete', '删除', task.id));
    node.dataset.actions = status;
  }
  const slot = node.querySelector('.video-slot');
  if (state.media.has(task.id) && !slot.querySelector('video')) {
    const player = el('video'); player.controls = true; player.playsInline = true;
    player.preload = 'metadata'; player.src = state.media.get(task.id).url;
    slot.append(player);
  }
  if (Array.isArray(task.video_urls) && task.video_urls.length && !slot.querySelector('.output-links')) {
    const links = el('div', 'output-links');
    for (const raw of task.video_urls.slice(0, 5)) {
      try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') continue;
        const a = el('a', 'subtle-link', '服务器输出链接');
        a.href = url.href; a.rel = 'noopener noreferrer'; a.target = '_blank';
        links.append(a);
      } catch { /* Invalid output URLs are not clickable. */ }
    }
    slot.append(links);
  }
}
function renderTasks() {
  const list = $('task-list');
  const tasks = allTasks();
  const ids = new Set(tasks.map(task => String(task.id)));
  for (const child of [...list.children]) if (!ids.has(child.dataset.id)) child.remove();
  for (const task of tasks) {
    let node = [...list.children].find(child => child.dataset.id === String(task.id));
    if (!node) { node = taskNode(task); list.append(node); }
    patchTask(node, task);
  }
  $('empty-tasks').hidden = tasks.length > 0;
  $('listed-count').textContent = `${tasks.length} 条已显示`;
}
async function refresh({ quiet = false } = {}) {
  if (!state.client || state.polling) return;
  state.polling = true;
  try {
    const [status, tasks] = await Promise.all([
      state.client.status(), state.client.listTasks({ status: $('status-filter').value, limit: Number($('list-limit').value) })
    ]);
    state.status = status;
    state.tasks = tasks;
    for (const task of tasks) if (state.extras.has(Number(task.id))) state.extras.set(Number(task.id), task);
    renderStatus(); renderTasks();
    $('connection-state').textContent = '已连接'; $('connection-state').className = 'connection connected';
  } catch (error) {
    $('connection-state').textContent = '连接异常'; $('connection-state').className = 'connection warning';
    if (!quiet) flash(error.message, 'error');
  } finally { state.polling = false; }
}
async function connect() {
  disconnect();
  const epoch = state.connectEpoch;
  state.connecting = true;
  try {
    const url = normalizeBaseUrl($('api-url').value);
    state.base = url;
    state.ids = [...(state.history[url] || [])];
    const key = $('api-key').value;
    const client = createQueueClient({ url, key });
    $('connection-state').textContent = '正在连接…';
    const [status, tasks] = await Promise.all([client.status(), client.listTasks()]);
    if (epoch !== state.connectEpoch) return;
    state.client = client;
    state.status = status;
    state.tasks = tasks;
    $('connection-state').textContent = '已连接'; $('connection-state').className = 'connection connected';
    safeStore(); renderStatus(); renderTasks();
    flash('连接成功。密钥只在本页内存中使用，不会保存到浏览器历史或 GitHub。', 'ok');
    const missing = state.ids.filter(id => !tasks.some(t => Number(t.id) === id)).slice(0, 8);
    const recovered = await Promise.allSettled(missing.map(id => client.task(id)));
    if (epoch !== state.connectEpoch) return;
    recovered.forEach((result, i) => { if (result.status === 'fulfilled') state.extras.set(missing[i], result.value); });
    renderTasks();
    state.pollTimer = setInterval(() => { if (!document.hidden) void refresh({ quiet: true }); }, 4500);
  } catch (error) {
    if (epoch !== state.connectEpoch) return;
    $('connection-state').textContent = '连接失败'; $('connection-state').className = 'connection warning';
    flash(error.message, 'error');
  } finally { if (epoch === state.connectEpoch) state.connecting = false; }
}
async function taskAction(id, action) {
  if (!state.client) return flash('先连接 API。', 'warn');
  if (action === 'delete' && !confirm(`永久删除服务器任务 #${id}？`)) return;
  if (action === 'cancel' && !confirm(`确认取消/中断任务 #${id}？`)) return;
  try {
    if (action === 'refresh') {
      state.extras.set(id, await state.client.task(id));
      flash(`任务 #${id} 已查询。`, 'ok');
    } else if (action === 'preview' || action === 'download') {
      let media = state.media.get(id);
      if (!media) {
        flash(`正在取回视频 #${id}…`);
        const blob = await state.client.video(id, (loaded, total) => {
          $('message').textContent = `正在下载任务 #${id}：${(loaded / 1024 / 1024).toFixed(1)} MiB${total ? ' / ' + (total / 1024 / 1024).toFixed(1) + ' MiB' : ''}`;
        });
        for (const cached of state.media.values()) URL.revokeObjectURL(cached.url);
        state.media.clear();
        media = { url: URL.createObjectURL(blob), blob };
        state.media.set(id, media);
        for (const slot of document.querySelectorAll('.video-slot')) {
          if (slot.closest('.task-card')?.dataset.id !== String(id)) slot.querySelector('video')?.remove();
        }
      }
      if (action === 'download') {
        const a = el('a'); a.href = media.url; a.download = `MiniMax_H3_task${id}.mp4`;
        document.body.append(a); a.click(); a.remove();
        flash(`任务 #${id} 的下载已交给浏览器处理。`, 'ok');
      } else flash(`任务 #${id} 的预览已准备。`, 'ok');
    } else {
      await state.client.taskAction(id, action);
      if (action === 'delete') { state.extras.delete(id); state.ids = state.ids.filter(value => value !== id); safeStore(); }
      flash(`任务 #${id} 的 ${action} 请求已获服务器回执。请以刷新后的状态为准。`, 'ok');
      await refresh();
    }
    renderTasks();
  } catch (error) { flash(error.message, 'error'); }
}
async function queueAction(action) {
  if (!state.client) return flash('先连接 API。', 'warn');
  if (action === 'clear' && !confirm('确定清理服务器上所有已完成、失败或取消的历史任务？')) return;
  try {
    await state.client.queueAction(action);
    flash(`队列 ${action} 请求已被接受。`, 'ok');
    await refresh();
  } catch (error) { flash(error.message, 'error'); }
}
async function lookUp() {
  if (!state.client) return flash('先连接 API。', 'warn');
  try {
    const id = validateId($('task-lookup').value.trim());
    const task = await state.client.task(id);
    state.extras.set(id, task); remember(id); renderTasks();
    flash(`已找到任务 #${id}。`, 'ok');
  } catch (error) { flash(error.message, 'error'); }
}
function attachEvents() {
  $('connect').addEventListener('click', connect);
  for (const id of ['api-url', 'api-key']) $(id).addEventListener('input', () => {
    if (state.client || state.connecting) { disconnect(); flash('连接配置已变更，请重新连接。', 'warn'); }
  });
  for (const kind of Object.keys(KINDS)) {
    $('files-' + kind).addEventListener('change', event => {
      addFile(kind, [...event.target.files]); event.target.value = '';
    });
    $('add-' + kind).addEventListener('click', () => addUrl(kind));
  }
  $('resolution').addEventListener('change', () => { $('custom-size').hidden = $('resolution').value !== 'custom'; });
  $('submit-task').addEventListener('click', () => submit(false));
  $('submit-batch').addEventListener('click', () => submit(true));
  $('refresh').addEventListener('click', () => refresh());
  $('lookup').addEventListener('click', lookUp);
  for (const action of ['pause', 'resume', 'clear']) $('queue-' + action).addEventListener('click', () => queueAction(action));
  $('status-filter').addEventListener('change', () => refresh());
  $('list-limit').addEventListener('change', () => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.client) void refresh({ quiet: true }); });
  window.addEventListener('pagehide', () => {
    if (state.pollTimer) clearInterval(state.pollTimer);
    for (const item of state.media.values()) URL.revokeObjectURL(item.url);
    for (const list of Object.values(state.refs)) for (const item of list) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
}
restore();
attachEvents();
renderRefs();
renderTasks();
