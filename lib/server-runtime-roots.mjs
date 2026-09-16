import os from 'node:os';
import path from 'node:path';
import {realpathSync} from 'node:fs';

function canonical(directory) {
  const suffix=[];let cursor=directory;
  for(;;){
    try{return path.join(realpathSync(cursor),...suffix);}
    catch(error){if(error.code!=='ENOENT')throw error;suffix.unshift(path.basename(cursor));cursor=path.dirname(cursor);}
  }
}

// A server started with a separate CLI home must not read or write the desktop
// app's jobs, account journal or retained sign-ins. Native launches deliberately
// retain their established canonical paths (including during app upgrades).
export function serverRuntimeRoots({env=process.env,home=os.homedir()}={}) {
  const custom=env.CLAWDAD_HOME?.trim();
  const isolated=custom&&!env.CLAWDAD_NATIVE_RUNTIME_VERSION
    &&path.resolve(custom)!==path.join(home,'.clawdad');
  const root=isolated?path.join(canonical(path.resolve(custom)),'native'):path.join(home,'Library/Application Support/ClawDad');
  return {assistant:path.join(root,'Assistant'),accounts:path.join(root,'Accounts')};
}
