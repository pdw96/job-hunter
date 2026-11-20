import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { newRecordsOn } from "@/modules/experiences/switch";
import { RecordImportForm } from "./record-import-form";

export default async function RecordImportPage() {
  if (!newRecordsOn()) notFound();
  await requireUser();
  return <RecordImportForm />;
}
