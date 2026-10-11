# NoteVault

An auto-saving, searchable replacement for "open a new Notepad tab", with a GitHub-style activity bar.

## Install
1. Extract the zip anywhere and double-click **Install NoteVault.cmd**. No admin rights needed.
   - Needs Windows 10/11, Microsoft Edge (built in) and Node.js 22.13+. If Node.js is missing, the installer offers to install it with winget.
   - The installer isn't code-signed yet, so Windows SmartScreen may warn: choose **More info → Run anyway**.
2. The app is copied to `%LOCALAPPDATA%\Programs\NoteVault`; you can delete the zip afterwards.
3. Remove it any time: search the Start menu for **Uninstall NoteVault** (your notes are kept).

## Open it
- **Win → type `notev` → Enter**. A fresh note opens with the cursor ready. The Start-menu shortcut also gets the hotkey **Ctrl+Alt+N** (Windows may need a sign-out and back in before it responds).
- Optional faster first open: run `install.ps1 -Startup` (pre-starts it quietly at sign-in).

## Keys
| Key | Action |
|---|---|
| Ctrl+K (or Ctrl+P) | Command palette: search every note with live preview, or run any command |
| ↑ / ↓ / Enter | Pick a result — the note opens at the match |
| Ctrl+O | Show / hide the sidebar (notes by day, activity, Pinned, Trash) |
| / | Block menu on an empty line (headings, checklist, code, table, date…) |
| Select text | Floating format bar |
| Esc | Closes one thing at a time, back to the clean editor |
| Alt+N | New note |
| Ctrl+, | Settings · Ctrl+/ shortcuts |
| Ctrl + / - / 0, Ctrl + wheel | Text size |
| Tab / Shift+Tab | Indent / outdent list items; elsewhere Tab inserts a tab |

## Formatting (real rich text, like Windows Notepad)
Use the toolbar, the shortcuts, or just type the Markdown shortcut — it turns into formatting instantly.

| Key | Format | Or type |
|---|---|---|
| Ctrl+B / Ctrl+I / Ctrl+U | **Bold** / *italic* / underline | `**text**` / `*text*` |
| Ctrl+Shift+S | Strikethrough | `~~text~~` |
| Ctrl+Shift+H | Highlight | `==text==` |
| Ctrl+E | Inline code | text between backticks |
| Ctrl+Shift+K | Link (Ctrl+click a link to open it) | |
| Ctrl+Alt+1 / 2 / 3, Ctrl+Alt+0 | Heading 1 / 2 / 3, normal text | `# ` `## ` `### ` |
| Ctrl+Shift+8 / 7 / 9 | Bullets / numbers / checklist | `- ` `1. ` `[ ] ` |
| Ctrl+Shift+B | Quote | `> ` |
| Ctrl+Alt+C | Code block (syntax coloured) | three backticks |

- Code you paste from VS Code / Notepad goes into a code block automatically, indentation intact.
- Click a checkbox to tick it. Tab / Shift+Tab indent list items; elsewhere Tab inserts a tab.
- Tables, quotes, divider lines and today's date are in the toolbar's **+** menu (and the / menu).
- The toolbar can be hidden in Settings → Editor; the / menu and the selection bar still work.

## Where things live
- Notes: `%LOCALAPPDATA%\NoteVault\notes.db` (SQLite; kept out of OneDrive on purpose, since sync can corrupt live databases)
- Daily backups (last 14): `%LOCALAPPDATA%\NoteVault\backups\`
- Version history: kept automatically every 10 min of editing, when you return to a note later, and before any big deletion.
- Delete only moves notes to Trash (sidebar → Trash), with an Undo right after.

## Other
- Settings → Data → Import: pulls in Windows Notepad's unsaved tabs (duplicates skipped).
- Uninstall: Start menu → **Uninstall NoteVault**, or `install.ps1 -Uninstall` (notes are kept).
- Runs entirely on this PC at `http://127.0.0.1:47823`; it accepts no outside connections.
