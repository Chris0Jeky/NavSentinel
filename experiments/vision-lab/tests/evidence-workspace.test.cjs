'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../shared/evidence.js');
const source=fs.readFileSync(path.join(__dirname,'../web/evidence-workspace.js'),'utf8');
const STORAGE='navsentinel-imported-evidence-v1';
const fixture={format:'navsentinel-evidence',schema:1,source:'navsentinel-extension',evidence:'recorded-observation',exportedAt:'2026-09-08T00:00:00.000Z',events:[
 {id:'event-1',timestamp:'2026-09-08T00:00:00.000Z',kind:'nav_click_block',sourceSite:'source.test',destinationSite:null,outcome:'recorded',reasons:[]}
]};

function workspace(){
 const listeners={},closeTasks=[],storage=new Map();let onClose;
 class Element{constructor(action){this.dataset={evidenceAction:action};}closest(){return this;}}
 const dialog={open:false,innerHTML:'',showModal(){this.open=true;},close(){this.open=false;closeTasks.push(()=>onClose({currentTarget:dialog}));},addEventListener(type,fn){assert.equal(type,'close');onClose=fn;}};
 const context={NSEvidence:E,NSRenderer:{escape:String},Element,
  document:{getElementById:id=>{assert.equal(id,'dialog');return dialog;},addEventListener:(type,fn)=>{listeners[type]=fn;}},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
 vm.runInNewContext(source,context,{timeout:1000});
 context.NSEvidenceWorkspace.mount({isConnected:true,innerHTML:''});
 return {dialog,storage,
  importFile:async value=>{const text=JSON.stringify(value);await listeners.change({target:{id:'evidence-file',files:[{size:Buffer.byteLength(text),text:async()=>text}],value:'selected'}});},
  click:async action=>{listeners.click({target:new Element(action)});await Promise.resolve();},
  // Native close removes open immediately, then queues its close event.
  flushClose:()=>{while(closeTasks.length)closeTasks.shift()();}};
}

test('a queued close from clear cannot discard the next review import',async()=>{
 const h=workspace();await h.importFile(fixture);await h.click('apply');h.flushClose();
 const review=E.exportReview(E.correct(JSON.parse(h.storage.get(STORAGE)),'observation-1','uncertain','2026-09-08T00:00:01.000Z'));
 await h.click('clear');await h.click('confirm-clear');
 assert.equal(JSON.parse(h.storage.get(STORAGE)).events.length,0);
 await h.importFile(review);assert.equal(h.dialog.open,true);
 h.flushClose();await h.click('apply');
 const restored=JSON.parse(h.storage.get(STORAGE));
 assert.deepEqual(restored.events,review.events);
 assert.deepEqual(restored.corrections,review.corrections);
});

test('closing the current import still discards its pending file',async()=>{
 const h=workspace();await h.importFile(fixture);
 h.dialog.close();h.flushClose();await h.click('apply');
 assert.equal(h.storage.has(STORAGE),false);
 assert.match(h.dialog.innerHTML,/Choose a valid evidence file first/);
});
