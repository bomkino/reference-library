import type { KeyboardEvent } from "react";

export function handleDialogKey(event: KeyboardEvent<HTMLElement>, onEscape: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']",
  )];
  if (controls.length === 0) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? (current <= 0 ? controls.length - 1 : current - 1)
    : (current < 0 || current === controls.length - 1 ? 0 : current + 1);
  event.preventDefault();
  controls[next]?.focus();
}
