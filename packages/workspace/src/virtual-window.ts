export interface VirtualWindowInput {
  itemCount: number;
  columns: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscanRows?: number;
}

export interface VirtualWindow {
  startIndex: number;
  endIndexExclusive: number;
  startRow: number;
  endRowExclusive: number;
  totalHeight: number;
  offsetTop: number;
  renderedCount: number;
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  const columns = Math.max(1, Math.floor(input.columns));
  const rowHeight = Math.max(1, input.rowHeight);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const scrollTop = Math.max(0, input.scrollTop);
  const overscan = Math.max(0, Math.floor(input.overscanRows ?? 2));
  const rowCount = Math.ceil(itemCount / columns);
  const firstVisibleRow = Math.floor(scrollTop / rowHeight);
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const startRow = Math.max(0, firstVisibleRow - overscan);
  const endRowExclusive = Math.min(
    rowCount,
    firstVisibleRow + visibleRows + overscan,
  );
  const startIndex = Math.min(itemCount, startRow * columns);
  const endIndexExclusive = Math.min(itemCount, endRowExclusive * columns);
  return {
    startIndex,
    endIndexExclusive,
    startRow,
    endRowExclusive,
    totalHeight: rowCount * rowHeight,
    offsetTop: startRow * rowHeight,
    renderedCount: Math.max(0, endIndexExclusive - startIndex),
  };
}
