export type NavigationKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export function moveSelectionIndex(
  current: number,
  key: NavigationKey,
  columns: number,
  itemCount: number,
): number {
  if (itemCount <= 0) return -1;
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeCurrent = Math.min(Math.max(current, 0), itemCount - 1);
  const proposed =
    key === "ArrowLeft"
      ? safeCurrent - 1
      : key === "ArrowRight"
        ? safeCurrent + 1
        : key === "ArrowUp"
          ? safeCurrent - safeColumns
          : key === "ArrowDown"
            ? safeCurrent + safeColumns
            : key === "Home"
              ? 0
              : itemCount - 1;
  return Math.min(Math.max(proposed, 0), itemCount - 1);
}
