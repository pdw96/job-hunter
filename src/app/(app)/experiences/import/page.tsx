import { requireUser } from "@/lib/session";
import { ImportForm } from "./import-form";

export default async function ImportPage() {
  await requireUser();
  return <ImportForm />;
}
