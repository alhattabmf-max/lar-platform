"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FAQ_ITEMS_SETTING_KEY,
  FAQ_ITEM_LIMITS,
  FAQ_MAX_ITEMS,
  type FaqItem,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";

/**
 * The FAQ, edited as a LIST of questions.
 *
 * Add, edit, reorder, activate — the four things an operator needs for
 * content that grows one entry at a time. A single block of text
 * supports none of them.
 *
 * WHAT THIS WRITES is one settings row: the whole list is sent to
 * `PUT /admin/settings/faq_items`, validated by the same registry that
 * validates every other setting. There is no FAQ table, no migration,
 * and no endpoint of its own — which is also why the entire list is
 * written at once rather than one item at a time.
 *
 * ORDER IS CHANGED WITH BUTTONS, operable from the keyboard. Drag and
 * drop is not offered as the only way: it is unusable with a keyboard,
 * unreliable with a screen reader, and awkward on a touch screen.
 *
 * RETIRING IS NOT DELETING. `isActive` hides a question from the public
 * page while keeping what it said, so a seasonal answer can come back
 * without being rewritten. Deleting is still offered, and asks first.
 */
export interface FaqManagerLabels {
  addLegend: string;
  questionAr: string;
  questionEn: string;
  answerAr: string;
  answerEn: string;
  add: string;
  save: string;
  saved: string;
  moveUp: string;
  moveDown: string;
  activate: string;
  deactivate: string;
  remove: string;
  removePrompt: string;
  confirm: string;
  cancel: string;
  working: string;
  required: string;
  empty: string;
  active: string;
  inactive: string;
  full: string;
  errorTitle: string;
  requestIdLabel: string;
}

export interface FaqManagerProps {
  items: FaqItem[];
  labels: FaqManagerLabels;
}

