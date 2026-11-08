import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('parser-entry.js',import.meta.url))],bundle:true,format:'iife',globalName:'FitDecoder',platform:'browser',target:'es2020',minify:true,legalComments:'eof',outfile:fileURLToPath(new URL('../../public/vendor/fit-parser.js',import.meta.url))});
