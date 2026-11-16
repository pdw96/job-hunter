import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { saveContactAction } from "@/modules/profile/actions";
import { getContact } from "@/modules/profile/repo";

const FIELDS = [
  { name: "legalName", label: "이름", type: "text", autoComplete: "name" },
  { name: "phone", label: "전화번호", type: "tel", autoComplete: "tel" },
  { name: "address", label: "주소", type: "text", autoComplete: "street-address" },
  { name: "birthDate", label: "생년월일", type: "date", autoComplete: "bday" },
  { name: "contactEmail", label: "연락용 이메일", type: "email", autoComplete: "email" },
] as const;

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser();
  const contact = await getContact(db, user.id);
  const { saved } = await searchParams;

  return (
    <div className="max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">내 정보</h1>
        <p className="text-sm text-foreground/70">
          이 정보는 지원서 파일을 만들 때만 쓰이고 AI에게 보내지 않습니다
        </p>
      </div>

      {saved && (
        <p role="status" className="rounded-lg bg-foreground/5 px-3 py-2 text-sm">
          저장했습니다
        </p>
      )}

      <form action={saveContactAction} className="space-y-4">
        {FIELDS.map((field) => (
          <label key={field.name} className="block space-y-1">
            <span className="text-sm font-medium">{field.label}</span>
            <input
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              defaultValue={contact?.[field.name] ?? ""}
              className="w-full rounded-lg border border-foreground/20 bg-transparent px-3 py-2"
            />
          </label>
        ))}
        <button type="submit" className="rounded-lg bg-foreground px-4 py-2 font-medium text-background">
          저장
        </button>
      </form>
    </div>
  );
}
