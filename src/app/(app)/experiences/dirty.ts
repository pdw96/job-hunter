"use client";

import { useSyncExternalStore } from "react";

// 입력 폼에 저장하지 않은 변경이 있는지. 폼이 알리고 검증 패널이 읽는다.
let dirty = false;
const listeners = new Set<() => void>();

export function setDirty(value: boolean) {
  if (dirty === value) return;
  dirty = value;
  for (const listener of listeners) listener();
}

export function useDirty(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dirty,
    () => false,
  );
}
