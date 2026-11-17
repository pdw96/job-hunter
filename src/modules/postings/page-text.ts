// 채용 공고 페이지(HTML)에서 글자와 본문 그림의 주소를 뽑는다. 화면과 네트워크를 모르는 순수 함수다.

export type PageContent = {
  text: string;
  images: string[]; // 본문에 있는 그림의 주소(절대 주소). 공고가 그림으로 올라온 경우에 쓴다
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", bull: "•" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#")) {
      const point = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[lower] ?? whole;
  });
}

// 글이 아닌 것과 페이지 틀(메뉴, 머리말, 꼬리말). 안의 내용을 통째로 건너뛴다
const SKIP = new Set(["script", "style", "noscript", "svg", "template", "iframe", "nav", "header", "footer", "aside", "select", "button", "title"]);
const BREAK = new Set(["br", "hr", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "dt", "dd", "ul", "ol", "table"]);

type Scanned = { text: string; title: string; jsonLd: string[]; images: string[] };

// HTML을 앞에서부터 한 번만 훑는다. 믿을 수 없는 페이지를 다루므로, 입력이 어떻게 생겼든 길이에 비례하는 시간 안에 끝나야 한다
// (정규식으로 태그를 지우면 닫히지 않는 "<"가 많은 페이지에서 시간이 제곱으로 늘어난다)
function scan(html: string): Scanned {
  const lower = html.toLowerCase();
  const out: string[] = [];
  const jsonLd: string[] = [];
  const images: string[] = [];
  let title = "";
  let position = 0;
  let closable = true; // 남은 글에 ">"가 더 있는가. 한 번 없다고 확인되면 다시 찾지 않는다

  while (position < html.length) {
    const open = html.indexOf("<", position);
    if (open === -1 || !closable) {
      out.push(html.slice(position));
      break;
    }
    out.push(html.slice(position, open));

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      if (end === -1) break; // 닫히지 않은 주석 뒤는 버린다
      position = end + 3;
      continue;
    }

    // <!doctype …>, <?xml …?> 같은 선언은 글이 아니다
    if (html[open + 1] === "!" || html[open + 1] === "?") {
      const end = html.indexOf(">", open + 2);
      if (end === -1) break;
      position = end + 1;
      continue;
    }

    const closing = html[open + 1] === "/";
    const nameStart = open + (closing ? 2 : 1);
    let nameEnd = nameStart;
    while (nameEnd < html.length && /[a-z0-9]/.test(lower[nameEnd])) nameEnd += 1;
    if (nameEnd === nameStart) {
      // 태그가 아닌 "<" (예: "3 < 5")
      out.push("<");
      position = open + 1;
      continue;
    }
    const tagEnd = html.indexOf(">", nameEnd);
    if (tagEnd === -1) {
      closable = false;
      position = open;
      continue;
    }
    const name = lower.slice(nameStart, nameEnd);
    const tag = html.slice(open, tagEnd + 1);
    position = tagEnd + 1;

    if (!closing && SKIP.has(name)) {
      const end = lower.indexOf(`</${name}`, position);
      const inner = html.slice(position, end === -1 ? html.length : end);
      if (name === "title" && title === "") title = inner;
      if (name === "script" && /type=["']application\/ld\+json["']/i.test(tag)) jsonLd.push(inner);
      if (end === -1) break; // 닫히지 않았으면 뒤는 모두 그 안의 내용이다
      const after = html.indexOf(">", end);
      if (after === -1) break;
      position = after + 1;
      continue;
    }
    if (!closing && name === "img") images.push(tag);
    // 줄은 닫는 태그에서 바꾼다(여는 태그와 닫는 태그 양쪽에서 바꾸면 빈 줄이 생긴다)
    if (!closing && name === "li") out.push("- ");
    else if (name === "br" || name === "hr" || (closing && BREAK.has(name))) out.push("\n");
    else out.push(" ");
  }

  return { text: tidy(out.join("")), title: tidy(title), jsonLd, images };
}

// 문자 표기를 풀고 줄을 정리한다
function tidy(text: string): string {
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 태그를 지우고 줄을 정리한다
export function htmlToText(html: string): string {
  return scan(html).text;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

// JSON-LD 안에서 JobPosting을 찾는다(@graph나 배열 안에 들어 있기도 하다)
function findJobPosting(value: unknown, depth = 0): Json | null {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  const type = value["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return value;
  return findJobPosting(value["@graph"], depth + 1);
}

function location(value: unknown): string {
  const places = Array.isArray(value) ? value : [value];
  return places
    .map((place) => {
      const address = isObject(place) ? place.address : null;
      if (typeof address === "string") return address;
      if (!isObject(address)) return "";
      return [address.addressRegion, address.addressLocality, address.streetAddress].map(asText).filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

// 페이지에 정해진 형식(JSON-LD JobPosting)으로 든 공고 정보를 글로 바꾼다. 없으면 null
export function jobPostingText(html: string): string | null {
  return jobPostingFrom(scan(html).jsonLd);
}

function jobPostingFrom(scripts: string[]): string | null {
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch {
      continue;
    }
    const job = findJobPosting(parsed);
    if (!job) continue;
    const organization = isObject(job.hiringOrganization) ? asText(job.hiringOrganization.name) : asText(job.hiringOrganization);
    const employment = Array.isArray(job.employmentType) ? job.employmentType.map(asText).join(", ") : asText(job.employmentType);
    const lines = [
      organization && `회사: ${organization}`,
      asText(job.title) && `직무: ${asText(job.title)}`,
      asText(job.validThrough) && `마감: ${asText(job.validThrough)}`,
      location(job.jobLocation) && `근무지: ${location(job.jobLocation)}`,
      employment && `고용 형태: ${employment}`,
      asText(job.experienceRequirements) && `경력: ${asText(job.experienceRequirements)}`,
      asText(job.description) && `\n${htmlToText(asText(job.description))}`,
    ].filter(Boolean);
    if (lines.length > 0) return lines.join("\n");
  }
  return null;
}

// 공고 본문이 아닌 그림(로고, 아이콘, 광고 띠)을 이름으로 걸러 낸다
const NOT_CONTENT = /logo|icon|sprite|banner|btn|button|badge|avatar|profile|blank|spacer|loading|\.svg(\?|$)|\.gif(\?|$)/i;

function imageUrls(tags: string[], baseUrl: string): string[] {
  const found: string[] = [];
  for (const tag of tags.slice(0, 200)) {
    // 늦게 불러오는 그림은 주소가 data-src 같은 곳에 있다
    // (속성의 순서와 상관없이 그쪽을 먼저 본다. src에는 빈 그림이 들어 있기 쉽다)
    const attribute = (name: string) => tag.match(new RegExp(`\\s${name}=["']([^"']+)["']`, "i"))?.[1];
    const source = attribute("data-src") ?? attribute("data-original") ?? attribute("data-lazy-src") ?? attribute("src");
    if (!source || source.startsWith("data:") || NOT_CONTENT.test(source)) continue;
    try {
      const url = new URL(decodeEntities(source), baseUrl);
      if ((url.protocol === "http:" || url.protocol === "https:") && !found.includes(url.href)) found.push(url.href);
    } catch {
      // 주소로 읽을 수 없는 값은 건너뛴다
    }
  }
  return found.slice(0, 8);
}

export function contentFromHtml(html: string, baseUrl: string): PageContent {
  const page = scan(html);
  const structured = jobPostingFrom(page.jsonLd);
  // 정해진 형식의 공고 정보가 있으면 그것을 앞에 두고, 본문 글이 더 길면 뒤에 붙인다
  const text = structured
    ? page.text.length > structured.length * 1.5
      ? `${structured}\n\n${page.text}`
      : structured
    : [page.title, page.text].filter(Boolean).join("\n\n");
  return { text, images: imageUrls(page.images, baseUrl) };
}
