const day=24*60*60*1000;
const registrationPrefix='push:device:';
const queueKey='push:events';
const topic='earth.frg.clawdad.ios';
const text=(value,max)=>typeof value==='string' && value.trim().length>0 && value.trim().length<=max;
const uuid=value=>typeof value==='string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const base64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const signingCache = new Map();

function environmentConfig(env,environment) {
  if (environment !== 'development') return env;
  return {...env,CLAWDAD_APNS_KEY_ID:env.CLAWDAD_APNS_DEVELOPMENT_KEY_ID,CLAWDAD_APNS_PRIVATE_KEY:env.CLAWDAD_APNS_DEVELOPMENT_PRIVATE_KEY};
}

export function pushConfigured(env,environment='production') {
  env=environmentConfig(env,environment);
  return Boolean(env.CLAWDAD_APNS_PRIVATE_KEY && /^[A-Z\d]{10}$/.test(env.CLAWDAD_APNS_KEY_ID || '') && /^[A-Z\d]{10}$/.test(env.CLAWDAD_APNS_TEAM_ID || ''));
}
async function providerToken(env,now) {
  const cacheId = `${env.CLAWDAD_APNS_TEAM_ID}:${env.CLAWDAD_APNS_KEY_ID}`;
  const cached = signingCache.get(cacheId);
  if (cached?.pem===env.CLAWDAD_APNS_PRIVATE_KEY && now>=cached.at && now-cached.at<45*60*1000) return cached.token;
  const pem=env.CLAWDAD_APNS_PRIVATE_KEY.replace(/-----[^-]+-----/g,'').replace(/\s+/g,'');
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const encode=value=>base64url(new TextEncoder().encode(JSON.stringify(value)));
  const input=`${encode({alg:'ES256',kid:env.CLAWDAD_APNS_KEY_ID})}.${encode({iss:env.CLAWDAD_APNS_TEAM_ID,iat:Math.floor(now/1000)})}`;
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(input));
  const token=`${input}.${base64url(signature)}`;
  if (signingCache.size >= 8) signingCache.delete(signingCache.keys().next().value);
  signingCache.set(cacheId, {pem:env.CLAWDAD_APNS_PRIVATE_KEY,at:now,token});
  return token;
}
export function normalizeCompletion(value,now=Date.now()) {
  const when=Date.parse(value?.completedAt);
  if (!/^[a-f\d]{64}$/.test(value?.id || '') || !uuid(value?.sessionId) || !text(value?.directory,160) ||
      /[/\\\r\n\u0000-\u001f]/.test(value.directory) || !Number.isFinite(when) || when<now-day || when>now+60_000) throw new Error('Invalid completed-turn notification');
  // Copy the allowlist only: response text, code and full paths stay on the Mac.
  return {id:value.id,sessionId:value.sessionId,directory:value.directory.trim(),completedAt:new Date(when).toISOString()};
}
export function completionPayload(event,registration,identity) {
  const at=new Intl.DateTimeFormat(registration.locale,{hour:'numeric',minute:'2-digit',timeZone:registration.timeZone}).format(new Date(event.completedAt));
  return {aps:{alert:{title:`${event.directory} · Response ready`,subtitle:`${identity.hostName || 'ClawDad'} · Thread ${event.sessionId.slice(-6)}`,body:`Completed at ${at}`},
    sound:'default', 'thread-id':`${identity.hostId}:${event.sessionId}`, category:'AGENT_RESPONSE'},
    clawdad:{version:1,eventId:event.id,sessionId:event.sessionId,directory:event.directory,completedAt:event.completedAt,
      accountId:identity.accountId,workspaceId:identity.workspaceId,hostId:identity.hostId}};
}
export class PushNotificationService {
  constructor(state,env,{fetchImpl=fetch,clock=Date.now}={}) { this.state=state; this.env=env; this.fetch=fetchImpl; this.clock=clock; this.pending=Promise.resolve(); }
  exclusive(work) { const next=this.pending.then(work); this.pending=next.catch(()=>{}); return next; }
  async register(deviceId,value) {
    return this.exclusive(async()=>{
      const key=registrationPrefix+deviceId;
      if (value?.enabled===false) { await this.state.storage.delete(key); return {enabled:false,configured:pushConfigured(this.env)}; }
      if (value?.enabled!==true || !/^[a-f\d]{32,512}$/i.test(value.token || '') || !['production','development'].includes(value.environment)) throw new Error('Invalid notification registration');
      const locale=text(value.locale,64)?value.locale:'en-US', timeZone=text(value.timeZone,80)?value.timeZone:'UTC';
      new Intl.DateTimeFormat(locale,{timeZone});
      const previous=await this.state.storage.get(key);
      const devices=await this.state.storage.list({prefix:registrationPrefix});
      if (!previous && devices.size>=16) throw new Error('Too many notification devices');
      await this.state.storage.put(key,{deviceId,token:value.token.toLowerCase(),environment:value.environment,locale,timeZone,
        enabledSince:previous?.enabledSince || this.clock(),updatedAt:this.clock()});
      return {enabled:true,configured:pushConfigured(this.env,value.environment)};
    });
  }
  async revoke(deviceId) { return this.exclusive(()=>this.state.storage.delete(registrationPrefix+deviceId)); }
  async submit(value,identity) {
    return this.exclusive(async()=>{
      const event=normalizeCompletion(value,this.clock());
      const devices=await this.state.storage.list({prefix:registrationPrefix});
      const targets=[...devices.values()].filter(device=>Date.parse(event.completedAt)>=device.enabledSince).map(device=>device.deviceId);
      if (!targets.length) return {accepted:true,recipients:0};
      if (![...devices.values()].some(device=>targets.includes(device.deviceId) && pushConfigured(this.env,device.environment))) return {accepted:false,unavailable:true};
      const events=(await this.state.storage.get(queueKey) || []).filter(item=>Date.parse(item.completedAt)>this.clock()-day);
      const previous=events.find(item=>item.id===event.id);
      if (previous) return {accepted:true,duplicate:true};
      if (events.filter(item=>item.targets.length>0).length>=128) return {accepted:false,unavailable:true};
      events.push({...event,identity,targets,attempt:0,nextAt:this.clock()});
      const pending=events.filter(item=>item.targets.length);
      const completed=events.filter(item=>!item.targets.length).slice(-(512-pending.length));
      await this.state.storage.put(queueKey,[...completed,...pending]);
      await this.state.storage.setAlarm(this.clock()+100);
      return {accepted:true,recipients:targets.length};
    });
  }
  async alarm() {
    return this.exclusive(async()=>{
      const events=(await this.state.storage.get(queueKey) || []).filter(item=>Date.parse(item.completedAt)>this.clock()-day);
      let remainingBudget=16;
      for (const event of events) {
        if (!event.targets.length || event.nextAt>this.clock() || remainingBudget<=0) continue;
        for (const deviceId of [...event.targets]) {
          if (remainingBudget--<=0) break;
          const key=registrationPrefix+deviceId;
          const device=await this.state.storage.get(key);
          const access=await this.state.storage.get(`access:device:${deviceId}`);
          if (!device || !access?.tokenHash || access.revokedAt || Date.parse(event.completedAt)<device.enabledSince) {
            event.targets=event.targets.filter(id=>id!==deviceId); continue;
          }
          let delivered=false, invalid=false;
          try {
            const token=await providerToken(environmentConfig(this.env,device.environment),this.clock());
            const response=await this.fetch(`https://${device.environment==='development'?'api.sandbox.push.apple.com':'api.push.apple.com'}/3/device/${device.token}`,{
              method:'POST',headers:{authorization:`bearer ${token}`,'apns-topic':topic,'apns-push-type':'alert','apns-priority':'10',
                'apns-expiration':String(Math.floor((Date.parse(event.completedAt)+day)/1000)),'apns-collapse-id':event.id,'content-type':'application/json'},
              body:JSON.stringify(completionPayload(event,device,event.identity)),signal:AbortSignal.timeout(10_000)});
            delivered=response.ok;
            const reason=delivered?'':(await response.json().catch(()=>({}))).reason;
            invalid=response.status===410 || reason==='BadDeviceToken' || reason==='DeviceTokenNotForTopic';
            if (response.status===403) {
              const config = environmentConfig(this.env,device.environment);
              signingCache.delete(`${config.CLAWDAD_APNS_TEAM_ID}:${config.CLAWDAD_APNS_KEY_ID}`);
            }
          } catch { /* The bounded durable alarm retries provider/network failures. */ }
          if (invalid) {
            const current=await this.state.storage.get(key);
            if (current?.token===device.token) await this.state.storage.delete(key);
          }
          if (delivered || invalid) event.targets=event.targets.filter(id=>id!==deviceId);
          // A provider reply is checkpointed per device, before the next send.
          await this.state.storage.put(queueKey,events);
        }
        event.attempt+=1;
        event.nextAt=this.clock()+Math.min(60*60*1000,5000*2**Math.min(event.attempt,10));
      }
      await this.state.storage.put(queueKey,events);
      const pending=events.filter(event=>event.targets.length);
      const next=[...pending.map(event=>event.nextAt),...events.map(event=>Date.parse(event.completedAt)+day+1)];
      if (next.length) await this.state.storage.setAlarm(Math.max(this.clock()+1000,Math.min(...next)));
      else await this.state.storage.delete(queueKey);
    });
  }
}
