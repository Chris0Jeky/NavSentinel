export interface CompactHtmlOptions {
  stripCrossOrigin?: boolean;
}

export function compactHtml(html: string, options?: CompactHtmlOptions): string;
