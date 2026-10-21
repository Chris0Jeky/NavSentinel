import http from "node:http";
import { expect, it } from "vitest";
import { startFormIntentLab } from "./e2e/form_intent_lab";
const get = (url: string): Promise<string> => new Promise((resolve, reject) => { http.get(url, res => { let body = ""; res.setEncoding("utf8"); res.on("data", chunk => body += chunk); res.on("end", () => resolve(body)); }).on("error", reject); });
it("private health checks do not consume a form authority", async () => {
 const lab = await startFormIntentLab("exact-request"); try {
  expect(await lab.probe()).toEqual({ ok: true, sequence: 1 }); expect(await lab.probe()).toEqual({ ok: true, sequence: 2 }); expect(lab.attempts).toEqual([]);
  await get(lab.benignUrl); expect(lab.attempts).toMatchObject([{role:"benign",accepted:true,ordinal:1}]);
 } finally { await lab.close(); }
 expect((await lab.probe()).ok).toBe(false);
});
it("observer exceptions do not remove accepted requests or prevent later observers", async () => {
 const lab = await startFormIntentLab("exact-request"); const seen: unknown[] = []; try {
  lab.observe(() => { throw new Error("deliberate"); }); const remove = lab.observe(r => { seen.push(r); r.accepted = false; });
  await get(lab.benignUrl); expect(seen).toHaveLength(1); expect(lab.attempts[0]?.accepted).toBe(true); expect(lab.observerErrors()).toBe(1);
  remove(); await get(lab.benignUrl); expect(seen).toHaveLength(1); expect(lab.attempts[1]?.accepted).toBe(false);
 } finally { await lab.close(); }
});
it("fixture probes are default-off and never rewrite native prototypes", async () => {
 const plain = await startFormIntentLab("target-mutation"), recorded = await startFormIntentLab("target-mutation", { observeIntent:true });
 try {
  expect(await get(plain.fixtureOrigin.replace("localhost","127.0.0.1")+"/child")).not.toContain("__nsFormReport");
  const html=await get(recorded.fixtureOrigin.replace("localhost","127.0.0.1")+"/child");expect(html).toContain("__nsFormReport");expect(html).toContain("setTimeout");expect(html).not.toMatch(/prototype\.(submit|requestSubmit)\s*=/);
 } finally { await plain.close(); await recorded.close(); }
});
