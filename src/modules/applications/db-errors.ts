// Postgres 오류 코드를 가려낸다. 드라이버가 오류를 감싸므로 cause를 따라 내려가며 본다
export function hasPgCode(error: unknown, code: string): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === code) return true;
  }
  return false;
}
