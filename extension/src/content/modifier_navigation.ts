export function isImmediateWindowOpenTarget(target: unknown): boolean {
  if (typeof target !== "string" || !target) return true;
  return /^_blank$/i.test(target) || (
    !/^_(self|top|parent)$/i.test(target) &&
    target !== window.name
  );
}

export function effectiveAnchorTarget(anchor: HTMLAnchorElement): string {
  return anchor.getAttribute("target")
    ?? document.querySelector<HTMLBaseElement>("base[target]")?.target
    ?? "";
}

export function isTrustedModifiedAnchorGesture(event: MouseEvent): boolean {
  return event.isTrusted && (
    event.button === 1 || (!event.button && (event.ctrlKey || event.metaKey))
  );
}

export function isBlankAnchorTarget(target: string): boolean {
  return /^_blank$/i.test(target) || /[\t\n\r<]/.test(target);
}

export function isSameTabAnchorTarget(target: string, topFrame: boolean): boolean {
  return (!target || !isImmediateWindowOpenTarget(target)) &&
    (topFrame || !/^_(parent|top)$/i.test(target));
}
