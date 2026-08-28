import { useEffect, type RefObject } from "react";

interface ElementState {
  element: HTMLElement;
  hadInert: boolean;
  ariaHidden: string | null;
}

function isModal(element: HTMLElement): boolean {
  const role = element.getAttribute("role");
  return role === "dialog" || role === "alertdialog";
}

export function useModalIsolation(
  root: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const container = root.current;
    if (!container || !active) return;
    const states = Array.from(container.children)
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement && !isModal(element)
      ))
      .map((element): ElementState => ({
        element,
        hadInert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    for (const { element } of states) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    return () => {
      for (const { element, hadInert, ariaHidden } of states) {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [active, root]);
}
