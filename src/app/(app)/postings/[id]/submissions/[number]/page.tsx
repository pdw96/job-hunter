import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { countChars } from "@/modules/applications/check";
import { dutiesLine, resumeText, sections } from "@/modules/applications/resume-entries";
import { getSubmission } from "@/modules/applications/submission-repo";
import { koreaDate } from "@/modules/postings/today";
import { submittedCareerView } from "./career-view";
import { CopyButton } from "./copy-button";

// 제출본 화면. 제출하는 순간 얼린 복사본을 읽기만 한다
export default async function SubmissionPage({ params }: { params: Promise<{ id: string; number: string }> }) {
  const user = await requireUser();
  const { id, number: raw } = await params;
  const number = Number(raw);
  // 없는 번호와 남의 제출본을 구분하지 않고 404로 보낸다
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number)) notFound();
  const submission = await getSubmission(db, user.id, id, number);
  if (!submission) notFound();

  const { posting, resume, answers } = submission.content;
  // 경력기술서 없이 냈거나 옛 제출본이면 null이고 구역을 그리지 않는다
  const career = submittedCareerView(submission.content);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-foreground/60">
          <Link href={`/postings/${id}`} className="underline">
            공고로 돌아가기
          </Link>
        </p>
        <h1 className="text-2xl font-bold">
          제출 {submission.number} · {koreaDate(submission.submittedAt)}
        </h1>
        <p className="text-foreground/70">
          {posting.company} · {posting.title}
        </p>
        {submission.reopenedAt && <p className="text-sm text-foreground/60">이후 새 버전을 만들었습니다</p>}
      </div>

      <section className="space-y-3" aria-label="이력서">
        <h2 className="text-lg font-semibold">이력서{resume ? ` · ${resume.from === "tailored" ? "맞춤본" : "트랙 공통본"}` : ""}</h2>
        {resume ? (
          <>
            <CopyButton text={resumeText(resume.content)} />
            {sections(resume.content).map((section) => (
              <div key={section.kind} className="space-y-1">
                <h3 className="font-semibold">{section.label}</h3>
                <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
                  {section.entries.map(({ experienceId, heading, lines }) => (
                    <li key={experienceId} className="space-y-1 py-3 text-sm">
                      <p className="font-medium">{[heading.name, heading.organization, heading.role, heading.period].filter(Boolean).join(" | ")}</p>
                      {dutiesLine(heading.duties) && <p className="break-words text-foreground/80">{dutiesLine(heading.duties)}</p>}
                      <ul className="list-disc space-y-1 pl-5">
                        {lines.map((line, index) => (
                          <li key={index}>{line.text}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        ) : (
          <p className="text-sm text-foreground/70">이력서 없이 제출했습니다</p>
        )}
      </section>

      {career && (
        <section className="space-y-3" aria-label="경력기술서">
          <h2 className="text-lg font-semibold">경력기술서 · {career.label}</h2>
          <CopyButton text={career.copyText} />
          {career.companies.map((company) => (
            <div key={company.experienceId} className="space-y-1">
              <h3 className="break-words font-semibold">
                {[company.heading.company, company.heading.department, company.heading.title, company.heading.period].filter(Boolean).join(" · ")}
              </h3>
              {dutiesLine(company.heading.duties) && <p className="break-words text-sm text-foreground/80">{dutiesLine(company.heading.duties)}</p>}
              {company.items.length > 0 && (
                <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
                  {company.items.map((item) => (
                    <li key={item.experienceId} className="space-y-2 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 break-words font-medium">
                          {[item.heading.name, item.heading.role, item.heading.period].filter(Boolean).join(" · ")}
                        </p>
                        {item.detail === "summary" && <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-xs">요약</span>}
                        {item.emphasized && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">강조</span>}
                      </div>
                      {item.heading.tools.length > 0 && <p className="break-words text-foreground/80">기술: {item.heading.tools.join(", ")}</p>}
                      {(
                        [
                          ["한 일", item.done],
                          ["성과", item.results],
                        ] as const
                      ).map(
                        ([label, lines]) =>
                          lines.length > 0 && (
                            <div key={label} className="space-y-1">
                              <p className="text-xs font-medium text-foreground/60">{label}</p>
                              <ul className="list-disc space-y-1 pl-5 leading-relaxed">
                                {lines.map((line, index) => (
                                  <li key={index} className="break-words">
                                    {line.text}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ),
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-4" aria-label="자기소개서">
        <h2 className="text-lg font-semibold">자기소개서</h2>
        {answers.length === 0 && <p className="text-sm text-foreground/70">문항 없이 제출했습니다</p>}
        {answers.map((answer, index) => {
          const text = answer.paragraphs.map((paragraph) => paragraph.text).join("\n");
          return (
            <article key={index} className="space-y-2 rounded-lg border border-foreground/15 p-4">
              <h3 className="font-semibold">
                {index + 1}. {answer.prompt}
              </h3>
              {answer.paragraphs.length === 0 ? (
                <p className="text-sm text-foreground/70">답 없음</p>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
                  <p className="text-sm text-foreground/60">
                    공백 포함 {countChars(text, true)}자 / 공백 제외 {countChars(text, false)}자
                    {answer.charLimit !== null && ` / 제한 ${answer.charLimit}자`}
                  </p>
                  <CopyButton text={text} />
                </>
              )}
            </article>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">공고 원문</h2>
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-foreground/5 p-4 text-sm">{posting.rawText}</pre>
      </section>

      {posting.companyNote && (
        <section className="space-y-2">
          <h2 className="font-semibold">인재상·회사 소개</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-foreground/5 p-4 text-sm">{posting.companyNote}</pre>
        </section>
      )}
    </div>
  );
}
