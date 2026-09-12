import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function readHostNotificationIdentity(configPath) {
  try {
    let file=configPath||process.env.CLAWDAD_CLOUD_CONFIG_FILE||path.join(os.homedir(),'.clawdad/cloud.json');
    if(file.startsWith('~/'))file=path.join(os.homedir(),file.slice(2));
    const config=JSON.parse(await fs.readFile(file,'utf8'));
    const identity={accountId:process.env.CLAWDAD_CLOUD_ACCOUNT_ID||config.accountId,
      workspaceId:process.env.CLAWDAD_CLOUD_WORKSPACE_ID||config.workspaceId,
      hostId:process.env.CLAWDAD_CLOUD_HOST_ID||config.hostId||os.hostname()};
    return Object.values(identity).every(v=>typeof v==='string'&&v.trim()&&v.length<=160&&!/[\x00-\x1f]/.test(v))?identity:null;
  } catch { return null; }
}

// A failure in one notification source must not starve the others. Each source
// retains its durable event until the existing relay acknowledges acceptance.
export async function deliverNotificationOutboxes({local, relay, hostName}) {
  for(const route of ['/v1/codex/weekly-usage','/v1/assistant/research','/v1/assistant/notifications']) {
    try {
      const {events=[]}=await local(route+'/outbox');
      for(const event of events) {
        const result=await relay({...event,hostName});
        if(result.accepted)await local(route+'/delivered',{method:'POST',body:JSON.stringify({id:event.id})});
      }
    } catch { /* Keep the original IDs for the next bounded delivery pass. */ }
  }
}
