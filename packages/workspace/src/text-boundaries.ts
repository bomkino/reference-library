import { unicodeScalarLength } from "@pitchdog/reference-bridge";

export function textLimitError(
  value: string,
  maximum: number,
  label: string,
  trimBeforeCount = false,
): string | null {
  const measured = trimBeforeCount ? value.trim() : value;
  return unicodeScalarLength(measured) > maximum
    ? `${label} must be at most ${maximum.toLocaleString()} Unicode characters.`
    : null;
}

export function safeRelativeDisplayPath(value: string): string {
  if (
    !value ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^file:/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split(/[\\/]/).some((part) => part === "..")
  ) {
    return "Relative path unavailable";
  }
  return value;
}
