/* Explicit file interchange only. Imported observations never carry action authority. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NSEvidence=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MAX_BYTES=8*1024*1024,MAX_EVENTS=5000,MAX_CORRECTIONS=5000;
const KINDS=Object.freeze(['nav_blank_prompt','nav_click_block','nav_silent_allow','nav_rollback','nav_allowlist_add','nav_allowlist_remove','cred_submit_prompt','cred_submit_allow_once','cred_trust_domain','cred_untrust_domain','cred_paste_warn','cred_form_evaluated','suite_config_update','clickfix_detected','dblclickjack_detected','nav_reputation_late_warn','mutation_alert','pushstate_abuse','bridge_buffer_overflow']);
const REASONS=Object.freeze(['no_accessible_name','minimal_accessible_name','overlay_large_interactive','overlay_medium_interactive','intent_mismatch_under_interactive','retargeted_target_mismatch','overlay_high_zindex','overlay_elevated_zindex','invisible_but_clickable','near_invisible_opacity','low_opacity','cursor_pointer_no_affordance','keyboard_activation','legit_modal_backdrop','composite_escalation','nrs_new_tab_window','nrs_cross_site','nrs_fast_attempt','nrs_user_activation_active','nrs_multiple_attempts','nrs_allowlisted','nrs_explicit_new_tab_intent','nrs_double_click_hijack','nrs_known_bad_domain','nrs_redirect_chain_depth','nrs_redirect_via_known_redirector','nrs_oauth_redirect_mismatch','nrs_oauth_opener_manipulation','nrs_clickfix_active','nrs_opener_previously_allowed','nrs_pushstate_abuse','nrs_nav_anomaly','nrs_csp_weakness','nrs_domain_repeat_offender','nrs_js_behavior_suspicious','clipboard_command_with_overlay','clipboard_write_with_overlay','clickfix_instruction_pattern','clickfix_paste_instruction','clickfix_captcha_text_with_overlay','overlay_detected','overlay_injected','form_action_changed','password_injected','suspicious_iframe','clickfix_detected','dblclickjack_detected','mutation_alert','pushstate_abuse']);
const CORRECTIONS=Object.freeze(['should-allow','should-block','uncertain']);
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error(label+' must be an object.');}
function keys(value,allowed,label){object(value,label);if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error(label+' contains unsupported fields. Export minimized evidence from the extension first.');}
function iso(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw Error('Expected a canonical ISO timestamp.');return value;}
function opaque(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_:]{1,100}$/.test(value))throw Error('Invalid observation identifier.');return value;}
function site(value){
  if(value===null)return null;
  const invalid=()=>{throw Error('Sites must be canonical hostnames, never URLs, paths, or user information.');};
  if(typeof value!=='string'||!value.length||value.length>253||value!==value.toLowerCase())return invalid();
  // The extension exports IPv6 without brackets. Only parse a lexically fenced
  // address; never extract a hostname from arbitrary URL-shaped metadata.
  if(value.includes(':')){
    if(!/^[0-9a-f:.]+$/.test(value))return invalid();
    try{if(new URL('https://['+value+']/').hostname!=='['+value+']')return invalid();}
    catch{return invalid();}
    return value;
  }
  if(!value.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return invalid();
  if(/^\d+(?:\.\d+){3}$/.test(value)){
    try{if(new URL('https://'+value+'/').hostname!==value)return invalid();}
    catch{return invalid();}
  }
  return value;
}
function event(value){keys(value,['id','timestamp','kind','sourceSite','destinationSite','outcome','reasons','score'],'Observation');if(!KINDS.includes(value.kind)||value.outcome!=='recorded')throw Error('Unsupported event kind or outcome.');if(!Array.isArray(value.reasons)||value.reasons.length>16||value.reasons.some(reason=>!REASONS.includes(reason)))throw Error('Unsupported or excessive reason codes.');const result={id:opaque(value.id),timestamp:iso(value.timestamp),kind:value.kind,sourceSite:site(value.sourceSite),destinationSite:site(value.destinationSite),outcome:'recorded',reasons:[...new Set(value.reasons)]};if(Object.hasOwn(value,'score')){if(typeof value.score!=='number'||!Number.isFinite(value.score)||value.score<0||value.score>100)throw Error('Score must be between 0 and 100.');result.score=value.score;}return result;}
function envelope(value){keys(value,['format','schema','exportedAt','source','evidence','events'],'Evidence file');if(value.format!=='navsentinel-evidence'||value.schema!==1||value.source!=='navsentinel-extension'||value.evidence!=='recorded-observation')throw Error('This is not a supported NavSentinel extension evidence export.');if(!Array.isArray(value.events)||value.events.length>MAX_EVENTS)throw Error('Evidence must contain at most '+MAX_EVENTS+' observations.');const seen=new Set(),events=value.events.map(row=>{const clean=event(row);if(seen.has(clean.id))throw Error('Duplicate observation identifier in file.');seen.add(clean.id);return clean;});return {format:'navsentinel-evidence',schema:1,exportedAt:iso(value.exportedAt),source:'navsentinel-extension',evidence:'recorded-observation',events};}
function parse(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('Evidence file exceeds the 8 MiB limit.');return envelope(JSON.parse(text));}
function reviewEnvelope(value){keys(value,['format','schema','exportedAt','source','evidence','events','corrections'],'Review file');if(value.format!=='navsentinel-evidence-review'||value.schema!==1||value.source!=='explicit-file-import'||value.evidence!=='recorded-observation-not-independent-proof')throw Error('This is not a supported NavSentinel evidence review.');const clean=restore({schema:value.schema,events:value.events,corrections:value.corrections});return {format:value.format,schema:1,exportedAt:iso(value.exportedAt),source:value.source,evidence:value.evidence,events:clean.events,corrections:clean.corrections};}
function importEnvelope(value){return value?.format==='navsentinel-evidence-review'?reviewEnvelope(value):envelope(value);}
function parseImport(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('Evidence file exceeds the 8 MiB limit.');return importEnvelope(JSON.parse(text));}
function empty(){return {schema:1,events:[],corrections:[]};}
function merge(state,input){
  const clean=importEnvelope(input),existing=restore(state),events=existing.events.slice(),corrections=existing.corrections.slice();
  const importedCorrections=clean.corrections||[];
  if(events.length+clean.events.length>MAX_EVENTS)throw Error('Imported history is full. Export and clear it before importing more.');
  if(corrections.length+importedCorrections.length>MAX_CORRECTIONS)throw Error('Correction history is full. Export and clear it before importing more.');
  const used=new Set(events.map(row=>row.id)),remap=new Map();let sequence=events.length+1;
  for(const row of clean.events){let id;do{id='observation-'+sequence++;}while(used.has(id));used.add(id);remap.set(row.id,id);events.push({...row,id});}
  for(const item of importedCorrections)corrections.push({...item,eventId:remap.get(item.eventId)});
  return {state:{schema:1,events,corrections},added:clean.events.length};
}
function restore(value){keys(value,['schema','events','corrections'],'Saved evidence');if(value.schema!==1||!Array.isArray(value.events)||value.events.length>MAX_EVENTS||!Array.isArray(value.corrections)||value.corrections.length>MAX_CORRECTIONS)throw Error('Invalid saved evidence.');const events=value.events.map(event),ids=new Set(events.map(row=>row.id));if(ids.size!==events.length)throw Error('Duplicate saved observation.');const corrections=value.corrections.map(item=>{keys(item,['eventId','kind','timestamp'],'Correction');if(!ids.has(item.eventId)||!CORRECTIONS.includes(item.kind))throw Error('Invalid correction.');return {eventId:opaque(item.eventId),kind:item.kind,timestamp:iso(item.timestamp)};});return {schema:1,events,corrections};}
function correct(state,eventId,kind,now=new Date().toISOString()){if(!state.events.some(row=>row.id===eventId)||!CORRECTIONS.includes(kind))throw Error('Unknown observation or correction.');if(state.corrections.length>=MAX_CORRECTIONS)throw Error('Correction history is full. Export and clear imported history to continue.');return {schema:1,events:state.events.slice(),corrections:[...state.corrections,{eventId,kind,timestamp:iso(now)}]};}
function project(row){const clean=event(row);return {source:clean.sourceSite||'Not recorded',observation:clean.kind.replaceAll('_',' '),destination:clean.destinationSite||'Not recorded',outcome:'Recorded observation',knowledgeGap:'This file records an extension event. It does not independently prove prevention, destination arrival, or recovery.',reasons:clean.reasons.slice()};}
function exportReview(state,now=new Date().toISOString()){const clean=restore(state);return {format:'navsentinel-evidence-review',schema:1,exportedAt:iso(now),source:'explicit-file-import',evidence:'recorded-observation-not-independent-proof',events:clean.events,corrections:clean.corrections};}
return Object.freeze({MAX_BYTES,MAX_EVENTS,KINDS,REASONS,CORRECTIONS,parse,parseImport,envelope,reviewEnvelope,event,empty,merge,restore,correct,project,exportReview});
});
