// Isolated-world prototypes bypass HTMLFormElement's named control properties.
export function domProperty<T, K extends keyof T>(prototype: T, node: T, key: K): T[K] {
  return Object.getOwnPropertyDescriptor(prototype, key)!.get!.call(node);
}

export function domAttribute(node: Element, name: string): string | null {
  return Element.prototype.getAttribute.call(node, name);
}
