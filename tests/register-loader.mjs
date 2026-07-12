import { register } from 'node:module';

register('./module-loader.mjs', import.meta.url);
