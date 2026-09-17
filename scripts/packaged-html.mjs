const OPTIONS_ARTIFACT_PATH = "options/options.html";
const OPTIONS_SCRIPT_SRC = /^\/assets\/options\.html-[A-Za-z0-9_-]+\.js$/;
const PACKAGED_STYLESHEET_HREF = /^\/assets\/[A-Za-z0-9._~-]+\.css$/;

// This is deliberately broader than today's Options markup. If a future page
// gains a raw-text, preformatted, embedded-document, or template surface, keep
// its original whitespace and let the aggregate size gate report the growth.
const WHITESPACE_SENSITIVE_HTML =
  /<\s*\/?\s*(?:pre|textarea|style|template|xmp|listing|plaintext|iframe|noembed|noframes|svg|math)\b/i;
const INLINE_STYLE_OR_XML_SPACE = /\s(?:style|xml:space)\s*=/i;

function parseStrictAttributes(raw) {
  const attributes = new Map();
  let offset = 0;

  while (offset < raw.length) {
    while (/\s/.test(raw[offset] ?? "")) offset += 1;
    if (offset >= raw.length || (raw[offset] === "/" && offset === raw.length - 1)) break;

    const nameMatch = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(raw.slice(offset));
    if (!nameMatch) return null;
    const name = nameMatch[0].toLowerCase();
    if (attributes.has(name)) return null;
    offset += nameMatch[0].length;
    while (/\s/.test(raw[offset] ?? "")) offset += 1;

    let value = null;
    if (raw[offset] === "=") {
      offset += 1;
      while (/\s/.test(raw[offset] ?? "")) offset += 1;
      const quote = raw[offset];
      if (quote !== '"' && quote !== "'") return null;
      const end = raw.indexOf(quote, offset + 1);
      if (end < 0) return null;
      value = raw.slice(offset + 1, end);
      // The browser decodes character references before interpreting attributes.
      // Comparing their raw spelling could therefore miss a security-relevant
      // rel/src/href value (for example, style&#x73;heet). Fail closed instead of
      // duplicating the HTML parser inside this packaging optimization.
      if (value.includes("&")) return null;
      offset = end + 1;
    }
    attributes.set(name, value);
  }

  return attributes;
}

function hasOnlyExpectedExternalScript(html) {
  const starts = html.match(/<script\b/gi) ?? [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (starts.length !== 1 || scripts.length !== 1 || scripts[0][2] !== "") return false;

  const attributes = parseStrictAttributes(scripts[0][1]);
  if (!attributes || attributes.size !== 3) return false;
  return attributes.get("type") === "module" &&
    attributes.get("crossorigin") === null &&
    typeof attributes.get("src") === "string" &&
    OPTIONS_SCRIPT_SRC.test(attributes.get("src"));
}

function cssUsesOnlyCollapsingWhitespace(css) {
  // Escapes can conceal property names or values. @import can add rules that the
  // packaged map did not inspect. Both therefore make this optimization ineligible.
  if (css.includes("\\")) return false;

  let code = "";
  let quote = null;
  let inComment = false;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (inComment) {
      code += " ";
      if (char === "*" && next === "/") {
        code += " ";
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      code += " ";
      if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      code += "  ";
      inComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      code += " ";
      quote = char;
      continue;
    }

    if (char === "{") braces += 1;
    else if (char === "}" && --braces < 0) return false;
    else if (char === "[") brackets += 1;
    else if (char === "]" && --brackets < 0) return false;
    else if (char === "(") parentheses += 1;
    else if (char === ")" && --parentheses < 0) return false;
    code += char;
  }

  if (inComment || quote || braces !== 0 || brackets !== 0 || parentheses !== 0) return false;
  if (/@import\b/i.test(code)) return false;

  for (const match of code.matchAll(/white-space\b/gi)) {
    const declaration = code.slice(match.index);
    if (!/^white-space\s*:\s*(?:normal|nowrap)\s*(?:!important\s*)?(?=[;}])/i.test(declaration)) {
      return false;
    }
  }
  return true;
}

function linkedStylesheetsAreSafe(html, stylesheetsByHref) {
  if (!(stylesheetsByHref instanceof Map)) return false;
  const starts = html.match(/<link\b/gi) ?? [];
  const links = [...html.matchAll(/<link\b([^>]*)>/gi)];
  if (starts.length !== links.length) return false;

  let stylesheetCount = 0;
  for (const link of links) {
    const attributes = parseStrictAttributes(link[1]);
    if (!attributes) return false;
    const rel = attributes.get("rel");
    const href = attributes.get("href");
    if (typeof rel !== "string" || typeof href !== "string") return false;
    if (!rel.toLowerCase().split(/\s+/).includes("stylesheet")) continue;
    stylesheetCount += 1;
    if (!PACKAGED_STYLESHEET_HREF.test(href)) return false;
    const css = stylesheetsByHref.get(href);
    if (typeof css !== "string" || !cssUsesOnlyCollapsingWhitespace(css)) return false;
  }
  return stylesheetCount > 0;
}

function stripIndentBeforeTags(html) {
  return html
    .split("\n")
    .map((line) => {
      let offset = 0;
      while (line[offset] === " " || line[offset] === "\t") offset += 1;
      return offset > 0 && line[offset] === "<" ? line.slice(offset) : line;
    })
    .join("\n");
}

/**
 * Compact only the known built Options page, and only while its entire style and
 * script surface proves that inter-tag indentation collapses. Any uncertainty
 * returns the original bytes; the performance gate then fails closed.
 */
export function compactKnownOptionsHtml(relativePath, html, stylesheetsByHref) {
  if (relativePath.replaceAll("\\", "/") !== OPTIONS_ARTIFACT_PATH) return html;
  if (WHITESPACE_SENSITIVE_HTML.test(html) || INLINE_STYLE_OR_XML_SPACE.test(html)) return html;
  if (!hasOnlyExpectedExternalScript(html)) return html;
  if (!linkedStylesheetsAreSafe(html, stylesheetsByHref)) return html;
  return stripIndentBeforeTags(html);
}
