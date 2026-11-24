"use client";

import Link from "next/link";
import { useState } from "react";
import { editCareerAction, rewriteCareerItemsAction } from "@/modules/applications/career-actions";
import type { CareerItemCheck } from "@/modules/applications/career-check";
import { RESUME_LIMITS } from "@/modules/applications/options";
import { dutiesLine, parseLines } from "@/modules/applications/resume-entries";
import type { ResumeLine } from "@/modules/applications/types";
import { ErrorLine, useRun } from "../postings/[id]/application/use-run";
import type { CareerCompanyView, CareerEditorData, CareerItemView } from "./editor-data";

// 경력기술서 공통본·맞춤본이 함께 쓰는 편집 화면. 검사 결과는 서버가 그릴 때 계산해 넘긴다

type Field = "done" | "results";

const small = "text-sm underline disabled:opacity-50";
const primary = "rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50";
const WAIT = "1분쯤 걸릴 수 있습니다";
const FULL = "경력기술서 항목은 30개까지입니다. 항목을 빼고 넣어 주세요";
const OVERWRITE = "직접 고친 줄이 덮어써집니다. 다시 쓸까요?";
const FIELD_LABEL: Record<Field, string> = { done: "한 일", results: "성과" };

// 회사가 쓸 수 없으면 회사 줄에서 한 번만 알린다
function problems(check: CareerItemCheck, companyUnavailable: boolean): string[] {
  if (check.unavailable) return companyUnavailable ? [] : ["이 경험은 지금 쓸 수 없습니다(확인 풀림, 제외, 지움). 빼 주세요"];
  const lines: string[] = [];
  if (check.empty) lines.push("줄이 없습니다. 다시 쓰기로 채워 주세요");
  if (check.stale) lines.push("경험 기록이 바뀌었습니다. 다시 쓰기를 권합니다");
  if (check.scopeChanged) lines.push("트랙의 사용 범위가 바뀌었습니다. 다시 쓰기를 권합니다");
  if (check.banned.length > 0) lines.push(`쓰면 안 되는 표현: ${check.banned.join(", ")}`);
  if (check.ungrounded.length > 0) lines.push(`기록에 없는 숫자: ${check.ungrounded.join(", ")}`);
  return lines;
}

// 화면에서 먼저 줄 수와 길이를 본다. 서버도 같은 한도로 다시 본다
function linesProblem(text: string): string | null {
  const lines = parseLines(text);
  if (lines.length > RESUME_LIMITS.editLines) return `줄은 ${RESUME_LIMITS.editLines}개까지 쓸 수 있습니다`;
  if (lines.some((line) => [...line].length > RESUME_LIMITS.line)) return `한 줄은 ${RESUME_LIMITS.line}자까지 쓸 수 있습니다`;
  return null;
}

