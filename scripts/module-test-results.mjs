// Local test evidence format 1.0.0; created 2026-10-29T09:01:00.000Z; updated 2026-10-29T09:10:00.000Z.
// Pure normalization and coverage policy; the default export is a Node test reporter.
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

export const RESULT_SCHEMA = 1;
const outcomes = ['pass','fail','cancelled','skipped','todo'];
const counts = () => ({tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0,suites:0});
const hash = value => createHash('sha256').update(value).digest('hex');
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const marked = value => value !== undefined && value !== false;
const eventKey = data => JSON.stringify([data.file,data.name,data.line,data.column,data.nesting]);

// stdout from tests is a test:stdout event, not reporter output. Never parse TAP
// text or trust console.log('# pass ...'). Require source positions below: early
// Node 20 used child stdout TAP internally and lacks these structured positions.
export default async function* report(source) {
  yield JSON.stringify({event:'begin',schemaVersion:RESULT_SCHEMA})+'\n';
  for await (const {type,data} of source) {
    if (!['test:start','test:pass','test:fail'].includes(type)) continue;
    yield JSON.stringify({event:type.slice(5),data:{name:data.name,file:data.file,entryFile:data.entryFile,
      line:data.line,column:data.column,nesting:data.nesting,kind:data.details?.type,
      skip:data.skip,todo:data.todo,failureType:data.details?.error?.failureType}})+'\n';
  }
  yield JSON.stringify({event:'end',schemaVersion:RESULT_SCHEMA})+'\n';
}

export function normalizeTestRun(output, {file,root,exitCode}) {
  const events = output.trim().split('\n').map(line=>JSON.parse(line));
  if (events[0]?.event !== 'begin' || events[0]?.schemaVersion !== RESULT_SCHEMA ||
      events.at(-1)?.event !== 'end' || events.at(-1)?.schemaVersion !== RESULT_SCHEMA)
    throw Error('Incomplete structured test stream: '+file);
  const stats = counts(), pending = new Map();
  let suiteFailures = 0, wrappers = 0;
  for (const {event,data} of events.slice(1,-1)) {
    if (!['start','pass','fail'].includes(event) || !data || typeof data.name !== 'string' ||
        typeof data.file !== 'string' || !Number.isInteger(data.line) || data.line < 1 ||
        !Number.isInteger(data.column) || data.column < 1 || !Number.isInteger(data.nesting) || data.nesting < 0)
      throw Error('Invalid structured test event: '+file);
    const key = eventKey(data);
    if (event === 'start') { pending.set(key,(pending.get(key)||0)+1); continue; }
    if (!pending.get(key)) throw Error('Test result without start: '+file);
    pending.set(key,pending.get(key)-1);
    // Node counts an empty entry file as a passing test. It is process execution,
    // not a declared test case. Do not accept it as nonempty test coverage.
    const wrapper = !data.entryFile && resolve(root,data.name) === resolve(root,file) &&
      data.file === resolve(root,file) && data.nesting === 0;
    if (wrapper) {
      wrappers++;
      if (event === 'fail' || marked(data.skip) || marked(data.todo)) suiteFailures++;
      continue;
    }
    const origin = relative(root,resolve(root,data.file));
    if (!origin || origin === '..' || origin.startsWith('..'+sep)) throw Error('Test origin outside repository');
    const outcome = marked(data.skip) ? 'skipped' : marked(data.todo) ? 'todo' :
      event === 'pass' ? 'pass' : ['cancelledByParent','testAborted','testTimeoutFailure'].includes(data.failureType) ? 'cancelled' : 'fail';
    if (data.kind === 'suite') {
      stats.suites++;
      if (outcome !== 'pass') suiteFailures++;
    } else {
      stats.tests++; stats[outcome]++;
    }
  }
  const completed = [...pending.values()].every(value=>value===0);
  const result = {file,completed,exitCode,stats,suiteFailures,wrappers,outputSha256:hash(output)};
  return {...result,status:fileResultPasses(result) ? 'PASS' : 'FAIL'};
}

export function fileResultPasses(result) {
  const stats = result?.stats;
  return result?.completed === true && result.exitCode === 0 && result.suiteFailures === 0 &&
    result.wrappers === 0 && sha256(result.outputSha256) &&
    stats && Object.keys(counts()).every(key=>Number.isSafeInteger(stats[key]) && stats[key]>=0) &&
    stats.tests > 0 && stats.pass === stats.tests && outcomes.slice(1).every(key=>stats[key]===0);
}

export const testCommands = modules => requiredTestFiles(modules).map(file=>
  ['--test','--test-reporter=./scripts/module-test-results.mjs',file]);
export function summarizeTestResults(results) {
  const stats = counts();
  for (const result of results) for (const key of Object.keys(stats)) stats[key]+=result.stats[key];
  return stats;
}

export function requiredTestFiles(modules) {
  return [...new Set(modules.flatMap(module=>module.tests))].sort();
}

// Optional tests outside module.tests do not affect mandatory coverage. A shared
// required file belongs to each declaring module; this is file-level, not case-
// level, ownership and never claims the file tests only that module.
export function testCoverage(modules, results) {
  const required = requiredTestFiles(modules);
  const files = required.map(file=>{
    const matches = results.filter(result=>result.file===file);
    return {file,moduleIds:modules.filter(module=>module.tests.includes(file)).map(module=>module.id),
      status:matches.length===1 && matches[0].status==='PASS' && fileResultPasses(matches[0]) ? 'PASS' : 'FAIL'};
  });
  return {files,modules:modules.map(module=>({id:module.id,version:module.version,
    files:[...new Set(module.tests)].sort(),status:module.tests.length && module.tests.every(file=>
      files.find(result=>result.file===file)?.status==='PASS') ? 'PASS' : 'FAIL'}))};
}

export function bindTestResults(modules, results, hashes) {
  const coverage = testCoverage(modules,results);
  return {schemaVersion:RESULT_SCHEMA,runner:'node:test',files:coverage.files.map(binding=>({
    ...binding,sourceSha256:hashes[binding.file],result:results.find(result=>result.file===binding.file)
  })),modules:coverage.modules};
}
export const testResultsDigest = results => hash(JSON.stringify(results));

export function testResultsMatch(record, modules, hashes) {
  const evidence = record?.testResults;
  if (evidence?.schemaVersion !== RESULT_SCHEMA || evidence.runner !== 'node:test' ||
      !Array.isArray(evidence.files) || evidence.files.some(file=>!file || typeof file !== 'object') ||
      !Array.isArray(evidence.modules) ||
      record.testResultsSha256 !== testResultsDigest(evidence)) return false;
  const results = evidence.files.map(file=>file.result || {});
  const expected = bindTestResults(modules,results,hashes);
  return expected.files.length > 0 && expected.files.every(file=>file.status==='PASS' && sha256(file.sourceSha256)) &&
    expected.modules.every(module=>module.status==='PASS') && JSON.stringify(evidence)===JSON.stringify(expected) &&
    JSON.stringify(record.stats)===JSON.stringify(summarizeTestResults(results)) &&
    JSON.stringify(record.commands)===JSON.stringify(testCommands(modules));
}
