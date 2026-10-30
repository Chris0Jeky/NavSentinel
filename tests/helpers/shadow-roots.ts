/**
 * Extension UI hosts use closed shadow roots (#894, #1142), so `host.shadowRoot`
 * is null. Importing this module records every root at `attachShadow` time so a
 * unit test can still read it; product code exports no test accessor (the toast
 * chunk has no byte budget left for one).
 */
const roots = new WeakMap<Element, ShadowRoot>();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
  const root = attachShadow.call(this, init);
  roots.set(this, root);
  return root;
};

export function shadowOf(host: Element | null | undefined): ShadowRoot | null {
  return (host && roots.get(host)) ?? null;
}
