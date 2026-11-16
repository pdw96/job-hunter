import { requireUser } from "@/lib/session";

export default async function HomePage() {
  const user = await requireUser();

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{user.name}님, 환영합니다</h1>
      <p className="text-foreground/70">아직 준비 중인 기능입니다</p>
    </div>
  );
}
