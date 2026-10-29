/** Pure closed-fixture binding and exact normalized-request comparison; no I/O or state. */
export const DUMMY_KEY = 'SIMULATOR_ONLY_NOT_A_REAL_KEY';
export class SimulatorError extends Error {
  constructor(code, fields = []) {
    super(`${code}${fields.length ? ': ' + fields.join(', ') : ''}`);
    this.name = 'SimulatorError'; this.code = code;
    // Do not echo request values, credentials, prompt text, or supplied URLs.
    this.diff = fields.map(field => ({field, expected:'fixture contract', actual:'[REDACTED mismatch]'}));
  }
}
const equal = (a,b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a).sort(), other = Object.keys(b).sort();
  return keys.length === other.length && keys.every((key,i)=>key===other[i] && equal(a[key],b[key]));
};
function bind(value, parameters) {
  if (value && typeof value === 'object') {
    if (Object.keys(value).length===1 && Object.hasOwn(value,'$parameter')) return parameters[value.$parameter];
    return Array.isArray(value) ? value.map(item=>bind(item,parameters))
      : Object.fromEntries(Object.entries(value).map(([key,item])=>[key,bind(item,parameters)]));
  }
  return value;
}
/** JSON fixture input; supplied/default parameter values must be nonempty strings. */
export function bindFixtureSteps(fixture, parameters = {}) {
  if (!fixture?.steps?.length) throw new SimulatorError('SIMULATOR_CONFIGURATION');
  const values={};
  for (const [name,rule] of Object.entries(fixture.parameters || {})) {
    values[name]=Object.hasOwn(parameters,name)?parameters[name]:rule.default;
    if (rule.type!=='string' || typeof values[name]!=='string' || !values[name].trim())
      throw new SimulatorError('SIMULATOR_CONFIGURATION',['parameters.'+name]);
  }
  if (Object.keys(parameters).some(name=>!Object.hasOwn(values,name))) throw new SimulatorError('SIMULATOR_CONFIGURATION',['parameters']);
  return bind(fixture.steps,values);
}

export function assertFixtureRequest(actual, expected) {
  const fields=[];
  if (actual.method!==expected.method) fields.push('method');
  // Exact origin/path/query: unknown routes and query credentials never fall back to fetch.
  if (actual.url!==expected.url) fields.push('url');
  const headers=Object.fromEntries(actual.headers.entries());
  if (!equal(headers,expected.headers)) fields.push('headers');
  if (!equal(actual.body,expected.body)) fields.push('body');
  if (fields.length) throw new SimulatorError('SIMULATOR_REQUEST_MISMATCH',fields);
}
