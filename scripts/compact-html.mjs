const RAW_TAG = /<(script|style|pre|textarea)\b[^>]*>/gi;
const SIMPLE_ATTRIBUTE = /(\s[A-Za-z_:][A-Za-z0-9_.:-]*=)"([A-Za-z0-9_.:-]+)"/g;
const VOID_TAG = /^(<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b[^>]*?)\s*\/>$/i;

function compactTag(tag, stripCrossOrigin = false) {
  const isLocalAsset = /\b(?:src|href)\s*=\s*["']\/assets\//i.test(tag);
  const withoutCrossOrigin = stripCrossOrigin && isLocalAsset
    ? tag.replace(/\s+crossorigin(?=\s|>)/gi, "")
    : tag;
  const unquoted = withoutCrossOrigin.replace(SIMPLE_ATTRIBUTE, "$1$2");
  return unquoted.replace(VOID_TAG, "$1>");
}

function compactNormalHtml(html, stripCrossOrigin = false) {
  const withoutComments = html.replace(/<!--(?!\[if\b)[\s\S]*?-->/gi, "");
  const tokens = withoutComments.split(/(<[^>]*>)/g);

  return tokens
    .map((token, index) => {
      if (token.startsWith("<")) return compactTag(token, stripCrossOrigin);
      const collapsed = token.replace(/\s+/g, " ");
      return collapsed;
    })
    .join("")
    .trim();
}

/**
 * Compact generated HTML while retaining browser-visible inline spacing and
 * the exact contents of raw-text elements. This is a packaging optimization;
 * it does not alter scripts, styles, preformatted text, or textarea content.
 */
export function compactHtml(html, { stripCrossOrigin = false } = {}) {
  const output = [];
  let cursor = 0;
  let match;

  while ((match = RAW_TAG.exec(html)) !== null) {
    output.push(compactNormalHtml(html.slice(cursor, match.index), stripCrossOrigin));
    const tagName = match[1];
    const close = new RegExp(`</${tagName}\\s*>`, "ig");
    close.lastIndex = match.index + match[0].length;
    const closing = close.exec(html);
    if (!closing) {
      output.push(html.slice(match.index));
      cursor = html.length;
      break;
    }
    output.push(compactTag(html.slice(match.index, match.index + match[0].length), stripCrossOrigin));
    output.push(html.slice(match.index + match[0].length, closing.index));
    output.push(closing[0]);
    cursor = closing.index + closing[0].length;
    RAW_TAG.lastIndex = cursor;
  }

  output.push(compactNormalHtml(html.slice(cursor), stripCrossOrigin));
  return output.join("");
}
