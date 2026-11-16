import { db } from "@/db";
import { requireAdmin } from "@/lib/session";
import { addEmailAction, removeEmailAction } from "@/modules/access/actions";
import { isAdminEmail, listAllowedEmails } from "@/modules/access/allowlist";

const ERRORS: Record<string, string> = {
  invalid: "이메일 형식이 올바르지 않습니다",
  admin: "관리자 이메일은 지울 수 없습니다",
  forbidden: "관리자만 할 수 있습니다",
};

const dateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const admin = await requireAdmin();
  const { error } = await searchParams;
  // 관리자 이메일은 맨 위에 따로 보여 주므로 목록에서는 뺀다
  const emails = (await listAllowedEmails(db)).filter((row) => !isAdminEmail(row.email));

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">허용 이메일</h1>

      <form action={addEmailAction} className="flex gap-2">
        <input
          name="email"
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder="name@gmail.com"
          aria-label="추가할 이메일"
          className="min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-foreground px-4 py-2 font-medium text-background">
          추가
        </button>
      </form>

      {error && ERRORS[error] && (
        <p role="alert" className="text-sm text-red-600">
          {ERRORS[error]}
        </p>
      )}

      <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
        <li className="flex items-center gap-3 py-3">
          <span className="min-w-0 flex-1 truncate">{admin.email}</span>
          <span className="rounded bg-foreground/10 px-2 py-0.5 text-xs">관리자</span>
        </li>
        {emails.map((row) => (
          <li key={row.email} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1 truncate">{row.email}</span>
            <span className="text-sm text-foreground/60">{dateFormat.format(row.createdAt)}</span>
            <form action={removeEmailAction}>
              <input type="hidden" name="email" value={row.email} />
              <button type="submit" className="text-sm underline">
                삭제
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
