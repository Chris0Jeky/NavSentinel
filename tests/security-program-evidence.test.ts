import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ExistingEvidenceMapping = {
  id: string;
  oracle_type: string;
  evidence_state: string;
  current_oracle: string;
  known_limitation: string;
};

describe("security-program evidence boundaries", () => {
  it("keeps bridge clipboard pressure at modelled product-event evidence", () => {
    const registry = JSON.parse(
      readFileSync(
        new URL("../docs/security-program/registry/existing-evidence-map.json", import.meta.url),
        "utf8",
      ),
    ) as { mappings: ExistingEvidenceMapping[] };
    const mapping = registry.mappings.find((candidate) => candidate.id === "MAP-BRIDGE-CLIPBOARD-PRESSURE");

    expect(mapping).toBeDefined();
    expect(mapping).toMatchObject({ oracle_type: "product_event", evidence_state: "MODELLED" });
    expect(mapping?.current_oracle).not.toContain("HARM_REACHED");
    expect(mapping?.current_oracle).not.toContain("typed loopback sink");
    expect(mapping?.known_limitation).toMatch(/independent harm oracle/i);
  });
});
