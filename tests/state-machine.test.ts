import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MakeTokenType = typeof import("../extension/src/shared/stateMachine").makeToken;
type GetActiveTokenType = typeof import("../extension/src/shared/stateMachine").getActiveToken;
type SetActiveTokenType = typeof import("../extension/src/shared/stateMachine").setActiveToken;

let makeToken: MakeTokenType;
let getActiveToken: GetActiveTokenType;
let setActiveToken: SetActiveTokenType;

async function loadModule(): Promise<void> {
  const mod = await import("../extension/src/shared/stateMachine");
  makeToken = mod.makeToken;
  getActiveToken = mod.getActiveToken;
  setActiveToken = mod.setActiveToken;
}

describe("stateMachine", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(performance, "now").mockReturnValue(1000);
    await loadModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("makeToken", () => {
    it("creates a token with all expected fields", () => {
      const token = makeToken({
        siteKey: "example.com",
        frameKey: "frame-1",
        mode: "smart",
        cds: 25,
        reasonCodes: ["TINY_ELEMENT"],
      });
      expect(token).toMatchObject({
        siteKey: "example.com",
        frameKey: "frame-1",
        mode: "smart",
        cds: 25,
        reasonCodes: ["TINY_ELEMENT"],
        createdAt: 1000,
        expiresAt: 1800,
        type: "keyboard",
      });
      expect(token.id).toMatch(/^1000-/);
    });

    it("sets createdAt to current performance.now()", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      expect(token.createdAt).toBe(1000);
    });

    it("sets expiresAt to 800ms after creation", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      expect(token.expiresAt).toBe(1800);
    });

    it("generates a unique id containing the timestamp", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      expect(token.id).toContain("1000-");
      expect(token.id.length).toBeGreaterThan(5);
    });

    it("generates different ids on successive calls (deterministic)", () => {
      let call = 0;
      vi.spyOn(Math, "random").mockImplementation(() => 0.1 + 0.1 * call++);
      const t1 = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      const t2 = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      expect(t1.id).not.toBe(t2.id);
      expect(t1.id).toMatch(/^1000-/);
      expect(t2.id).toMatch(/^1000-/);
    });

    it("sets type to 'pointer' when pointer data is provided", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 10,
        reasonCodes: [],
        pointer: {
          x: 100,
          y: 200,
          button: 0,
          ctrl: false,
          shift: false,
          alt: false,
          meta: false,
        },
      });
      expect(token.type).toBe("pointer");
      expect(token.pointer).toEqual({
        x: 100,
        y: 200,
        button: 0,
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      });
    });

    it("sets type to 'keyboard' when no pointer data", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 10,
        reasonCodes: [],
      });
      expect(token.type).toBe("keyboard");
      expect(token.pointer).toBeUndefined();
    });

    it("preserves all mode values", () => {
      for (const mode of ["off", "smart", "strict"] as const) {
        const token = makeToken({
          siteKey: "s",
          frameKey: "f",
          mode,
          cds: 0,
          reasonCodes: [],
        });
        expect(token.mode).toBe(mode);
      }
    });

    it("preserves empty reasonCodes array", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      expect(token.reasonCodes).toEqual([]);
    });

    it("preserves multiple reasonCodes", () => {
      const reasons = ["TINY_ELEMENT", "OPACITY_LOW", "nrs_new_domain"];
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 50,
        reasonCodes: reasons,
      });
      expect(token.reasonCodes).toEqual(reasons);
    });

    it("aliases reasonCodes array (no defensive copy)", () => {
      const reasons = ["A", "B"];
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: reasons,
      });
      reasons.push("C");
      expect(token.reasonCodes).toEqual(["A", "B", "C"]);
    });

    it("treats explicit pointer: undefined the same as omitted", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
        pointer: undefined,
      });
      expect(token.type).toBe("keyboard");
      expect(token.pointer).toBeUndefined();
    });

    it("preserves pointer modifier keys", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
        pointer: {
          x: 0,
          y: 0,
          button: 1,
          ctrl: true,
          shift: true,
          alt: true,
          meta: true,
        },
      });
      expect(token.pointer!.ctrl).toBe(true);
      expect(token.pointer!.shift).toBe(true);
      expect(token.pointer!.alt).toBe(true);
      expect(token.pointer!.meta).toBe(true);
      expect(token.pointer!.button).toBe(1);
    });
  });

  describe("getActiveToken / setActiveToken", () => {
    it("returns null when no token has been set", () => {
      expect(getActiveToken()).toBeNull();
    });

    it("returns the token after setActiveToken", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      setActiveToken(token);
      expect(getActiveToken()).toBe(token);
    });

    it("returns null after token expires", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      setActiveToken(token);

      vi.spyOn(performance, "now").mockReturnValue(1801);
      expect(getActiveToken()).toBeNull();
    });

    it("returns token at exact expiresAt (uses strict > comparison)", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      setActiveToken(token);

      vi.spyOn(performance, "now").mockReturnValue(1800);
      expect(getActiveToken()).toBe(token);
    });

    it("returns null one tick past expiresAt", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      setActiveToken(token);

      vi.spyOn(performance, "now").mockReturnValue(1800.001);
      expect(getActiveToken()).toBeNull();
    });

    it("returns token just before expiry", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      setActiveToken(token);

      vi.spyOn(performance, "now").mockReturnValue(1799);
      expect(getActiveToken()).toBe(token);
    });

    it("clears expired token permanently (does not resurface)", () => {
      const token = makeToken({
        siteKey: "s",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      setActiveToken(token);

      vi.spyOn(performance, "now").mockReturnValue(1801);
      expect(getActiveToken()).toBeNull();

      vi.spyOn(performance, "now").mockReturnValue(1500);
      expect(getActiveToken()).toBeNull();
    });

    it("replaces previous token on second setActiveToken", () => {
      const t1 = makeToken({
        siteKey: "s1",
        frameKey: "f",
        mode: "smart",
        cds: 0,
        reasonCodes: [],
      });
      const t2 = makeToken({
        siteKey: "s2",
        frameKey: "f",
        mode: "strict",
        cds: 10,
        reasonCodes: [],
      });
      setActiveToken(t1);
      setActiveToken(t2);
      expect(getActiveToken()).toBe(t2);
      expect(getActiveToken()!.siteKey).toBe("s2");
    });

    it("module-level state is isolated between test runs", () => {
      expect(getActiveToken()).toBeNull();
    });
  });
});
