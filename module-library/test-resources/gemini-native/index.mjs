/** Node convenience loader; browser users inject the same frozen JSON into core.js. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSimulatorCore, DUMMY_KEY, SimulatorError } from './core.js';
export { DUMMY_KEY, SimulatorError };
const root=new URL('./',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
const data=new Map();
for(const descriptor of manifest.fixtures) {
  const bytes=await readFile(new URL(descriptor.path,root));
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==descriptor.sha256) throw new SimulatorError('SIMULATOR_FIXTURE_INTEGRITY');
  const fixture=JSON.parse(bytes);
  if(fixture.id!==descriptor.id || fixture.version!==descriptor.version) throw new SimulatorError('SIMULATOR_FIXTURE_INTEGRITY');
  data.set(fixture.id,{fixture,hash});
}
export const getManifest=()=>structuredClone(manifest);
export const getFixture=id=>structuredClone(data.get(id)?.fixture);
export function createGeminiSimulator({scenario='text.ok',parameters,clock,scheduler}={}) {
  const scenarioRevision=manifest.scenarios.find(item=>item.id===scenario);
  if(!scenarioRevision) throw new SimulatorError('SIMULATOR_UNSUPPORTED_FEATURE',['scenario']);
  const {fixture,hash}=data.get(scenarioRevision.fixtureId);
  const revision={resourceId:manifest.resourceId,resourceVersion:manifest.resourceVersion,
    scenarioId:scenarioRevision.id,scenarioVersion:scenarioRevision.version,
    fixtureSetVersion:manifest.fixtureSetVersion,fixtureSha256:hash,protocolSnapshot:manifest.protocolSnapshot};
  return createSimulatorCore({fixture,revision,parameters,clock,scheduler});
}
export function simulatorConfig(model='sim-gemini-text-v1') {
  return {protocol:'gemini',url:'https://generativelanguage.googleapis.com/v1beta',
    trustedTarget:'https://generativelanguage.googleapis.com/v1beta',key:DUMMY_KEY,model};
}
