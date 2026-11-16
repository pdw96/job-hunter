import { type AnyPgColumn, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

// ncs 모듈: NCS(국가직무능력표준) 분류. 모든 사용자가 함께 쓰는 기준 데이터다.
// 데이터는 data/ncs/*.csv에서 만든 마이그레이션(npm run ncs:build)으로 넣는다.
export const ncsCategories = pgTable(
  "ncs_categories",
  {
    code: text("code").primaryKey(), // 단계마다 2자리: 대 2, 중 4, 소 6, 세 8
    level: integer("level").notNull(), // 1 대분류, 2 중분류, 3 소분류, 4 세분류(직무)
    name: text("name").notNull(),
    parentCode: text("parent_code").references((): AnyPgColumn => ncsCategories.code),
  },
  (t) => [index("ncs_categories_parent_idx").on(t.parentCode)],
);

// NCS에 없는 흔한 직무 이름(백엔드, PM 등)으로도 검색되게 하는 별칭
export const ncsAliases = pgTable(
  "ncs_aliases",
  {
    alias: text("alias").notNull(),
    code: text("code")
      .notNull()
      .references(() => ncsCategories.code),
  },
  (t) => [primaryKey({ columns: [t.alias, t.code] })],
);
