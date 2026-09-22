const RAW_TAG = /<(script|style|pre|textarea)\b[^>]*>/gi;
const SIMPLE_ATTRIBUTE = /(\s[A-Za-z_:][A-Za-z0-9_.:-]*=)"([^\s"'`=<>]+)"/g;
const VOID_TAG = /^(<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b[^>]*?)\s*\/>$/i;
const TAG_NAME = /^<(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/;
const STRUCTURAL_TAGS = new Set([
  "address", "article", "aside", "blockquote", "body", "dd", "details", "dialog", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
  "header", "hgroup", "html", "legend", "li", "link", "main", "menu", "meta", "nav", "ol", "optgroup",
  "option", "p", "section", "select", "summary", "table", "tbody", "td", "template", "tfoot", "th",
  "thead", "title", "tr", "ul",
]);
const OPTIONAL_P_END = /<\/p>(?=<(?:(?:address|article|aside|blockquote|details|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hgroup|hr|main|menu|nav|ol|p|pre|search|section|table|ul)\b|\/(?:article|aside|blockquote|body|details|dialog|div|fieldset|footer|form|main|nav|section)>))/gi;

function compactTag(tag, stripCrossOrigin = false) {
  const isLocalAsset = /\b(?:src|href)\s*=\s*["']\/assets\//i.test(tag);
  const withoutCrossOrigin = stripCrossOrigin && isLocalAsset
    ? tag.replace(/\s+crossorigin(?=\s|>)/gi, "")
    : tag;
  const unquoted = withoutCrossOrigin.replace(SIMPLE_ATTRIBUTE, "$1$2");
  return unquoted.replace(VOID_TAG, "$1>");
}

function isStructuralTag(token) {
  const name = TAG_NAME.exec(token)?.[2];
  return name ? STRUCTURAL_TAGS.has(name.toLowerCase()) : false;
}

function isStructuralBoundary(token, closing) {
  const match = TAG_NAME.exec(token);
  return !!match && !!match[1] === closing && STRUCTURAL_TAGS.has(match[2].toLowerCase());
}

function compactNormalHtml(html, stripCrossOrigin = false, preserveInterElementWhitespace = false) {
  const withoutComments = html.replace(/<!--(?!\[if\b)[\s\S]*?-->/gi, "");
  const tokens = withoutComments.split(/(<[^>]*>)/g).map((token) => {
    if (token.startsWith("<")) return compactTag(token, stripCrossOrigin);
    return token.replace(/\s+/g, " ");
  });

  return tokens
    .map((token, index) => {
      const previous = tokens[index - 1] ?? "";
      const next = tokens[index + 1] ?? "";
      if (!preserveInterElementWhitespace && token === " " && (isStructuralTag(previous) || isStructuralTag(next))) return "";
      if (!token || token.startsWith("<")) return token;
      const withoutLeading = token.startsWith(" ") && isStructuralBoundary(previous, false)
        ? token.slice(1)
        : token;
      return withoutLeading.endsWith(" ") && isStructuralBoundary(next, true)
        ? withoutLeading.slice(0, -1)
        : withoutLeading;
    })
    .join("")
    .trim();
}

function stripOptionalEndTags(html) {
  return html
    .replace(/<\/option>(?=<option\b|<\/(?:optgroup|select)>)/gi, "")
    .replace(OPTIONAL_P_END, "")
    .replace(/<\/head><body>/gi, "")
    .replace(/<\/head>(?=<body\b)/gi, "")
    .replace(/<\/body>(?=<\/html>)/gi, "")
    .replace(/<\/html>$/i, "");
}

/**
 * Compact generated HTML while retaining browser-visible inline spacing and
 * the exact contents of raw-text elements. This is a packaging optimization;
 * it does not alter scripts, styles, preformatted text, or textarea content.
 */
export function compactHtml(html, {
  stripCrossOrigin = false,
  preserveInterElementWhitespace = false,
} = {}) {
  const output = [];
  // Each document owns its scan cursor, including an unterminated raw suffix.
  const rawTag = new RegExp(RAW_TAG);
  let cursor = 0;
  let match;

  while ((match = rawTag.exec(html)) !== null) {
    const normal = compactNormalHtml(html.slice(cursor, match.index), stripCrossOrigin, preserveInterElementWhitespace);
    const tagName = match[1];
    const close = new RegExp(`</${tagName}\\s*>`, "ig");
    close.lastIndex = match.index + match[0].length;
    const closing = close.exec(html);
    if (!closing) {
      output.push(stripOptionalEndTags(normal));
      output.push(html.slice(match.index));
      cursor = html.length;
      break;
    }
    // Include the opening boundary so </p><pre> can still compact, but never
    // run HTML end-tag substitutions over script/style/pre/textarea bodies.
    output.push(stripOptionalEndTags(normal + compactTag(match[0], stripCrossOrigin)));
    output.push(html.slice(match.index + match[0].length, closing.index));
    output.push(closing[0]);
    cursor = closing.index + closing[0].length;
    rawTag.lastIndex = cursor;
  }

  output.push(stripOptionalEndTags(compactNormalHtml(html.slice(cursor), stripCrossOrigin, preserveInterElementWhitespace)));
  return output.join("");
}
