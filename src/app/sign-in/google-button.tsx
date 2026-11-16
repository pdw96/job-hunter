"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function GoogleButton() {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/denied",
    });
    if (error) setPending(false);
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={pending}
      className="w-full rounded-lg bg-foreground px-4 py-3 font-medium text-background disabled:opacity-60"
    >
      {pending ? "이동 중…" : "Google로 로그인"}
    </button>
  );
}
