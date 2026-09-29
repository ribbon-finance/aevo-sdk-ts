import { AevoValueError } from "./errors.js";

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function assertDecimalString(value: unknown, name: string): string {
  if (typeof value === "number") {
    throw new AevoValueError(
      "UNSAFE_NUMBER",
      `${name} must be a decimal string; JS numbers are rejected for money`
    );
  }
  if (typeof value !== "string") {
    throw new AevoValueError("INVALID_DECIMAL", `${name} must be a decimal string`);
  }
  if (value.startsWith("-")) {
    throw new AevoValueError("NEGATIVE_DECIMAL", `${name} must be non-negative`);
  }
  if (!DECIMAL_PATTERN.test(value)) {
    throw new AevoValueError("INVALID_DECIMAL", `${name} must be a plain decimal string`);
  }
  return value;
}

function parseFixed(value: unknown, decimals: number, name: string): bigint {
  const text = assertDecimalString(value, name);
  const match = DECIMAL_PATTERN.exec(text);
  const whole = match?.[1] ?? "0";
  const fraction = match?.[2] ?? "";
  if (fraction.length > decimals) {
    throw new AevoValueError(
      "TOO_MANY_DECIMALS",
      `${name} must have at most ${decimals} decimal places`
    );
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

function formatFixed(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionText}`;
}

export function toRaw6(decimalString: string): string {
  return parseFixed(decimalString, 6, "value").toString();
}

export function rateToRaw(rate: string): string {
  return parseFixed(rate, 6, "rate").toString();
}

export function bpsToRate(bps: string): string {
  const rawBpsHundredths = parseFixed(bps, 2, "bps");
  return formatFixed(rawBpsHundredths, 6);
}

export function normalizeDecimal6(decimalString: string, name = "value"): string {
  return formatFixed(parseFixed(decimalString, 6, name), 6);
}

export function oneOfRateOrBps(params: {
  rate?: string | undefined;
  bps?: string | undefined;
  fieldName: string;
}): string {
  if (params.rate !== undefined && params.bps !== undefined) {
    throw new AevoValueError(
      "INVALID_ARGUMENT",
      `pass either ${params.fieldName}Rate or ${params.fieldName}Bps, not both`
    );
  }
  if (params.bps !== undefined) {
    return bpsToRate(params.bps);
  }
  if (params.rate !== undefined) {
    return normalizeDecimal6(params.rate, params.fieldName);
  }
  throw new AevoValueError(
    "INVALID_ARGUMENT",
    `${params.fieldName}Rate or ${params.fieldName}Bps is required`
  );
}
