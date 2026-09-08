'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const css=read('web/style.css');
const modes=[['extension','NavSentinel-Browser.html','The browser guardian'],['desktop','NavSentinel-Desktop.html','The desktop companion'],['relay','NavSentinel-Intent-Relay.html','The intent broker']];
for(const [mode,file,title]of modes){
 const scripts=[read('shared/core.js'),read('shared/scenarios.js'),read('shared/evidence.js'),read('web/renderer.js'),read('web/evidence-workspace.js'),`globalThis.NS_INITIAL_MODE=${JSON.stringify(mode)};`,read('web/app.js')].map(x=>x.replace(/<\/script/gi,'<\\/script'));
 const hashes=scripts.map(x=>`'sha256-${crypto.createHash('sha256').update(x).digest('base64')}'`).join(' ');
 const csp=`default-src 'none'; script-src ${hashes}; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>NavSentinel · ${title}</title><style>${css}</style></head><body><div id="app"></div><dialog id="dialog" class="dialog" aria-label="Action dialog"></dialog><dialog id="drawer" class="drawer" aria-label="Decision details"></dialog><div id="toasts" class="toasts" aria-live="polite" role="status"></div>${scripts.map(x=>`<script>${x}</script>`).join('')}</body></html>`;
 fs.writeFileSync(path.join(root,file),html);console.log(`Built ${file}: ${Buffer.byteLength(html)} bytes; inline scripts hash-pinned; no network access.`);
}
fs.copyFileSync(path.join(root,'shared/core.js'),path.join(root,'extension/shared/core.js'));
const fixtureNames=require('../shared/scenarios.js').map(s=>s.id);fs.writeFileSync(path.join(root,'artifacts/fixture-manifest.json'),JSON.stringify({schema:1,kernel:require('../shared/core.js').VERSION,fixtures:fixtureNames,evidence:'Synthetic kernel contracts only'},null,2));
