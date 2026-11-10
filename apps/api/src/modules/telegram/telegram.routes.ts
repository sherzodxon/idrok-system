// M7 HTTP surface: the bot webhook, the Mini App login, admin link management and broadcasts, and the guardian's own
// notification settings. Public routes (webhook, Mini App login) are listed in http/public-routes.ts.
import { timingSafeEqual } from "node:crypto";
import type { Router } from "express";
import { z } from "zod";
import { runWithTenant, type DbTransaction } from "@idrok/db";
import {
  BroadcastPreviewSchema,
  BroadcastSchema,
  BroadcastTargetSchema,
  CreateBroadcastSchema,
  IdParamsSchema,
  LinkCodeIssuedSchema,
  ListQuerySchema,
  LoginResponseSchema,
  MyNotificationsSchema,
  TelegramAdminSettingsSchema,
  TelegramGuardianQuerySchema,
  TelegramGuardianSchema,
  TelegramLinkSummarySchema,
  TelegramWebAppLoginSchema,
  UpdateNotificationPreferenceSchema,
  UpdateNotificationSettingsSchema,
  pageOf,
  type MyNotificationsDto,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { verifyInitData } from "../../domain/telegram";
import type { RequestAuth } from "../../http/auth";
import { AppError, notFound } from "../../http/errors";
import { routesFor } from "../../http/route";
import { SlidingWindow } from "../../infra/rate-limit";
import type { OpenApiRegistry } from "../../openapi/registry";
import { writeAudit } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { generateTemporaryPassword, hashPassword } from "../auth/password";
import { MeService } from "../me/me.service";
import { notificationSettings, preferenceOf, updateNotificationSettings, updatePreference } from "../notifications/settings";
import { TelegramLinkingService } from "./linking.service";
import { TelegramAdminService } from "./telegram.service";

const tags = ["telegram"];
const WebhookBody = z.looseObject({ update_id: z.number().int().nonnegative() });
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_LOGINS_PER_IP = 60;

const secretMatches = (given: unknown, expected: string) =>
  typeof given === "string" &&
  given.length === expected.length &&
  timingSafeEqual(Buffer.from(given), Buffer.from(expected));

/** T-92: a linked guardian without a portal account gets one (login = phone; the password is never shown). */
async function ensureGuardianUser(tx: DbTransaction, tenantId: string, guardianId: string): Promise<string> {
  const g = await tx.guardian.findUniqueOrThrow({ where: { id: guardianId }, select: { userId: true, phone: true } });
  if (g.userId) return g.userId;
  const taken = await tx.user.findFirst({ where: { username: g.phone }, select: { id: true } });
  if (taken) throw new AppError("CONFLICT", 409, { reason: "USERNAME_TAKEN" });
  const role = await tx.role.findFirst({ where: { code: "GUARDIAN", archivedAt: null }, select: { id: true } });
  if (!role) throw new AppError("CONFLICT", 409, { reason: "SYSTEM_ROLE_MISSING" });
  const user = await tx.user.create({
    data: {
      tenantId,
      username: g.phone,
      phone: g.phone,
      // A random password nobody knows: the web login needs a temporary password from the admin.
      passwordHash: await hashPassword(generateTemporaryPassword()),
      mustChangePassword: true,
    },
    select: { id: true },
  });
  await tx.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } });
  await tx.guardian.update({ where: { id: guardianId }, data: { userId: user.id } });
  await writeAudit(tx, {
    tenantId,
    actorUserId: null,
    action: "user.create",
    entityType: "User",
    entityId: user.id,
    after: { guardianId, via: "telegram" },
  });
  return user.id;
}

