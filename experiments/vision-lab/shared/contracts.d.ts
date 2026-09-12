export type Action = 'navigate'|'popup'|'overlay'|'credential-submit'|'clipboard-write'|'shell-paste'|'file-upload'|'oauth-consent'|'agent-action';
export type Decision = 'allow'|'review'|'block'|'observe';
export interface Context { tab: string; frame: string; document: string; navigation: string; actionId: string }
export interface IntentEvent { id: string; journeyId: string; actor: string; action: Action; source: string; destination: string; signals: string[]; context: Context; evidence: 'fixture'|'sensor'|'declared' }
export interface Policy { mode: 'smart'|'strict'|'observe'; navigationHosts: string[]; credentialHosts: string[]; attentionLimit: number }
export interface Contribution { id:string; label:string; points:number; group:string; category:string; evidence:'observed'|'correlated'|'inferred'|'unknown'; hard?:boolean }
export interface Result { version:string; decision:Decision; wouldDecide:Decision; score:number; hard:boolean; category:string; headline:string; overridable:boolean; contributions:Contribution[]; suppressed:string[]; explanation:string[]; evidence:string; scoreMeaning:string; coverage:string }
export interface Capability { token:string; requestId:string; expiresAt:number; oneUse:true }
