import {codexProcessOwners} from './codex-thread-control.mjs';

// Lightweight inventory only: no tab focus, composer keystroke, capture, login,
// resume, process termination or workspace snapshot operation is performed.
export async function inspectAccountConsumers(runtime,{readOwners=codexProcessOwners}={}){
  const owners=await readOwners(),catalog=runtime.observation?.catalog||runtime.workspaceCatalog?.catalog;
  const tabs=catalog?.tabs||[],jobs=runtime.state?.jobs||[],consumers=[];
  for(const owner of owners){
    const tab=tabs.find(t=>t.tty?.replace('/dev/','')===owner.tty);
    const receipts=jobs.filter(j=>['queued','running','submitted','working','agent_queued','inserted','attention','interrupted'].includes(j.status)
      &&(j.args?.tabId===tab?.id&&tab || owner.threads?.includes(j.sessionId||j.args?.sessionId)));
    const shell=owner.tty==='??';
    consumers.push({id:'pid:'+owner.pid,pid:owner.pid,kind:owner.socket?'shared_app_server':shell?'background_codex':'terminal_codex',
      processIdentity:tab?.agentInstanceId||null,tabId:tab?.id,windowId:tab?.windowId,tty:owner.tty,
      sessionId:owner.threads.length===1?owner.threads[0]:null,directory:tab?.directory,title:tab?.title,
      busy:typeof tab?.isBusy==='boolean'?tab.isBusy:receipts.some(r=>['working','running','submitted','agent_queued'].includes(r.status))?true:null,
      draft:{state:'requires_verified_capture',recoverable:false},pendingReceipts:receipts.map(j=>({id:j.id,status:j.status})),
      accountVerified:false,recoverable:false,reason:owner.threads.length>1?'Multiple live conversations share this process. All owners need verified transition.':
        'Per-process account adoption and exact unsent input recovery still need verification.'});
  }
  return {complete:false,consumers,reasons:[
    ...(!catalog?['The native Terminal catalog is not currently available.']:[]),
    'This read-only inventory does not establish each process’s authenticated account or capture hidden drafts. Live switching remains guarded.',
  ]};
}
