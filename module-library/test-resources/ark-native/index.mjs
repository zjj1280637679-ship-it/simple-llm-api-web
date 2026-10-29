/** Node loader for ordinary Ark fixtures; no production request-builder or network dependency. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSimulatorCore, DUMMY_KEY, SimulatorError} from '../shared/core.js';
export {DUMMY_KEY, SimulatorError};
export const ARK_BASE_URL='https://ark.cn-beijing.volces.com/api/v3';
export const TEXT_MODEL='sim-ark-text-v1';
// Solely selects the unchanged adapter's dated image capability. Never a live availability claim.
export const IMAGE_MODEL='doubao-seedream-5-0-flash-260915';
const root=new URL('./',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
const data=new Map();
for(const descriptor of manifest.fixtures) {
  const bytes=await readFile(new URL(descriptor.path,root));
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==descriptor.sha256)throw new SimulatorError('SIMULATOR_FIXTURE_INTEGRITY');
  const fixture=JSON.parse(bytes);
  if(fixture.id!==descriptor.id||fixture.version!==descriptor.version)throw new SimulatorError('SIMULATOR_FIXTURE_INTEGRITY');
  data.set(fixture.id,{fixture,hash});
}
for(const descriptor of manifest.assets) {
  const bytes=await readFile(new URL(descriptor.path,root));
  if(createHash('sha256').update(bytes).digest('hex')!==descriptor.sha256)throw new SimulatorError('SIMULATOR_ASSET_INTEGRITY');
}
export const getManifest=()=>structuredClone(manifest);
export const getFixture=id=>structuredClone(data.get(id)?.fixture);
export function createArkSimulator({scenario='text.ok',parameters,clock,scheduler}={}) {
  const scenarioRevision=manifest.scenarios.find(item=>item.id===scenario);
  if(!scenarioRevision)throw new SimulatorError('SIMULATOR_UNSUPPORTED_FEATURE',['scenario']);
  const {fixture,hash}=data.get(scenarioRevision.fixtureId);
  const revision={resourceId:manifest.resourceId,resourceVersion:manifest.resourceVersion,
    scenarioId:scenarioRevision.id,scenarioVersion:scenarioRevision.version,
    fixtureSetVersion:manifest.fixtureSetVersion,fixtureSha256:hash,protocolSnapshot:manifest.protocolSnapshot};
  return createSimulatorCore({fixture,revision,parameters,clock,scheduler});
}
export function simulatorConfig(model=TEXT_MODEL) {
  return {protocol:'ark',url:ARK_BASE_URL,trustedTarget:ARK_BASE_URL,key:DUMMY_KEY,model};
}
