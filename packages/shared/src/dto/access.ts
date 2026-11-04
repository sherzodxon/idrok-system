import { z } from "zod";

export const RoleSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
});
export type RoleDto = z.infer<typeof RoleSchema>;

export const AssignRolesSchema = z.object({ roleIds: z.array(z.uuid()).max(20) }).strict();

export const RoleCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
export const CreateRoleSchema = z
  .object({
    code: RoleCodeSchema,
    name: z.string().trim().min(1).max(80),
    permissions: z.array(z.string()).max(200).default([]),
  })
  .strict();
export const UpdateRoleSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const SetRolePermissionsSchema = z.object({ permissions: z.array(z.string()).max(200) }).strict();

export const AuditLogEntrySchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actor: z.object({ id: z.uuid(), username: z.string() }).nullable(),
  reason: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const UserListItemSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  /** The card's name (null for a system account without a card). */
  name: z.string().nullable(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  roles: z.array(z.string()),
  profile: z.enum(["STUDENT", "GUARDIAN", "EMPLOYEE"]).nullable(),
});
export type UserListItem = z.infer<typeof UserListItemSchema>;

// ---- one login account (Sozlamalar → Foydalanuvchilar → user page)

/** Lowercase: the login form lowercases what is typed. Letters, digits, dot, dash, underscore; 3..50. */
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => /^[a-z0-9][a-z0-9._-]{2,49}$/.test(v), { message: "invalid_username" });

export const ChangeUsernameSchema = z.object({ username: UsernameSchema }).strict();

export const LinkEmployeeSchema = z
  .object({
    employeeId: z.uuid().optional(),
    newEmployee: z
      .object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => !!v.employeeId !== !!v.newEmployee, { message: "one_of", path: ["employeeId"] });

export const UserSessionSchema = z.object({
  id: z.uuid(),
  clientType: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
});

export const UserDetailSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  mustChangePassword: z.boolean(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
  passwordChangedAt: z.iso.datetime().nullable(),
  roles: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
  /** The card the account belongs to (its name is the display name); null = a system account (seed admin). */
  person: z
    .object({
      kind: z.enum(["STUDENT", "GUARDIAN", "EMPLOYEE"]),
      id: z.uuid(),
      firstName: z.string(),
      lastName: z.string(),
      detail: z.string().nullable(),
    })
    .nullable(),
  sessions: z.array(UserSessionSchema),
  /** Last 30 days unless named otherwise; only the parts that fit the account's card are present. */
  stats: z.object({
    auditActions: z.number().int(),
    employee: z
      .object({
        scoresGiven: z.number().int(),
        coinEvaluations: z.number().int(),
        testsTotal: z.number().int(),
        questionsTotal: z.number().int(),
        teachingGroups: z.number().int(),
      })
      .nullable(),
    student: z
      .object({
        testsFinished: z.number().int(),
        averagePercent: z.string().nullable(),
        coinBalance: z.number().int(),
        attendance: z.record(z.string(), z.number().int()),
      })
      .nullable(),
    guardian: z.object({ children: z.array(z.object({ id: z.uuid(), name: z.string() })) }).nullable(),
  }),
});
export type UserDetailDto = z.infer<typeof UserDetailSchema>;
