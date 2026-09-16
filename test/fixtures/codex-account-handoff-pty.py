"""Private synthetic account-handoff driver; no ordinary prompt or real tab.

stdin/stdout carry a bounded fixture RPC. Only the already approved continuity
thread and two retained sign-ins are allowed. The persistent shell owns this
one private PTY. Neither another process nor a real Terminal window is targeted.
"""
import hashlib
import atexit
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import time
import pexpect
import pyte

base = Path.home() / 'Library/Application Support/ClawDad/Accounts/verification-2026-09-15'
fixture = base / 'thread-continuity-1'
if len(sys.argv) != 2 or not re.fullmatch(r'handoff-pty-[a-z0-9-]+', sys.argv[1]):
    raise SystemExit('Supply a new handoff-pty-* receipt name.')
root = fixture / sys.argv[1]
root.mkdir(mode=0o700)
original = json.loads((fixture / 'evidence.json').read_text())
thread = original['sourceThreadId']
project = str(fixture / 'project')
if original['modelTurns'] != 1 or original['project'] != project or thread != '01a0a848-cb86-7033-ae6f-ce006f5b51bb':
    raise SystemExit('Only the exact prior synthetic continuity fixture is allowed.')
logs = list((fixture / 'sessions').rglob('rollout-*-' + thread + '.jsonl'))
if len(logs) != 1:
    raise SystemExit('The fixture must have one exact persisted history.')
history = logs[0]
encoder = json.JSONEncoder(ensure_ascii=False, separators=(',', ':'))
def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()
def write(name, value):
    file = root / name
    file.write_text(value)
    file.chmod(0o600)
def accepted():
    selected = []
    for line in history.read_text().splitlines():
        row = json.loads(line)
        payload = row.get('payload', {})
        if (row.get('type') == 'response_item' and payload.get('role') in ('user', 'assistant')) or (row.get('type') == 'event_msg' and payload.get('type') in ('user_message', 'task_started', 'task_complete', 'turn_aborted')):
            selected.append(row)
    return digest(encoder.encode(selected))
baseline = accepted()
env = {k: os.environ[k] for k in ('PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG') if k in os.environ}
env.update({'TERM': 'xterm-256color', 'ZDOTDIR': str(root), 'HISTFILE': str(root / 'shell-history')})
shell = pexpect.spawn('/bin/zsh', ['-f'], cwd=project, env=env, encoding='utf-8', timeout=25, dimensions=(48, 180))
atexit.register(lambda: shell.close(force=True) if shell.isalive() else None)
write('fixture-shell.json', encoder.encode({'pid': shell.pid, 'parent': os.getpid(), 'project': project}))
# child_fd is the master; obtain the slave from the exact spawned shell PID.
slave = subprocess.check_output(['/bin/ps', '-p', str(shell.pid), '-o', 'tty='], text=True).strip()
if not re.fullmatch(r'ttys[0-9]+', slave):
    shell.close(force=True)
    raise SystemExit('The private shell did not expose one TTY.')
tty = '/dev/' + slave
screen = pyte.Screen(180, 48)
stream = pyte.Stream(screen)
shell.send("PROMPT='CLAWDAD_FIXTURE> '; RPROMPT=''; unset HISTFILE\r")
current = None
known = ''
status = None
receipts = {}
serial = 0
raw = ''

def receive():
    global raw
    try:
        text = shell.read_nonblocking(size=65536, timeout=0.15)
    except pexpect.TIMEOUT:
        return
    raw += text
    if len(raw) > 4 * 1024 * 1024:
        raise RuntimeError('Bounded fixture terminal output exceeded.')
    stream.feed(text)
    if '\x1b[6n' in text:
        shell.send('\x1b[%d;%dR' % (screen.cursor.y + 1, screen.cursor.x + 1))

def visible():
    return '\n'.join(screen.display)

def wait(predicate, seconds=12):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        receive()
        if predicate(visible()):
            return
    raise RuntimeError('The private fixture did not reach the expected observed state.')

