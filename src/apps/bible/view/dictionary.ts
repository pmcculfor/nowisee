import {
  edgeAction,
  edgeNode,
  edgePop,
  siblingListEdges,
  type MapFragment,
} from "../../../app-kit/index.ts";
import type { NodePayload } from "../../../core/types.ts";
import { DICTIONARY_POLICY } from "../catalog.ts";
import {
  dictionaryEmptyId,
  dictionaryWordId,
  dictionaryWorkId,
} from "../ids.ts";
import type { CanonRef, DictionaryWord } from "../types.ts";
import {
  addNode,
  addWindowedNodes,
  listedDictionaryWorks,
  siblingWindow,
  slotVerseId,
  type ViewSession,
} from "./helpers.ts";

export function addDictionaryEmpty(
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: CanonRef,
): void {
  const id = dictionaryEmptyId(ref);
  addNode(payloads, { id, label: dictionaryEmptyLabel() });
  fragments.push({ [id]: { back: edgePop() } });
}

export function addDictionaryWorks(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: CanonRef,
): void {
  const works = listedDictionaryWorks(session);
  const ids = works.map((work) => dictionaryWorkId(ref, work.id));
  fragments.push(siblingListEdges(ids, { wrap: true }));
  const verseId = slotVerseId(session.deps.store, ref);
  for (const work of works) {
    const id = dictionaryWorkId(ref, work.id);
    addNode(payloads, { id, label: work.label });
    const words =
      verseId === null ? [] : session.deps.store.listDictionaryWords(work.id, verseId);
    const first = words[0];
    fragments.push({
      [id]: {
        enter: first
          ? edgeAction(dictionaryWordId(ref, work.id, first.position))
          : edgeNode(dictionaryEmptyId(ref), "push"),
        back: edgePop(),
      },
    });
  }
  const focus = works[0];
  if (focus) {
    addDictionaryWords(session, payloads, fragments, ref, focus.id, undefined);
  }
}

export function addDictionaryWords(
  session: ViewSession,
  payloads: Map<string, NodePayload>,
  fragments: MapFragment[],
  ref: CanonRef,
  workId: number,
  focusPosition: number | undefined,
): void {
  const verseId = slotVerseId(session.deps.store, ref);
  const words =
    verseId === null ? [] : [...session.deps.store.listDictionaryWords(workId, verseId)];
  if (words.length === 0) {
    addDictionaryEmpty(payloads, fragments, ref);
    return;
  }
  const ids = words.map((word) => dictionaryWordId(ref, workId, word.position));
  const focusId =
    focusPosition !== undefined
      ? dictionaryWordId(ref, workId, focusPosition)
      : ids[0]!;
  const around = siblingWindow(ids, focusId, DICTIONARY_POLICY.siblingRadius);
  fragments.push(siblingListEdges(ids, { wrap: false, around }));
  addWindowedNodes(payloads, ids, around, (_id, index) => ({
    id: ids[index]!,
    label: dictionaryWordLabel(words[index]!),
  }));
  const start = around ? Math.max(0, around.index - around.radius) : 0;
  const end = around ? Math.min(ids.length, around.index + around.radius + 1) : ids.length;
  for (let i = start; i < end; i++) {
    fragments.push({
      [ids[i]!]: { back: edgePop() },
    });
  }
}

export function dictionaryEmptyLabel(): string {
  return "No dictionary entries for this verse.";
}

export function dictionaryWordLabel(word: DictionaryWord): string {
  return [word.english, word.translit, word.strongs, word.body].filter(Boolean).join(". ");
}

export function dictionaryWordLabelFor(
  session: ViewSession,
  ref: CanonRef,
  workId: number,
  position: number,
): string {
  const verseId = slotVerseId(session.deps.store, ref);
  if (verseId === null) {
    return dictionaryEmptyLabel();
  }
  const word = session.deps.store
    .listDictionaryWords(workId, verseId)
    .find((item) => item.position === position);
  return word ? dictionaryWordLabel(word) : dictionaryEmptyLabel();
}
