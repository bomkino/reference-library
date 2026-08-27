import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_ASSET_NOTE_SCALARS,
  MAX_ASSET_TITLE_SCALARS,
  unicodeScalarLength,
  type AssetDetail,
  type AssetSummary,
  type ReferenceWorkspaceBridge,
  type ReviewState,
  type TextPatch,
} from "@pitchdog/reference-bridge";
import { safeErrorMessage } from "./safe-errors";

export interface AssetDraft {
  title: string;
  note: string;
  reviewState: ReviewState;
}

export function useAssetEditor(
  bridge: ReferenceWorkspaceBridge,
  sessionId: string,
  selected: AssetSummary | null,
  revisionPulse: number,
  onSaved: (detail: AssetDetail) => void,
) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [draft, setDraft] = useState<AssetDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!selected) { setDetail(null); setDraft(null); setError(null); return; }
    const current = ++request.current;
    setLoading(true);
    try {
      const next = await bridge.getAsset(sessionId, selected.assetId);
      if (current !== request.current) return;
      setDetail(next);
      setDraft(toDraft(next));
      setError(null);
    } catch (reason) {
      if (current === request.current) setError(messageFrom(reason));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [bridge, selected?.assetId, sessionId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (revisionPulse > 0 && detail && !isDirty(detail, draft)) void load();
  }, [revisionPulse]);

  const dirty = useMemo(() => isDirty(detail, draft), [detail, draft]);
  const discard = useCallback(() => { if (detail) setDraft(toDraft(detail)); }, [detail]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!detail || !draft || !isDirty(detail, draft)) return true;
    if (assetDraftErrors(draft).length > 0) {
      setError("Shorten the highlighted Asset fields before saving.");
      return false;
    }
    setSaving(true);
    try {
      const result = await bridge.updateAsset({
        sessionId,
        assetId: detail.assetId,
        expectedRevision: detail.revision,
        patch: {
          customTitle: textPatch(detail.customTitle, draft.title, true),
          note: textPatch(detail.note, draft.note, false),
          reviewState: draft.reviewState,
        },
      });
      setDetail(result.asset);
      setDraft(toDraft(result.asset));
      onSaved(result.asset);
      setError(null);
      return true;
    } catch (reason) {
      setError(messageFrom(reason));
      return false;
    } finally {
      setSaving(false);
    }
  }, [bridge, detail, draft, onSaved, sessionId]);

  return { detail, draft, setDraft, dirty, loading, saving, error, save, discard, reload: load };
}

function toDraft(detail: AssetDetail): AssetDraft {
  return { title: detail.customTitle ?? "", note: detail.note ?? "", reviewState: detail.reviewState };
}

function isDirty(detail: AssetDetail | null, draft: AssetDraft | null): boolean {
  return Boolean(detail && draft && (
    (detail.customTitle ?? "") !== draft.title ||
    (detail.note ?? "") !== draft.note ||
    detail.reviewState !== draft.reviewState
  ));
}

export function textPatch(current: string | null, draft: string, trimBlank: boolean): TextPatch {
  if ((current ?? "") === draft) return { action: "unchanged" };
  if ((trimBlank ? draft.trim() : draft.trim()).length === 0) return { action: "clear" };
  return { action: "set", value: trimBlank ? draft.trim() : draft };
}

export function assetDraftErrors(draft: AssetDraft | null): string[] {
  if (!draft) return [];
  const errors: string[] = [];
  if (unicodeScalarLength(draft.title) > MAX_ASSET_TITLE_SCALARS) errors.push("title");
  if (unicodeScalarLength(draft.note) > MAX_ASSET_NOTE_SCALARS) errors.push("note");
  return errors;
}

function messageFrom(reason: unknown): string {
  return safeErrorMessage(reason, "Asset update failed.");
}
