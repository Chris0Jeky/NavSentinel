'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'extension/content.js'),'utf8');
const NSCore=require('../shared/core.js');
function load(){
  const sent=[],notices=[],handlers={};
  const window={addEventListener:(t,f)=>{handlers[t]=f;}};
  class Element{matches(){return true;}}
  class HTMLFormElement{}
  class HTMLAnchorElement{}
  const document={
    documentElement:null,
    addEventListener(){},
    append(){},
    elementsFromPoint(){return [];},
    querySelectorAll(){return [];},
    createElement(){
      const el={style:{},_text:'',isConnected:false,
        append(c){if(c&&typeof c.textContent==='string'&&c.textContent.includes('NavSentinel'))notices.push(c.textContent);},
        remove(){},
        attachShadow(){return {append(box){if(box&&typeof box.textContent==='string')notices.push(box.textContent);}};}};
      Object.defineProperty(el,'textContent',{get(){return this._text;},set(v){this._text=v;if(typeof v==='string'&&v.includes('NavSentinel'))notices.push(v);}});
      return el;
    }
  };
  const chrome={runtime:{id:'x',sendMessage(m){sent.push(m);return Promise.resolve({enabled:true});},onMessage:{addListener(){}}}};
  const CoreBridge=Object.assign({},NSCore,{evaluate:e=>NSCore.evaluate(JSON.parse(JSON.stringify(e)))});
  const context={NSCore:CoreBridge,crypto:require('node:crypto').webcrypto,location:{href:'https://site.test/',origin:'https://site.test'},
    window,document,chrome,MutationObserver:class{observe(){}disconnect(){}},Element,HTMLFormElement,HTMLAnchorElement,
    getComputedStyle:()=>({position:'static',pointerEvents:'auto',opacity:'1'}),setTimeout:()=>0,
    innerWidth:1024,innerHeight:768,URL,console};
  vm.runInNewContext(src,context,{timeout:1000});
  return {context,handlers,sent,notices,Element,HTMLFormElement};
}
const tick=()=>new Promise(r=>setImmediate(r));
const sensors=sent=>sent.filter(m=>m&&m.type==='sensor');
function clickEvent(anchor,counts){
  return {isTrusted:true,button:0,composedPath:()=>[anchor],preventDefault:()=>{counts.prevented++;},stopImmediatePropagation:()=>{counts.stopped++;}};
}
test('credential-bearing navigation is held without sensor report',async()=>{
  const h=load();await tick();
  const anchor=new h.Element();anchor.href='https://user:secret@evil.test/';anchor.innerText='';anchor.textContent='';
  const counts={prevented:0,stopped:0};
  h.handlers.click(clickEvent(anchor,counts));
  assert.equal(counts.prevented,1);
  assert.equal(counts.stopped,1);
  assert.equal(sensors(h.sent).length,0);
  assert.ok(h.notices.some(t=>t.includes('A navigation to an invalid or credential-bearing address was held. No click was replayed.')));
});
test('overlong navigation is held without sensor report',async()=>{
  const h=load();await tick();
  const anchor=new h.Element();anchor.href='https://evil.test/'+'a'.repeat(3000);anchor.innerText='';anchor.textContent='';
  const counts={prevented:0,stopped:0};
  h.handlers.click(clickEvent(anchor,counts));
  assert.equal(counts.prevented,1);
  assert.equal(counts.stopped,1);
  assert.equal(sensors(h.sent).length,0);
});
test('password-form submit to credential-bearing destination is held without sensor report',async()=>{
  const h=load();await tick();
  const form=new h.HTMLFormElement();form.action='https://user:secret@evil.test/';form.querySelector=()=>({});
  const counts={prevented:0,stopped:0};
  h.handlers.submit({target:form,submitter:undefined,isTrusted:true,preventDefault:()=>{counts.prevented++;},stopImmediatePropagation:()=>{counts.stopped++;}});
  assert.equal(counts.prevented,1);
  assert.equal(sensors(h.sent).length,0);
  assert.ok(h.notices.some(t=>t.includes('A captured password-form submission to an invalid destination was held. Password values were not read.')));
});
test('normal cross-origin navigation is not held',async()=>{
  const h=load();await tick();
  const anchor=new h.Element();anchor.href='https://other.test/';anchor.innerText='';anchor.textContent='';
  const counts={prevented:0,stopped:0};
  h.handlers.click(clickEvent(anchor,counts));
  assert.equal(counts.prevented,0);
  assert.equal(sensors(h.sent).length,0);
});
