export const RAIL_MINI_KEY = 'flowboard-rail-mini';

/** Pre-paint script (app/layout.tsx, after the theme script): the collapsed rail must not flash open. Server-safe, no React. */
export const RAIL_BOOT_SCRIPT = "try{if(localStorage.getItem('flowboard-rail-mini')==='1')document.documentElement.dataset.rail='mini'}catch(e){}";
