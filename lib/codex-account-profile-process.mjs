import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Authentication has a separate, deterministic transport. This class cannot
// start a turn, resume history, provide API credentials, or stop another owner.
const methods=new Set(['initialize','config/read','account/read','account/rateLimits/read',
  'account/login/start','account/login/cancel']);
const failure=()=>Error('The separate Codex sign-in connection ended. Check the saved authorization before trying a new sign-in.');

export async function privateAccountDirectory(directory) {
  if(!path.isAbsolute(directory)||path.normalize(directory)!==directory)throw Error('Use an absolute account profile directory.');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(directory)!==directory
    ||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('The account profile needs private, local directory ownership.');
}

export class CodexAccountProfileProcess {
  constructor({home,binary,launch=spawn,timeoutMs=30_000}={}) {
    Object.assign(this,{home,binary,launch,timeoutMs});this.pending=new Map();this.listeners=new Set();this.next=0;this.closed=false;
  }
  async connect() {
    await privateAccountDirectory(this.home);
    if(this.closed)throw failure();
    // Deliberately omit inherited API keys, access tokens, alternate providers,
    // CODEX_HOME and SQLite overrides. The CLI owns all credential handling.
    const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','TMPDIR','LANG']
      .filter(name=>process.env[name]).map(name=>[name,process.env[name]]));
    env.CODEX_HOME=this.home;
    this.child=this.launch(this.binary,['app-server','--stdio','-c','cli_auth_credentials_store="keyring"'],
      {cwd:this.home,env,stdio:['pipe','pipe','ignore']});
    const child=this.child;this.lines=createInterface({input:child.stdout});let bytes=0;
    child.stdout.on('data',buffer=>{bytes+=buffer.length;if(bytes>4*1024*1024)this.close();});
    child.on('error',()=>this.disconnected());child.on('exit',()=>this.disconnected());
    child.stdin.on('error',()=>this.disconnected());
    this.lines.on('line',line=>{
      try {
        const message=JSON.parse(line),pending=this.pending.get(message.id);
        if(pending){this.pending.delete(message.id);clearTimeout(pending.timer);
          message.error?pending.reject(failure()):pending.resolve(message.result);}
        else if(message.id!=null&&message.method)child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Account-only connection'}})+'\n');
        else for(const listener of this.listeners)listener(message);
      }catch{this.disconnected();}
    });
    try {
      this.info=await this.request('initialize',{clientInfo:{name:'clawdad_account_connection',version:'1'}});
      child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
      const config=await this.request('config/read',{cwd:this.home,includeLayers:false});
      if(config.config?.cli_auth_credentials_store!=='keyring')throw Error('Codex could not use the required Keychain storage.');
      await this.verifyStorage();return this;
    }catch(error){this.close();throw error;}
  }
  request(method,params={}) {
    if(!methods.has(method)||this.closed||!this.child)return Promise.reject(failure());
    return new Promise((resolve,reject)=>{
      const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(failure());},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  async verifyStorage() {
    // Metadata only. A file fallback violates the selected storage policy.
    const present=await fs.lstat(path.join(this.home,'auth.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    if(present)throw Error('The separate authorization did not remain in Keychain. Review the profile before using it.');
  }
  disconnected(){
    if(this.closed)return;this.closed=true;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(failure());}this.pending.clear();
    for(const listener of this.listeners)listener({method:'clawdad/accountConnectionClosed'});
  }
  close(){this.disconnected();this.lines?.close();this.child?.stdin.end();this.child?.kill();}
}

export async function openCodexSignIn({url}) {
  if(process.platform!=='darwin')throw Error('Complete Codex sign-in on the connected Mac.');
  const target=new URL(url);
  if(target.protocol!=='https:'||!['auth.openai.com','auth.chatgpt.com','chatgpt.com'].includes(target.hostname))throw Error('Codex returned an unsupported sign-in address.');
  await new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/open',[target.href],{stdio:'ignore'});
    child.on('error',()=>reject(Error('The Mac could not open the Codex sign-in page.')));
    child.on('exit',code=>code===0?resolve():reject(Error('The Mac could not open the Codex sign-in page.')));
  });
}
