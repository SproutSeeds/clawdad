// The native worker owns every mutation. This UI retains a request ID across
// uncertain delivery and reads durable progress while the worker restores tabs.
(() => {
  const open=document.getElementById('mainWorkspaceOpen'),dialog=document.getElementById('mainWorkspaceDialog');
  if(!open||!dialog)return;
  const $=id=>document.getElementById(id),storage='clawdad.main-workspace.pending';
  const selectedStorage='clawdad.main-workspace.selected';
  let state={},catalog=null,pending=null,timer=null,refreshing=false,windowSignature='',snapshotSignature='',selected=localStorage.getItem(selectedStorage)||'',closeResult=null;
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
    const named=state.namedSnapshots||[],namedSignature=JSON.stringify(named);
    if(namedSignature!==snapshotSignature){
      snapshotSignature=namedSignature;
      if(!named.some(s=>s.id===selected))selected=state.selectedSnapshotId||named[0]?.id||'';
      $('mainWorkspaceNamed').replaceChildren(...named.map(s=>new Option(`${s.name} · ${s.count} tabs${s.needsReview?' · Needs review':''}`,s.id)));
      $('mainWorkspaceNamed').value=selected;
    }
    $('mainWorkspaceNamed').disabled=!!pending;
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
        remove.onclick=()=>{if(confirm(`Remove ${row.entry.name} from this saved setup? Its live tab and files remain intact.`))void perform('mainworkspace.remove',{entryId:entry.id,snapshotId:selected,expectedRevision:state.revision});};
      }
      row.entry=entry;const {summary,description,draft,copy,remove}=row.parts;
      $('mainWorkspaceEntries').append(row);
      summary.textContent=`${entry.name} · ${(entry.status||'saved').replaceAll('_',' ')}`;
      description.textContent=[entry.kind==='codex'?'Codex conversation':'Shell',entry.directory,entry.sessionId&&`Conversation ${entry.sessionId}`,entry.identityIssue,entry.message,entry.draftLimitation].filter(Boolean).join('\n');
      if(draft.textContent!==(entry.draftText||''))draft.textContent=entry.draftText||'';
      draft.hidden=copy.hidden=!entry.draftText;remove.disabled=!!pending;
    }
    for(const [id,row] of rows)if(!ids.has(id)){row.remove();rows.delete(id);}
    const snapshots=$('mainWorkspaceSnapshots');snapshots.replaceChildren();
    for(const snapshot of state.snapshots||[]){const button=document.createElement('button');button.type='button';button.disabled=!!pending;
      button.textContent=`Recover snapshot ${snapshot.index+1} · ${snapshot.count} projects`;
      button.onclick=()=>perform('mainworkspace.recover',{snapshotId:selected,snapshotIndex:snapshot.index,expectedRevision:state.revision});snapshots.append(button);}
    $('mainWorkspaceSave').disabled=!!pending||!$('mainWorkspaceWindow').value;
    $('mainWorkspaceUpdate').disabled=!!pending||!selected||!$('mainWorkspaceWindow').value;
    $('mainWorkspaceReuse').disabled=!!pending||!state.entries?.length||!$('mainWorkspaceWindow').value;
    $('mainWorkspaceSeparate').disabled=!!pending||!state.entries?.length;
    $('mainWorkspaceCloseWindow').disabled=!!pending||!$('mainWorkspaceWindow').value;
    const plan=closeResult?.closePlan,ready=plan?.status==='confirmation_required',tabs=plan?.tabs||[];
    $('mainWorkspaceClosePlan').hidden=!closeResult;
    $('mainWorkspaceCloseDescription').textContent=closeResult?[closeResult.windowTitle,`${tabs.length} tabs · ${closeResult.runningAgents||0} agents working · ${closeResult.unsentDrafts||0} unsent drafts`,closeResult.confirmation,closeResult.message,...tabs.map(t=>`${t.name}: ${t.identityIssue||t.draft?.limitation||t.directory}`)].filter(Boolean).join('\n'):'';
    $('mainWorkspaceConfirmClose').disabled=!!pending||!ready;
    $('mainWorkspaceSaveClose').disabled=!!pending||!ready||!tabs.length||tabs.some(t=>t.identityIssue||typeof t.draft?.text!=='string'||t.pendingReceipts?.length);
    $('mainWorkspaceCancelClose').disabled=!!pending;
  }
  async function refresh(){
    if(refreshing)return;refreshing=true;
    try{
      const result=await request('mainworkspace.status',{...(selected?{snapshotId:selected}:{}),...(pending?{jobId:pending.id}:{})});state=result.mainWorkspace||{};catalog=result.catalog;
      if(result.job&&!['queued','running'].includes(result.job.status)){
        if(result.job.result?.closePlan)closeResult=result.job.result;
        if(pending?.action==='mainworkspace.save'&&result.job.result?.selectedSnapshotId){selected=result.job.result.selectedSnapshotId;localStorage.setItem(selectedStorage,selected);snapshotSignature='';}
        pending=null;localStorage.removeItem(storage);$('mainWorkspaceError').textContent=result.job.error||'';
      }
      if(result.paused&&pending)$('mainWorkspaceError').textContent='Mac control is paused. Resume control to continue this request.';
      render();
    }catch(error){$('mainWorkspaceError').textContent=error.message;}finally{refreshing=false;}
  }
  async function resend(){if(!pending)return;try{await request(pending.action,pending.args,pending.id);$('mainWorkspaceError').textContent='';await refresh();}catch(error){$('mainWorkspaceError').textContent=`Request saved. Check its receipt before another attempt: ${error.message}`;}}
  async function perform(action,args={}){if(pending)return;pending={action,args,id:crypto.randomUUID()};localStorage.setItem(storage,JSON.stringify(pending));render();await resend();}
  open.onclick=async()=>{dialog.showModal();await refresh();if(!pending)void perform('mainworkspace.inspect');timer=setInterval(refresh,2000);};
  const close=()=>{dialog.close();clearInterval(timer);open.focus();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});$('mainWorkspaceClose').onclick=close;
  const saveArgs=()=>({tabId:$('mainWorkspaceWindow').value,name:$('mainWorkspaceName').value,expectedRevision:state.revision});
  $('mainWorkspaceNamed').onchange=()=>{selected=$('mainWorkspaceNamed').value;localStorage.setItem(selectedStorage,selected);$('mainWorkspaceName').value=(state.namedSnapshots||[]).find(s=>s.id===selected)?.name||'Main Workspace';void refresh();};
  $('mainWorkspaceRestore').onclick=()=>perform('mainworkspace.restore',{snapshotId:selected});
  $('mainWorkspaceSave').onclick=()=>perform('mainworkspace.save',saveArgs());
  $('mainWorkspaceUpdate').onclick=()=>{if(confirm('Replace this snapshot with exactly the chosen window’s current lineup? Its previous version remains recoverable.'))void perform('mainworkspace.save',{...saveArgs(),snapshotId:selected});};
  $('mainWorkspaceReuse').onclick=()=>{if(confirm('Restore missing saved tabs into the chosen window? Its existing work and unsaved tabs remain intact.'))void perform('mainworkspace.restore',{snapshotId:selected,reuseWindowTabId:$('mainWorkspaceWindow').value});};
  $('mainWorkspaceSeparate').onclick=()=>{if(confirm('Allow a separate window for this saved setup? Existing windows remain open.'))void perform('mainworkspace.restore',{snapshotId:selected,newWindowConfirmed:true});};
  $('mainWorkspaceCloseWindow').onclick=()=>perform('mainworkspace.close.inspect',{tabId:$('mainWorkspaceWindow').value});
  function confirmClose(saveFirst){if(confirm(closeResult.confirmation||'Close this exact window and stop all work in it?'))void perform('mainworkspace.close',{confirmationToken:closeResult.closePlan.token,confirm:true,...(saveFirst?{saveName:$('mainWorkspaceName').value,expectedRevision:state.revision}:{})});}
  $('mainWorkspaceConfirmClose').onclick=()=>confirmClose(false);$('mainWorkspaceSaveClose').onclick=()=>confirmClose(true);
  $('mainWorkspaceCancelClose').onclick=()=>{closeResult=null;render();};
  $('mainWorkspaceWindow').onchange=render;$('mainWorkspaceScan').onclick=()=>perform('mainworkspace.inspect');$('mainWorkspaceRetry').onclick=resend;
})();
