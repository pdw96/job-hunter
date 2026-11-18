// 글자(코드 포인트) 단위로 자른다. 이모지가 반으로 잘리면 PostgreSQL jsonb가 저장을 거부한다
export const cut = (text: string, max: number): string => [...text].slice(0, max).join("");
