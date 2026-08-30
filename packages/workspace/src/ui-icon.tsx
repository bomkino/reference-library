import type { Icon } from "@phosphor-icons/react";

export function UiIcon({ icon: IconComponent }: { icon: Icon }) {
  return <IconComponent className="ui-icon" aria-hidden="true" focusable="false" size="1em" weight="bold" />;
}
