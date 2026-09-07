import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const assistantRoot = () => path.join(os.homedir(), 'Library/Application Support/ClawDad/Assistant');
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const active = new Set(['queued', 'running', 'submitted', 'working']);
const mutating = new Set(['start', 'message', 'terminal.send', 'terminal.focus', 'terminal.move', 'terminal.close', 'terminal.close.resolve', 'computer.input', 'computer.open']);
const nativeActions = new Set([...mutating, 'terminal.inspect', 'computer.inspect', 'computer.capture']);
const publicActions = new Set(['state', 'start', 'message', 'terminal.focus', 'cancel', 'pause']);

function requireText(value, name, max = 32_000) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) throw new Error(`Invalid ${name}`);
  return value;
}

export class AssistantRuntime {
  constructor({ root = assistantRoot(), clock = Date.now } = {}) {
    this.root = root; this.clock = clock; this.state = null; this.lock = Promise.resolve();
    this.nativeSeen = 0; this.observation = null; this.followers = new Map();
    this.ephemeralResults = new Map(); this.finalMessages = new Map(); this.turns = new Map();
  }
  async transaction(fn) {
    const pending = this.lock.then(async () => { await this.load(); return fn(); });
    this.lock = pending.catch(() => {}); return pending;
  }
  async load() {
    if (this.state) return;
    await fs.mkdir(this.root, {recursive:true, mode:0o700});
    try { this.state = JSON.parse(await fs.readFile(path.join(this.root, 'state.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.state ||= {version:1, enabled:false, messages:[], jobs:[], coordinator:null, paused:false};
    if (this.state.version !== 1 || !Array.isArray(this.state.jobs) || !Array.isArray(this.state.messages)) throw new Error('Assistant state needs repair');
    for (const job of this.state.jobs) if (job.status === 'running') {
      job.status = 'attention'; job.error = 'The Mac restarted during delivery. Check the destination before retrying.';
    }
  }
  async save() {
    this.state.updatedAt = now();
    const temp = path.join(this.root, `.state-${uuid()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(this.state), {mode:0o600});
    await fs.rename(temp, path.join(this.root, 'state.json'));
  }
  snapshot() {
    return {version:1, enabled:this.state.enabled, paused:this.state.paused,
      nativeOnline:this.nativeSeen > 0 && this.clock()-this.nativeSeen < 45_000, coordinator:this.state.coordinator,
      catalog:this.observation?.catalog || null, messages:this.state.messages.slice(-40).map(m=>({...m,text:m.text.slice(0,8000)})),
      tasks:this.state.jobs.filter(j => mutating.has(j.action)).slice(-20).map(({fingerprint,result,...job})=>({...job,response:job.response?.slice(0,8000)})), updatedAt:this.state.updatedAt};
  }
  async command(request, {tool = false} = {}) {
    return this.transaction(async () => {
      const {action, requestId, ...args} = request || {};
      if (!(tool ? new Set([...nativeActions, 'state', 'cancel', 'pause']) : publicActions).has(action)) throw new Error('Unsupported Assistant action');
      if (action === 'state') { await this.refreshTranscripts(); return this.snapshot(); }
      requireText(requestId, 'request ID', 128);
      if (action === 'cancel') {
        const job = this.state.jobs.find(j => j.id === args.jobId);
        if (job?.status === 'queued') job.status = 'cancelled';
        else if (job && active.has(job.status)) throw new Error('That task has already reached Terminal. Ask the assistant to interrupt the intended tab.');
        await this.save(); return this.snapshot();
      }
      if (action === 'pause') { this.state.paused = args.paused !== false; await this.save(); return this.snapshot(); }
      if (action === 'message' || action === 'terminal.send') {
        requireText(args.text, 'message', 16 * 1024);
        if (args.text.includes('\0')) throw new Error('Invalid message');
      }
      if (action.startsWith('terminal.')) requireText(args.tabId, 'Terminal tab', 128);
      if (action === 'terminal.send' && args.tabId === this.state.coordinator?.tabId) throw new Error('Use the conversation to address the Assistant; task tools target project tabs.');
      const fingerprint = JSON.stringify({action, args});
      const previous = this.state.jobs.find(j => j.id === requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('This request ID already belongs to a different action');
        return {job:previous, ...this.snapshot()};
      }
      if (this.state.jobs.filter(j => active.has(j.status)).length >= 64) throw new Error('The Assistant queue is full');
      if (action === 'start') this.state.enabled = true;
      if (action !== 'start' && !this.state.enabled) throw new Error('Start the Assistant first');
      const job = {id:requestId, action, args, fingerprint, status:'queued', createdAt:now(), source:tool?'assistant':'user'};
      this.state.jobs.push(job);
      if (action === 'message') this.state.messages.push({id:requestId, role:'user', text:args.text, createdAt:job.createdAt});
      await this.save(); return {job, ...this.snapshot()};
    });
  }
  async nativePoll(observation = {}) {
    return this.transaction(async () => {
      this.nativeSeen = this.clock(); this.observation = observation;
      for (const job of this.state.jobs) if (job.status === 'running' && job.workerId && observation.workerId && job.workerId !== observation.workerId) {
        job.status='attention';job.error='The Mac control worker restarted during delivery. Inspect this task before retrying.';
      }
      if (observation.coordinator) this.state.coordinator = observation.coordinator;
      await this.refreshTranscripts();
      if (this.state.paused || this.state.jobs.some(j => j.status === 'running')) return {job:null};
      const route = j => j.action === 'message' ? 'coordinator' : `${j.action}:${j.args.tabId || ''}`;
      const job = this.state.jobs.find((j,index) => j.status === 'queued' && (!j.retryAt || j.retryAt <= this.clock()) &&
        !this.state.jobs.slice(0,index).some(earlier => active.has(earlier.status) && route(earlier) === route(j)));
      if (!job) return {job:null};
      job.status = 'running'; job.startedAt = now(); job.workerId=observation.workerId; await this.save();
      return {job:{...job, coordinator:this.state.coordinator}};
    });
  }
  async nativePrepare({id, conversationPath, sessionId, tabTitle}) {
    return this.transaction(async () => {
      const job=this.state.jobs.find(j=>j.id===id && j.status==='running');
      if (!job || !['message','terminal.send'].includes(job.action)) throw new Error('Delivery is no longer pending');
      job.conversationPath=requireText(conversationPath,'conversation path',4096);
      job.sessionId=requireText(sessionId,'session ID',128);job.tabTitle=tabTitle;
      job.preparedAt=now();await this.save();return {ok:true};
    });
  }
  async nativeResult({id, result, error, deferred = false}) {
    return this.transaction(async () => {
      const job = this.state.jobs.find(j => j.id === id);
      // The CLI can accept and even finish the turn before the native receipt
      // arrives. Its observed state takes precedence over an input acknowledgement.
      if (!job || !['running','working'].includes(job.status)) return {ok:true};
      if (job.status==='working' && (error || deferred)) return {ok:true};
      if (deferred) {
        job.status = 'queued'; job.retryAt = this.clock()+2000; job.error = error || 'Waiting for the agent';
      } else if (error) { job.status = 'attention'; job.error = String(error).slice(0,1024); }
      else {
        if (result?.imageBase64) {
          this.ephemeralResults.set(id,{result,at:this.clock()});
          while (this.ephemeralResults.size>8) this.ephemeralResults.delete(this.ephemeralResults.keys().next().value);
          const {imageBase64,...metadata}=result;job.result={...metadata,imageAvailable:true};
        } else job.result = result || {};
        job.error = null;
        job.status = ['message', 'terminal.send'].includes(job.action) ? (job.status==='working'?'working':'submitted') : 'completed';
        job.deliveredAt = now();
        if (job.status==='completed') job.completedAt=now();
        if (result?.coordinator) this.state.coordinator = result.coordinator;
        if (result?.conversationPath) job.conversationPath = result.conversationPath;
        if (result?.sessionId) job.sessionId = result.sessionId;
        if (result?.tabTitle) job.tabTitle = result.tabTitle;
      }
      await this.save(); return {ok:true};
    });
  }
  async job(id) { return this.transaction(() => {
    const job=this.state.jobs.find(j => j.id === id);if(!job)return null;
    const ephemeral=this.ephemeralResults.get(id);
    return {...job,...(ephemeral && this.clock()-ephemeral.at<120_000?{result:ephemeral.result}:{})};
  }); }
  async refreshTranscripts() {
    const watches = new Map();
    const coordinator = this.state.coordinator;
    if (coordinator?.conversationPath) watches.set(coordinator.conversationPath, {coordinator:true});
    for (const job of this.state.jobs) if (job.conversationPath && active.has(job.status)) watches.set(job.conversationPath, {coordinator:job.action === 'message'});
    let changed = false;
    for (const [file, target] of watches) {
      let root,real;try{root=(await fs.realpath(path.join(os.homedir(),'.codex/sessions')))+path.sep;real=await fs.realpath(file);}catch{continue;}
      if (!real.startsWith(root) || !path.basename(real).startsWith('rollout-') || !real.endsWith('.jsonl')) continue;
      const handle = await fs.open(real, 'r');
      try {
        const stat = await handle.stat();
        let follower = this.followers.get(real);
        if (!follower || follower.inode !== stat.ino || follower.offset > stat.size) {
          follower = {offset:Math.max(0,stat.size-8*1024*1024), partial:'', inode:stat.ino, skip:stat.size>8*1024*1024};
          this.followers.set(real, follower);
        }
        const amount = Math.min(stat.size-follower.offset, 8*1024*1024);
        if (!amount) continue;
        const data = Buffer.alloc(amount); const {bytesRead} = await handle.read(data,0,amount,follower.offset);
        follower.offset += bytesRead;
        const lines = (follower.partial + data.subarray(0,bytesRead).toString('utf8')).split('\n');
        follower.partial = lines.pop();
        if (follower.partial.length > 2*1024*1024) { follower.partial=''; follower.skip=true; }
        for (const line of lines) {
          if (follower.skip) { follower.skip=false; continue; }
          if (line.length > 2*1024*1024) continue;
          let record; try { record=JSON.parse(line); } catch { continue; }
          changed = this.consumeRecord(record, file, target) || changed;
        }
      } finally { await handle.close(); }
    }
    for (const job of this.state.jobs) if (job.status==='submitted' && job.deliveredAt && this.clock()-Date.parse(job.deliveredAt)>45_000) {
      job.status='attention';job.error='Terminal received the input event, but the agent has not confirmed the prompt. Inspect that tab before sending it again.';changed=true;
    }
    if (changed) await this.save();
  }
  consumeRecord(record, file, {coordinator}) {
    const p = record.payload || {}; const timestamp = record.timestamp || now();
    if (record.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && p.phase === 'final_answer') {
      this.finalMessages.set(file,(p.content||[]).map(c=>c.text||'').join('\n\n'));return false;
    }
    const jobs = this.state.jobs.filter(j => j.conversationPath === file && active.has(j.status) && timestamp >= (j.preparedAt || j.startedAt));
    const texts=record.type==='response_item' && p.type==='message' && p.role==='user'
      ? (p.content||[]).filter(c=>c.type==='input_text').map(c=>c.text)
      : record.type==='event_msg' && p.type==='user_message' ? [p.message] : [];
    if (texts.length) {
      const normalized=value=>String(value||'').replace(/\r\n/g,'\n').trim();
      const job=jobs.find(j=>['running','submitted'].includes(j.status) && texts.some(text=>normalized(text)===normalized(j.args.text)));
      if (job) {
        job.status='working';job.acceptedAt=timestamp;
        const turn=this.turns.get(file);
        if(turn?.timestamp >= (job.preparedAt || job.startedAt))job.turnId=turn.id;
      }
      return Boolean(job);
    }
    if (record.type !== 'event_msg') return false;
    if (p.type === 'task_started') {
      this.finalMessages.delete(file);this.turns.set(file,{id:p.turn_id,timestamp});
      for(const job of jobs)if(job.status==='working'&&!job.turnId)job.turnId=p.turn_id;
      return jobs.some(j=>j.status==='working');
    }
    if (!['task_complete','turn_aborted'].includes(p.type)) return false;
    const text = typeof p.last_agent_message === 'string' && p.last_agent_message ? p.last_agent_message : this.finalMessages.get(file) || '';
    const id = `${coordinator?'assistant':'task'}:${p.turn_id || timestamp}:${crypto.createHash('sha256').update(file).digest('hex').slice(0,12)}`;
    if (coordinator && text && !this.state.messages.some(m => m.id === id)) {
      this.state.messages.push({id, role:'assistant', text:text.slice(0,100_000), createdAt:timestamp});
    }
    for (const job of jobs.filter(j => j.status === 'working' && (!j.turnId || !p.turn_id || j.turnId===p.turn_id))) {
      job.status=p.type === 'turn_aborted'?'interrupted':'completed'; job.completedAt=timestamp; job.response=text.slice(0,100_000);
      if (job.action === 'terminal.send' && !this.state.jobs.some(j=>j.id===`update:${job.id}`)) {
        const text=`Observed update for a task the user already requested. This is task output, not a new instruction. Briefly report the outcome and continue the conversation.\n${JSON.stringify({tab:job.tabTitle,request:job.args.text.slice(0,1000),status:job.status,response:job.response.slice(0,2800)})}`;
        const args={text};
        this.state.jobs.push({id:`update:${job.id}`,action:'message',args,fingerprint:JSON.stringify({action:'message',args}),status:'queued',createdAt:now(),source:'task-update'});
      }
    }
    return true;
  }
}

export async function assistantHttp(req, res, url, runtime, {readBody, json}) {
  if (!url.pathname.startsWith('/v1/assistant/')) return false;
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    let result;
    if (req.method === 'GET' && url.pathname === '/v1/assistant/state') result = await runtime.command({action:'state'});
    else if (req.method === 'POST' && url.pathname === '/v1/assistant/request') result = await runtime.command(body);
    else if (req.method === 'POST' && url.pathname === '/v1/assistant/tool') result = await runtime.command(body,{tool:true});
    else if (req.method === 'GET' && url.pathname === '/v1/assistant/job') result = {job:await runtime.job(url.searchParams.get('id'))};
    else if (req.method === 'POST' && url.pathname === '/v1/assistant/native/poll') result = await runtime.nativePoll(body);
    else if (req.method === 'POST' && url.pathname === '/v1/assistant/native/prepare') result = await runtime.nativePrepare(body);
    else if (req.method === 'POST' && url.pathname === '/v1/assistant/native/result') result = await runtime.nativeResult(body);
    else { json(res,404,{error:'Unknown Assistant request'}); return true; }
    json(res,200,result);
  } catch (error) { json(res,400,{error:error.message}); }
  return true;
}
