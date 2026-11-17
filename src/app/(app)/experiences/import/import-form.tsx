"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteExperienceAction, importAction, type ImportActionResult } from "@/modules/experiences/actions";

type Created = Extract<ImportActionResult, { ok: true }>;

export function ImportForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Created | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    const formData = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) formData.set("file", file);
    else formData.set("text", text);
    startTransition(async () => {
      const response = await importAction(formData);
      if (response.ok) setResult(response);
      else setMessage(response.message);
    });
  }

  function remove(id: string) {
    if (!result || !window.confirm("이 기록을 지울까요?")) return;
    setResult({ ...result, created: result.created.filter((item) => item.id !== id) });
    startTransition(async () => {
      // 지운 뒤 목록 화면으로 보내려는 이동은 따르지 않고 이 화면에 머문다
      await deleteExperienceAction(id, false);
      router.refresh();
    });
  }

  if (result) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">기록 {result.created.length}건을 만들었습니다</h1>
          <p className="text-sm text-foreground/70">
            모두 “미확인” 상태입니다. 기록마다 주장을 하나씩 확인해야 지원서에 쓸 수 있습니다. 필요 없는 기록은 지워 주세요
          </p>
          {result.skipped > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              형식이 맞지 않아 만들지 못한 초안이 {result.skipped}건 있습니다
            </p>
          )}
          {result.more && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              글에 경험이 더 있어 다 담지 못했습니다. 나머지는 나눠서 다시 올려 주세요
            </p>
          )}
        </div>
        <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
          {result.created.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
              <span className="text-sm text-foreground/60">확인할 주장 {item.claimCount}개</span>
              <Link href={`/experiences/${item.id}`} className="text-sm underline">
                열기
              </Link>
              <button type="button" onClick={() => remove(item.id)} disabled={pending} className="text-sm text-red-600 underline">
                지우기
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 text-sm">
          <Link href="/experiences" className="underline">
            경험 기록으로
          </Link>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setText("");
              setFileName(null);
            }}
            className="underline"
          >
            더 가져오기
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">가져오기</h1>
        <p className="text-sm text-foreground/70">
          이력서나 자기소개서를 붙여 넣거나 파일로 올리면, AI가 경험 단위로 나눠 기록 초안을 만듭니다
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/70">
          <li>연락처(전화번호, 이메일, 주소)는 지우고 올리는 것이 안전합니다</li>
          <li>원본 파일은 저장하지 않습니다</li>
          <li>노션: 페이지를 복사해 붙여 넣거나, “내보내기 → Markdown &amp; CSV”로 받은 파일을 올려 주세요</li>
        </ul>
      </div>

      <fieldset disabled={pending} className="m-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-70">
        <label className="block space-y-1">
          <span className="text-sm font-medium">글 붙여 넣기</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            disabled={fileName !== null}
            placeholder="여기에 붙여 넣어 주세요 (4만 자까지)"
            className="w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2 disabled:opacity-40"
          />
        </label>

        <div className="space-y-1">
          <label className="block space-y-1">
            <span className="text-sm font-medium">또는 파일 올리기</span>
            <span className="block text-xs text-foreground/60">PDF, 워드(.docx), 글 파일(.md, .txt, .csv) · 4MB까지</span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.md,.txt,.csv"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              className="block w-full text-sm"
            />
          </label>
          {fileName && (
            <button
              type="button"
              onClick={() => {
                if (fileRef.current) fileRef.current.value = "";
                setFileName(null);
              }}
              className="text-sm underline"
            >
              파일 빼기
            </button>
          )}
        </div>
      </fieldset>

      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || (text.trim() === "" && fileName === null)}
          className="rounded-lg bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {pending ? "읽는 중… (1분쯤 걸릴 수 있습니다)" : "가져오기"}
        </button>
        <Link href="/experiences" className="text-sm underline">
          취소
        </Link>
      </div>
    </form>
  );
}
