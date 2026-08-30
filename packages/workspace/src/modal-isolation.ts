import { useEffect, type RefObject } from "react";

interface ElementState {
  element: HTMLElement;
  hadInert: boolean;
  ariaHidden: string | null;
}

export function useModalIsolation(
  root: RefObject<HTMLElement | null>,
  active: boolean,
  exemptSelector: string,
): void {
  useEffect(() => {
    const container = root.current;
    if (!container || !active) return;
    const states = Array.from(container.children)
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement && !(exemptSelector && element.matches(exemptSelector))
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
  }, [active, exemptSelector, root]);
}
