import test from 'node:test';
import assert from 'node:assert/strict';
import {serverRuntimeRoots} from '../lib/server-runtime-roots.mjs';
test('separate CLI home isolates both account receipts and Assistant jobs from the desktop app',()=>{
  const options={home:'/user',env:{CLAWDAD_HOME:'/fixture/server-home'}};
  assert.deepEqual(serverRuntimeRoots(options),{accounts:'/fixture/server-home/native/Accounts',assistant:'/fixture/server-home/native/Assistant'});
});
test('native launches and ordinary default CLI home preserve canonical stored state',()=>{
  for(const env of [{},{CLAWDAD_HOME:'/user/.clawdad'},{CLAWDAD_HOME:'/native/server',CLAWDAD_NATIVE_RUNTIME_VERSION:'fixture'}])
    assert.deepEqual(serverRuntimeRoots({home:'/user',env}),{accounts:'/user/Library/Application Support/ClawDad/Accounts',assistant:'/user/Library/Application Support/ClawDad/Assistant'});
});
