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
