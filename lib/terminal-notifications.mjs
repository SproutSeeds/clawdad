import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const day = 24 * 60 * 60 * 1000;
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export const notificationStatePath = config => path.join(path.dirname(config.configPath), 'terminal-notifications.json');

// Batch read-only process metadata. Terminal focus and screen output are never
// completion signals, and the phone need not have visited a tab.
export async function discoverTerminalConversations({execute = run, sessionRoot = path.join(os.homedir(), '.codex/sessions')} = {}) {
  const options = {encoding:'utf8', timeout:5000, maxBuffer:8 * 1024 * 1024};
  const {stdout} = await execute('/bin/ps', ['-axo','pid=,tty=,comm='], options);
  const owners = new Map();
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (match && /^ttys?[a-z\d]+$/i.test(match[2]) && path.basename(match[3]) === 'codex') owners.set(match[1], `/dev/${match[2]}`);
  }
  if (!owners.size) return [];
  const result = await execute('/usr/sbin/lsof',['-a','-p',[...owners.keys()].join(','),'-Fn'],options)
    .catch(error => { if (error.code === 1 && typeof error.stdout === 'string') return {stdout:error.stdout}; throw error; });
  const root = await fs.realpath(sessionRoot);
  let tty = '';
  const found = new Map();
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) tty = owners.get(line.slice(1)) || '';
    if (!tty || !line.startsWith('n') || !line.endsWith('.jsonl')) continue;
    try {
      const file = await fs.realpath(line.slice(1));
      if (!file.startsWith(root + path.sep) || !path.basename(file).startsWith('rollout-')) continue;
      const handle = await fs.open(file, 'r');
      let prefix;
      try { const buffer = Buffer.alloc(256 * 1024); const read = await handle.read(buffer,0,buffer.length,0); prefix = buffer.subarray(0,read.bytesRead); }
      finally { await handle.close(); }
      const end = prefix.indexOf(10);
      if (end < 0) continue;
      const record = JSON.parse(prefix.subarray(0,end).toString('utf8'));
      const meta = record.payload;
      if (record.type !== 'session_meta' || meta?.source !== 'cli' || !uuid(meta.id) || !file.endsWith(`${meta.id}.jsonl`) || !path.isAbsolute(meta.cwd || '')) continue;
      found.set(file, {file, tty, sessionId:meta.id, projectPath:meta.cwd, directory:path.basename(meta.cwd) || 'Terminal'});
    } catch { /* Closed processes and replaced files are sampled next time. */ }
  }
  return [...found.values()];
}

