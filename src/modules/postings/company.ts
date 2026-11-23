// 회사 이름을 같은 회사끼리 같게 만든다. (주)·주식회사·㈜·(유) 같은 표기와 띄어쓰기, 대소문자를 뺀다
export function companyKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(\s*(주|유|사|합|재)\s*\)/g, "")
    .replace(/주식회사|유한회사|유한책임회사|합자회사|합명회사/g, "")
    .replace(/[()[\]【】]/g, "")
    .replace(/[\s.,·]+/g, "");
}
