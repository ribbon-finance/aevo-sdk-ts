import { describe, expect, it } from "vitest";
import {
  AevoValueError,
  bpsToRate,
  normalizeDecimal6,
  oneOfRateOrBps,
  rateToRaw,
  toRaw6,
} from "../src/index.js";

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AevoValueError);
    return (error as AevoValueError).code;
  }
  throw new Error("expected an AevoValueError");
}

describe("unit helpers", () => {
  it("converts valid 6-decimal values to raw integers", () => {
    expect(toRaw6("0")).toBe("0");
    expect(toRaw6("1")).toBe("1000000");
    expect(toRaw6("1.234567")).toBe("1234567");
    expect(toRaw6("1000000000000.000001")).toBe("1000000000000000001");
  });

  it("converts basis points and rates", () => {
    expect(bpsToRate("3")).toBe("0.0003");
    expect(bpsToRate("0.01")).toBe("0.000001");
    expect(rateToRaw("0.0003")).toBe("300");
    expect(rateToRaw("1")).toBe("1000000");
  });

  it("rejects imprecise, negative, and over-precision inputs", () => {
    expect(() => toRaw6("1.0000001")).toThrow(AevoValueError);
    expect(() => toRaw6("-1")).toThrow(AevoValueError);
    expect(() => toRaw6("1e-6")).toThrow(AevoValueError);
    expect(() => toRaw6(1 as unknown as string)).toThrow(AevoValueError);
    expect(() => bpsToRate("0.001")).toThrow(AevoValueError);
  });

  it("reports a specific error code for each kind of bad input", () => {
    expect(errorCode(() => toRaw6(1.5 as unknown as string))).toBe("UNSAFE_NUMBER");
    expect(errorCode(() => toRaw6(undefined as unknown as string))).toBe("INVALID_DECIMAL");
    expect(errorCode(() => toRaw6(10n as unknown as string))).toBe("INVALID_DECIMAL");
    expect(errorCode(() => toRaw6("-0.1"))).toBe("NEGATIVE_DECIMAL");
    expect(errorCode(() => toRaw6("1.0000001"))).toBe("TOO_MANY_DECIMALS");
    for (const bad of ["", " 1", "1 ", "01", ".5", "1.", "1,5", "+1", "0x10", "NaN", "Infinity", "1.2.3"]) {
      expect(errorCode(() => toRaw6(bad)), bad).toBe("INVALID_DECIMAL");
    }
  });

  it("handles exact 6-decimal boundaries and very large values without precision loss", () => {
    expect(toRaw6("0.000001")).toBe("1");
    expect(toRaw6("0.999999")).toBe("999999");
    expect(toRaw6("123456789012345678901234567890.123456")).toBe("123456789012345678901234567890123456");
    expect(rateToRaw("0.01")).toBe("10000");
    expect(errorCode(() => rateToRaw("0.0000001"))).toBe("TOO_MANY_DECIMALS");
  });

  it("converts basis points with at most 2 decimals", () => {
    expect(bpsToRate("0")).toBe("0");
    expect(bpsToRate("5")).toBe("0.0005");
    expect(bpsToRate("100")).toBe("0.01");
    expect(bpsToRate("2.5")).toBe("0.00025");
    expect(errorCode(() => bpsToRate("-1"))).toBe("NEGATIVE_DECIMAL");
  });

  it("normalizes decimals to canonical form", () => {
    expect(normalizeDecimal6("1.500000")).toBe("1.5");
    expect(normalizeDecimal6("0.000000")).toBe("0");
    expect(normalizeDecimal6("10")).toBe("10");
    expect(normalizeDecimal6("0.0003")).toBe("0.0003");
    expect(errorCode(() => normalizeDecimal6("1.0000001", "maxFee"))).toBe("TOO_MANY_DECIMALS");
  });

  it("requires exactly one of rate or bps", () => {
    expect(oneOfRateOrBps({ rate: "0.000300", fieldName: "builderFee" })).toBe("0.0003");
    expect(oneOfRateOrBps({ bps: "3", fieldName: "builderFee" })).toBe("0.0003");
    expect(errorCode(() => oneOfRateOrBps({ rate: "0.0003", bps: "3", fieldName: "builderFee" }))).toBe(
      "INVALID_ARGUMENT"
    );
    expect(errorCode(() => oneOfRateOrBps({ fieldName: "builderFee" }))).toBe("INVALID_ARGUMENT");
  });
});
