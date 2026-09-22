/** Inert #688 fixture. Authorities are issued by the harness, never by pages.
 * Tokens live in paths because GET forms replace the action's query. Bodies are
 * drained without parsing, logging or retaining values. Every attempted spend
 * is recorded, including rejected duplicates: sink enforcement cannot hide a
 * product replay. No endpoint executes commands or contacts another service.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";

export type FormCase =
  | "alternate-submitter" | "action-substitution" | "target-mutation" | "method-mutation"
  | "enctype-mutation" | "base-href" | "base-target" | "reassociation" | "expired"
  | "mismatch-burn" | "synthetic" | "location-same" | "location-different" | "late-submit"
  | "exact-submit" | "exact-request" | "native" | "server-redirect" | "slow-response"
  | "empty-target" | "inherited-target" | "empty-method" | "invalid-method" | "self"
  | "dialog" | "validation" | "replay" | "allow-once" | "allow-mutated" | "mixed"
  | "cancel-replace";
export interface FormReceipt { role: "harm" | "benign"; method: string; accepted: boolean; ordinal: number }

export async function startFormIntentLab(variant: FormCase) {
  const attempts: FormReceipt[] = [];
  const authorities = new Map<string, { role: "harm" | "benign"; used: boolean }>();
  let sinkOrigin = "";
  const mint = (role: "harm" | "benign") => {
    const pathname = `/sink/${role}/${randomBytes(16).toString("hex")}/accept`;
    authorities.set(pathname, { role, used: false });
    return pathname;
  };
  const harmPath = mint("harm");
  const benignPath = mint("benign");
  const server = http.createServer((req, res) => {
    req.resume();
    const url = new URL(req.url ?? "/", "http://fixture.invalid");
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("x-content-type-options", "nosniff");
    const authority = authorities.get(url.pathname);
    if (authority) {
      const accepted = !authority.used && ["GET", "POST"].includes(req.method ?? "");
      attempts.push({ role: authority.role, method: req.method ?? "", accepted, ordinal: attempts.length + 1 });
      authority.used = true;
      if (!accepted) { res.writeHead(409); res.end("<h1>Rejected duplicate or method</h1>"); return; }
      if (variant === "server-redirect") { res.writeHead(303, { location: sinkOrigin + "/done" }); res.end(); return; }
      if (variant === "replay" || variant === "mismatch-burn") { res.writeHead(204); res.end(); return; }
      if (variant === "slow-response") { setTimeout(() => res.end("<h1>Slow benign response</h1>"), 1800); return; }
      res.end(`<h1>${authority.role} inert receipt</h1>`);
      return;
    }
    if (url.pathname === "/done") { res.end("<h1>Benign redirected result</h1>"); return; }
    if (url.pathname === "/parent") {
      res.end(`<!doctype html><meta charset="utf-8"><title>Form authority lab</title>
        <h1>Local form task</h1>${variant === "cancel-replace" ? `<form id="replacement" action="${sinkOrigin + benignPath}" method="post"><button id="replacement-submit">Continue replacement</button></form>` : ""}
        <iframe title="Local form task" src="/child" style="width:900px;height:650px"></iframe>`);
      return;
    }
    if (url.pathname !== "/child") { res.writeHead(404); res.end("Missing fixture"); return; }
    const harm = sinkOrigin + harmPath;
    const benign = sinkOrigin + benignPath;
    const malicious = ["alternate-submitter", "action-substitution", "target-mutation", "method-mutation", "enctype-mutation", "base-href", "base-target", "reassociation", "expired", "mismatch-burn", "synthetic", "location-same", "location-different", "late-submit", "mixed"].includes(variant);
    const action = variant === "location-same" || variant === "late-submit" ? harm : malicious ? benign : benign;
    const target = ["alternate-submitter", "target-mutation", "base-target", "mixed", "self"].includes(variant) ? "_self" : "_top";
    const extra = variant === "validation" ? '<input id="required" required aria-label="Required field">' : '';
    const setup: string[] = [];
    if (variant === "action-substitution") setup.push(`f.action=harm; a.setAttribute('formaction',benign);`);
    if (variant === "alternate-submitter") setup.push(`a.setAttribute('formaction',harm); b.setAttribute('formaction',harm); b.setAttribute('formtarget','_top');`);
    if (["target-mutation", "method-mutation", "enctype-mutation", "reassociation", "expired", "mismatch-burn", "synthetic", "mixed"].includes(variant)) setup.push(`f.action=harm;`);
    if (variant === "base-href") setup.push(`base.href=benign.slice(0,benign.lastIndexOf('/')+1); f.setAttribute('action','accept');`);
    if (["base-target", "inherited-target"].includes(variant)) setup.push(`f.removeAttribute('target'); base.target=${JSON.stringify(variant === "base-target" ? "_self" : "_top")};`);
    if (variant === "base-target") setup.push(`f.action=harm;`);
    if (variant === "empty-target") setup.push(`base.target='_top'; a.setAttribute('formtarget','');`);
    if (variant === "empty-method" || variant === "invalid-method") setup.push(`a.setAttribute('formmethod',${JSON.stringify(variant === "empty-method" ? "" : "not-a-method")});`);
    if (variant === "dialog") setup.push(`const d=document.createElement('dialog'); document.body.append(d); d.append(f); f.method='dialog'; d.showModal();`);
    const call = "HTMLFormElement.prototype.requestSubmit.call(f,a)";
    const scripts: Partial<Record<FormCase, string>> = {
      "alternate-submitter": "HTMLFormElement.prototype.requestSubmit.call(f,b)",
      "action-substitution": "HTMLFormElement.prototype.submit.call(f)",
      "target-mutation": `a.setAttribute('formtarget','_top'); ${call}`,
      "method-mutation": `a.setAttribute('formmethod','get'); ${call}`,
      "enctype-mutation": `a.setAttribute('formenctype','text/plain'); ${call}`,
      "base-href": `base.href=harm.slice(0,harm.lastIndexOf('/')+1); ${call}`,
      "base-target": `base.target='_top'; ${call}`,
      "reassociation": `g.action=harm; g.target='_top'; g.method='post'; g.append(a); HTMLFormElement.prototype.requestSubmit.call(g,a)`,
      "expired": call,
      "mismatch-burn": `a.setAttribute('formmethod','get'); ${call}; a.removeAttribute('formmethod'); setTimeout(()=>${call},100)`,
      "synthetic": call,
      "location-same": "top.location.assign(harm)",
      "location-different": "top.location.assign(harm)",
      "exact-submit": "HTMLFormElement.prototype.submit.call(f)",
      "exact-request": call,
      "replay": `${call}; setTimeout(()=>${call},200)`,
      "allow-once": call,
      "allow-mutated": call,
      "mixed": `a.setAttribute('formtarget','_top'); ${call}; setTimeout(()=>{ a.removeAttribute('formtarget'); f.action=benign; f.target='_top'; a.onclick=null; document.body.dataset.mixedReady='1'; },300)`,
    };
    if (variant === "late-submit") setup.push(`f.addEventListener('submit',()=>{ f.action=harm; a.setAttribute('formaction',harm); }); f.action=benign;`);
    if (variant === "cancel-replace") setup.push(`f.addEventListener('submit',e=>{ e.preventDefault(); top.document.getElementById('replacement-submit').click(); });`);
    const script = scripts[variant];
    const delay = variant === "expired" ? 1700 : 100;
    res.end(`<!doctype html><html><head><meta charset="utf-8"><base id="base"><title>Child form</title>
      <style>body{font:18px system-ui;padding:30px}button,input{padding:12px;margin:8px}form{display:block}</style></head>
      <body><h2>Submit the local test form</h2><form id="f" action="${action}" method="post" target="${target}">
        <input type="hidden" name="sentinel" value="inert"><button id="a" type="submit">Continue locally</button>
        <button id="b" type="submit">Alternate submitter</button>${extra}</form><form id="g"></form>
        <button id="outside" type="button">Run local task</button>
      <script>
        const f=document.getElementById('f'),g=document.getElementById('g'),a=document.getElementById('a'),b=document.getElementById('b'),base=document.getElementById('base');
        const harm=${JSON.stringify(harm)},benign=${JSON.stringify(benign)};
        ${setup.join("\n")}
        ${script ? `a.onclick=e=>{e.preventDefault();setTimeout(()=>{${script}},${delay});};` : ""}
        ${["allow-once", "allow-mutated"].includes(variant) ? `document.getElementById('outside').onclick=()=>setTimeout(()=>{${call}},100);` : ""}
        document.body.dataset.fixtureReady='1';
      </script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback lab did not bind");
  const fixtureOrigin = `http://localhost:${address.port}`;
  sinkOrigin = `http://127.0.0.1:${address.port}`;
  return { fixtureOrigin, sinkOrigin, attempts, benignUrl: sinkOrigin + benignPath, harmUrl: sinkOrigin + harmPath,
    close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
