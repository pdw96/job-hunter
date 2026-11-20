import { redirect } from "next/navigation";

// 옛 경험 기록 화면. 5-4에서 새 구조(/records)로 바꾸며 닫았다. 예전 주소로 들어오면 경험 기록으로 보낸다
export default function OldExperiencesPage() {
  redirect("/records");
}
