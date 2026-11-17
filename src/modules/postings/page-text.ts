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

// 태그를 지우고 줄을 정리한다
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|dt|dd|ul|ol|table)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const strip = (html: string, tags: string[]) =>
  tags.reduce((result, tag) => result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " "), html);

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
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
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

function imageUrls(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
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
  const title = htmlToText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  // 글이 아닌 것과 페이지 틀(메뉴, 머리말, 꼬리말)을 뺀다
  const main = strip(body.replace(/<!--[\s\S]*?-->/g, " "), ["script", "style", "noscript", "svg", "template", "iframe", "nav", "header", "footer", "aside", "select", "button"]);

  const structured = jobPostingText(html);
  const bodyText = htmlToText(main);
  // 정해진 형식의 공고 정보가 있으면 그것을 앞에 두고, 본문 글이 더 길면 뒤에 붙인다
  const text = structured
    ? bodyText.length > structured.length * 1.5
      ? `${structured}\n\n${bodyText}`
      : structured
    : [title, bodyText].filter(Boolean).join("\n\n");
  return { text, images: imageUrls(main, baseUrl) };
}
