import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
import {assertSharedThreadOwner} from './codex-thread-control.mjs';

const exec=promisify(execFile);

// Codex creates a transcript lazily on the first turn. A fresh thread may be
// admitted only when the live shared server owns that exact ID and project.
export async function liveCodexProjectBinding(client,sessionId,projectPath,readOwners){
  try{
    const owner=await assertSharedThreadOwner(client,sessionId,readOwners);
    if(owner.kind!=='app_server')return null;
    const {thread}=await client.request('thread/read',{threadId:sessionId,includeTurns:false});
    if(thread?.id!==sessionId||!thread.cwd||path.resolve(thread.cwd)!==path.resolve(projectPath)
      ||!['cli','vscode'].includes(thread.source))return null;
    return {ok:true,reason:'',filePath:thread.path||null,cwd:thread.cwd,source:thread.source,live:true};
  }catch{return null;}
}

// Subscription profiles keep transcripts in their own CODEX_HOME while sharing
// the canonical SQLite index. Follow the exact indexed ID, then verify the
// transcript's identity before exposing its contents or validating dispatch.
export async function indexedCodexTranscriptPath(home,sessionId){
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>160)return '';
  try{
    const database=path.join(home,'state_5.sqlite');
    if(!(await stat(database)).isFile())return '';
    const sql="SELECT rollout_path AS path FROM threads WHERE id='"+sessionId.replaceAll("'","''")+"' AND archived=0 LIMIT 1";
    const binary=process.env.CLAWDAD_SQLITE3_PATH||(process.platform==='darwin'?'/usr/bin/sqlite3':'sqlite3');
    const {stdout}=await exec(binary,['-readonly','-json',database,sql],{timeout:2000,maxBuffer:16384});
    const file=JSON.parse(stdout||'[]')[0]?.path;
    if(typeof file!=='string'||!path.isAbsolute(file)||!file.endsWith('.jsonl'))return '';
    const stream=createReadStream(file,{encoding:'utf8'}),lines=readline.createInterface({input:stream,crlfDelay:Infinity});
    try{for await(const line of lines){if(!line.trim())continue;const first=JSON.parse(line);
      return first.type==='session_meta'&&first.payload?.id===sessionId?file:'';
    }}finally{lines.close();stream.destroy();}
  }catch{}
  return '';
}
