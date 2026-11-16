// data/ncs/*.csv를 읽어 drizzle/NNNN_ncs_seed.sql을 다시 만든다. 여러 번 실행해도 결과가 같다.
// 사용: npm run ncs:build
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

function readCsv(path) {
  const [header, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const keys = header.split(",");
  return lines.map((line) => {
    const cells = line.split(","); // 이 데이터에는 쉼표나 따옴표가 들어간 값이 없다
    if (cells.length !== keys.length) throw new Error(`칸 수가 맞지 않습니다: ${path}: ${line}`);
    return Object.fromEntries(keys.map((k, i) => [k, cells[i].trim()]));
  });
}

const q = (value) => (value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`);

function inserts(table, columns, rows, size = 300) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    const values = rows.slice(i, i + size).map((r) => `(${r.join(", ")})`).join(",\n");
    out.push(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES\n${values};`);
  }
  return out;
}

const categories = readCsv("data/ncs/categories.csv").sort(
  (a, b) => Number(a.level) - Number(b.level) || a.code.localeCompare(b.code),
);
const aliases = readCsv("data/ncs/aliases.csv");

const statements = [
  ...inserts(
    "ncs_categories",
    ["code", "level", "name", "parent_code"],
    categories.map((c) => [q(c.code), Number(c.level), q(c.name), q(c.code.length > 2 ? c.code.slice(0, -2) : null)]),
  ),
  ...inserts("ncs_aliases", ["alias", "code"], aliases.map((a) => [q(a.alias), q(a.code)])),
];

const file = readdirSync("drizzle").find((name) => name.endsWith("_ncs_seed.sql"));
if (!file) throw new Error("drizzle/*_ncs_seed.sql이 없습니다. 먼저 drizzle-kit generate --custom --name ncs_seed");
writeFileSync(`drizzle/${file}`, `${statements.join("\n--> statement-breakpoint\n")}\n`);
console.log(`drizzle/${file}: 분류 ${categories.length}건, 별칭 ${aliases.length}건`);