function Lines({ label, lines }: { label: string; lines: ResumeLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground/60">{label}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {lines.map((line, index) => (
          <li key={index} className="break-words">
            {line.text}
            {line.edited && <span className="ml-2 text-xs text-foreground/50">직접 수정</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemCard({
  data,
  view,
  companyUnavailable,
  first,
  last,
  readOnly,
}: {
  data: CareerEditorData;
  view: CareerItemView;
  companyUnavailable: boolean;
  first: boolean; // 회사 안의 맨 위
  last: boolean; // 회사 안의 맨 아래
  readOnly: boolean;
}) {
  const { item, check, href } = view;
  const [editing, setEditing] = useState<Field | null>(null);
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const edit = useRun();
  const rewrite = useRun();
  const pending = edit.pending || rewrite.pending;
  const lines = problems(check, companyUnavailable);
  const recommend = !check.unavailable && (check.stale || check.scopeChanged || check.empty);
  const heading = [item.heading.name, item.heading.role, item.heading.period].filter(Boolean).join(" · ");
  const id = item.experienceId;

  function open(field: Field) {
    setText(item[field].map((line) => line.text).join("\n"));
    setLocalError(null);
    setEditing(field);
  }

  function save() {
    if (!editing) return;
    const problem = linesProblem(text);
    setLocalError(problem);
    if (problem) return;
    edit.run(() => editCareerAction(data.careerId, { type: "lines", itemId: id, field: editing, text }, data.version), () => setEditing(null));
  }

  function rewriteOne() {
    if ([...item.done, ...item.results].some((line) => line.edited) && !confirm(OVERWRITE)) return;
    rewrite.run(() => rewriteCareerItemsAction(data.careerId, [id], data.version));
  }

  return (
    <li className="space-y-2 py-3" aria-label={item.heading.name}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 break-words font-medium">
          {href ? (
            <Link href={href} className="hover:underline">
              {heading}
            </Link>
          ) : (
            heading
          )}
        </p>
        {item.detail === "summary" && <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs">요약</span>}
        {item.emphasized && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">강조</span>}
      </div>
      {item.heading.tools.length > 0 && <p className="break-words text-sm text-foreground/80">기술: {item.heading.tools.join(", ")}</p>}

      {editing ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground/60">{FIELD_LABEL[editing]}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(3, item[editing].length + 1)}
            aria-label={`${item.heading.name} ${FIELD_LABEL[editing]}`}
            className="w-full rounded-lg border border-foreground/20 bg-transparent p-3 text-sm"
          />
          <p className="text-xs text-foreground/60">
            한 줄에 한 줄씩 씁니다. {RESUME_LIMITS.editLines}줄, 한 줄 {RESUME_LIMITS.line}자까지
          </p>
          <div className="flex gap-3">
            <button type="button" disabled={pending} onClick={save} className={primary}>
              {edit.pending ? "저장 중…" : "저장"}
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(null)} className={small}>
              취소
            </button>
          </div>
          <ErrorLine message={localError} />
        </div>
      ) : (
        <>
          <Lines label="한 일" lines={item.done} />
          <Lines label="성과" lines={item.results} />
        </>
      )}

      {lines.map((line) => (
        <p key={line} className="text-xs text-red-600">
          {line}
        </p>
      ))}

      {!readOnly && !editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" disabled={pending} onClick={() => open("done")} className={small}>
            한 일 고치기
          </button>
          <button type="button" disabled={pending} onClick={() => open("results")} className={small}>
            성과 고치기
          </button>
          <button
            type="button"
            disabled={pending || first}
            onClick={() => edit.run(() => editCareerAction(data.careerId, { type: "move", itemId: id, direction: "up" }, data.version))}
            className={small}
          >
            위로
          </button>
          <button
            type="button"
            disabled={pending || last}
            onClick={() => edit.run(() => editCareerAction(data.careerId, { type: "move", itemId: id, direction: "down" }, data.version))}
            className={small}
          >
            아래로
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => edit.run(() => editCareerAction(data.careerId, { type: "remove", itemId: id }, data.version))}
            className={small}
          >
            빼기
          </button>
          {!check.unavailable && (
            <button
              type="button"
              disabled={pending}
              onClick={rewriteOne}
              className={recommend ? "rounded-lg border border-red-600 px-3 py-1 text-sm font-medium text-red-600 disabled:opacity-50" : small}
            >
              {rewrite.pending ? "다시 쓰는 중…" : "다시 쓰기"}
            </button>
          )}
          {rewrite.pending && (
            <span role="status" className="text-sm text-foreground/60">
              {WAIT}
            </span>
          )}
        </div>
      )}
      <ErrorLine message={edit.message ?? rewrite.message} />
    </li>
  );
}

function CompanyBlock({ data, view, readOnly }: { data: CareerEditorData; view: CareerCompanyView; readOnly: boolean }) {
  const { company, check, items } = view;
  const run = useRun();
  const heading = [company.heading.company, company.heading.department, company.heading.title, company.heading.period].filter(Boolean).join(" · ");
  const duties = dutiesLine(company.heading.duties);
  const id = company.experienceId;

  return (
    <div className="space-y-1" aria-label={company.heading.company}>
      <h2 className="break-words text-lg font-semibold">{heading}</h2>
      {duties && <p className="break-words text-sm text-foreground/80">{duties}</p>}
      {check.unavailable ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-red-600">
          이 경력은 지금 쓸 수 없습니다(확인 풀림, 제외, 지움)
          {!readOnly && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                disabled={run.pending}
                onClick={() => run.run(() => editCareerAction(data.careerId, { type: "remove", itemId: id }, data.version))}
                className={small}
              >
                빼기
              </button>
            </>
          )}
        </p>
      ) : (
        check.stale && (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-amber-700 dark:text-amber-400">
            경력 기록이 바뀌었습니다
            {!readOnly && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  disabled={run.pending}
                  onClick={() => run.run(() => rewriteCareerItemsAction(data.careerId, [id], data.version))}
                  className={small}
                >
                  {run.pending ? "새로 고치는 중…" : "머리 새로 고침"}
                </button>
              </>
            )}
          </p>
        )
      )}
      <ErrorLine message={run.message} />
      {items.length > 0 && (
        <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
          {items.map((itemView, index) => (
            <ItemCard
              key={itemView.item.experienceId}
              data={data}
              view={itemView}
              companyUnavailable={check.unavailable}
              first={index === 0}
              last={index === items.length - 1}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// 빠진 회사·항목을 체크해서 넣는다. 처음에는 모두 체크되어 있다(새로 생긴 것도 체크된 채로 보이게 뺀 것만 기억한다)
function MissingPanel({ data }: { data: CareerEditorData }) {
  const add = useRun();
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const chosen = data.missing.filter((entry) => !unchecked.has(entry.id));

  function toggle(id: string, checked: boolean) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2 rounded-lg bg-foreground/5 p-3">
      <p className="text-sm">빠진 항목 {data.missing.length}개</p>
      <ul className="space-y-1">
        {data.missing.map((entry) => {
          // 회사째 빠졌으면 이름이 곧 회사 이름이다
          const label = entry.name === entry.companyName ? entry.companyName : [entry.companyName, entry.name].filter(Boolean).join(" · ");
          return (
            <li key={entry.id}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!unchecked.has(entry.id)}
                  disabled={add.pending || data.full}
                  onChange={(e) => toggle(entry.id, e.target.checked)}
                  className="mt-1"
                />
                <span className="min-w-0 break-words">{label}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {data.full ? (
        <p className="text-sm text-red-600">{FULL}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={add.pending || chosen.length === 0}
            onClick={() =>
              add.run(
                () => rewriteCareerItemsAction(data.careerId, chosen.map((entry) => entry.id), data.version),
                () => setUnchecked(new Set()),
              )
            }
            className={primary}
          >
            {add.pending ? "넣는 중…" : "넣기"}
          </button>
          {add.pending && (
            <span role="status" className="text-sm text-foreground/60">
              {WAIT}
            </span>
          )}
        </div>
      )}
      <ErrorLine message={add.message} />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={copy} className="rounded-lg border border-foreground/20 px-3 py-1.5 text-sm">
        글로 복사
      </button>
      {copied && (
        <span role="status" className="text-sm text-foreground/60">
          복사했습니다
        </span>
      )}
      {copyError && (
        <span role="alert" className="text-sm text-red-600">
          복사하지 못했습니다. 글을 직접 선택해 복사해 주세요
        </span>
      )}
    </div>
  );
}

export function CareerEditor({
  data,
  readOnly,
  tailored,
}: {
  data: CareerEditorData;
  readOnly: boolean; // 맞춤본인데 지원이 아니면 버튼을 숨기고 복사만 둔다
  tailored: boolean;
}) {
  const all = useRun();
  const usable = data.companies.flatMap((company) => company.items.filter((view) => !view.check.unavailable));

  function rewriteAll() {
    const edited = usable.some((view) => [...view.item.done, ...view.item.results].some((line) => line.edited));
    if (!confirm(`쓸 수 있는 항목 ${usable.length}개를 모두 다시 씁니다.${edited ? " 직접 고친 줄이 덮어써집니다." : ""} 다시 쓸까요?`)) return;
    all.run(() => rewriteCareerItemsAction(data.careerId, usable.map((view) => view.item.experienceId), data.version));
  }

  return (
    <section className="space-y-4" aria-label={tailored ? "경력기술서 맞춤본" : "경력기술서 공통본"}>
      {!readOnly && data.missing.length > 0 && <MissingPanel data={data} />}
      {data.commonChanged && (
        <p className="text-sm text-amber-700 dark:text-amber-400">공통본을 고친 뒤입니다{readOnly ? "" : ". 다시 만들면 고친 공통본에서 출발합니다"}</p>
      )}
      <CopyButton text={data.copyText} />

      {data.companies.length === 0 ? (
        <p className="text-sm text-foreground/70">경력기술서에 남은 회사가 없습니다</p>
      ) : (
        data.companies.map((view) => <CompanyBlock key={view.company.experienceId} data={data} view={view} readOnly={readOnly} />)
      )}

      {!readOnly && usable.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={all.pending} onClick={rewriteAll} className={small}>
              {all.pending ? "모두 다시 쓰는 중…" : "모두 다시 쓰기"}
            </button>
            {all.pending && (
              <span role="status" className="text-sm text-foreground/60">
                {WAIT}
              </span>
            )}
          </div>
          <ErrorLine message={all.message} />
        </div>
      )}
    </section>
  );
}
