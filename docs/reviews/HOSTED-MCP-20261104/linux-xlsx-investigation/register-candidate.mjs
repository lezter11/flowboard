import {registerHooks} from 'node:module';
const candidate=new URL('./candidate-both-excel-parser.ts',import.meta.url).href,xml=new URL('./candidate-both-import-xml.ts',import.meta.url).href;
registerHooks({resolve(specifier,context,next){const resolved=next(specifier,context);if(resolved.url.endsWith('/apps/api/src/services/excel-parser.ts'))return {...resolved,url:candidate};if(resolved.url.endsWith('/apps/api/src/services/import-xml.ts'))return {...resolved,url:xml};return resolved;}});
