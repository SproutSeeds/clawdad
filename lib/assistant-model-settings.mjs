import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// These are the actual pre-settings request configurations. Migration keeps
// them rather than importing the model of an unrelated project/Terminal agent.
export const legacyAssistantModel = Object.freeze({model:'gpt-6-astra',reasoningEffort:'low'});
export const legacyResearchModel = Object.freeze({model:'gpt-6-astra',reasoningEffort:'medium'});
const copy = value => structuredClone(value);
const pair = value => value && typeof value.model==='string' && /^[a-zA-Z0-9._:/-]{1,160}$/.test(value.model)
  && typeof value.reasoningEffort==='string' && /^[a-z]{1,32}$/.test(value.reasoningEffort);

export function validateAssistantModel(selection,catalog,{images=false}={}) {
  if(!pair(selection))throw Error('Choose a model and its supported reasoning effort.');
  const model=catalog.models.find(m=>m.model===selection.model);
  if(!model)throw Error(`${selection.model} is unavailable in this signed-in runtime. Open Settings → Assistant, refresh models and choose an available model.`);
  if(!model.supportedReasoningEfforts.includes(selection.reasoningEffort))throw Error(`${selection.reasoningEffort} reasoning is unavailable for ${selection.model}. Choose a supported effort in Settings → Assistant.`);
  if(images && model.inputModalities && !model.inputModalities.includes('image'))throw Error(`${selection.model} cannot inspect images. Choose an image-capable model in Settings → Assistant; the attached images are preserved.`);
  return {model:selection.model,reasoningEffort:selection.reasoningEffort};
}

export class AssistantModelSettings {
  constructor({file,readCatalog,legacyMain=async()=>legacyAssistantModel,clock=Date.now}) {
    Object.assign(this,{file,readCatalog,legacyMain,clock});
    this.state=null;this.lock=Promise.resolve();this.catalogFlight=null;this.cached=null;
  }
  transaction(fn) {
    const next=this.lock.then(async()=>{
      if(!this.state){
        try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}
        catch(e){if(e.code!=='ENOENT')throw Error('Assistant model settings could not be read. Restore the settings file before changing models.');}
        if(!this.state){
          const previous=await this.legacyMain();
          this.state={version:1,revision:0,main:pair(previous)?{model:previous.model,reasoningEffort:previous.reasoningEffort}:copy(legacyAssistantModel),
            researchDefault:copy(legacyResearchModel),overrides:{},receipts:{}};
          try{await this.save();}catch(e){this.state=null;throw e;}
        }
      }
        if(this.state.version!==1 || !pair(this.state.main) || !pair(this.state.researchDefault)
          || !this.state.overrides || !this.state.receipts || !Number.isSafeInteger(this.state.revision)
          || Object.values(this.state.overrides).some(v=>!pair(v)))throw Error('Assistant model settings need repair. Existing conversations and research settings are preserved.');
      return fn();
    });this.lock=next.catch(()=>{});return next;
  }
  async save(){
    await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    const temporary=this.file+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,JSON.stringify(this.state),{mode:0o600});await fs.rename(temporary,this.file);
  }
  async catalog(force=false){
    if(!force && this.cached && this.clock()-this.cached.at<15_000)return copy(this.cached.value);
    if(!this.catalogFlight)this.catalogFlight=(async()=>{
      try{
        const value=await this.readCatalog();
        if(!value.authenticated || !Array.isArray(value.models) || !value.models.length)throw Error('No authenticated models.');
        this.cached={value,at:this.clock()};return value;
      }catch{this.cached=null;throw Error('Available models could not be verified. Check Codex sign-in on your Mac, then choose Refresh models. Saved choices have been kept.');}
      finally{this.catalogFlight=null;}
    })();
    return copy(await this.catalogFlight);
  }
  async snapshot(threads=[],{refresh=true}={}){
    let catalog,error=null;try{catalog=await this.catalog(refresh);}catch(e){error=e.message;}
    const state=await this.transaction(()=>copy(this.state));
    const describe=selection=>{
      try{if(!catalog)throw Error(error);validateAssistantModel(selection,catalog);return {...selection,available:true};}
      catch(e){return {...selection,available:false,error:e.message};}
    };
    return {version:1,revision:state.revision,main:describe(state.main),researchDefault:describe(state.researchDefault),
      models:catalog?.models||[],catalogError:error,catalogObservedAt:this.cached?new Date(this.cached.at).toISOString():null,
      supervisors:threads.filter(t=>t.configured).map(t=>({id:t.id,name:t.name,project:t.evidenceRoot,sessionId:t.sessionId,status:t.status,
        inherited:!state.overrides[t.id],selection:describe(state.overrides[t.id]||state.researchDefault)}))};
  }
  async update({scope,threadId=null,selection=null,inherit=false,expectedRevision},requestId,threads=[]){
    if(typeof requestId!=='string'||requestId.length<1||requestId.length>128)throw Error('A stable settings request ID is required.');
    if(!['main','researchDefault','supervisor'].includes(scope)||typeof inherit!=='boolean'||(inherit&&scope!=='supervisor'))throw Error('Choose Main Assistant, research defaults or an individual supervisor.');
    if(scope==='supervisor'&&!threads.some(t=>t.id===threadId&&t.configured))throw Error('That configured supervisor is no longer available. Refresh Assistant settings.');
    const fingerprint=JSON.stringify({scope,threadId,selection,inherit,expectedRevision});
    const prior=await this.transaction(()=>this.state.receipts[requestId]);
    if(prior){if(prior.fingerprint!==fingerprint)throw Error('That settings request ID was already used.');return {receipt:copy(prior),settings:await this.snapshot(threads)};}
    const catalog=await this.catalog(true);
    const nextSelection=validateAssistantModel(inherit?await this.transaction(()=>copy(this.state.researchDefault)):selection,catalog);
    const receipt=await this.transaction(async()=>{
      if(this.state.receipts[requestId]){
        if(this.state.receipts[requestId].fingerprint!==fingerprint)throw Error('That settings request ID was already used.');
        return copy(this.state.receipts[requestId]);
      }
      if(expectedRevision!==this.state.revision)throw Error('Assistant settings changed elsewhere. Refresh and review your selection before saving.');
      const previous=copy(this.state);
      if(scope==='supervisor'){
        if(inherit)delete this.state.overrides[threadId];else this.state.overrides[threadId]=nextSelection;
      }else this.state[scope]=nextSelection;
      const receipt={requestId,fingerprint,revision:++this.state.revision,scope,threadId,inherit,selection:nextSelection,appliesTo:'subsequent_requests',savedAt:new Date(this.clock()).toISOString()};
      this.state.receipts[requestId]=receipt;
      try{await this.save();}catch(e){this.state=previous;throw e;}
      return copy(receipt);
    });
    return {receipt,settings:await this.snapshot(threads,{refresh:false})};
  }
  async resolve(scope,threadId=null,options={}){
    const selected=await this.transaction(()=>({selection:copy(scope==='main'?this.state.main:this.state.overrides[threadId]||this.state.researchDefault),
      revision:this.state.revision,inherited:scope!=='main'&&!this.state.overrides[threadId]}));
    const catalog=await this.catalog();
    return {...validateAssistantModel(selected.selection,catalog,options),settingsRevision:selected.revision,inherited:selected.inherited};
  }
}