export class TerminalNotificationMonitor {
  constructor({statePath, discover = discoverTerminalConversations, deliver, clock = Date.now, intervalMs = 5000}) {
    this.statePath=statePath; this.discover=discover; this.deliver=deliver; this.clock=clock; this.intervalMs=intervalMs;
    this.state=null; this.timer=null; this.pending=null; this.stopped=false;
  }
  async load() {
    if (this.state) return;
    try { this.state=JSON.parse(await fs.readFile(this.statePath,'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.state ||= {version:1, startedAt:this.clock(), files:{}, events:[]};
    if (this.state.version !== 1 || !Array.isArray(this.state.events) || !this.state.files) throw new Error('Notification checkpoint is invalid');
  }
  async save() {
    await fs.mkdir(path.dirname(this.statePath),{recursive:true,mode:0o700});
    const temp=`${this.statePath}.${process.pid}.tmp`;
    await fs.writeFile(temp,JSON.stringify(this.state),{mode:0o600});
    await fs.rename(temp,this.statePath);
    this.saved = true;
  }
  consume(record, file) {
    const payload=record.payload || {};
    if (record.type === 'session_meta') return;
    if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant' && payload.phase === 'final_answer') {
      file.hasAnswer=(payload.content || []).some(block => typeof block.text === 'string' && block.text.trim()); return;
    }
    if (record.type !== 'event_msg') return;
    if (['task_started','user_message','turn_aborted'].includes(payload.type)) { file.hasAnswer=false; return; }
    if (payload.type !== 'task_complete') return;
    const hasAnswer=file.hasAnswer || (typeof payload.last_agent_message === 'string' && payload.last_agent_message.trim());
    file.hasAnswer=false;
    const completedAt=payload.completed_at || record.timestamp;
    // Current Codex lifecycle records use Unix seconds; older records use ISO
    // text. Date.parse(number) treats it as date text and drops real answers.
    const when=typeof completedAt === 'number'
      ? completedAt * (Math.abs(completedAt)<1e12 ? 1000 : 1)
      : Date.parse(completedAt);
    if (!hasAnswer || !Number.isFinite(when) || when < this.state.startedAt || when < this.clock()-day || when > this.clock()+60_000) return;
    const id=crypto.createHash('sha256').update(`${file.sessionId}:${payload.turn_id || completedAt}`).digest('hex');
    if (this.state.events.some(event => event.id === id)) return;
    this.state.events.push({id,sessionId:file.sessionId,directory:file.directory,projectPath:file.projectPath,tty:file.tty,
      completedAt:new Date(when).toISOString(), delivered:false});
  }
  async read(file) {
    const handle=await fs.open(file.file,'r');
    try {
      const stat=await handle.stat();
      const identity=`${stat.dev}:${stat.ino}`;
      if (file.identity !== identity || stat.size < (file.offset || 0)) {
        file.offset=Math.max(0,stat.size - 2*1024*1024); file.partial=''; file.skipFirst=file.offset>0; file.hasAnswer=false; file.identity=identity;
      }
      // Bounded reads keep large tool output from monopolizing the host. The
      // durable cursor advances only after complete records are interpreted.
      const length=Math.min(stat.size-file.offset,2*1024*1024);
      if (length <= 0) return;
      const buffer=Buffer.alloc(length);
      const {bytesRead}=await handle.read(buffer,0,length,file.offset);
      file.offset+=bytesRead;
      const bytes=Buffer.concat([Buffer.from(file.partial || '', 'base64'),buffer.subarray(0,bytesRead)]);
      let begin=0, end;
      while ((end=bytes.indexOf(10,begin)) >= 0) {
        const line=bytes.subarray(begin,end); begin=end+1;
        if (file.skipFirst) { file.skipFirst=false; continue; }
        if (line.length>2*1024*1024) continue;
        try { this.consume(JSON.parse(line.toString('utf8')),file); } catch { /* Incomplete/invalid data is not a completion. */ }
      }
      const partial=bytes.subarray(begin);
      if (partial.length>2*1024*1024) { file.partial=''; file.skipFirst=true; }
      else file.partial=partial.toString('base64');
    } finally { await handle.close(); }
  }
  tick() {
    if (this.stopped) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending=this.sample().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async sample() {
    await this.load();
    const before=JSON.stringify(this.state);
    const discovered=await this.discover().catch(()=>[]);
    for (const value of discovered) {
      const previous=this.state.files[value.file];
      const lastSeenAt=!previous || this.clock()-previous.lastSeenAt>=60_000 ? this.clock() : previous.lastSeenAt;
      this.state.files[value.file]={...previous,...value,lastSeenAt};
    }
    for (const [key,file] of Object.entries(this.state.files)) {
      if (file.lastSeenAt < this.clock()-day) { delete this.state.files[key]; continue; }
      try { await this.read(file); } catch { /* One inaccessible/closed tab cannot stall other alerts. */ }
    }
    this.state.events=this.state.events.filter(event=>Date.parse(event.completedAt)>=this.clock()-30*day).slice(-1000);
    if (!this.saved || before!==JSON.stringify(this.state)) await this.save(); // Persist before delivery, skip unchanged idle scans.
    for (const event of this.state.events.filter(event=>!event.delivered && Date.parse(event.completedAt)>=this.clock()-day && (event.retryAt || 0)<=this.clock()).slice(0,20)) {
      try {
        await this.deliver({id:event.id,sessionId:event.sessionId,directory:event.directory,completedAt:event.completedAt});
        event.delivered=true; delete event.retryAt;
      } catch { event.retryAt=this.clock()+30_000; }
      await this.save();
    }
  }
  start() {
    if (this.timer) return;
    this.stopped=false;
    this.timer=setInterval(()=>{void this.tick().catch(()=>{});},this.intervalMs); this.timer.unref?.();
    void this.tick().catch(()=>{});
  }
  async stop() { this.stopped=true; clearInterval(this.timer); this.timer=null; await this.pending; }
}

export async function resolveTerminalNotification(config, id) {
  if (!/^[a-f\d]{64}$/.test(id || '')) throw new Error('That notification is invalid.');
  const state=JSON.parse(await fs.readFile(notificationStatePath(config),'utf8'));
  const event=state.events.find(event=>event.id===id);
  if (!event) throw new Error('That notification is no longer available on this Mac.');
  return {eventId:event.id,sessionId:event.sessionId,projectPath:event.projectPath,directory:event.directory,completedAt:event.completedAt};
}
