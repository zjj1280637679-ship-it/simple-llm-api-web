/** Local-only attachment preparation. No uploads, storage, or network side effects. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 8;
export const MODALITIES = {text:'文本',image:'图片',pdf:'PDF',audio:'音频',video:'视频'};
const types = {
 'image/png':'image','image/jpeg':'image','image/webp':'image',
 'application/pdf':'pdf','audio/mpeg':'audio','audio/mp3':'audio','audio/wav':'audio','audio/x-wav':'audio','audio/ogg':'audio','audio/flac':'audio',
 'video/mp4':'video','video/webm':'video','video/quicktime':'video',
};
const extensions = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'};
const textExtensions = /\.(txt|md|csv|json|log|xml|html|css|js|ts|py|yaml|yml)$/i;
export function supportedModalities(protocol) { return protocol === 'gemini' ? Object.keys(MODALITIES) : protocol === 'openai' ? ['text','image','pdf'] : ['text','image']; }
export function attachmentError(message) { return Object.assign(new Error(message), {code:'ATTACHMENT', safeMessage:message}); }
export function describeFile(file) {
 const mimeType = (file.type || extensions[file.name?.split('.').pop()?.toLowerCase()] || '').toLowerCase();
 const kind = types[mimeType] || (mimeType.startsWith('text/') || textExtensions.test(file.name || '') || mimeType === 'application/json' ? 'text' : null);
 if (!kind) throw attachmentError('此文件格式尚未接入；请选择图片、PDF、UTF-8 文本或 Gemini 音视频。');
 if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) throw attachmentError('单个附件需大于 0 且不超过 5 MiB。');
 return {name:String(file.name || 'attachment').slice(0,200),size:file.size,mimeType:kind === 'text' ? 'text/plain' : mimeType,kind};
}
export function validateAttachments(files, protocol, enabled = supportedModalities(protocol)) {
 if (!Array.isArray(files) || files.length > MAX_FILES || files.reduce((n,f)=>n+f.size,0) > MAX_TOTAL_BYTES) throw attachmentError('每条消息最多 8 个附件，合计不超过 8 MiB。');
 for (const f of files) {
  describeFile({...f,type:f.mimeType});
  if (!supportedModalities(protocol).includes(f.kind) || !enabled.includes(f.kind)) throw attachmentError(`当前协议或输入模态未启用${MODALITIES[f.kind] || '此类型'}；请调整设置或移除附件。`);
 }
 return files;
}
export async function prepareFiles(selected, existing, protocol, enabled) {
 const descriptions = Array.from(selected, describeFile);
 validateAttachments([...existing,...descriptions],protocol,enabled);
 const prepared = await Promise.all(Array.from(selected, async (file,i) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== descriptions[i].size) throw attachmentError('文件读取大小发生变化，请重新选择。');
  let data = ''; for(let i=0;i<bytes.length;i+=32768) data += String.fromCharCode(...bytes.subarray(i,i+32768));
  const base64 = btoa(data);
  let text;
  if(descriptions[i].kind === 'text') { try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw attachmentError('文本附件需要 UTF-8 编码。'); } }
  return {...descriptions[i],id:globalThis.crypto.randomUUID(),base64,...(text === undefined ? {} : {text})};
 }));
 return [...existing,...prepared];
}
export function attachmentMetadata(files = []) { return files.map(({name,size,mimeType,kind})=>({name,size,mimeType,kind})); }
export function attachmentParts(files,protocol) {
 validateAttachments(files,protocol);
 return files.map(f=>{
  if(f.kind==='text') { const text = `附件 ${JSON.stringify(f.name)}（以下为文件内容）\n${f.text}\n（附件结束）`; return protocol==='gemini'?{text}:{type:'text',text}; }
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64 || '') || !f.base64) throw attachmentError('附件数据无效，请重新选择。');
  if(protocol==='gemini') return {inlineData:{mimeType:f.mimeType,data:f.base64}};
  if(f.kind==='pdf') return {type:'file',file:{filename:f.name,file_data:`data:${f.mimeType};base64,${f.base64}`}};
  return {type:'image_url',image_url:{url:`data:${f.mimeType};base64,${f.base64}`}};
 });
}
