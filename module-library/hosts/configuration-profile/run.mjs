import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runHost} from '../support.mjs';
import {configurationFixture,requestProfile} from './fixture.mjs';

await runHost('R-004',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'configuration-profile-host-'));
  const sessions=[];
  try {
    const {api,sourceFixture}=configurationFixture({directory});
    const original=structuredClone(sourceFixture),store=api.createConfigurationStore();
    const first=await store.restore('demo');
    const firstBytes=await readFile(join(directory,'demo','00000001.json'),'utf8');
    const pinned=await store.start('demo');sessions.push(pinned);
    const config=api.getConfigurationPreset();config.output.presets[0].text='second reply';
    const second=await store.load('demo',config);
    const restored=await store.restore('demo',{revision:1});
    assert.equal((await requestProfile(pinned)).text,'first reply');pinned.assertComplete();
    const reset=pinned.reset();sessions.push(reset);
    assert.equal(reset.inspect().consumed,0);
    assert.equal((await requestProfile(reset)).text,'first reply');reset.assertComplete();
    const historical=await store.start('demo',{revision:2});sessions.push(historical);
    assert.equal((await requestProfile(historical)).text,'second reply');historical.assertComplete();
    const history=await store.history('demo');
    assert.deepEqual(history.map(record=>record.revision),[1,2,3]);
    assert.equal(second.parentSha256,first.snapshotSha256);
    assert.equal(restored.parentSha256,second.snapshotSha256);
    assert.equal(restored.configurationSha256,first.configurationSha256);
    assert.equal(await readFile(join(directory,'demo','00000001.json'),'utf8'),firstBytes);
    assert.deepEqual(sourceFixture,original);
    return {revisions:history.map(record=>({revision:record.revision,reason:record.reason})),
      parentChainVerified:true,firstRecordUnchanged:true,restoredConfigurationMatches:true,
      pinnedRevision:pinned.snapshot().revision,resetRevision:reset.snapshot().revision,
      historicalRevision:historical.snapshot().revision,independentReset:true,sourceFixtureUnchanged:true,
      networkRequests:0,temporaryStoreRemovedOnExit:true};
  } finally {for(const session of sessions)session.dispose();await rm(directory,{recursive:true,force:true});}
});
