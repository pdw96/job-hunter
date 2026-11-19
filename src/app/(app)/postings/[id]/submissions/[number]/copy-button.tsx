"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
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
        복사
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