def owner():
    rows = subprocess.check_output(['/bin/ps', '-t', slave, '-o', 'pid=,pgid=,tpgid=,stat=,lstart=,comm='], text=True)
    matches = []
    for line in rows.splitlines():
        columns = line.split(maxsplit=9)
        if len(columns) == 10 and columns[1] == columns[2] and Path(columns[9]).name == 'codex':
            matches.append(columns)
    if len(matches) != 1:
        return None
    row = matches[0]
    files = subprocess.check_output(['/usr/sbin/lsof', '-a', '-p', row[0], '-Fn'], text=True)
    if 'n' + str(history) not in files.splitlines():
        raise RuntimeError('The foreground process does not hold the exact synthetic history.')
    return {'pid': int(row[0]), 'processIdentity': 'codex-process-' + digest('|'.join(row[:3] + row[4:]))}

def composer(text):
    rows = text.splitlines()
    starts = [i for i, line in enumerate(rows) if line.strip().startswith('›')]
    if not starts:
        return None
    i = starts[-1]
    return rows[i].strip()[1:].strip()

def verify_draft():
    value = composer(visible())
    if not known:
        return value == '' or value == 'Ask Codex to do anything'
    if '\n' not in known and len(known) < 140:
        return value == known
    return value == '[Pasted Content %d chars]' % len(known)

def capture_status(profile):
    global status
    if known or not verify_draft():
        raise RuntimeError('Status needs the exact empty disposable composer.')
    before = owner()
    if not before:
        raise RuntimeError('No exact disposable agent owner.')
    shell.send('/status')
    wait(lambda text: composer(text) == '/status')
    time.sleep(0.25)
    shell.send('\r')
    email = 'codyshanemitchell@gmail.com' if profile == 'cody' else 'playinthesunwithme@gmail.com'
    wait(lambda text: email in text and 'Account:' in text and thread in text)
    # Let the compositor finish and observe the prompt after the complete panel.
    wait(lambda text: composer(text) in ('', 'Ask Codex to do anything'))
    if owner() != before or accepted() != baseline:
        raise RuntimeError('The owner or accepted work changed during local status.')
    text = visible()
    if 'gpt-6-astra (reasoning low, summaries auto)' not in text or 'Read Only (never)' not in text:
        raise RuntimeError('The expected fixture model and permissions were not shown.')
    status = {'profile': profile, 'email': email, 'model': 'gpt-6-astra', 'reasoningEffort': 'low', 'permissions': 'read-only/never', **before}
    write('status-%d-%s.txt' % (serial, profile), text)

def observe():
    if accepted() != baseline:
        raise RuntimeError('The fixture accepted turn history changed. No further action is permitted.')
    value = owner()
    common = {'tty': tty, 'tabLifetime': digest('fixture-shell:' + str(shell.pid)), 'windowIdentity': digest('private-pty:' + str(shell.pid)),
              'shellIdentity': 'fixture-shell-' + str(shell.pid), 'sessionId': thread, 'directory': project, 'acceptedTurnsHash': baseline,
              'busy': False, 'queueEmpty': True, 'pendingReceiptsResolved': True}
    if value is None:
        if 'CLAWDAD_FIXTURE>' not in visible():
            raise RuntimeError('The original shell is not observed.')
        return {**common, 'kind': 'shell', 'draft': {'text': '', 'hash': digest(''), 'verified': True, 'provenance': 'rendered-composer'}}
    if not status or value['processIdentity'] != status['processIdentity'] or not verify_draft() or 'esc to interrupt' in visible():
        raise RuntimeError('The exact idle status and draft are unavailable.')
    return {**common, **value, 'kind': 'agent', 'authorizationHome': str(base / status['profile']), 'email': status['email'],
            'model': status['model'], 'reasoningEffort': status['reasoningEffort'], 'settingsVerified': True, 'launchPolicyVerified': True,
            'shellWillRemain': True, 'executable': '/opt/homebrew/bin/codex', 'resumeOptions': ['--sandbox', 'read-only', '--ask-for-approval', 'never'],
            'images': [], 'draft': {'text': known, 'hash': digest(known), 'verified': True,
                                  'provenance': 'unchanged-native-paste' if '\n' in known else 'rendered-composer'}}