export function telegramRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const route = routesFor(router, registry);
  const admin = new TelegramAdminService(deps.db);
  const linking = new TelegramLinkingService(deps.db, deps.authState);
  const auth = new AuthService(deps);
  const me = new MeService(deps.db);
  const ipWindow = new SlidingWindow(deps.redis, LOGIN_WINDOW_MS);
  const env = deps.env;
  const botConfigured = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET);

  const defaultTenant = async () => {
    const t = await deps.root.tenant.findUnique({ where: { slug: env.DEFAULT_TENANT_SLUG }, select: { id: true, status: true } });
    return t?.status === "ACTIVE" ? t.id : null;
  };

  // ---- bot webhook (T-90)
  route(
    {
      method: "post",
      path: "/telegram/webhook",
      summary: "Telegram bot webhook (X-Telegram-Bot-Api-Secret-Token)",
      tags,
      access: "public",
      responses: { 200: { description: "Accepted" }, 401: { description: "Bad secret" }, 404: { description: "Bot off" } },
    },
    async ({ req, res }) => {
      if (!botConfigured) throw notFound();
      if (!secretMatches(req.headers["x-telegram-bot-api-secret-token"], env.TELEGRAM_WEBHOOK_SECRET!))
        throw new AppError("AUTH_REQUIRED", 401);
      const parsed = WebhookBody.safeParse(req.body);
      const tenantId = await defaultTenant();
      // Malformed or unroutable updates are acknowledged (Telegram would retry them forever).
      if (!parsed.success || !tenantId) return void res.json({ ok: true });
      await runWithTenant({ tenantId, requestId: String(req.id) }, () =>
        deps.db.$transaction(async (tx) => {
          const [row] = await tx.telegramUpdate.createManyAndReturn({
            data: [{ tenantId, updateId: BigInt(parsed.data.update_id), payload: parsed.data as object }],
            skipDuplicates: true,
            select: { id: true },
          });
          if (!row) return; // the same update_id again
          await tx.outboxEvent.create({
            data: {
              tenantId,
              type: "telegram.update_received",
              aggregateType: "TelegramUpdate",
              aggregateId: row.id,
              payload: { tenantId, telegramUpdateId: row.id },
            },
          });
        }),
      );
      res.json({ ok: true });
    },
  );

  // ---- Mini App login (T-92)
  route(
    {
      method: "post",
      path: "/auth/telegram",
      summary: "Telegram Mini App login: verified initData → TELEGRAM session (tokens in the body)",
      tags: ["auth"],
      access: "public",
      body: TelegramWebAppLoginSchema,
      responses: {
        200: { description: "Logged in", schema: LoginResponseSchema },
        401: { description: "TELEGRAM_INVALID_INIT_DATA" },
        403: { description: "TELEGRAM_NOT_LINKED" },
        404: { description: "TELEGRAM_NOT_CONFIGURED" },
        429: { description: "AUTH_RATE_LIMITED" },
      },
    },
    async ({ req, res, body }) => {
      if (!env.TELEGRAM_BOT_TOKEN) throw new AppError("TELEGRAM_NOT_CONFIGURED", 404);
      const ipKey = `rl:tg-login:ip:${req.ip ?? "unknown"}`;
      const state = await ipWindow.state(ipKey);
      if (state.count >= MAX_LOGINS_PER_IP) throw new AppError("AUTH_RATE_LIMITED", 429, { retryAfterSec: state.retryAfterSec });
      await ipWindow.hit(ipKey);
      const verified = verifyInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
      if (!verified) throw new AppError("TELEGRAM_INVALID_INIT_DATA", 401);
      const tenantId = await defaultTenant();
      if (!tenantId) throw new AppError("TELEGRAM_NOT_LINKED", 403);
      const found = await runWithTenant({ tenantId, requestId: String(req.id) }, async () => {
        const link = await deps.db.telegramLink.findFirst({
          where: { telegramUserId: BigInt(verified.user.id), revokedAt: null },
          select: { id: true, guardianId: true },
        });
        if (!link) return null;
        const userId = await deps.db.$transaction((tx) => ensureGuardianUser(tx, tenantId, link.guardianId));
        return { linkId: link.id, userId };
      });
      if (!found) throw new AppError("TELEGRAM_NOT_LINKED", 403);
      const user = await deps.root.user.findUnique({ where: { id: found.userId }, select: { status: true } });
      if (user?.status !== "ACTIVE") throw new AppError("TELEGRAM_NOT_LINKED", 403);
      const result = await auth.loginTelegram({
        tenantId,
        userId: found.userId,
        telegramLinkId: found.linkId,
        ...(req.headers["user-agent"] ? { userAgent: req.headers["user-agent"] } : {}),
      });
      const authState = await deps.authState.fromDb(result.userId);
      if (!authState) throw new AppError("AUTH_SESSION_REVOKED", 401);
      const profile = await runWithTenant({ tenantId, userId: result.userId }, () =>
        me.get({ ...authState, mustChangePassword: false, sessionId: result.sessionId, via: "bearer", telegram: true }),
      );
      const { csrfToken: _csrf, ...tokens } = result.tokens;
      res.json({ user: profile, tokens });
    },
  );

  // ---- admin: settings and link status
  route(
    {
      method: "get",
      path: "/telegram/settings",
      summary: "Notification settings and bot status",
      tags,
      access: "telegram.manage",
      responses: { 200: { description: "Settings", schema: TelegramAdminSettingsSchema } },
    },
    async ({ res }) =>
      res.json({
        settings: await notificationSettings(deps.db),
        status: {
          botConfigured,
          botUsername: env.TELEGRAM_BOT_USERNAME ?? null,
          smsProviderConfigured: deps.sms.configured,
        },
      }),
  );
  route(
    {
      method: "put",
      path: "/telegram/settings",
      summary: "Change notification settings",
      tags,
      access: "telegram.manage",
      body: UpdateNotificationSettingsSchema,
      responses: { 200: { description: "Settings", schema: TelegramAdminSettingsSchema.shape.settings } },
    },
    async ({ res, body }) => res.json(await updateNotificationSettings(deps.db, body)),
  );
  route(
    {
      method: "get",
      path: "/telegram/summary",
      summary: "How many guardians are linked",
      tags,
      access: "telegram.manage",
      responses: { 200: { description: "Counts", schema: TelegramLinkSummarySchema } },
    },
    async ({ res }) => res.json(await admin.summary()),
  );
  route(
    {
      method: "get",
      path: "/telegram/guardians",
      summary: "Guardians with their Telegram link status",
      tags,
      access: "telegram.manage",
      query: TelegramGuardianQuerySchema,
      responses: { 200: { description: "Guardians", schema: pageOf(TelegramGuardianSchema) } },
    },
    async ({ res, query }) => res.json(await admin.guardians(query)),
  );
  route(
    {
      method: "post",
      path: "/telegram/guardians/:id/link-code",
      summary: "Issue a one-time link code (shown once; earlier codes stop working)",
      tags,
      access: "telegram.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Code", schema: LinkCodeIssuedSchema }, 404: { description: "NOT_FOUND" } },
    },
    async ({ res, params }) => res.json(await linking.issueCode(params.id, env.TELEGRAM_BOT_USERNAME)),
  );
  route(
    {
      method: "delete",
      path: "/telegram/guardians/:id/link",
      summary: "Unlink the guardian's Telegram (their Mini App sessions end)",
      tags,
      access: "telegram.manage",
      params: IdParamsSchema,
      responses: { 204: { description: "Unlinked" }, 404: { description: "NOT_FOUND (no link)" } },
    },
    async ({ res, params, auth: a }) => {
      await linking.unlinkGuardian(params.id, a.userId, "ADMIN");
      res.status(204).end();
    },
  );

  // ---- broadcasts (T-96)
  route(
    {
      method: "post",
      path: "/telegram/broadcasts/preview",
      summary: "Who a broadcast to these classes would reach",
      tags,
      access: "notifications.broadcast",
      body: BroadcastTargetSchema,
      responses: { 200: { description: "Counts", schema: BroadcastPreviewSchema } },
    },
    async ({ res, body }) => res.json(await admin.preview(body.classGroupIds)),
  );
  route(
    {
      method: "post",
      path: "/telegram/broadcasts",
      summary: "Send a message to the guardians of selected classes",
      tags,
      access: "notifications.broadcast",
      body: CreateBroadcastSchema,
      responses: { 200: { description: "Queued", schema: BroadcastSchema } },
    },
    async ({ res, body, auth: a }) => res.json(await admin.create(body, a.userId)),
  );
  route(
    {
      method: "get",
      path: "/telegram/broadcasts",
      summary: "Broadcast history with delivery counts",
      tags,
      access: "notifications.broadcast",
      query: ListQuerySchema,
      responses: { 200: { description: "Broadcasts", schema: pageOf(BroadcastSchema) } },
    },
    async ({ res, query }) => res.json(await admin.broadcasts(query)),
  );

  // ---- the guardian's own settings (portal and Mini App)
  const myGuardianId = async (a: RequestAuth) => {
    const g = await deps.db.guardian.findFirst({ where: { userId: a.userId }, select: { id: true } });
    if (!g) throw notFound();
    return g.id;
  };
  const mine = async (guardianId: string): Promise<MyNotificationsDto> => {
    const [preferences, settings, link] = await Promise.all([
      preferenceOf(deps.db, guardianId),
      notificationSettings(deps.db),
      deps.db.telegramLink.findFirst({
        where: { guardianId, revokedAt: null },
        select: { linkedAt: true, blockedAt: true },
      }),
    ]);
    return {
      preferences,
      schoolQuietStartMinute: settings.quietStartMinute,
      schoolQuietEndMinute: settings.quietEndMinute,
      telegram: {
        status: !link ? "NOT_LINKED" : link.blockedAt ? "BLOCKED" : "LINKED",
        linkedAt: link?.linkedAt.toISOString() ?? null,
        botUsername: env.TELEGRAM_BOT_USERNAME ?? null,
      },
    };
  };
  route(
    {
      method: "get",
      path: "/portal/notifications",
      summary: "Guardian portal: my notification settings and Telegram status",
      tags: ["portal"],
      access: "portal.guardian",
      responses: { 200: { description: "Settings", schema: MyNotificationsSchema } },
    },
    async ({ res, auth: a }) => res.json(await mine(await myGuardianId(a))),
  );
  route(
    {
      method: "put",
      path: "/portal/notifications",
      summary: "Guardian portal: change my notification settings",
      tags: ["portal"],
      access: "portal.guardian",
      body: UpdateNotificationPreferenceSchema,
      responses: { 200: { description: "Settings", schema: MyNotificationsSchema } },
    },
    async ({ res, auth: a, body }) => {
      const id = await myGuardianId(a);
      await updatePreference(deps.db, id, body);
      res.json(await mine(id));
    },
  );
  route(
    {
      method: "delete",
      path: "/portal/telegram",
      summary: "Guardian portal: unlink my Telegram",
      tags: ["portal"],
      access: "portal.guardian",
      responses: { 204: { description: "Unlinked" }, 404: { description: "NOT_FOUND (no link)" } },
    },
    async ({ res, auth: a }) => {
      await linking.unlinkGuardian(await myGuardianId(a), a.userId, "GUARDIAN");
      res.status(204).end();
    },
  );
}
