// Presentation is a projection. Raw receipts, tool results and original history
// remain in local diagnostics; hiding a row never deletes or replays a request.
const taskActions = new Set(['terminal.send','terminal.queue','terminal.insert','terminal.clear','terminal.replace']);
const taskParent = job => job.parentTaskId || (job.source === 'task-update' && job.id.startsWith('update:') ? job.id.slice(7) : null);

export function assistantTaskName(title) {
  const text = String(title || '').trim();
  if (!text || text.includes(' — ') || /(?:--|\bcodex\b.*\s|\b(?:bash|zsh)\b|[\r\n])/.test(text)) return 'Terminal agent';
  const name = text.replace(/\/$/, '').split('/').at(-1);
  return name.toLowerCase() === 'clawdad' ? 'ClawDad' : name.slice(0,80);
}

export function assistantReadableError(error) {
  if (!error) return null;
  const text = String(error);
  if (/unsupported.*version|version.*verified|draft controls could not/.test(text)) return "This agent's input controls could not be verified. Its draft was preserved; inspect the tab before retrying.";
  if (/no longer available|agent.*changed|input.*changed|intended.*changed/.test(text)) return 'The target tab or its input changed. Inspect it before trying again; the request will not be repeated automatically.';
  if (/Tab was sent once|Tab delivery could not|Delivery is uncertain/.test(text)) return 'Tab was pressed once, but queue acceptance is uncertain. Check the original tab before retrying.';
  if (/already has a draft|has a draft|draft or an unreadable/.test(text)) return 'This tab has an existing draft. It was preserved. Review it before authorizing replacement.';
  if (/restarted during delivery|worker restarted/.test(text)) return 'The Mac restarted during delivery. Check the destination before retrying.';
  if (/spawn|ENOENT|ECONN|stack trace|^Error:|\bat .+\(.+:\d+/.test(text)) return 'The Mac could not finish this operation. Your request is saved; reconnect and inspect its status. Technical details are in diagnostics.';
  return text.replace(/\/(?:Users|Volumes|var)\/[^\s,;]+/g, 'the local file').slice(0,600);
}

export function assistantPresentation(state, catalog, diagnostics = {}) {
  const hiddenJobs = new Set(diagnostics.jobIds || []), hiddenMessages = new Set(diagnostics.messageIds || []);
  const resolved = new Set(diagnostics.resolvedJobIds || []);
  for (const job of state.jobs) if (job.visibility === 'diagnostic') hiddenJobs.add(job.id);
  for (const job of state.jobs) if (hiddenJobs.has(taskParent(job))) hiddenJobs.add(job.id);
  const owners = new Map(state.jobs.map(j => [j.id,j]));
  function owner(message) {
    return owners.get(message.requestId || message.id) || state.jobs.find(j => message.id.startsWith(`assistant:${j.id}:`));
  }
  const readable = state.messages.filter(message => {
    const job = owner(message);
    return ['user','assistant'].includes(message.role) && message.visibility !== 'diagnostic'
      && !hiddenMessages.has(message.id) && !hiddenJobs.has(job?.id);
  });
  const messages = readable.filter(m => !taskParent(owner(m) || {})).slice(-40)
    .map(message => ({...message, requestId: owner(message)?.id || message.requestId}));
  const tasks = state.jobs.filter(job => !hiddenJobs.has(job.id) && !resolved.has(job.id) && !taskParent(job)
    && (taskActions.has(job.action) || (job.status === 'attention' && ['message','computer.open','computer.input','computer.clear','computer.replace'].includes(job.action))))
    .slice(-20).map(({fingerprint,result,...job}) => {
      const tabId = job.args.tabId;
      const known = tabId && state.jobs.findLast(j => j.args?.tabId === tabId && j.tabTitle && !j.tabTitle.includes(' — '));
      const title = job.tabTitle || catalog?.tabs?.find(t => t.id === tabId)?.title || known?.tabTitle;
      const update = state.jobs.find(j => taskParent(j) === job.id);
      const {imageOwner,...args} = job.args;
      return {...job,args,displayName:job.action === 'message' ? 'Assistant' : job.action.startsWith('computer.') ? 'Mac' : assistantTaskName(title),
        error:assistantReadableError(job.error), response:update?.response || job.response,
        requestText:job.action === 'terminal.clear' ? 'Clear the inspected draft input' : args.text || owners.get(job.parentRequestId)?.args?.text || 'Update the inspected Mac input'};
    });
  // Control receipts remain available for navigation, separate from the chat.
  const operations = state.jobs.filter(j => j.action === 'terminal.focus').slice(-20)
    .map(({id,action,status,args,error}) => ({id,action,status,args,error:assistantReadableError(error)}));
  const taskUpdates = readable.filter(m => m.role === 'assistant' && tasks.some(t => t.id === taskParent(owner(m) || {})));
  return {messages,tasks,operations,taskUpdates};
}
