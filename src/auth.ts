import { createHmac } from "node:crypto";

export interface HmacSignatureInput {
  key: string;
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  body?: string | undefined;
}

export interface HmacSignatureResult {
  canonicalString: string;
  signature: string;
}

export function pathWithoutQuery(pathOrTarget: string): string {
  const question = pathOrTarget.indexOf("?");
  return question === -1 ? pathOrTarget : pathOrTarget.slice(0, question);
}

export function generateHmacSignature(input: HmacSignatureInput): HmacSignatureResult {
  const body = input.body ?? "";
  const canonicalString = [
    input.key,
    input.timestamp,
    input.method,
    pathWithoutQuery(input.path),
    body
  ].join(",");
  const signature = createHmac("sha256", input.secret)
    .update(canonicalString)
    .digest("hex");
  return { canonicalString, signature };
}

export function unixTimestampNanoseconds(date = new Date()): string {
  return (BigInt(date.getTime()) * 1_000_000n).toString();
}
