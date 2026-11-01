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
  status: z.enum(["ACTIVE", "DISABLED"]),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  roles: z.array(z.string()),
  profile: z.enum(["STUDENT", "GUARDIAN", "EMPLOYEE"]).nullable(),
});
export type UserListItem = z.infer<typeof UserListItemSchema>;
