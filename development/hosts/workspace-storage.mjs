import assert from 'node:assert/strict';
import {createWorkspaceStorage} from '../../src/workspace-storage.js';
import {report} from './report.mjs';
await report('workspace-storage',async()=>{
  let resolve,writes=0,restored=0;const store={load:()=>new Promise(r=>resolve=r),schedule:()=>writes++,close(){}};const host=createWorkspaceStorage({store,capture:()=>({}),restore:()=>restored++});const pending=host.initialize();host.save(true);assert.equal(writes,0);resolve({draft:'saved'});await pending;host.save(true);assert.equal(restored,1);assert.equal(writes,1);host.dispose();return {hydrationBeforeWrites:true};
});
