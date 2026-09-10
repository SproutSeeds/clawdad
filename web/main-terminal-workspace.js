// The native worker owns every mutation. This UI retains a request ID across
// uncertain delivery and reads durable progress while the worker restores tabs.
(() => {
  const open=document.getElementById('mainWorkspaceOpen'),dialog=document.getElementById('mainWorkspaceDialog');
  if(!open||!dialog)return;
  const $=id=>document.getElementById(id),storage='clawdad.main-workspace.pending';
  let state={},catalog=null,pending=null,timer=null,refreshing=false,windowSignature='';
  try{pending=JSON.parse(localStorage.getItem(storage)||'null');}catch{}
  const rows=new Map();
  async function request(action,args={},id=crypto.randomUUID()){
    const response=await fetch('/v1/assistant/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...args,requestId:id})});
    const value=await response.json();if(!response.ok)throw Error(value.error||'The Mac could not finish this request.');return value;
  }
  function render(){
    $('mainWorkspaceStatus').textContent=(pending?'Checking saved progress…':(state.status||'Loading').replaceAll('_',' '))+(state.message?' · '+state.message:'');
    $('mainWorkspaceRestore').disabled=!!pending||!state.entries?.length;
    $('mainWorkspaceSave').disabled=!!pending||!$('mainWorkspaceWindow').value;
    $('mainWorkspaceScan').disabled=!!pending;
    $('mainWorkspaceRetry').hidden=!pending;
    const windows=[...new Map((catalog?.tabs||[]).map(tab=>[tab.windowGroupId||tab.id,tab])).values()];
    const signature=JSON.stringify(windows.map(t=>[t.id,t.windowTitle,t.title]));
    if(signature!==windowSignature){
      const previous=$('mainWorkspaceWindow').value;windowSignature=signature;
      $('mainWorkspaceWindow').replaceChildren(new Option('Choose the Main Terminal window',''),...windows.map(t=>new Option(`${t.windowTitle||'Terminal window'} · ${t.title}`,t.id)));
      const selected=(catalog?.tabs||[]).find(t=>t.id===catalog.selectedTabId);
      $('mainWorkspaceWindow').value=windows.some(t=>t.id===previous)?previous:(windows.find(t=>t.windowGroupId===selected?.windowGroupId)?.id||'');
    }
    const ids=new Set();
    for(const entry of state.entries||[]){
      ids.add(entry.id);let row=rows.get(entry.id);
      if(!row){
        row=document.createElement('details');const summary=document.createElement('summary'),description=document.createElement('p'),draft=document.createElement('pre'),copy=document.createElement('button'),remove=document.createElement('button');
        copy.type=remove.type='button';copy.textContent='Copy saved draft';remove.textContent='Remove from saved workspace';
        row.append(summary,description,draft,copy,remove);row.parts={summary,description,draft,copy,remove};rows.set(entry.id,row);$('mainWorkspaceEntries').append(row);
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(row.entry.draftText||'');copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy saved draft',1200);}catch{$('mainWorkspaceError').textContent='Select the saved draft and use Copy.';}};
        remove.onclick=()=>{if(confirm(`Remove ${row.entry.name} from the saved workspace? Its live tab and files remain intact.`))void perform('mainworkspace.remove',{entryId:entry.id,expectedRevision:state.revision});};
      }
      row.entry=entry;const {summary,description,draft,copy,remove}=row.parts;
      summary.textContent=`${entry.name} · ${(entry.status||'saved').replaceAll('_',' ')}`;
      description.textContent=[entry.directory,entry.sessionId&&`Conversation ${entry.sessionId}`,entry.message,entry.draftLimitation].filter(Boolean).join('\n');
      if(draft.textContent!==(entry.draftText||''))draft.textContent=entry.draftText||'';
      draft.hidden=copy.hidden=!entry.draftText;remove.disabled=!!pending;
    }
    for(const [id,row] of rows)if(!ids.has(id)){row.remove();rows.delete(id);}
    const snapshots=$('mainWorkspaceSnapshots');snapshots.replaceChildren();
    for(const snapshot of state.snapshots||[]){const button=document.createElement('button');button.type='button';button.disabled=!!pending;
      button.textContent=`Recover snapshot ${snapshot.index+1} · ${snapshot.count} projects`;
      button.onclick=()=>perform('mainworkspace.recover',{snapshotIndex:snapshot.index,expectedRevision:state.revision});snapshots.append(button);}
    $('mainWorkspaceSave').disabled=!!pending||!$('mainWorkspaceWindow').value;
  }
  async function refresh(){
    if(refreshing)return;refreshing=true;
    try{
      const result=await request('mainworkspace.status',pending?{jobId:pending.id}:{});state=result.mainWorkspace||{};catalog=result.catalog;
      if(result.job&&!['queued','running'].includes(result.job.status)){pending=null;localStorage.removeItem(storage);$('mainWorkspaceError').textContent=result.job.error||'';}
      if(result.paused&&pending)$('mainWorkspaceError').textContent='Mac control is paused. Resume control to continue this request.';
      render();
    }catch(error){$('mainWorkspaceError').textContent=error.message;}finally{refreshing=false;}
  }
  async function resend(){if(!pending)return;try{await request(pending.action,pending.args,pending.id);$('mainWorkspaceError').textContent='';await refresh();}catch(error){$('mainWorkspaceError').textContent=`Request saved. Check its receipt before another attempt: ${error.message}`;}}
  async function perform(action,args={}){if(pending)return;pending={action,args,id:crypto.randomUUID()};localStorage.setItem(storage,JSON.stringify(pending));render();await resend();}
  open.onclick=async()=>{dialog.showModal();await refresh();if(!pending)void perform('mainworkspace.inspect');timer=setInterval(refresh,2000);};
  const close=()=>{dialog.close();clearInterval(timer);open.focus();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});$('mainWorkspaceClose').onclick=close;
  $('mainWorkspaceRestore').onclick=()=>perform('mainworkspace.restore');
  $('mainWorkspaceSave').onclick=()=>perform('mainworkspace.save',{tabId:$('mainWorkspaceWindow').value,expectedRevision:state.revision});
  $('mainWorkspaceWindow').onchange=render;$('mainWorkspaceScan').onclick=()=>perform('mainworkspace.inspect');$('mainWorkspaceRetry').onclick=resend;
})();
