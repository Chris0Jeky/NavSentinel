import { describe, expect, it } from "vitest";
import { computeNRS } from "../extension/src/shared/nrs";

const cds = { cds: 0, reasonCodes: [] };
const nav = { isNewTabOrWindow: false, isCrossSite: false, redirectViaKnownRedirector: true };

describe("known redirector hops are discrete (#793)", () => {
  it.each([Number.MIN_VALUE, 0.1, 0.5, 0.999999, 1.5, 2.5])(
    "uses the documented one-hop fallback for %s", (knownRedirectorHops) => {
      const result = computeNRS(cds, { ...nav, knownRedirectorHops });
      expect(result.nrs).toBe(15);
      expect(result.nrsFactors).toEqual(["nrs_redirect_via_known_redirector"]);
    },
  );

  it.each([[undefined, 15], [1, 15], [2, 30], [50, 30]] as const)(
    "preserves the established score for %s hops", (knownRedirectorHops, expected) => {
      expect(computeNRS(cds, { ...nav, knownRedirectorHops }).nrs).toBe(expected);
    },
  );

  it("does not invent redirector evidence when the flag is false", () => {
    const result = computeNRS(cds, { ...nav, redirectViaKnownRedirector: false, knownRedirectorHops: 0.5 });
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).toEqual([]);
  });
});
