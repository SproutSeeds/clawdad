import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const idOK=value=>typeof value==='string'&&/^[a-zA-Z0-9._:-]{1,128}$/.test(value);
const stateOK=value=>value&&Number.isInteger(value.boostDB)&&value.boostDB>=0&&value.boostDB<=20&&Number.isSafeInteger(value.revision)&&value.revision>=0&&value.policy==='speech-output-v1';
const hubs=new WeakMap();
export function speechOutputControls(runtime){
  if(!hubs.has(runtime))hubs.set(runtime,new SpeechOutputControls({root:runtime.root,clock:runtime.clock}));
  return hubs.get(runtime);
}

// The device owns persistence. Never replay uncertain delivery after restart.
export class SpeechOutputControls {
  constructor({root,clock=Date.now}){this.root=root;this.clock=clock;this.devices=new Map();this.receipts=null;this.lock=Promise.resolve();}
  async transaction(fn){const task=this.lock.then(async()=>{if(!this.receipts){try{this.receipts=JSON.parse(await fs.readFile(path.join(this.root,'speech-output-receipts.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.receipts={};}}return fn();});this.lock=task.catch(()=>{});return task;}
  async save(next){await fs.mkdir(this.root,{recursive:true,mode:0o700});const temp=path.join(this.root,`.speech-${crypto.randomUUID()}.tmp`);try{await fs.writeFile(temp,JSON.stringify(next),{mode:0o600,flag:'wx'});await fs.rename(temp,path.join(this.root,'speech-output-receipts.json'));this.receipts=next;}finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
  snapshot(deviceId){
    const device=this.devices.get(deviceId);
    const online=!!device&&this.clock()-device.seen<6000;
    return {deviceId,label:device?.label||null,status:online?(device.state.supported?'online':'unsupported'):'offline',state:device?.state||null,observedAt:device?.seen||null,
      scope:device?.state.scope==='browser-origin-profile'?'This browser or Mac web profile at this ClawDad address, across accounts. Other addresses, profiles and devices keep their own boost.':'This app installation on the named playback device, across accounts. Other devices keep their own boost.'};
  }
  async sync({deviceId,label,state,ack}){
    if(!idOK(deviceId)||!stateOK(state)||typeof state.supported!=='boolean')throw Error('Invalid speech device state.');
    return this.transaction(async()=>{
      const previous=this.devices.get(deviceId);
      if(previous&&state.revision<previous.state.revision)throw Error('Stale speech device revision.');
      if(previous&&state.revision===previous.state.revision&&state.boostDB!==previous.state.boostDB)throw Error('Conflicting speech device state.');
      this.devices.set(deviceId,{seen:this.clock(),label:String(label||'Playback device').slice(0,80),state});
      if(ack){
        const receipt=this.receipts[ack.requestId];
        if(receipt?.deviceId!==deviceId)throw Error('Speech acknowledgment belongs to another device.');
        if(receipt.status==='pending'||receipt.status==='unverified'){
          const applied=ack.status==='applied'&&ack.appliedBoostDB===receipt.boostDB&&ack.appliedRevision===receipt.expectedRevision+1&&state.revision>=ack.appliedRevision
            &&(state.revision>ack.appliedRevision||state.boostDB===receipt.boostDB);
          const updated={...receipt,status:applied?'applied':'rejected',acknowledgedAt:this.clock(),appliedRevision:applied?ack.appliedRevision:null,error:applied?null:String(ack.error||'Device did not verify the requested preference.').slice(0,250)};
          await this.save({...this.receipts,[ack.requestId]:updated});
        }
      }
      const pending=Object.values(this.receipts).find(r=>r.deviceId===deviceId&&r.status==='pending'&&r.instanceId===this.instanceId&&r.expiresAt>this.clock());
      return {speechOutput:{...this.snapshot(deviceId),pending:pending?{requestId:pending.requestId,boostDB:pending.boostDB,expectedRevision:pending.expectedRevision,expiresAt:pending.expiresAt}:null}};
    });
  }
  instanceId=crypto.randomUUID();
  async read(deviceId){return this.transaction(()=>({speechOutput:deviceId?this.snapshot(deviceId):{devices:[...this.devices.keys()].map(id=>this.snapshot(id))}}));}
  async set(args,{originDeviceId,authorize}){
    const {requestId,operation,boostDB,deltaDB,expectedRevision}=args;
    const deviceId=args.deviceId||originDeviceId;
    if(!idOK(requestId)||!idOK(deviceId))throw Error('Read speech boost and choose the intended playback device. This conversation has no verified playback-device target.');
    if(!['set','increase','reset'].includes(operation)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Read the current speech boost revision first.');
    if(operation==='set'&&(!Number.isInteger(boostDB)||boostDB<0||boostDB>20))throw Error('Speech boost supports whole numbers from 0 to +20 dB.');
    if(operation==='increase'&&(!Number.isInteger(deltaDB)||deltaDB< -20||deltaDB>20))throw Error('Speech boost adjustments must be whole numbers from -20 to +20 dB.');
    const fingerprint=JSON.stringify([deviceId,operation,boostDB??null,deltaDB??null,expectedRevision]);
    const existing=await this.transaction(()=>this.receipts[requestId]);
    if(existing){if(existing.fingerprint!==fingerprint)throw Error('Speech request ID was reused with different arguments.');return this.result(existing);}
    await authorize();
    const receipt=await this.transaction(async()=>{
      if(this.receipts[requestId]){if(this.receipts[requestId].fingerprint!==fingerprint)throw Error('Speech request ID conflict.');return this.receipts[requestId];}
      const snapshot=this.snapshot(deviceId);
      if(snapshot.status!=='online')return {requestId,deviceId,status:snapshot.status,error:'The intended playback device must be connected and support Speech boost. No change was queued.'};
      if(snapshot.state.revision!==expectedRevision)throw Error('Speech boost changed. Read its current state before retrying.');
      const db=operation==='reset'?0:operation==='increase'?snapshot.state.boostDB+deltaDB:boostDB;
      if(db<0||db>20)throw Error('The requested adjustment exceeds the 0 to +20 dB range. No change was made.');
      if(Object.values(this.receipts).some(r=>r.deviceId===deviceId&&r.status==='pending'&&r.expiresAt>this.clock()))throw Error('A speech change is awaiting this device. Check its receipt first.');
      if(Object.keys(this.receipts).length>=10000)throw Error('Speech receipt storage is full. No change was queued.');
      const next={requestId,deviceId,operation,boostDB:db,expectedRevision,fingerprint,status:'pending',createdAt:this.clock(),expiresAt:this.clock()+5000,instanceId:this.instanceId};
      await this.save({...this.receipts,[requestId]:next});return next;
    });
    if(receipt.status!=='pending')return this.result(receipt);
    for(let i=0;i<50;i++){
      await new Promise(resolve=>setTimeout(resolve,100));
      const current=await this.transaction(()=>this.receipts[requestId]);
      if(current.status!=='pending')return this.result(current);
      if(this.clock()>=current.expiresAt)break;
    }
    return this.transaction(async()=>{const current=this.receipts[requestId];if(current.status==='pending')await this.save({...this.receipts,[requestId]:{...current,status:'unverified',error:'The device did not acknowledge before the deadline. Do not assume a volume change or submit another increase. Read the same request ID and current device state.'}});return this.result(this.receipts[requestId]);});
  }
  result(receipt){const expired=receipt.status==='pending'&&(receipt.instanceId!==this.instanceId||receipt.expiresAt<=this.clock());return {speechOutput:{receipt:{...receipt,...(expired?{status:'unverified',error:'Delivery was interrupted. Read current device state; this command will not be replayed.'}:{})},device:this.snapshot(receipt.deviceId)}};}
  async receipt(requestId){return this.transaction(()=>this.receipts[requestId]?this.result(this.receipts[requestId]):{speechOutput:{receipt:null,status:'unknown'}});}
}
