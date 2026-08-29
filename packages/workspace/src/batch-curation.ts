import type {
  AssetDetail,
  AssetPatch,
  AssetSummary,
  ReviewState,
} from "@pitchdog/reference-bridge";

export interface BatchCurationAction {
  reviewState?: ReviewState;
  addTags?: readonly string[];
  addUsedIn?: readonly string[];
}

export interface BatchFailure {
  asset: AssetSummary;
  reason: unknown;
}

export interface BatchOutcome {
  updated: AssetDetail[];
  failed: BatchFailure[];
  skipped: number;
}

export function parseBatchTokens(value: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of value.split(/[\n,]+/)) {
    const token = raw.trim().replace(/^#+/, "");
    const key = token.toLocaleLowerCase();
    if (!token || seen.has(key)) continue;
    seen.add(key);
    output.push(token);
  }
  return output;
}

export function mergeEditorialTokens(
  current: readonly string[],
  additions: readonly string[],
): string[] {
  const output = [...current];
  const seen = new Set(current.map((token) => token.toLocaleLowerCase()));
  for (const token of additions) {
    const trimmed = token.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

export function buildBatchPatch(
  asset: AssetSummary,
  action: BatchCurationAction,
): AssetPatch | null {
  const tags = action.addTags?.length
    ? mergeEditorialTokens(asset.tags, action.addTags)
    : asset.tags;
  const usedIn = action.addUsedIn?.length
    ? mergeEditorialTokens(asset.usedIn, action.addUsedIn)
    : asset.usedIn;
  const tagsChanged = tags.length !== asset.tags.length;
  const usedInChanged = usedIn.length !== asset.usedIn.length;
  const reviewChanged = action.reviewState !== undefined && action.reviewState !== asset.reviewState;
  if (!tagsChanged && !usedInChanged && !reviewChanged) return null;

  return {
    customTitle: { action: "unchanged" },
    reviewState: reviewChanged ? action.reviewState : undefined,
    note: { action: "unchanged" },
    tags: tagsChanged ? { action: "set", value: tags } : { action: "unchanged" },
    usedIn: usedInChanged ? { action: "set", value: usedIn } : { action: "unchanged" },
  };
}

export async function runBatchCuration(
  assets: readonly AssetSummary[],
  action: BatchCurationAction,
  update: (asset: AssetSummary, patch: AssetPatch) => Promise<AssetDetail>,
  refresh: (asset: AssetSummary) => Promise<AssetSummary> = async (asset) => asset,
): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { updated: [], failed: [], skipped: 0 };
  for (const original of assets) {
    try {
      const asset = await refresh(original);
      const patch = buildBatchPatch(asset, action);
      if (!patch) {
        outcome.skipped += 1;
        continue;
      }
      outcome.updated.push(await update(asset, patch));
    } catch (reason) {
      outcome.failed.push({ asset: original, reason });
    }
  }
  return outcome;
}

export function batchOutcomeMessage(outcome: BatchOutcome): string {
  const parts: string[] = [];
  if (outcome.updated.length) parts.push(`Updated ${outcome.updated.length}`);
  if (outcome.skipped) parts.push(`${outcome.skipped} already matched`);
  if (outcome.failed.length) parts.push(`${outcome.failed.length} failed`);
  return parts.length ? `${parts.join(" · ")}.` : "Nothing changed.";
}
