// Question bank (tests.md §3): a personal bank per teacher; questions shared with the subject are visible (not
// editable) to its other teachers. Content lives in append-only versions: an edit is a new version, so a test keeps
// the version it was built with (acceptance 9).
import type { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type {
  CreateQuestionSchema,
  QuestionContent,
  QuestionDto,
  QuestionListQuery,
  QuestionVersionDto,
  UpdateQuestionSchema,
} from "@idrok/shared";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { orderBy, page, skipTake } from "../../http/pagination";
import type { StorageProvider } from "../../infra/storage";
import { storageKey } from "../../infra/storage/storage";
import { contentHash, questionProblems, type GradableQuestion } from "../../domain/tests";
import { activeOn } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { buildQuestionSheet, type ExportQuestion } from "./question-excel";

const SCHOOL_WIDE = ["SUPER_ADMIN", "SCHOOL_ADMIN", "DIRECTOR", "DEPUTY_DIRECTOR", "METHODIST"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const include = {
  owner: { select: { firstName: true, lastName: true } },
  subject: { select: { name: true } },
  grade: { select: { name: true } },
  topic: { select: { title: true } },
  currentVersion: true,
} satisfies Prisma.QuestionInclude;
type Row = Prisma.QuestionGetPayload<{ include: typeof include }>;
type VersionRow = NonNullable<Row["currentVersion"]>;

export const versionDto = (v: VersionRow): QuestionVersionDto => ({
  id: v.id,
  version: v.version,
  text: v.text,
  points: v.points.toString(),
  options: v.options as QuestionVersionDto["options"],
  acceptedAnswers: (v.acceptedAnswers as string[] | null) ?? null,
  pairs: (v.pairs as QuestionVersionDto["pairs"]) ?? null,
  explanation: v.explanation,
  imageAssetId: v.imageAssetId,
  createdAt: v.createdAt.toISOString(),
});

/** The grader's view of a stored version. */
export const gradable = (type: string, v: Pick<VersionRow, "options" | "acceptedAnswers" | "pairs">) =>
  ({
    type,
    options: v.options,
    acceptedAnswers: v.acceptedAnswers,
    pairs: v.pairs,
  }) as unknown as GradableQuestion;

const isSchoolWide = (auth: RequestAuth) => auth.roles.some((r) => SCHOOL_WIDE.includes(r));

const hashOf = (type: string, c: Omit<QuestionContent, "type">) =>
  contentHash({
    type: type as QuestionContent["type"],
    text: c.text,
    options: c.options,
    acceptedAnswers: c.acceptedAnswers,
    pairs: c.pairs,
  });

/** Keeps only the fields of the type (an option list on a SHORT_TEXT question would only confuse). */
function shape(type: string, c: Omit<QuestionContent, "type">) {
  return {
    text: c.text,
    points: c.points,
    options: type === "SINGLE" || type === "MULTIPLE" ? c.options : [],
    acceptedAnswers: type === "SHORT_TEXT" ? (c.acceptedAnswers ?? []) : null,
    pairs: type === "MATCHING" ? (c.pairs ?? []) : null,
    explanation: c.explanation ?? null,
    imageAssetId: c.imageAssetId ?? null,
  };
}

export class QuestionBankService {
  constructor(
    private readonly db: Db,
    private readonly storage?: StorageProvider,
  ) {}

  /** The caller's employee record: questions belong to a teacher. */
  async me(auth: RequestAuth, tx: Db | DbTransaction = this.db) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { employee: { select: { id: true } } },
    });
    return user.employee?.id ?? null;
  }

  /** What the caller may see: school-wide roles everything; a teacher their own and shared ones of their subjects. */
  async visibleWhere(auth: RequestAuth): Promise<Prisma.QuestionWhereInput> {
    if (isSchoolWide(auth)) return {};
    const me = await this.me(auth);
    if (!me) return { id: { in: [] } };
    const { today } = await schoolClock(this.db);
    const subjects = await this.db.teacherAssignment.findMany({
      where: { teacherId: me, ...activeOn(today) },
      select: { subjectId: true },
    });
    return {
      OR: [
        { ownerId: me },
        { sharedWithSubject: true, subjectId: { in: [...new Set(subjects.map((s) => s.subjectId))] } },
      ],
    };
  }

  private async toDto(rows: Row[], me: string | null, teachingGroupId?: string): Promise<QuestionDto[]> {
    const ids = rows.map((r) => r.id);
    const usage = ids.length
      ? await this.db.testQuestion.findMany({
          where: { questionVersion: { questionId: { in: ids } } },
          select: {
            testId: true,
            questionVersion: { select: { questionId: true } },
            test: { select: { assignments: { select: { teachingGroupId: true } } } },
          },
        })
      : [];
    return rows.map((r) => {
      const mine = usage.filter((u) => u.questionVersion.questionId === r.id);
      return {
        id: r.id,
        ownerId: r.ownerId,
        ownerName: `${r.owner.lastName} ${r.owner.firstName}`,
        subjectId: r.subjectId,
        subjectName: r.subject.name,
        gradeId: r.gradeId,
        gradeName: r.grade.name,
        topicId: r.topicId,
        topicTitle: r.topic?.title ?? null,
        type: r.type,
        difficulty: r.difficulty,
        status: r.status,
        sharedWithSubject: r.sharedWithSubject,
        mine: r.ownerId === me,
        ...(teachingGroupId
          ? { usedWithGroup: mine.some((u) => u.test.assignments.some((a) => a.teachingGroupId === teachingGroupId)) }
          : {}),
        usedInTests: new Set(mine.map((u) => u.testId)).size,
        current: versionDto(r.currentVersion!),
      };
    });
  }

  async list(auth: RequestAuth, q: QuestionListQuery) {
    const me = await this.me(auth);
    const scope =
      q.scope === "mine"
        ? { ownerId: me ?? "00000000-0000-0000-0000-000000000000" }
        : q.scope === "shared"
          ? { sharedWithSubject: true, ownerId: { not: me ?? undefined } }
          : {};
    const where: Prisma.QuestionWhereInput = {
      AND: [
        await this.visibleWhere(auth),
        scope,
        {
          status: q.status,
          ...(q.subjectId ? { subjectId: q.subjectId } : {}),
          ...(q.gradeId ? { gradeId: q.gradeId } : {}),
          ...(q.topicId === "none" ? { topicId: null } : q.topicId ? { topicId: q.topicId } : {}),
          ...(q.type ? { type: q.type } : {}),
          ...(q.difficulty ? { difficulty: q.difficulty } : {}),
          ...(q.q ? { currentVersion: { text: { contains: q.q, mode: "insensitive" as const } } } : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.db.question.findMany({
        where,
        include,
        orderBy: orderBy(q.sort, ["createdAt", "difficulty", "type"] as const, [{ createdAt: "desc" }]),
        ...skipTake(q),
      }),
      this.db.question.count({ where }),
    ]);
    return page(await this.toDto(rows, me, q.teachingGroupId), total, q);
  }

  async get(auth: RequestAuth, id: string) {
    const row = await this.db.question.findFirst({ where: { AND: [{ id }, await this.visibleWhere(auth)] }, include });
    if (!row) throw notFound();
    return (await this.toDto([row], await this.me(auth)))[0]!;
  }

  async versions(auth: RequestAuth, id: string) {
    await this.get(auth, id);
    const rows = await this.db.questionVersion.findMany({ where: { questionId: id }, orderBy: { version: "desc" } });
    return rows.map(versionDto);
  }

  private async checkContent(
    tx: DbTransaction,
    type: string,
    content: ReturnType<typeof shape>,
    meta: { subjectId: string; gradeId: string; topicId?: string | null },
  ) {
    const problems = questionProblems({
      type: type as QuestionContent["type"],
      text: content.text,
      options: content.options,
      acceptedAnswers: content.acceptedAnswers,
      pairs: content.pairs,
    });
    if (problems.length) throw new AppError("VALIDATION_ERROR", 400, { reason: "QUESTION_INVALID", problems });
    if (meta.topicId) {
      const topic = await tx.topic.findFirst({
        where: { id: meta.topicId, subjectId: meta.subjectId, gradeId: meta.gradeId },
      });
      if (!topic) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "topicId", code: "invalid" }] });
    }
    if (content.imageAssetId) {
      const asset = await tx.fileAsset.findFirst({
        where: { id: content.imageAssetId, kind: "QUESTION_IMAGE", status: "READY" },
      });
      if (!asset) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "imageAssetId", code: "invalid" }] });
    }
  }

  /** Creates a question with its first version (also used by the Excel import, inside the row's transaction). */
  async createIn(tx: DbTransaction, ownerId: string, input: z.infer<typeof CreateQuestionSchema>, actorId?: string) {
    const content = shape(input.type, input);
    await this.checkContent(tx, input.type, content, input);
    const [subject, grade] = await Promise.all([
      tx.subject.findFirst({ where: { id: input.subjectId } }),
      tx.grade.findFirst({ where: { id: input.gradeId } }),
    ]);
    if (!subject || !grade)
      throw new AppError("VALIDATION_ERROR", 400, {
        fields: [{ path: subject ? "gradeId" : "subjectId", code: "invalid" }],
      });
    const tenantId = requireTenantId();
    const question = await tx.question.create({
      data: {
        tenantId,
        ownerId,
        subjectId: input.subjectId,
        gradeId: input.gradeId,
        topicId: input.topicId ?? null,
        type: input.type,
        difficulty: input.difficulty,
        sharedWithSubject: input.sharedWithSubject,
      },
    });
    const version = await tx.questionVersion.create({
      data: {
        tenantId,
        questionId: question.id,
        version: 1,
        ...content,
        acceptedAnswers: content.acceptedAnswers ?? undefined,
        pairs: content.pairs ?? undefined,
        contentHash: hashOf(input.type, input),
        createdById: actorId ?? null,
      },
    });
    await tx.question.update({ where: { id: question.id }, data: { currentVersionId: version.id } });
    return question.id;
  }

  async create(auth: RequestAuth, input: z.infer<typeof CreateQuestionSchema>) {
    const id = await this.db.$transaction(async (tx) => {
      const me = await this.me(auth, tx);
      if (!me) throw forbidden({ reason: "NO_EMPLOYEE_PROFILE" });
      const qid = await this.createIn(tx, me, input, auth.userId);
      await writeAudit(tx, { action: "question.create", entityType: "Question", entityId: qid });
      return qid;
    });
    return this.get(auth, id);
  }

  /** Only the owner edits. Content → a new version (when it differs); metadata in place. */
  async update(auth: RequestAuth, id: string, input: z.infer<typeof UpdateQuestionSchema>) {
    await this.db.$transaction(async (tx) => {
      const me = await this.me(auth, tx);
      const q = await tx.question.findFirst({ where: { id }, include: { currentVersion: true } });
      if (!q) throw notFound();
      if (q.ownerId !== me) throw forbidden({ reason: "NOT_QUESTION_OWNER" });
      const topicId = input.topicId === undefined ? q.topicId : input.topicId;
      if (input.content) {
        const content = shape(q.type, input.content);
        await this.checkContent(tx, q.type, content, { subjectId: q.subjectId, gradeId: q.gradeId, topicId });
        const hash = hashOf(q.type, input.content);
        const cur = q.currentVersion!;
        const same =
          hash === cur.contentHash &&
          content.points === cur.points.toString() &&
          content.explanation === cur.explanation &&
          content.imageAssetId === cur.imageAssetId &&
          JSON.stringify(content.options.map((o) => [o.id, o.isCorrect])) ===
            JSON.stringify((cur.options as { id: string; isCorrect: boolean }[]).map((o) => [o.id, o.isCorrect]));
        if (!same) {
          const version = await tx.questionVersion.create({
            data: {
              tenantId: requireTenantId(),
              questionId: id,
              version: cur.version + 1,
              ...content,
              acceptedAnswers: content.acceptedAnswers ?? undefined,
              pairs: content.pairs ?? undefined,
              contentHash: hash,
              createdById: auth.userId,
            },
          });
          await tx.question.update({ where: { id }, data: { currentVersionId: version.id } });
        }
      } else if (input.topicId) {
        await this.checkContent(tx, q.type, shape(q.type, versionDto(q.currentVersion!)), {
          subjectId: q.subjectId,
          gradeId: q.gradeId,
          topicId,
        });
      }
      await tx.question.update({
        where: { id },
        data: {
          topicId,
          ...(input.difficulty ? { difficulty: input.difficulty } : {}),
          ...(input.sharedWithSubject !== undefined ? { sharedWithSubject: input.sharedWithSubject } : {}),
          ...(input.status
            ? { status: input.status, archivedAt: input.status === "ARCHIVED" ? new Date() : null }
            : {}),
        },
      });
      await writeAudit(tx, {
        action: "question.update",
        entityType: "Question",
        entityId: id,
        after: { content: !!input.content, status: input.status },
      });
    });
    return this.get(auth, id);
  }

  /** Content hashes already in the caller's visible bank for a subject and grade (import duplicate check). */
  async knownHashes(auth: RequestAuth | { userId: string; roles: string[] }, subjectId: string, gradeId: string) {
    const where = await this.visibleWhere(auth as RequestAuth);
    const rows = await this.db.questionVersion.findMany({
      where: { question: { AND: [where, { subjectId, gradeId, status: "ACTIVE" }] } },
      select: { contentHash: true },
    });
    return new Set(rows.map((r) => r.contentHash));
  }

  /** S4: questions with their answers leave only through questions.export — a teacher their own, the school all. */
  async export(
    auth: RequestAuth,
    q: { subjectId: string; gradeId?: string; scope: "mine" | "all"; locale: "uz" | "ru" },
  ) {
    const me = await this.me(auth);
    if (q.scope === "all" && !isSchoolWide(auth)) throw forbidden({ reason: "EXPORT_OWN_ONLY" });
    const rows = await this.db.question.findMany({
      where: {
        subjectId: q.subjectId,
        status: "ACTIVE",
        ...(q.gradeId ? { gradeId: q.gradeId } : {}),
        ...(q.scope === "mine" ? { ownerId: me ?? "00000000-0000-0000-0000-000000000000" } : {}),
      },
      include,
      orderBy: { createdAt: "asc" },
    });
    await writeAudit(this.db, {
      action: "question.export",
      entityType: "Subject",
      entityId: q.subjectId,
      after: { count: rows.length, scope: q.scope },
    });
    return buildQuestionSheet(
      q.locale,
      rows.map((r): ExportQuestion => ({
        type: r.type,
        text: r.currentVersion!.text,
        options: r.currentVersion!.options as ExportQuestion["options"],
        acceptedAnswers: r.currentVersion!.acceptedAnswers as string[] | null,
        points: r.currentVersion!.points.toString(),
        topicTitle: r.topic?.title ?? null,
        difficulty: r.difficulty,
        explanation: r.currentVersion!.explanation,
      })),
    );
  }

  // ---- images (PNG, JPEG, WebP; checked by their bytes, not the name)

  async uploadImage(auth: RequestAuth, file: { buffer: Buffer; originalname: string }) {
    const type = imageType(file.buffer);
    if (!type) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "not_image" }] });
    if (file.buffer.length > MAX_IMAGE_BYTES)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "file", code: "too_large" }] });
    const tenantId = requireTenantId();
    const id = randomUUID();
    const key = storageKey(tenantId, "QUESTION_IMAGE", id, type.ext);
    await this.storage!.put(key, file.buffer, { contentType: type.mime });
    await this.db.fileAsset.create({
      data: {
        id,
        tenantId,
        storageKey: key,
        originalName: file.originalname.slice(0, 200),
        mimeType: type.mime,
        sizeBytes: file.buffer.length,
        sha256: createHash("sha256").update(file.buffer).digest("hex"),
        kind: "QUESTION_IMAGE",
        status: "READY",
        createdById: auth.userId,
      },
    });
    return { id };
  }

  /** Bytes of a question image the caller may see: a bank question visible to them (attempts use their own route). */
  async image(auth: RequestAuth, id: string) {
    const visible = await this.db.questionVersion.findFirst({
      where: { imageAssetId: id, question: await this.visibleWhere(auth) },
      select: { id: true },
    });
    const asset = await this.db.fileAsset.findFirst({ where: { id, kind: "QUESTION_IMAGE", status: "READY" } });
    if (!asset || (!visible && asset.createdById !== auth.userId)) throw notFound();
    return { buffer: await this.storage!.get(asset.storageKey), mimeType: asset.mimeType };
  }
}

export function imageType(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}
