import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({base:'./', publicDir:'public',build:{outDir:'dist-game',emptyOutDir:true,rollupOptions:{input:resolve(import.meta.dirname,'play.html')}},server:{host:'0.0.0.0',port:4173,strictPort:true},preview:{host:'0.0.0.0',port:4174,strictPort:true}});
