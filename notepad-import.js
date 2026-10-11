// Best-effort reader for Windows 11 Notepad's unsaved-tab files
// (%LOCALAPPDATA%\Packages\Microsoft.WindowsNotepad_*\LocalState\TabState\*.bin).
// The format is undocumented; layout observed:
//   "NP" | seq uleb | type uleb (0 = unsaved) | 1 byte | selStart uleb | selEnd uleb
//   | wordWrap, rtl, showUnicode (3 bytes) | optCount uleb + optCount bytes
//   | contentLen uleb | content UTF-16LE | unsaved flag (1) | crc32 (4)
//   then zero or more edit chunks: pos uleb | delCount uleb | addCount uleb | UTF-16LE | crc32 (4)
// Tabs that belong to a saved file (type != 0) are skipped — that text is already on disk.
const fs = require('node:fs');
const path = require('node:path');

function uleb(buf, o) {
  let result = 0, shift = 0, b;
  do {
    if (o.i >= buf.length) throw new Error('eof');
    b = buf[o.i++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return result;
}

function utf16(buf, o, chars) {
  if (o.i + chars * 2 > buf.length) throw new Error('eof');
  const s = buf.toString('utf16le', o.i, o.i + chars * 2);
  o.i += chars * 2;
  return s;
}

function parseTab(buf) {
  if (buf.length < 4 || buf[0] !== 0x4e || buf[1] !== 0x50) return null;
  const o = { i: 2 };
  uleb(buf, o); // sequence number
  if (uleb(buf, o) !== 0) return null; // tab backed by a saved file
  o.i += 1;
  uleb(buf, o); uleb(buf, o); // selection start / end
  o.i += 3; // word wrap, rtl, show unicode
  const optCount = uleb(buf, o);
  o.i += optCount; // option bytes
  let text = utf16(buf, o, uleb(buf, o));
  o.i += 1 + 4; // unsaved flag + crc
  while (o.i < buf.length) {
    try {
      const pos = uleb(buf, o), del = uleb(buf, o), add = uleb(buf, o);
      const ins = utf16(buf, o, add);
      o.i += 4;
      if (pos > text.length) break;
      text = text.slice(0, pos) + ins + text.slice(pos + del);
    } catch {
      break;
    }
  }
  return text.replace(/\r\n?/g, '\n');
}

function importNotepadTabs() {
  const pkgRoot = path.join(process.env.LOCALAPPDATA || '', 'Packages');
  const out = [];
  let pkgs = [];
  try { pkgs = fs.readdirSync(pkgRoot).filter((d) => d.startsWith('Microsoft.WindowsNotepad_')); } catch { return out; }
  for (const pkg of pkgs) {
    const dir = path.join(pkgRoot, pkg, 'LocalState', 'TabState');
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.bin(\.bak)?$/.test(f) || /\.\d+\.bin$/.test(f)) continue; // skip per-tab state siblings (x.0.bin / x.1.bin)
      const full = path.join(dir, f);
      try {
        const text = parseTab(fs.readFileSync(full));
        if (text && text.trim()) out.push({ file: full, text, mtime: fs.statSync(full).mtimeMs });
      } catch { /* unreadable tab — ignore */ }
    }
  }
  return out;
}

module.exports = { importNotepadTabs, parseTab };
