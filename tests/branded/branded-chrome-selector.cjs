"use strict";

const path = require("node:path");

function selectBrandedChrome(rawSelector) {
  const selector = (rawSelector || "").trim();
  if (!selector || selector === "0" || selector === "false") return {};
  if (selector === "1" || selector === "true") return { channel: "chrome" };
  return { executablePath: path.resolve(selector) };
}

module.exports = { selectBrandedChrome };