def launch(profile, request_id):
    global current, known, status
    if profile not in ('cody', 'sun') or owner() is not None:
        raise RuntimeError('Launch requires an empty private shell and an approved retained account.')
    wait(lambda text: 'CLAWDAD_FIXTURE>' in text)
    args = ['/usr/bin/env', 'CODEX_HOME=' + str(base / profile), '/opt/homebrew/bin/codex', 'resume', thread, '--cd', project, '--no-alt-screen',
            '--model', 'gpt-6-astra', '-c', 'model_reasoning_effort="low"', '-c', 'cli_auth_credentials_store="keyring"',
            '-c', 'sqlite_home=' + encoder.encode(str(fixture / 'index')), '--sandbox', 'read-only', '--ask-for-approval', 'never']
    screen.reset()
    shell.send(' '.join(shlex.quote(arg) for arg in args))
    time.sleep(0.25)
    shell.send('\r')
    known = ''
    status = None
    wait(lambda text: 'CLAWDAD_CONTINUITY_9F3A' in text and 'Ask Codex' in text and 'Resuming session' not in text, 35)
    current = profile
    capture_status(profile)
    receipts[request_id] = {'state': 'dispatched', 'effect': 'launch', 'processIdentity': status['processIdentity']}
    return observe()

def insert(text, request_id):
    global known
    before = observe()
    if before['kind'] != 'agent' or known or not text or len(text.encode()) > 16 * 1024 or any(ord(c) < 32 and c not in '\n\t' for c in text):
        raise RuntimeError('Only a bounded synthetic draft into the exact empty fixture composer is allowed.')
    # Bracketed paste is the CLI interface; Enter and Tab are never sent here.
    shell.send('\x1b[200~' + text + '\x1b[201~')
    known = text
    wait(lambda _: verify_draft())
    if owner()['processIdentity'] != before['processIdentity']:
        raise RuntimeError('Fixture input owner changed.')
    receipts[request_id] = {'state': 'dispatched', 'effect': 'draft'}
    return observe()

try:
    wait(lambda text: 'CLAWDAD_FIXTURE>' in text)
    for line in sys.stdin:
        request = json.loads(line)
        serial += 1
        try:
            action = request['method']
            args = request.get('args', {})
            if action == 'launch':
                result = launch(args['profile'], args['requestId'])
            elif action == 'observe':
                receive()
                result = observe()
            elif action == 'insert':
                result = insert(args['text'], args['requestId'])
            elif action == 'stop':
                before = observe()
                if before['kind'] != 'agent' or before['processIdentity'] != args['processIdentity'] or owner()['pid'] != before['pid']:
                    raise RuntimeError('Stop is restricted to the exact idle private fixture owner.')
                # This PID was launched under our one persistent fixture shell,
                # verified foreground, exact history, idle state and unchanged input.
                receipts[args['requestId']] = {'state': 'dispatched', 'effect': 'stop'}
                os.kill(before['pid'], signal.SIGTERM)
                wait(lambda text: owner() is None and 'CLAWDAD_FIXTURE>' in text)
                known = ''
                status = None
                result = observe()
            elif action == 'receipt':
                result = {'requestId': args['requestId'], 'durable': False, **receipts.get(args['requestId'], {'state': 'not_dispatched'})}
            elif action == 'finish':
                result = {'samePTY': tty, 'shellPid': shell.pid, 'acceptedTurnsHash': accepted(), 'baselineHash': baseline, 'modelTurnsSent': 0}
            else:
                raise RuntimeError('Unsupported fixture control.')
            write('rendered-%03d.txt' % serial, visible())
            print(encoder.encode({'id': request['id'], 'result': result}), flush=True)
        except Exception as error:
            write('failure-%03d.txt' % serial, visible())
            print(encoder.encode({'id': request['id'], 'error': str(error)}), flush=True)
finally:
    # Stop only this fixture's own descendants and PTY. A real user PID is never
    # accepted by this driver, and no Terminal application window was created.
    try:
        value = owner()
        if value:
            os.kill(value['pid'], signal.SIGTERM)
            for _ in range(50):
                receive()
                if owner() is None:
                    break
    finally:
        shell.close(force=True)
        write('synthetic-terminal.raw.txt', raw)
