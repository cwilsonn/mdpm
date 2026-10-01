// Turns raw terminal input into key events. A single read can carry several keys (pasted text, key repeat)
// and escape sequences (arrows), so parsing walks the chunk.

export interface Key {
  name: 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageup' | 'pagedown' | 'enter' | 'escape' | 'backspace' | 'tab' | 'ctrl-c' | 'ctrl-u' | 'char'
  char?: string
}

const SEQUENCES: [string, Key['name']][] = [
  ['\x1b[A', 'up'], ['\x1b[B', 'down'], ['\x1b[C', 'right'], ['\x1b[D', 'left'],
  ['\x1bOA', 'up'], ['\x1bOB', 'down'], ['\x1bOC', 'right'], ['\x1bOD', 'left'],
  ['\x1b[H', 'home'], ['\x1b[F', 'end'], ['\x1b[1~', 'home'], ['\x1b[4~', 'end'],
  ['\x1b[5~', 'pageup'], ['\x1b[6~', 'pagedown'],
]

export function parseKeys(input: string): Key[] {
  const keys: Key[] = []
  for (let i = 0; i < input.length;) {
    const rest = input.slice(i)
    const seq = SEQUENCES.find(([s]) => rest.startsWith(s))
    if (seq) { keys.push({ name: seq[1] }); i += seq[0].length; continue }
    const c = input[i]!
    i++
    if (c === '\x1b') {
      // An unrecognized escape sequence (function keys, mouse reports) is swallowed whole rather than typed.
      const unknown = rest.match(/^\x1b\[[0-?]*[ -/]*[@-~]/)
      if (unknown) { i += unknown[0].length - 1; continue }
      keys.push({ name: 'escape' })
    }
    else if (c === '\r' || c === '\n') keys.push({ name: 'enter' })
    else if (c === '\x7f' || c === '\b') keys.push({ name: 'backspace' })
    else if (c === '\t') keys.push({ name: 'tab' })
    else if (c === '\x03') keys.push({ name: 'ctrl-c' })
    else if (c === '\x15') keys.push({ name: 'ctrl-u' })
    else if (c >= ' ') {
      // Keep surrogate pairs (emoji) together.
      const cp = String.fromCodePoint(input.codePointAt(i - 1)!)
      i += cp.length - 1
      keys.push({ name: 'char', char: cp })
    }
  }
  return keys
}
