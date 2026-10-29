// Typed, transport-independent control of ONE live page. No network listener,
// eval, credentials, endpoint trust override, or persistence belongs here.
export const SESSION_COMMANDS = Object.freeze({
  'session.state': 'state', 'session.logs': 'logs', 'page.navigate': 'navigate',
  'settings.update': 'settings', 'draft.set': 'draft',
  'request.send': 'send', 'request.cancel': 'cancel'
});
const invalid = () => { const e = new Error('Invalid page command'); e.code = 'INVALID_SESSION_COMMAND'; throw e; };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const only = (x, keys) => object(x) && Object.keys(x).every(k => keys.includes(k));
export function validateSessionCommand(input) {
  if (!only(input, ['command', 'args']) || !Object.hasOwn(SESSION_COMMANDS, input.command)) invalid();
  const args = input.args ?? {};
  if (!object(args)) invalid();
  switch (input.command) {
    case 'page.navigate':
      if (!only(args, ['page']) || !['chat', 'image', 'logs'].includes(args.page)) invalid(); break;
    case 'draft.set':
      if (!only(args, ['text']) || typeof args.text !== 'string' || args.text.length > 100000) invalid(); break;
    case 'settings.update': {
      const fields = ['model', 'output', 'temperature', 'topP', 'aspectRatio', 'imageSize'];
      if (!only(args, fields) || !Object.keys(args).length) invalid();
      for (const [k, v] of Object.entries(args)) {
        if (k === 'model' && (typeof v !== 'string' || !v.trim() || v.length > 200)) invalid();
        if (['output', 'temperature', 'topP'].includes(k) && v !== '' && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) invalid();
        if (k === 'output' && v !== '' && (!Number.isInteger(v) || v < 1)) invalid();
        if (k === 'topP' && v !== '' && v > 1) invalid();
        if (k === 'temperature' && v !== '' && v > 2) invalid();
        if (k === 'aspectRatio' && !['1:1','1:4','1:8','2:3','3:2','3:4','4:1','4:3','4:5','5:4','8:1','9:16','16:9','21:9'].includes(v)) invalid();
        if (k === 'imageSize' && !['1K','1.5K','2K','4K'].includes(v)) invalid();
      }
      break;
    }
    default: if (Object.keys(args).length) invalid();
  }
  return { command: input.command, args: { ...args } };
}
const sendFailures = Object.freeze({
  failed: 'REQUEST_FAILED', cancelled: 'REQUEST_CANCELLED', 'not-sent': 'REQUEST_NOT_SENT',
  'needs-configuration': 'CONFIGURATION_REQUIRED', declined: 'CONFIRMATION_REQUIRED', ignored: 'REQUEST_IGNORED'
});
export function sessionCommandResult(command, result) {
  if (command === 'request.send' && result && Object.hasOwn(sendFailures, result.status)) {
    // Preserve only diagnostic metadata, never an upstream body or raw error.
    const diagnostic = { status: result.status };
    if (typeof result.code === 'string' && /^[A-Z_]{1,80}$/.test(result.code)) diagnostic.code = result.code;
    if (['select-workspace','busy','empty','unsupported-model','changed-after-confirmation'].includes(result.reason)) diagnostic.reason = result.reason;
    return { ok: false, error: sendFailures[result.status], result: diagnostic };
  }
  return { ok: true, result: result ?? null };
}
export function createPageSession(handlers) {
  return Object.freeze({
    version: 1,
    commands: Object.freeze(Object.keys(SESSION_COMMANDS)),
    async execute(input) {
      if(handlers.isActive?.()===false)return {ok:false,error:'SESSION_CLOSED'};
      const { command, args } = validateSessionCommand(input);
      const handler = handlers[SESSION_COMMANDS[command]];
      if (typeof handler !== 'function') return { ok: false, error: 'UNSUPPORTED_SESSION_COMMAND' };
      try {
        // Never let a transport assert consent. This callback must ask the user
        // in the page; normal endpoint/image approvals still run in send().
        if (command === 'request.send' && (typeof handlers.confirmSend !== 'function' || !await handlers.confirmSend())) {
          return { ok: false, error: 'CONFIRMATION_REQUIRED' };
        }
        if(handlers.isActive?.()===false)return {ok:false,error:'SESSION_CLOSED'};
        const result = await handler(args);
        return sessionCommandResult(command, result);
      } catch {
        // Do not expose upstream errors, request URLs, stack traces or secrets.
        return { ok: false, error: 'SESSION_COMMAND_FAILED' };
      }
    }
  });
}
