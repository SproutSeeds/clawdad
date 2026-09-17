// One account reading for the Mac's main view; all formatting uses this device's timezone.
(() => {
  const button = document.getElementById('weeklyUsage');
  const dialog = document.getElementById('weeklyUsageDialog');
  const detail = document.getElementById('weeklyUsageDetail');
  const notice = document.getElementById('weeklyUsageNotice');
  let usage, pending = false, seen = [];
  try { seen = JSON.parse(localStorage.getItem('clawdad.usage.seen') || '[]'); } catch { /* Empty first run. */ }
  const reset = value => new Intl.DateTimeFormat(undefined, {weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'}).format(new Date(value * 1000));
  function render() {
    const fresh = usage?.status === 'current' && usage.validUntil > Date.now();
    const title = usage?.remainingPercent == null ? 'Weekly allowance unavailable'
      : `${usage.remainingPercent}% weekly remaining${fresh ? '' : ' · Stale'}`;
    const text = title + (usage?.resetsAt ? '\nResets ' + reset(usage.resetsAt) : '');
    button.replaceChildren(document.createTextNode(title+' '));
    const info=document.createElement('span');info.textContent='ⓘ';info.setAttribute('aria-hidden','true');button.append(info);
    button.setAttribute('aria-label',title+'. Account and allowance details');
    const identity=usage?.subscription;
    detail.textContent = (identity?.email?`${identity.email} · ${identity.plan||'Subscription'}\nWorkspace: ${identity.workspaceName||'Not exposed by Codex'}\n\n`:'')
      +text+(usage?.observedAt?'\nLast refreshed '+new Date(usage.observedAt).toLocaleString():'')
      +(!fresh&&usage?.message?'\n\n'+usage.message:'')
      +(usage?.ordinaryUsageAllowed===false?'\n\nCodex reports that included subscription usage is currently unavailable. A shorter usage window can limit access while weekly allowance remains.'
        +(usage.shortWindow?'\nShorter window: '+usage.shortWindow.remainingPercent+'% remaining'+(usage.shortWindow.resetsAt?' · resets '+reset(usage.shortWindow.resetsAt):''):''):'');
    const alert = usage?.alerts?.filter(item => !seen.includes(item.id)).at(-1);
    notice.hidden = !alert || !fresh;
    if (alert && fresh) {
      notice.textContent = alert.threshold === 0 ? 'Codex weekly allowance reached 0% · View' : 'Codex weekly allowance is low · View';
      notice.onclick = () => {
        seen.push(...usage.alerts.map(item => item.id)); localStorage.setItem('clawdad.usage.seen', JSON.stringify([...new Set(seen)]));
        window.openClawDadUsage(); render();
      };
    }
  }
  async function refresh() {
    if (pending) return;
    pending = true;
    try { const response = await fetch('/v1/codex/weekly-usage'); if (!response.ok) throw Error(); usage = await response.json(); }
    catch { if (usage) usage.status = 'stale'; }
    finally { pending = false; render(); }
  }
  window.openClawDadUsage = () => { if (!dialog.open) dialog.showModal(); void refresh(); window.dispatchEvent(new Event('clawdad-open-usage')); };
  button.onclick = window.openClawDadUsage;
  const close = () => { dialog.close(); button.focus(); };
  document.getElementById('weeklyUsageClose').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.getElementById('weeklyUsageRefresh').onclick = refresh;
  const permission = document.getElementById('weeklyUsageNotifications');
  permission.hidden = !window.webkit?.messageHandlers?.clawdadNative;
  permission.onclick = () => { window.clawDadEnableUsageNotifications?.(); };
  void refresh(); setInterval(() => { render(); if (!document.hidden) void refresh(); }, 30_000);
  window.addEventListener('focus', refresh);
  window.addEventListener('clawdad-account-updated',refresh);
})();