/** A new item's id. Crypto-random so two admins cannot collide. */
function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function FaqManager({ items, labels }: FaqManagerProps) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [list, setList] = useState<FaqItem[]>(() => [...items]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // The server is the source of truth. A refresh bringing new rows in
  // replaces the local arrangement, so an operator is never editing a
  // list that no longer matches what was saved — including by a
  // colleague working at the same time.
  useEffect(() => {
    setList([...items]);
    setDirty(false);
  }, [items]);

  const [questionAr, setQuestionAr] = useState("");
  const [questionEn, setQuestionEn] = useState("");
  const [answerAr, setAnswerAr] = useState("");
  const [answerEn, setAnswerEn] = useState("");

  const canAdd =
    questionAr.trim() !== "" &&
    questionEn.trim() !== "" &&
    answerAr.trim() !== "" &&
    answerEn.trim() !== "" &&
    list.length < FAQ_MAX_ITEMS;

  async function persist(next: FaqItem[]) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setSaved(false);
    try {
      // sortOrder is rewritten from the array position on every save, so
      // the stored order can never disagree with what is on screen.
      const ordered = next.map((item, index) => ({
        ...item,
        sortOrder: index,
      }));
      await apiClient.put(`/admin/settings/${FAQ_ITEMS_SETTING_KEY}`, {
        value: ordered,
      });
      setBusy(false);
      setDirty(false);
      setSaved(true);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;

    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setList(next);
    setDirty(true);

    // Focus follows the row that moved, so an operator can press the
    // same key repeatedly without hunting for where the item went.
    queueMicrotask(() => {
      document
        .getElementById(`${ids}-${delta < 0 ? "up" : "down"}-${target}`)
        ?.focus();
    });
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!canAdd) return;

    const next = [
      ...list,
      {
        id: newId(),
        questionAr: questionAr.trim(),
        questionEn: questionEn.trim(),
        answerAr: answerAr.trim(),
        answerEn: answerEn.trim(),
        sortOrder: list.length,
        isActive: true,
      },
    ];
    setList(next);
    void persist(next).then(() => {
      setQuestionAr("");
      setQuestionEn("");
      setAnswerAr("");
      setAnswerEn("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={add}
        className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y"
        noValidate
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="px-1 text-base font-medium text-content">
            {labels.addLegend}
          </legend>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-qar`}>
                {labels.questionAr}
                <span aria-hidden="true">*</span>
                <span className="sr-only">{labels.required}</span>
              </Label>
              <Input
                id={`${ids}-qar`}
                dir="rtl"
                maxLength={FAQ_ITEM_LIMITS.question}
                value={questionAr}
                onChange={(event) => setQuestionAr(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-qen`}>
                {labels.questionEn}
                <span aria-hidden="true">*</span>
                <span className="sr-only">{labels.required}</span>
              </Label>
              <Input
                id={`${ids}-qen`}
                dir="ltr"
                maxLength={FAQ_ITEM_LIMITS.question}
                value={questionEn}
                onChange={(event) => setQuestionEn(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-aar`}>
                {labels.answerAr}
                <span aria-hidden="true">*</span>
                <span className="sr-only">{labels.required}</span>
              </Label>
              <Textarea
                id={`${ids}-aar`}
                dir="rtl"
                rows={4}
                maxLength={FAQ_ITEM_LIMITS.answer}
                value={answerAr}
                onChange={(event) => setAnswerAr(event.target.value)}
                className="rounded-md border border-line bg-surface p-2 text-sm text-content"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-aen`}>
                {labels.answerEn}
                <span aria-hidden="true">*</span>
                <span className="sr-only">{labels.required}</span>
              </Label>
              <Textarea
                id={`${ids}-aen`}
                dir="ltr"
                rows={4}
                maxLength={FAQ_ITEM_LIMITS.answer}
                value={answerEn}
                onChange={(event) => setAnswerEn(event.target.value)}
                className="rounded-md border border-line bg-surface p-2 text-sm text-content"
              />
            </div>
          </div>

          {list.length >= FAQ_MAX_ITEMS ? (
            <p role="status" className="text-sm text-warning-text">
              {labels.full}
            </p>
          ) : null}

          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={!canAdd || busy}
          >
            {busy ? labels.working : labels.add}
          </Button>
        </fieldset>
      </form>

      {failure ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-line p-3"
        >
          <p className="text-sm font-medium text-danger">{labels.errorTitle}</p>
          <p className="text-sm text-content-muted">
            {root(failure.messageKey)}
          </p>
          {failure.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}:{" "}
              <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {saved ? (
        <p role="status" aria-live="polite" className="text-sm text-content">
          {labels.saved}
        </p>
      ) : null}

      {list.length === 0 ? (
        <p className="text-sm text-content-muted">{labels.empty}</p>
      ) : (
        <ol className="flex list-none flex-col gap-3">
          {list.map((item, index) => (
            <li
              key={item.id}
              className="rounded-md border border-line bg-surface p-3"
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-sm text-content">
                    {item.questionAr}
                  </span>
                  <span className="text-xs text-content-muted">
                    {item.isActive ? labels.active : labels.inactive}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    id={`${ids}-up-${index}`}
                    variant="ghost"
                    size="sm"
                   
                    disabled={busy || index === 0}
                    aria-label={labels.moveUp}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    id={`${ids}-down-${index}`}
                    variant="ghost"
                    size="sm"
                   
                    disabled={busy || index === list.length - 1}
                    aria-label={labels.moveDown}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>

                  <Button
                    type="button"
                    variant={item.isActive ? "danger" : "primary"}
                    size="sm"
                   
                    disabled={busy}
                    onClick={() => {
                      const next = list.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, isActive: !entry.isActive }
                          : entry,
                      );
                      setList(next);
                      void persist(next);
                    }}
                  >
                    {item.isActive ? labels.deactivate : labels.activate}
                  </Button>

                  {removing === item.id ? null : (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                     
                      disabled={busy}
                      onClick={() => setRemoving(item.id)}
                    >
                      {labels.remove}
                    </Button>
                  )}
                </div>

                {removing === item.id ? (
                  // Asked in the page, never through window.confirm: a
                  // native dialog cannot be translated, ignores the
                  // document direction, and a browser may suppress it.
                  <div className="flex flex-col gap-2 rounded-md border border-line p-3">
                    <p
                      role="status"
                      aria-live="polite"
                      className="text-sm text-content"
                    >
                      {labels.removePrompt}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                       
                        disabled={busy}
                        onClick={() => {
                          const next = list.filter(
                            (entry) => entry.id !== item.id,
                          );
                          setList(next);
                          setRemoving(null);
                          void persist(next);
                        }}
                      >
                        {busy ? labels.working : labels.confirm}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                       
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        {labels.cancel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {dirty ? (
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={() => void persist(list)}
        >
          {busy ? labels.working : labels.save}
        </Button>
      ) : null}
    </div>
  );
}
