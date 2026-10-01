#!/usr/bin/env python3
"""Drive a command inside a real pseudo-terminal, for testing interactive programs.

Usage: pty-driver.py COLS ROWS STEPS_JSON -- command [args...]
STEPS_JSON is a list of steps, run in order:
  {"send": "text"}                    write to the terminal (escape sequences included)
  {"wait": "regex", "timeout": 5}     wait until the output so far matches (ANSI codes removed)
  {"sleep": 0.2}
After the steps the child gets 3 seconds to exit on its own, then is killed.
Prints one JSON object: {"output": <plain text of everything shown>, "exit": <code|null>, "timed_out": bool}
"""
import fcntl, json, os, pty, re, select, struct, sys, termios, time

cols, rows, steps = int(sys.argv[1]), int(sys.argv[2]), json.loads(sys.argv[3])
cmd = sys.argv[sys.argv.index('--') + 1:]
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]')

pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execvp(cmd[0], cmd)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

buf = ''
def pump(timeout):
    global buf
    r, _, _ = select.select([fd], [], [], timeout)
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            return False
        if not data:
            return False
        buf += data.decode('utf-8', 'replace')
    return True

def plain():
    return ANSI.sub('', buf)

timed_out = False
for step in steps:
    if 'send' in step:
        os.write(fd, step['send'].encode())
        pump(0.05)
    elif 'sleep' in step:
        end = time.time() + step['sleep']
        while time.time() < end:
            pump(0.05)
    elif 'wait' in step:
        end = time.time() + step.get('timeout', 5)
        pattern = re.compile(step['wait'], re.S)
        while not pattern.search(plain()):
            if time.time() > end:
                timed_out = True
                break
            if not pump(0.05):
                break
        if timed_out:
            break

code = None
end = time.time() + 3
while time.time() < end:
    pump(0.05)
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        code = os.waitstatus_to_exitcode(status)
        break
if code is None:
    try:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
    except OSError:
        pass
print(json.dumps({'output': plain(), 'exit': code, 'timed_out': timed_out}))
