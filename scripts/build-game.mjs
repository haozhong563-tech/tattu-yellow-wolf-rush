import { build } from 'vite';
import { rename, writeFile } from 'node:fs/promises';
await build({configFile:new URL('../vite.game.config.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
const out=new URL('../dist-game/',import.meta.url);
await rename(new URL('play.html',out),new URL('index.html',out));
await writeFile(new URL('.nojekyll',out),'');
console.log('Static Phaser game ready in dist-game; all asset URLs are relative.');
