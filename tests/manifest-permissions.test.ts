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
  web_accessible_resources?: { matches?: string[] }[];
  externally_connectable?: { matches?: string[] };
  declarative_net_request?: unknown;
};

const MANIFESTS = ["manifest.json", "manifest.firefox.json"] as const;

function loadManifest(name: string): Manifest {
  return JSON.parse(readFileSync(path.join(extensionDir, name), "utf8")) as Manifest;
}

function findUndisclosedGrants(manifest: Manifest, disclosure: string): string[] {
  const disclosed = new Set<string>();
  let fence: string | undefined;
  let inPermissionTable = false;
  for (const line of disclosure.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) { fence = marker; inPermissionTable = false; }
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (/^\s*\|\s*Permission\s*\|\s*Justification\s*\|/iu.test(line)) {
      inPermissionTable = true;
      continue;
    }
    if (!line.trimStart().startsWith("|")) inPermissionTable = false;
    if (!inPermissionTable) continue;
    const firstCell = line.split("|")[1] ?? "";
    for (const match of firstCell.matchAll(/`([^`\r\n]+)`/g)) disclosed.add(match[1]!);
  }
  const grants = {
    permissions: manifest.permissions ?? [],
    optional_permissions: manifest.optional_permissions ?? [],
    host_permissions: manifest.host_permissions ?? [],
    optional_host_permissions: manifest.optional_host_permissions ?? [],
    "content_scripts.matches": manifest.content_scripts?.flatMap((script) => script.matches ?? []) ?? [],
    "web_accessible_resources.matches": manifest.web_accessible_resources?.flatMap((resource) => resource.matches ?? []) ?? [],
    "externally_connectable.matches": manifest.externally_connectable?.matches ?? [],
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

  const fakeGrant = "undisclosedFakeGrant";
  const permissionTable = (row: string) => `| Permission | Justification |\n|---|---|\n${row}`;

  it.each<[string, Manifest]>([
    ["permissions", { permissions: [fakeGrant] }],
    ["optional_permissions", { optional_permissions: [fakeGrant] }],
    ["host_permissions", { host_permissions: [fakeGrant] }],
    ["optional_host_permissions", { optional_host_permissions: [fakeGrant] }],
    ["content_scripts.matches", { content_scripts: [{ matches: [fakeGrant] }] }],
    ["web_accessible_resources.matches", { web_accessible_resources: [{ matches: [fakeGrant] }] }],
    ["externally_connectable.matches", { externally_connectable: { matches: [fakeGrant] } }],
  ])("reports an undisclosed grant in %s", (field, copy) => {
    expect(findUndisclosedGrants(copy, disclosure)).toEqual([`${field}: ${fakeGrant}`]);
    expect(findUndisclosedGrants(copy, permissionTable(`| \`${fakeGrant}Suffix\` | x |`))).toEqual([`${field}: ${fakeGrant}`]);
    // Outside the permission table a backticked mention is not a disclosure.
    expect(findUndisclosedGrants(copy, `${disclosure}\nWe never use \`${fakeGrant}\`.`)).toEqual([`${field}: ${fakeGrant}`]);
    expect(findUndisclosedGrants(copy, permissionTable(`| \`${fakeGrant}\` | x |`))).toEqual([]);
  });

  it.each([
    ["justification cell", permissionTable(`| \`storage\` | Never requests \`${fakeGrant}\`. |`)],
    ["backtick code fence", `\`\`\`md\n${permissionTable(`| \`${fakeGrant}\` | x |`)}\n\`\`\``],
    ["tilde code fence", `~~~md\n${permissionTable(`| \`${fakeGrant}\` | x |`)}\n~~~`],
    ["unrelated table", `| Example | Notes |\n|---|---|\n| \`${fakeGrant}\` | x |`],
  ])("rejects disclosure only in a %s", (_label, text) => {
    expect(findUndisclosedGrants({ permissions: [fakeGrant] }, text)).toEqual([`permissions: ${fakeGrant}`]);
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

  // #1114/#1134: inherited-origin frames (about:blank, srcdoc, blob) need the
  // credential guard, the MAIN-world guard and the isolated bridge that arms it.
  it.each(["capture_isolated", "main_guard", "credential_guard"])(
    "manifest.json injects %s into origin-fallback frames",
    (script) => {
      const scripts = (loadManifest("manifest.json") as {
        content_scripts: Array<{ js: string[]; all_frames?: boolean; match_origin_as_fallback?: boolean }>;
      }).content_scripts;
      const entry = scripts.find((s) => s.js.includes(`src/content/${script}.ts`));
      expect(entry).toMatchObject({ all_frames: true, match_origin_as_fallback: true });
    },
  );

  it("ships no static DNR ruleset file", () => {
    expect(existsSync(path.join(extensionDir, "rules", "dnr_static.json"))).toBe(false);
  });
});
