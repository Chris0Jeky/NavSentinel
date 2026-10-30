import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the declared permission set. RI-05 removed the test-only
 * declarativeNetRequest ruleset (localhost-scoped placeholder rules behind a
 * disabled options toggle), so neither manifest may request the DNR
 * permissions or declare a rule resource. A real hard-block feature is a
 * separate future design (#242/#243) and would re-declare these deliberately.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, "..", "extension");

type Manifest = {
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: { matches?: string[] }[];
  declarative_net_request?: unknown;
};

const MANIFESTS = ["manifest.json", "manifest.firefox.json"] as const;

function loadManifest(name: string): Manifest {
  return JSON.parse(readFileSync(path.join(extensionDir, name), "utf8")) as Manifest;
}

function findUndisclosedGrants(manifest: Manifest, disclosure: string): string[] {
  // Only the permission table counts: a backticked token elsewhere (the
  // certification answers mention `activeTab`) is not a disclosure.
  const table = disclosure.split(/\r?\n/).filter((line) => line.startsWith("|")).join("\n");
  const disclosed = new Set(Array.from(table.matchAll(/`([^`\r\n]+)`/g), (match) => match[1]));
  const grants = {
    permissions: manifest.permissions ?? [],
    optional_permissions: manifest.optional_permissions ?? [],
    host_permissions: manifest.host_permissions ?? [],
    optional_host_permissions: manifest.optional_host_permissions ?? [],
    "content_scripts.matches": manifest.content_scripts?.flatMap((script) => script.matches ?? []) ?? [],
  };
  return Object.entries(grants).flatMap(([field, values]) =>
    [...new Set(values)].filter((value) => !disclosed.has(value)).map((value) => `${field}: ${value}`),
  );
}

describe("manifest permissions", () => {
  const disclosure = readFileSync(path.resolve(__dirname, "../docs/cws-listing/PRIVACY_DISCLOSURE.md"), "utf8");

  it.each(MANIFESTS)("%s discloses every permission, host grant, and content-script match", (name) => {
    expect(findUndisclosedGrants(loadManifest(name), disclosure)).toEqual([]);
  });

  it.each([
    "permissions",
    "optional_permissions",
    "host_permissions",
    "optional_host_permissions",
    "content_scripts.matches",
  ] as const)("reports an undisclosed grant in %s", (field) => {
    const manifest = loadManifest("manifest.json");
    const fakeGrant = "undisclosedFakeGrant";
    const copy: Manifest = field === "content_scripts.matches"
      ? { ...manifest, content_scripts: [...(manifest.content_scripts ?? []), { matches: [fakeGrant] }] }
      : { ...manifest, [field]: [...(manifest[field] ?? []), fakeGrant] };
    expect(findUndisclosedGrants(copy, disclosure)).toEqual([`${field}: ${fakeGrant}`]);
    expect(findUndisclosedGrants(copy, `${disclosure}\n| \`${fakeGrant}Suffix\` | x |`)).toEqual([`${field}: ${fakeGrant}`]);
    // Outside the permission table a backticked mention is not a disclosure.
    expect(findUndisclosedGrants(copy, `${disclosure}\nWe never use \`${fakeGrant}\`.`)).toEqual([`${field}: ${fakeGrant}`]);
    expect(findUndisclosedGrants(copy, `${disclosure}\n| \`${fakeGrant}\` | x |`)).toEqual([]);
  });

  it.each(MANIFESTS)("%s requests no declarativeNetRequest permission", (name) => {
    const permissions = loadManifest(name).permissions ?? [];
    expect(permissions).not.toContain("declarativeNetRequest");
    expect(permissions).not.toContain("declarativeNetRequestWithHostAccess");
  });

  it.each(MANIFESTS)("%s declares no declarative_net_request rule resources", (name) => {
    expect(loadManifest(name).declarative_net_request).toBeUndefined();
  });

  it.each(MANIFESTS)("%s still requests the permissions the product uses", (name) => {
    const permissions = loadManifest(name).permissions ?? [];
    expect(permissions).toContain("storage");
    expect(permissions).toContain("webNavigation");
    expect(permissions).toContain("tabs");
  });

  it("ships no static DNR ruleset file", () => {
    expect(existsSync(path.join(extensionDir, "rules", "dnr_static.json"))).toBe(false);
  });
});
