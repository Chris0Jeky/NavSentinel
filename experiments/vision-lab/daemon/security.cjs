'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../shared/core.js');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const digest = event => hash(JSON.stringify(Core.normalizeEvent(event)));
const randomToken = () => crypto.randomBytes(32).toString('base64url');
function constantEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string') return false;
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
class CapabilityStore {
  constructor({now=Date.now, max=256}={}) { this.now=now; this.max=max; this.items=new Map(); }
  prune(){ for(const [k,v] of this.items) if(v.expiresAt<=this.now()) this.items.delete(k); }
  issue({event,caller,requestId,ttl=30000}){
    this.prune();
    if(!Number.isInteger(ttl)||ttl<1||ttl>30000) throw new Error('Invalid capability lifetime');
    if(this.items.size>=this.max) throw new Error('Capability capacity reached');
    const token=randomToken(), expiresAt=this.now()+ttl;
    this.items.set(token,{digest:digest(event),caller,requestId,expiresAt,event:Core.normalizeEvent(event)});
    return {token,requestId,expiresAt,oneUse:true};
  }
  consume({token,event,caller}){
    if(typeof token!=='string'||token.length>128) throw new Error('Invalid capability');
    const entry=this.items.get(token);
    if(!entry) throw new Error('Unknown, used or revoked capability');
    // Consume before validation. Even a mismatched attempt burns the grant.
    this.items.delete(token);
    if(entry.expiresAt<=this.now()) throw new Error('Capability expired');
    if(entry.caller!==caller) throw new Error('Capability caller mismatch');
    if(!constantEqual(entry.digest,digest(event))) throw new Error('Capability context mismatch');
    return entry;
  }
  revokeAll(){ this.items.clear(); }
}
class Ledger {
  constructor(directory,{limit=500}={}){
    if(!Number.isInteger(limit)||limit<1||limit>10000) throw new Error('Invalid journal limit');
    this.limit=limit;this.directory=directory;this.file=path.join(directory,'journal.json');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    this.state={schema:1,anchor:'0'.repeat(64),baseSequence:0,nextSequence:1,entries:[]};
    if(fs.existsSync(this.file)){
      if(fs.lstatSync(this.file).isSymbolicLink()) throw new Error('Refusing symlinked journal');
      if(fs.statSync(this.file).size>4*1024*1024) throw new Error('Journal exceeds size limit');
      this.state=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(!this.verify()) throw new Error('Journal integrity check failed; no data was overwritten');
      if(this.state.entries.length>this.limit) throw new Error('Journal exceeds configured row bound');
    }
  }
  entryHash(entry){ return hash(JSON.stringify({sequence:entry.sequence,timestamp:entry.timestamp,previous:entry.previous,data:entry.data})); }
  verify(){
    const s=this.state;
    if(!s||s.schema!==1||!Array.isArray(s.entries)||!Number.isInteger(s.baseSequence)||!Number.isInteger(s.nextSequence)||typeof s.anchor!=='string'||!/^[a-f0-9]{64}$/.test(s.anchor))return false;
    let prev=s.anchor,seq=s.baseSequence;
    for(const e of s.entries){ if(e.previous!==prev||e.sequence!==++seq||e.hash!==this.entryHash(e))return false;prev=e.hash; }
    return s.nextSequence===seq+1;
  }
  persist(){
    const temp=`${this.file}.${process.pid}.tmp`;
    const fd=fs.openSync(temp,'w',0o600);
    try {fs.writeFileSync(fd,JSON.stringify(this.state));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(temp,this.file);
  }
  append(data){
    if(!this.verify())throw new Error('Journal integrity failed');
    const encoded=JSON.stringify(data);
    if(Buffer.byteLength(encoded)>8192)throw new Error('Receipt exceeds byte limit');
    const old=structuredClone(this.state);
    const e={sequence:this.state.nextSequence++,timestamp:new Date().toISOString(),previous:this.state.entries.at(-1)?.hash||this.state.anchor,data:JSON.parse(encoded)};
    e.hash=this.entryHash(e);this.state.entries.push(e);
    while(this.state.entries.length>this.limit){const dropped=this.state.entries.shift();this.state.anchor=dropped.hash;this.state.baseSequence=dropped.sequence;}
    try {this.persist();}catch(error){this.state=old;throw error;}
    return structuredClone(e);
  }
  snapshot(){return structuredClone({...this.state,verified:this.verify(),integrityMeaning:'Local hash-chain consistency, not an external signature or proof against an OS-level attacker'});}
}
module.exports={CapabilityStore,Ledger,constantEqual,randomToken,digest,hash};
