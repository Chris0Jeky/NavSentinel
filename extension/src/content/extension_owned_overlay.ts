const extensionOwnedOverlayElements = new WeakSet<Element>();

/** Mark a DOM node created by this isolated-world module graph. */
export function registerExtensionOwnedOverlayElement<T extends Element>(element: T): T {
  extensionOwnedOverlayElements.add(element);
  return element;
}

/** Page-created lookalikes cannot spoof membership in this isolated WeakSet. */
export function isExtensionOwnedOverlayElement(element: Element): boolean {
  return extensionOwnedOverlayElements.has(element);
}
