/** Explicit child-form diagnostic adapter. This is not the native four-arm proof contract. */
import { FORM_DOCUMENT_SCHEMA, DOCUMENT_POLICY, documentLifetimes } from './form-documents.mjs';
export const FORM_SCHEMA = 'navsentinel.observatory.form.v1';
const variants = ['alternate-submitter','action-substitution','target-mutation','method-mutation','enctype-mutation','base-href','base-target','reassociation','expired','mismatch-burn','synthetic','location-same','location-different','late-submit','exact-submit','exact-request','native','server-redirect','slow-response','empty-target','inherited-target','empty-method','invalid-method','self','dialog','validation','replay','allow-once','allow-mutated','mixed'];
const documentExperiments = {
 'same-url-siblings':'Same-URL sibling frames report independently. A report from one must not adopt the other’s input.',
 'same-frame-reload':'Reloading the same frame and URL creates a new reporting document. Old input is not reusable for display.',
 'same-document-navigation':'A fragment navigation retains the same reporting realm rather than fabricating a new document.',
 'frame-replacement':'A removed frame and a newly inserted frame have distinct identities, even at the same URL.',
 'spoofed-identity-disposal':'Hostile payload identity is rejected. Stopping the observer prevents further collection.',
 'borrowed-reporting-function':'A same-origin sibling calls a donor frame’s reporting function. The label identifies that function’s realm, not the initiating script.',
};
const benign = new Set(['exact-submit','exact-request','native','server-redirect','slow-response','empty-target','inherited-target','empty-method','invalid-method','self','dialog','validation','allow-once']);
const descriptions = {
  'alternate-submitter': 'The page invokes a different submit button from the one clicked. Its target override attempts to navigate the top page.',
  'action-substitution': 'The clicked button overrides the form with a benign destination. The page calls submit() without that button, exposing the harmful form action.',
  'target-mutation': 'The page changes a submitter target after input, attempting to turn a child-only submission into top-page navigation.',
  'method-mutation': 'The page changes the effective request method after the original interaction.',
  'enctype-mutation': 'The page changes the effective encoding after the original interaction. No request body or input value is recorded.',
  'base-href': 'Changing the document base changes where a relative form action resolves.',
  'base-target': 'Changing the document base target changes which browsing context the form would navigate.',
  reassociation: 'The clicked submitter is moved to another form before requestSubmit(). Form ownership and destination must be interpreted together.',
  expired: 'The fixture delays its operation beyond the original authority window.',
  'mismatch-burn': 'The fixture attempts a changed intent, restores the original method, then tries to spend the original authority again.',
  synthetic: 'A page-script click, rather than runner-dispatched pointer input, attempts to authorize the form operation.',
  'location-same': 'A Location navigation tries to reuse a form interaction. An accepted receiver request cannot be undone by later rollback.',
  'location-different': 'The page performs a Location navigation rather than the authorized form operation.',
  'late-submit': 'A native submit listener changes the destination late in submission. Receiver acceptance and later browser recovery are separate facts.',
  replay: 'The same authority is spent twice after a response that leaves the document alive. Rejected receiver attempts are retained, not hidden.',
  'allow-mutated': 'The form destination changes while an Allow-once decision is pending. The replay must not silently adopt the changed intent.',
  mixed: 'A changed target is attempted first; a separate fresh interaction then performs the legitimate submission.',
};
const fields = {
  form:['f','g','other'],submitter:['a','b','none','other'],action:['harm','benign','fixture','other'],declaredAction:['harm','benign','fixture','other'],actionSource:['form','submitter'],
  method:['GET','POST','DIALOG'],encoding:['urlencoded','multipart','plain'],target:['self','top','parent','blank','named'],targetSource:['form','submitter','base','default'],targetOverride:['absent','empty','present'],methodOverride:['absent','empty','present'],
};
const faultCodes = ['RUNNER_FAILED','CLOCK_INVALID','RECEIVER_UNHEALTHY','RECEIVER_CALLBACK_LOSS','PAGE_ERROR','CLEANUP_FAILED','PROBE_REJECTED','EVENTS_DROPPED','PRODUCT_READ_FAILED','DOCUMENT_BINDING_INVALID','DOCUMENT_CONTEXT_UNKNOWN','DOCUMENT_CONTEXT_REUSED','DOCUMENT_FRAME_UNKNOWN','DOCUMENT_LIMIT','DOCUMENT_METADATA_INVALID','DOCUMENT_TRANSPORT_LOST'];
const fail = code => { throw new Error(`FORM_${code}`); };
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function keys(v, allowed) { if (!obj(v) || Object.keys(v).length !== allowed.length || Object.keys(v).some(k=>!allowed.includes(k))) fail('FIELDS_INVALID'); }
function one(v, list) { if (!list.includes(v)) fail('ENUM_INVALID'); return v; }
function number(v, max=86400000) { if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max) fail('NUMBER_INVALID'); return v; }
function integer(v,max=1000000){number(v,max);if(!Number.isSafeInteger(v))fail('INTEGER_INVALID');return v;}
function boolean(v){if(typeof v!=='boolean')fail('BOOLEAN_INVALID');return v;}
function token(v){if(typeof v!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(v))fail('ID_INVALID');return v;}
function hash(v,n){if(typeof v!=='string'||!(new RegExp(`^[a-f0-9]{${n}}$`)).test(v))fail('HASH_INVALID');return v;}
function intent(v){keys(v,[...Object.keys(fields),'ownerMatches']);for(const [k,choices]of Object.entries(fields))one(v[k],choices);boolean(v.ownerMatches);return {...v};}
export function parseFormTrace(raw, source, makeCase) {
  const bound = raw.schema === FORM_DOCUMENT_SCHEMA;
  const lifetimes = bound ? documentLifetimes() : null;
  keys(raw,['schema','mode','scenarioId','variant','pairId','runId','protectedArm','identity','completed','browserVersion','requiredObservationMs','dropped','gaps','events','evidencePolicy',...(bound ? ['bindingPolicy',...(Object.hasOwn(raw,'experiment')?['experiment']:[])] : [])]);
  if(bound)one(raw.bindingPolicy,[DOCUMENT_POLICY]);
  const experiment=bound && Object.hasOwn(raw,'experiment')?one(raw.experiment,['form-campaign',...Object.keys(documentExperiments)]):'form-campaign';
  one(raw.schema,[FORM_SCHEMA,FORM_DOCUMENT_SCHEMA]);one(raw.mode,['synthetic']);one(raw.scenarioId,['issue688-form-intent']);one(raw.variant,variants);
  one(raw.evidencePolicy,['FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION']);hash(raw.pairId,64);token(raw.runId);boolean(raw.protectedArm);boolean(raw.completed);
  keys(raw.identity,['head','tree','extensionSha256','fixtureSha256']);hash(raw.identity.head,40);hash(raw.identity.tree,40);hash(raw.identity.extensionSha256,64);hash(raw.identity.fixtureSha256,64);
  if(typeof raw.browserVersion!=='string'||!/^([0-9]+(?:\.[0-9]+){1,4}|not-recorded)$/.test(raw.browserVersion))fail('BROWSER_INVALID');
  one(raw.requiredObservationMs,[2300]);integer(raw.dropped);
  if(!Array.isArray(raw.gaps)||raw.gaps.length>faultCodes.length||new Set(raw.gaps).size!==raw.gaps.length)fail('GAPS_INVALID');
  for(const g of raw.gaps)one(g,faultCodes);
  if(!Array.isArray(raw.events)||raw.events.length<2||raw.events.length>512)fail('EVENT_COUNT_INVALID');
  const arm = !raw.protectedArm?'baseline':raw.variant==='mixed'?'mixed':benign.has(raw.variant)?'benign':'protected';
  const c = makeCase(source,raw.scenarioId,raw.variant,arm);c.id=`${source.id}-${raw.runId}`;c.mode='synthetic';
  c.title = benign.has(raw.variant)?`Legitimate form control: ${raw.variant.replaceAll('-',' ')}`:`Child-form intent: ${raw.variant.replaceAll('-',' ')}`;
  c.intent=descriptions[raw.variant]??'A legitimate form task exercises native submission, validation, target inheritance or response handling without changing the intended operation.';
  c.boundary='The inert loopback receiver records accepted and rejected requests, including their method. It drains bodies without parsing, storing or proving their contents.';
  if(experiment!=='form-campaign'){c.title=`Reporting documents: ${experiment.replaceAll('-',' ')}`;c.intent=documentExperiments[experiment];c.boundary='This observer lifecycle exercise dispatches synthetic reports to test attribution. It is not a form attack or a protection/receiver qualification.';c.warnings.push('OBSERVER_LIFECYCLE_NOT_PROTECTION_EVIDENCE');}
  c.identity={repositoryHead:raw.identity.head,extensionSha256:raw.identity.extensionSha256,fixtureSha256:raw.identity.fixtureSha256,browserVersion:raw.browserVersion,profile:'smart-debug',seed:null};
  c.validity=raw.completed?'unverified':'invalid';c.gaps=[...raw.gaps];c.facts={harmReceipts:0,benignReceipts:0,cumulativeReceipts:0,legitimateCompletions:null,recovered:false};
  const snapshots=[],health={start:null,end:null};let previous=-1,ordinal=0,rejectedAttempts=0,lastInput=null,harmSeen=false;
  for(const [i,e]of raw.events.entries()){
    keys(e,['id','sequence','elapsedMs','source','kind','data',...(bound && ['document.started','document.ended','form.intent'].includes(e.kind)?['binding']:[])]);if(e.sequence!==i+1||e.id!==`e${i+1}`)fail('EVENT_ORDER_INVALID');
    number(e.elapsedMs);if(e.elapsedMs<previous)fail('CLOCK_REVERSED');previous=e.elapsedMs;
    const b=lifetimes?.observe(e,i);
    let kind=e.kind, data={}, explanation='';
    switch(e.kind){
      case 'document.started':case 'document.ended':
        if(!bound)fail('EVENT_KIND_INVALID');one(e.source,['browser']);keys(e.data,e.kind==='document.ended'?['reason']:[]);data={...e.data};
        explanation=e.kind==='document.started'?'The collector observed this eligible default-world reporting realm. This is not proof of which script initiated a native operation.':'The collector retired this reporting document; later snapshots cannot use its input history.';break;
      case 'run.start':case 'observation.end':
        one(e.source,['runner']);keys(e.data,[]);explanation=e.kind==='run.start'?'The runner started this diagnostic.':'The runner closed observation. This does not attest the test framework assertion result.';break;
      case 'input.dispatched':
        one(e.source,['runner']);keys(e.data,['action']);one(e.data.action,['click','synthetic-click','allow-once','fill-required']);data={...e.data};lastInput=e.elapsedMs;explanation='The runner dispatched this input action. A synthetic click is not trusted pointer input.';break;
      case 'form.intent':
        one(e.source,['page']);keys(e.data,['phase','primitive','intent']);one(e.data.phase,['input','operation','submit-event','late-mutation','prepared']);one(e.data.primitive,['native','submit','requestSubmit','location']);
        data={phase:e.data.phase,primitive:e.data.primitive,intent:intent(e.data.intent)};
        snapshots.push({eventId:e.id,eventIndex:i,elapsedMs:e.elapsedMs,...data,...(b?{binding:{...b}}:{})});explanation='The authored fixture reported this intent snapshot. Page reports are not proof of native execution or receiver acceptance.';break;
      case 'receiver.attempt':
        one(e.source,['sink']);keys(e.data,['role','method','accepted','ordinal']);one(e.data.role,['harm','benign']);one(e.data.method,['GET','POST','OTHER']);boolean(e.data.accepted);
        if(e.data.ordinal!==++ordinal)fail('RECEIVER_ORDER_INVALID');data={...e.data,consequence:e.data.role};
        if(e.data.accepted){kind='sink.receipt';c.facts.cumulativeReceipts++;if(e.data.role==='harm'){c.facts.harmReceipts++;harmSeen=true;c.facts.recovered=false;}else c.facts.benignReceipts++;}
        else {kind='receiver.rejected';rejectedAttempts++;}
        explanation=e.data.accepted?'The independent receiver accepted the synthetic request. Request contents are not recorded.':'The independent receiver rejected this attempted spend. Rejection by the receiver is not prevention by NavSentinel.';break;
      case 'receiver.health':
        one(e.source,['sink']);keys(e.data,['phase','ok','sequence']);one(e.data.phase,['start','end']);boolean(e.data.ok);integer(e.data.sequence);
        if(health[e.data.phase])fail('DUPLICATE_HEALTH');health[e.data.phase]={...e.data,eventIndex:i};data={...e.data};explanation='A private HTTP health challenge checked the receiver without consuming a consequence target.';break;
      case 'navigation.committed':
        one(e.source,['browser']);keys(e.data,['scope','destination']);one(e.data.scope,['top','child']);one(e.data.destination,['fixture','harm','benign','other']);data={...e.data};
        if(harmSeen&&e.data.scope==='top'&&e.data.destination==='fixture')c.facts.recovered=true;
        explanation='The browser observer reported a committed navigation to this minimized destination category. It does not establish a request body or native initiator.';break;
      case 'decision.report':
        one(e.source,['extension']);keys(e.data,['code']);one(e.data.code,['form-blocked','navigation-blocked','navigation-rollback','other-decision']);data={...e.data};explanation='The runner sampled a product-owned decision record. This timestamp is sampling time, not the original decision time.';break;
      default:fail('EVENT_KIND_INVALID');
    }
    c.events.push({id:e.id,sequence:e.sequence,source:e.source,kind,data,elapsedMs:e.elapsedMs,clock:'collector-receive',frame:b?b.scope:e.source==='page'?'child':e.kind==='navigation.committed'?e.data.scope:'none',...(b?{frameId:b.frameId,documentId:b.documentId}:{}),causes:[],explanation});
  }
  const lifetimeResult=lifetimes?.result();
  if(lifetimeResult?.incomplete)c.gaps.push('DOCUMENT_LIFECYCLE_INCOMPLETE');
  if(bound && !snapshots.length)c.gaps.push('DOCUMENT_REPORTS_MISSING');
  if(raw.events[0].kind!=='run.start'||raw.events[0].elapsedMs>1||raw.events.at(-1).kind!=='observation.end')c.gaps.push('WINDOW_BOUNDARIES_MISSING');
  if(raw.events.filter(e=>e.kind==='run.start').length!==1||raw.events.filter(e=>e.kind==='observation.end').length!==1)fail('DUPLICATE_BOUNDARY');
  if(lastInput===null||previous-lastInput<2300)c.gaps.push('POST_INPUT_WINDOW_INCOMPLETE');
  if(!health.start?.ok||!health.end?.ok||health.start.sequence<1||health.end.sequence<=health.start.sequence||health.start.eventIndex>=health.end.eventIndex)c.gaps.push('RECEIVER_HEALTH_INCOMPLETE');
  if(health.start&&raw.events.slice(0,health.start.eventIndex).some(e=>e.kind==='input.dispatched'||e.kind==='receiver.attempt'))c.gaps.push('HEALTH_STARTED_TOO_LATE');
  if(health.end&&raw.events.slice(health.end.eventIndex+1).some(e=>e.kind==='input.dispatched'||e.kind==='receiver.attempt'))c.gaps.push('HEALTH_ENDED_TOO_EARLY');
  if(raw.dropped)c.gaps.push('EVENTS_DROPPED');if(raw.browserVersion==='not-recorded')c.gaps.push('BROWSER_IDENTITY_MISSING');
  c.gaps=[...new Set(c.gaps)];
  c.assessment=c.validity==='invalid'?'INVALID':c.facts.harmReceipts>0?c.facts.recovered?'HARM_THEN_RECOVERY':'HARM_OBSERVED':c.facts.benignReceipts>0?'BENIGN_RECEIPT_OBSERVED':'INCONCLUSIVE';
  c.formEvidence={experiment,pairId:raw.pairId,runId:raw.runId,protectedArm:raw.protectedArm,sourceTree:raw.identity.tree,snapshots,rejectedAttempts,health,dropped:raw.dropped,...(bound?{bindingPolicy:DOCUMENT_POLICY,documents:lifetimeResult.documents}:{bindingPolicy:'UNBOUND_LEGACY',documents:[]})};
  c.warnings.push('FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION',bound?'Browser metadata binds the reporting realm, not native causality: same-origin code can borrow another frame’s exposed reporting function.': 'Page snapshots are best-effort reports; receive order is not native execution order or authenticated document identity.','No raw-input verifier or authenticated producer is established by importing these hashes.','A receiver arrival proves the synthetic request boundary, not credential contents.');
  return [c];
}
export function compareFormCases(cases){
  const groups=new Map();for(const c of cases.filter(c=>c.formEvidence && c.formEvidence.experiment==='form-campaign')){const id=c.formEvidence.pairId;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(c);}
  return [...groups].map(([pairId,group])=>{
    const reasons=['NOT_A_FOUR_ARM_COMPARISON'];const baseline=group.filter(c=>!c.formEvidence.protectedArm),protectedCases=group.filter(c=>c.formEvidence.protectedArm);
    let status='COMPARISON_INCOMPLETE';
    if(baseline.length!==1||protectedCases.length!==1)reasons.push('REQUIRE_ONE_BASELINE_AND_ONE_PROTECTED_RUN');
    if(new Set(group.map(c=>JSON.stringify([c.variant,c.identity,c.formEvidence.sourceTree]))).size!==1)reasons.push('IDENTITY_MISMATCH');
    if(new Set(group.map(c=>c.formEvidence.runId)).size!==group.length)reasons.push('RUN_ID_REUSED');
    if(group.some(c=>c.validity==='invalid'||c.gaps.length))reasons.push('OBSERVATIONS_INCOMPLETE');
    if(!(baseline[0]?.facts.harmReceipts>0))reasons.push('BASELINE_HARM_NOT_ESTABLISHED');
    if(reasons.length===1){const p=protectedCases[0];status=p.facts.harmReceipts>0?'PROTECTED_CONSEQUENCE_OBSERVED':p.formEvidence.rejectedAttempts>0?'RECEIVER_REJECTED_OPERATION':'PAIRED_NON_REACHABILITY_OBSERVED';}
    return {pairId,caseIds:group.map(c=>c.id),status,reasons,preventionSupported:false};
  });
}
