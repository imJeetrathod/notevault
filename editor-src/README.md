# Editor source

`editor.js` here is bundled into `../public/editor.js` (already built — you only need this to change the editor).

Rebuild, in any empty folder outside OneDrive:

```
npm install @tiptap/core@3.31.4 @tiptap/pm@3.31.4 @tiptap/starter-kit@3.31.4 @tiptap/extension-highlight@3.31.4 @tiptap/extension-list@3.31.4 @tiptap/extension-table@3.31.4 @tiptap/extension-code-block-lowlight@3.31.4 @tiptap/extensions@3.31.4 @tiptap/extension-image@3.31.4 lowlight@3.3.0 esbuild@0.28.2
copy <NoteVault>\editor-src\editor.js .
npx esbuild editor.js --bundle --minify --format=iife --global-name=NVEditor --target=chrome110 --outfile=<NoteVault>\public\editor.js
```
