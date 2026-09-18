import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {researchSave} from './research-budget.mjs';
import {CodexSharedClient,validThreadId,rpcPages} from './codex-thread-control.mjs';
import {acquireCodexDeliveryClaim} from './codex-delivery-claim.mjs';

export async function verifyAgentToolConfiguration(client,threadId,policy){
  const servers=await rpcPages(client,'mcpServerStatus/list',{threadId,detail:'full',limit:100});
  const native=servers.find(server=>server.name==='clawdad_assistant');
  const available=!!native&&Object.entries(native.tools||{}).length>0;
  if(available!==policy.nativeTools)throw Error('This thread has not loaded its saved native tool settings. Close other app-server views of this idle thread and retry; no message was sent.');
}

// A persistent MCP process receives a thread-specific handle, never the last
// Assistant's request ID. Each use resolves the currently accepted user turn.
export async function prepareAgentTools({root,threadId,requestId,text,policy,source='manual',accountEpoch,accountReceipt,
  authorizationText=text,authorizationSource='user'}){
  const directory=path.join(root,'AgentTools');let contextId=randomUUID();
  if(threadId){try{contextId=JSON.parse(await fs.readFile(path.join(directory,'threads',threadId+'.json'),'utf8')).contextId;}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(!validThreadId(contextId))throw Error('The saved native tool binding needs repair.');
  const file=path.join(directory,contextId+'.json');
  let record={version:1,contextId,threadId,requestId,text,source,accountEpoch,accountReceipt,authorizationText,authorizationSource,policy,status:'preparing'};
  const persist=async(initial=false)=>{
    const claim=await acquireCodexDeliveryClaim(root,{threadId:contextId,requestId:'native-tool-context'});
    try{
      if(!initial){const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.requestId!==requestId)return false;}
      await researchSave(file,record);return true;
    }finally{await claim.release();}
  };
  await persist(true);
  return {
    contextId,
    config:{
      'mcp_servers.clawdad_assistant.command':process.execPath,
      'mcp_servers.clawdad_assistant.args':[fileURLToPath(new URL('./assistant-mcp.mjs',import.meta.url))],
      'mcp_servers.clawdad_assistant.enabled':policy.nativeTools,
      'mcp_servers.clawdad_assistant.required':policy.nativeTools,
      'mcp_servers.clawdad_assistant.env.CLAWDAD_ASSISTANT_ROOT':path.dirname(root),
      'mcp_servers.clawdad_assistant.env.CLAWDAD_TOOL_CONTEXT_ID':contextId,
      'mcp_servers.clawdad_assistant.env.CLAWDAD_ASSISTANT_REQUEST_ID':'',
    },
    async bind(id,turnId){
      if(!validThreadId(id)||(record.threadId&&record.threadId!==id))throw Error('Native tool thread identity changed.');
      record={...record,threadId:id,...(turnId?{turnId}:{}),status:'active'};
      if(await persist())await researchSave(path.join(directory,'threads',id+'.json'),{contextId});
    },
    async close(){record={...record,status:'closed'};await persist();},
  };
}

export async function readAgentToolOrigin(root,contextId,{createClient=()=>new CodexSharedClient()}={}){
  if(!validThreadId(contextId))throw Error('Use the active native tool connection.');
  const record=JSON.parse(await fs.readFile(path.join(root,'AgentTools',contextId+'.json'),'utf8'));
  if(record.version!==1||record.contextId!==contextId||record.status!=='active'||!validThreadId(record.threadId)||!record.policy?.nativeTools)
    throw Error('This native tool request has no active user turn. Nothing was accepted.');
  const client=createClient();
  try{
    const page=await client.request('thread/turns/list',{threadId:record.threadId,limit:1,itemsView:'full',sortDirection:'desc'});
    const turn=page.data?.[0];
    if(!turn||turn.status!=='inProgress'||(record.turnId&&record.turnId!==turn.id)
      ||!(turn.items||[]).some(i=>i.type==='userMessage'&&(i.clientId===record.requestId||i.clientUserMessageId===record.requestId)))
      throw Error('This tool connection no longer belongs to the accepted user turn. Inspect its saved receipt.');
    return {...record,turnId:turn.id};
  }finally{client.close();}
}
