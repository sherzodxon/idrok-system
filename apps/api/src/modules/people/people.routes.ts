import type { Router } from "express";
import { z } from "zod";
import {
  AccountFilterSchema,
  AccountCreatedSchema,
  ArchiveStudentSchema,
  CreateAccountSchema,
  CreateEmployeeSchema,
  CreateGuardianSchema,
  CreateStudentSchema,
  EmployeeSchema,
  EmployeeStatusSchema,
  EnrollStudentSchema,
  GuardianSchema,
  IdParamsSchema,
  LinkGuardianSchema,
  ListQuerySchema,
  StudentDetailSchema,
  StudentListQuerySchema,
  StudentSummarySchema,
  UpdateEmployeeSchema,
  UpdateGuardianSchema,
  UpdateStudentSchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { AccountsService } from "../users/accounts.service";
import { EmployeesService } from "./employees.service";
import { GuardiansService } from "./guardians.service";
import { StudentsService } from "./students.service";

const StudentGuardianParams = z.object({ id: z.uuid(), guardianId: z.uuid() });

export function peopleRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const students = new StudentsService(deps.db);
  const guardians = new GuardiansService(deps.db);
  const employees = new EmployeesService(deps.db);
  const accounts = new AccountsService(deps.db, deps.authState);
  const route = routesFor(router, registry);
  const tags = ["people"];

  // ---- students
  route(
    {
      method: "get",
      path: "/students",
      summary: "Students (teachers: their groups only)",
      tags,
      access: "students.view",
      query: StudentListQuerySchema,
      responses: { 200: { description: "Students", schema: pageOf(StudentSummarySchema) } },
    },
    async ({ res, auth, query }) => res.json(await students.list(auth, query)),
  );
  route(
    {
      method: "post",
      path: "/students",
      summary: "Create a student (code assigned by the server)",
      tags,
      access: "students.create",
      body: CreateStudentSchema,
      responses: { 201: { description: "Created", schema: StudentDetailSchema } },
    },
    async ({ res, auth, body }) => res.status(201).json(await students.create(auth, body)),
  );
  route(
    {
      method: "get",
      path: "/students/:id",
      summary: "Student profile (within the caller's scope)",
      tags,
      // Staff need students.view; guardians and students reach their own record through the portal permissions.
      access: { anyOf: ["students.view", "portal.guardian", "portal.student"] },
      params: IdParamsSchema,
      responses: {
        200: { description: "Student", schema: StudentDetailSchema },
        404: { description: "NOT_FOUND (also outside scope)" },
      },
    },
    async ({ res, auth, params }) => res.json(await students.get(auth, params.id)),
  );
  route(
    {
      method: "patch",
      path: "/students/:id",
      summary: "Update a student",
      tags,
      access: "students.update",
      params: IdParamsSchema,
      body: UpdateStudentSchema,
      responses: { 200: { description: "Updated", schema: StudentDetailSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await students.update(auth, params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/students/:id/enrollments",
      summary: "Place in or transfer to a class",
      tags,
      access: "students.update",
      params: IdParamsSchema,
      body: EnrollStudentSchema,
      responses: { 200: { description: "Updated", schema: StudentDetailSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await students.enroll(auth, params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/students/:id/archive",
      summary: "Mark as left or graduated",
      tags,
      access: "students.archive",
      params: IdParamsSchema,
      body: ArchiveStudentSchema,
      responses: { 200: { description: "Archived", schema: StudentDetailSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await students.archive(auth, params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/students/:id/guardians",
      summary: "Link an existing or new guardian",
      tags,
      access: "guardians.manage",
      params: IdParamsSchema,
      body: LinkGuardianSchema,
      responses: { 200: { description: "Linked", schema: StudentDetailSchema } },
    },
    async ({ res, auth, params, body }) => res.json(await students.linkGuardian(auth, params.id, body)),
  );
  route(
    {
      method: "delete",
      path: "/students/:id/guardians/:guardianId",
      summary: "Unlink a guardian (kept as history)",
      tags,
      access: "guardians.manage",
      params: StudentGuardianParams,
      responses: { 204: { description: "Unlinked" } },
    },
    async ({ res, params }) => {
      await students.unlinkGuardian(params.id, params.guardianId);
      res.status(204).end();
    },
  );
  route(
    {
      method: "post",
      path: "/students/:id/account",
      summary: "Create the student's login (from grade 5 unless confirmed)",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      body: CreateAccountSchema,
      responses: { 201: { description: "Temporary password, shown once", schema: AccountCreatedSchema } },
    },
    async ({ res, auth, params, body }) =>
      res.status(201).json(await accounts.createStudentAccount(auth, params.id, body.allowBelowMinGrade)),
  );
  route(
    {
      method: "get",
      path: "/me/children",
      summary: "Guardian portal: my children",
      tags: ["portal"],
      access: "portal.guardian",
      responses: { 200: { description: "Children", schema: z.array(StudentSummarySchema) } },
    },
    async ({ res, auth }) => res.json(await students.myChildren(auth)),
  );

  // ---- guardians
  route(
    {
      method: "get",
      path: "/guardians",
      summary: "Guardians (class teachers: of their class)",
      tags,
      access: "guardians.view",
      query: ListQuerySchema.extend({ account: AccountFilterSchema.optional() }),
      responses: { 200: { description: "Guardians", schema: pageOf(GuardianSchema) } },
    },
    async ({ res, auth, query }) => res.json(await guardians.list(auth, query)),
  );
  route(
    {
      method: "post",
      path: "/guardians",
      summary: "Create a guardian",
      tags,
      access: "guardians.manage",
      body: CreateGuardianSchema,
      responses: { 201: { description: "Created", schema: GuardianSchema } },
    },
    async ({ res, body }) => res.status(201).json(await guardians.create(body)),
  );
  route(
    {
      method: "get",
      path: "/guardians/:id",
      summary: "Guardian",
      tags,
      access: "guardians.view",
      params: IdParamsSchema,
      responses: { 200: { description: "Guardian", schema: GuardianSchema } },
    },
    async ({ res, auth, params }) => res.json(await guardians.get(auth, params.id)),
  );
  route(
    {
      method: "patch",
      path: "/guardians/:id",
      summary: "Update a guardian",
      tags,
      access: "guardians.manage",
      params: IdParamsSchema,
      body: UpdateGuardianSchema,
      responses: { 200: { description: "Updated", schema: GuardianSchema } },
    },
    async ({ res, params, body }) => res.json(await guardians.update(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/guardians/:id/account",
      summary: "Create the guardian's login (username = phone)",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      responses: { 201: { description: "Temporary password, shown once", schema: AccountCreatedSchema } },
    },
    async ({ res, auth, params }) => res.status(201).json(await accounts.createGuardianAccount(auth, params.id)),
  );

  // ---- employees
  route(
    {
      method: "get",
      path: "/employees",
      summary: "Employees",
      tags,
      access: "employees.view",
      query: ListQuerySchema.extend({
        status: EmployeeStatusSchema.optional(),
        account: AccountFilterSchema.optional(),
      }),
      responses: { 200: { description: "Employees", schema: pageOf(EmployeeSchema) } },
    },
    async ({ res, query }) => res.json(await employees.list(query)),
  );
  route(
    {
      method: "post",
      path: "/employees",
      summary: "Create an employee",
      tags,
      access: "employees.manage",
      body: CreateEmployeeSchema,
      responses: { 201: { description: "Created", schema: EmployeeSchema } },
    },
    async ({ res, body }) => res.status(201).json(await employees.create(body)),
  );
  route(
    {
      method: "get",
      path: "/employees/:id",
      summary: "Employee",
      tags,
      access: "employees.view",
      params: IdParamsSchema,
      responses: { 200: { description: "Employee", schema: EmployeeSchema } },
    },
    async ({ res, params }) => res.json(await employees.get(params.id)),
  );
  route(
    {
      method: "patch",
      path: "/employees/:id",
      summary: "Update an employee",
      tags,
      access: "employees.manage",
      params: IdParamsSchema,
      body: UpdateEmployeeSchema,
      responses: { 200: { description: "Updated", schema: EmployeeSchema } },
    },
    async ({ res, params, body }) => res.json(await employees.update(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/employees/:id/account",
      summary: "Create the employee's login with roles (default TEACHER)",
      tags,
      access: "users.manage",
      params: IdParamsSchema,
      body: CreateAccountSchema,
      responses: { 201: { description: "Temporary password, shown once", schema: AccountCreatedSchema } },
    },
    async ({ res, auth, params, body }) =>
      res.status(201).json(await accounts.createEmployeeAccount(auth, params.id, body.roleIds)),
  );
}
