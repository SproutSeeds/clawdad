"""Authorized disposable TUI inspection. No model prompt, real tab, or login.

Only the previously generated synthetic account-continuity thread is resumed.
Local /status is a built-in command; receipts record no tokens or environment.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import pexpect
import pyte

if len(sys.argv) != 3 or sys.argv[1] not in ('cody', 'sun') or not re.fullmatch(r'tui-status-[a-z0-9-]+', sys.argv[2]):
    raise SystemExit('Use cody|sun and a new tui-status-* receipt.')
profile, name = sys.argv[1:]
base = Path.home() / 'Library/Application Support/ClawDad/Accounts/verification-2026-09-15'
root = base / 'thread-continuity-1'
original = json.loads((root / 'evidence.json').read_text())
reconciled = json.loads((root / 'reconciliation-1.json').read_text())
if reconciled['state'] != 'verified_local_history_only' or original['modelTurns'] != 1:
    raise SystemExit('Reconcile the disposable history first.')
thread = original['sourceThreadId']
project = root / 'project'
if original['project'] != str(project) or not re.fullmatch(r'[a-f0-9-]{36}', thread):
    raise SystemExit('Only the exact synthetic thread is authorized.')
folder = root / name
folder.mkdir(mode=0o700)  # Existing receipts must be inspected, never replayed.
receipt = {'version': 1, 'profile': profile, 'threadId': thread, 'state': 'starting',
           'modelPrompts': 0, 'loginActions': 0, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
def save():
    temp = folder / 'receipt.tmp'
    temp.write_text(json.JSONEncoder(indent=2).encode(receipt))
    temp.chmod(0o600)
    temp.replace(folder / 'receipt.json')

env = {k: os.environ[k] for k in ('PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG') if k in os.environ}
env.update({'CODEX_HOME': str(base / profile), 'TERM': 'xterm-256color'})
args = ['resume', thread, '--cd', str(project), '--no-alt-screen',
        '--model', 'gpt-6-astra', '-c', 'model_reasoning_effort="low"',
        '-c', 'cli_auth_credentials_store="keyring"', '-c', 'sqlite_home=' + json.JSONEncoder().encode(str(root / 'index')),
        '--sandbox', 'read-only', '--ask-for-approval', 'never']
save()
child = pexpect.spawn('/opt/homebrew/bin/codex', args, cwd=str(project), env=env, encoding='utf-8',
                      timeout=25, dimensions=(45, 180))
receipt['pid'] = child.pid
save()
output = ''
screen=pyte.Screen(180,45)
stream=pyte.Stream(screen)
def receive():
    global output
    try:
        text=child.read_nonblocking(size=65536,timeout=0.2)
    except pexpect.TIMEOUT:
        return
    output += text
    stream.feed(text)
    if '\x1b[6n' in text:
        child.send('\x1b[%d;%dR' % (screen.cursor.y+1,screen.cursor.x+1))
    if len(output)>1024*1024:
        raise RuntimeError('The fixture exceeded its output bound.')
try:
    # Respond only to terminal position queries, never an unknown prompt.
    deadline = time.monotonic() + 35
    trusted = False
    while time.monotonic() < deadline:
        receive()
        visible='\n'.join(screen.display)
        if 'Do you trust the contents of this directory?' in visible and 'Press enter to continue' in visible:
            # This fixture's project is the only authorized trust choice.
            if re.sub(r'\s+','',str(project)) not in re.sub(r'\s+','',visible):
                raise RuntimeError('The exact fixture directory was not shown at trust.')
            if trusted:
                continue
            if '1. Yes, continue' not in visible or '2. No, quit' not in visible:
                raise RuntimeError('The expected fixture trust choices were not visible.')
            child.send('\r');trusted = True
            receipt['fixtureTrustAccepted'] = True;save()
        elif 'CLAWDAD_CONTINUITY_9F3A' in visible and 'Ask Codex' in visible and 'gpt-6-astra' in visible and 'Resuming session' not in visible:
            # Keep the local command and Enter as distinct events. A single
            # burst can be treated as a paste and leave /status unsent.
            child.send('/status')
            typed_deadline = time.monotonic() + 3
            while time.monotonic() < typed_deadline:
                receive()
                if '› /status' in '\n'.join(screen.display):
                    break
            else:
                raise RuntimeError('The exact local status command was not visible.')
            time.sleep(0.25)
            child.send('\r')
            receipt['statusCommandDispatched'] = True;save()
            break
    else:
        raise RuntimeError('The disposable TUI did not reach a known composer.')
    deadline = time.monotonic() + 12
    expected = 'codyshanemitchell@gmail.com' if profile == 'cody' else 'playinthesunwithme@gmail.com'
    while time.monotonic() < deadline:
        receive()
        visible='\n'.join(screen.display)
        if expected in visible and 'Account:' in visible:
            receipt['accountEmail'] = expected
            receipt['state'] = 'verified_local_status'
            break
    if receipt['state'] != 'verified_local_status':
        raise RuntimeError('The local status did not expose the expected account.')
except Exception as error:
    receipt['state'] = 'needs_attention'
    receipt['failure'] = str(error)
    raise
finally:
    (folder / 'synthetic-terminal.txt').write_text(output)
    (folder / 'synthetic-terminal.txt').chmod(0o600)
    (folder / 'rendered-terminal.txt').write_text('\n'.join(screen.display))
    (folder / 'rendered-terminal.txt').chmod(0o600)
    receipt['outputSha256'] = hashlib.sha256(output.encode()).hexdigest()
    # This child owns only the disposable, idle fixture. No user process is signaled.
    child.close(force=True)
    receipt['fixtureProcessExited'] = not child.isalive()
    receipt['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()
    print(json.JSONEncoder().encode(receipt))
