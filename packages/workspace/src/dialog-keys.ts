import type { KeyboardEvent } from "react";

export function handleDialogKey(event: KeyboardEvent<HTMLElement>, onEscape: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== "Tab") return;
  const layoutAvailable = event.currentTarget.getClientRects().length > 0;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex='0']",
  )].filter((control) => {
    if (control.closest("[inert], [aria-hidden='true']")) return false;
    if (control.tagName !== "SUMMARY" && control.closest("details:not([open])")) return false;
    if (layoutAvailable && control.getClientRects().length === 0) return false;
    const style = getComputedStyle(control);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  if (controls.length === 0) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? (current <= 0 ? controls.length - 1 : current - 1)
    : (current < 0 || current === controls.length - 1 ? 0 : current + 1);
  event.preventDefault();
  controls[next]?.focus();
}
