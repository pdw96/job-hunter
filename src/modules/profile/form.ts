import type { ContactInput } from "./repo";

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// 폼 입력을 저장 형태로 바꾼다. 빈 칸은 null.
export function parseContactForm(formData: FormData): ContactInput {
  const birthDate = text(formData, "birthDate");
  return {
    legalName: text(formData, "legalName"),
    phone: text(formData, "phone"),
    address: text(formData, "address"),
    birthDate: birthDate && isRealDate(birthDate) ? birthDate : null,
    contactEmail: text(formData, "contactEmail"),
  };
}
