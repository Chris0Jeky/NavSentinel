/** Fixed synthetic fixture probe: never read form values or patch native methods. */
export interface FormIntentSample {
  form: "f" | "g" | "other"; submitter: "a" | "b" | "none" | "other";
  action: "harm" | "benign" | "fixture" | "other"; declaredAction: "harm" | "benign" | "fixture" | "other";
  actionSource: "form" | "submitter"; method: "GET" | "POST" | "DIALOG";
  encoding: "urlencoded" | "multipart" | "plain"; target: "self" | "top" | "parent" | "blank" | "named";
  targetSource: "form" | "submitter" | "base" | "default";
  targetOverride: "absent" | "empty" | "present"; methodOverride: "absent" | "empty" | "present"; ownerMatches: boolean;
}
/** Self-contained so the authored fixture can run this exact function. */
export function sampleFormIntent({ form, submitter, harmUrl, benignUrl }: {
  form: HTMLFormElement; submitter: HTMLButtonElement | null; harmUrl: string; benignUrl: string;
}): FormIntentSample {
  const doc = form.ownerDocument;
  const has = (attribute: string): boolean => !!submitter?.hasAttribute(attribute);
  const state = (attribute: string): "absent" | "empty" | "present" => !has(attribute) ? "absent" : submitter!.getAttribute(attribute) === "" ? "empty" : "present";
  const category = (raw: string | null): FormIntentSample["action"] => {
    try {
      const resolved = raw === null || raw === "" ? doc.URL : new URL(raw, doc.baseURI).href;
      return resolved === harmUrl ? "harm" : resolved === benignUrl ? "benign" : resolved === doc.URL ? "fixture" : "other";
    } catch { return "other"; }
  };
  const rawMethod = (has("formmethod") ? submitter!.getAttribute("formmethod") : form.getAttribute("method"))?.toLowerCase();
  const rawEncoding = (has("formenctype") ? submitter!.getAttribute("formenctype") : form.getAttribute("enctype"))?.toLowerCase();
  const base = doc.querySelector("base[target]");
  const targetSource = has("formtarget") ? "submitter" : form.hasAttribute("target") ? "form" : base ? "base" : "default";
  const rawTarget = (targetSource === "submitter" ? submitter!.getAttribute("formtarget") : targetSource === "form" ? form.getAttribute("target") : base?.getAttribute("target"))?.toLowerCase() ?? "";
  return {
    form: form.id === "f" || form.id === "g" ? form.id : "other",
    submitter: submitter === null ? "none" : submitter.id === "a" || submitter.id === "b" ? submitter.id : "other",
    action: category(has("formaction") ? submitter!.getAttribute("formaction") : form.getAttribute("action")),
    declaredAction: category(form.getAttribute("action")), actionSource: has("formaction") ? "submitter" : "form",
    method: rawMethod === "post" ? "POST" : rawMethod === "dialog" ? "DIALOG" : "GET",
    encoding: rawEncoding === "multipart/form-data" ? "multipart" : rawEncoding === "text/plain" ? "plain" : "urlencoded",
    target: rawTarget === "" || rawTarget === "_self" ? "self" : rawTarget === "_top" ? "top" : rawTarget === "_parent" ? "parent" : rawTarget === "_blank" ? "blank" : "named",
    targetSource, targetOverride: state("formtarget"), methodOverride: state("formmethod"), ownerMatches: submitter === null || submitter.form === form,
  };
}
export function formProbeScript(harmUrl: string, benignUrl: string): string {
  const json = (s: string): string => JSON.stringify(s).replaceAll("<", "\\u003c");
  return `const __nsFormReport=(phase,form=f,submitter=a,primitive='requestSubmit')=>{
    try {
      const intent=(${sampleFormIntent.toString()})({form,submitter,harmUrl:${json(harmUrl)},benignUrl:${json(benignUrl)}});
      const report=globalThis.__nsFormObservation;
      if(typeof report!=='function') return;
      const pending=report({phase,primitive,intent});
      if(pending&&typeof pending.catch==='function') pending.catch(()=>{});
    } catch {}
  };`;
}
