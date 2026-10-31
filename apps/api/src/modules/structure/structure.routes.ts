import type { Router } from "express";
import { z } from "zod";
import {
  AcademicYearSchema,
  ClassGroupListQuerySchema,
  ClassGroupSchema,
  CreateAcademicYearSchema,
  CreateClassGroupSchema,
  CreateGradeSchema,
  CreateSubgroupSchema,
  CreateSubjectSchema,
  CreateTeacherAssignmentSchema,
  EndTeacherAssignmentSchema,
  GradeSchema,
  IdParamsSchema,
  SubjectSchema,
  TeacherAssignmentListQuerySchema,
  TeacherAssignmentSchema,
  TeachingGroupSchema,
  UpdateAcademicYearSchema,
  UpdateClassGroupSchema,
  UpdateMembersSchema,
  UpdateSubjectSchema,
  pageOf,
} from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { StructureService } from "./structure.service";

const tags = ["structure"];

export function structureRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const s = new StructureService(deps.db);
  const route = routesFor(router, registry);

  route(
    {
      method: "get",
      path: "/academic-years",
      summary: "Academic years",
      tags,
      access: "academic_years.view",
      responses: { 200: { description: "Years", schema: z.array(AcademicYearSchema) } },
    },
    async ({ res }) => res.json(await s.listYears()),
  );
  route(
    {
      method: "post",
      path: "/academic-years",
      summary: "Create an academic year",
      tags,
      access: "academic_years.manage",
      body: CreateAcademicYearSchema,
      responses: { 201: { description: "Created", schema: AcademicYearSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createYear(body)),
  );
  route(
    {
      method: "patch",
      path: "/academic-years/:id",
      summary: "Change year dates",
      tags,
      access: "academic_years.manage",
      params: IdParamsSchema,
      body: UpdateAcademicYearSchema,
      responses: { 200: { description: "Updated", schema: AcademicYearSchema } },
    },
    async ({ res, params, body }) => res.json(await s.updateYear(params.id, body)),
  );
  route(
    {
      method: "post",
      path: "/academic-years/:id/activate",
      summary: "Make the year current (previous one is closed)",
      tags,
      access: "academic_years.manage",
      params: IdParamsSchema,
      responses: { 200: { description: "Activated" } },
    },
    async ({ res, params }) => res.json(await s.activateYear(params.id)),
  );

  route(
    {
      method: "get",
      path: "/grades",
      summary: "Grade levels (parallels)",
      tags,
      access: "class_groups.view",
      responses: { 200: { description: "Grades", schema: z.array(GradeSchema) } },
    },
    async ({ res }) => res.json(await s.listGrades()),
  );
  route(
    {
      method: "post",
      path: "/grades",
      summary: "Create a grade level",
      tags,
      access: "class_groups.manage",
      body: CreateGradeSchema,
      responses: { 201: { description: "Created", schema: GradeSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createGrade(body)),
  );

  route(
    {
      method: "get",
      path: "/class-groups",
      summary: "Classes (teachers: their own)",
      tags,
      access: "class_groups.view",
      query: ClassGroupListQuerySchema,
      responses: { 200: { description: "Classes", schema: pageOf(ClassGroupSchema) } },
    },
    async ({ res, auth, query }) => res.json(await s.listClassGroups(auth, query)),
  );
  route(
    {
      method: "post",
      path: "/class-groups",
      summary: "Create a class (and its whole-class teaching group)",
      tags,
      access: "class_groups.manage",
      body: CreateClassGroupSchema,
      responses: { 201: { description: "Created", schema: ClassGroupSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createClassGroup(body)),
  );
  route(
    {
      method: "get",
      path: "/class-groups/:id",
      summary: "Class",
      tags,
      access: "class_groups.view",
      params: IdParamsSchema,
      responses: { 200: { description: "Class", schema: ClassGroupSchema } },
    },
    async ({ res, auth, params }) => res.json(await s.getClassGroup(auth, params.id)),
  );
  route(
    {
      method: "patch",
      path: "/class-groups/:id",
      summary: "Change homeroom teacher or capacity",
      tags,
      access: "class_groups.manage",
      params: IdParamsSchema,
      body: UpdateClassGroupSchema,
      responses: { 200: { description: "Updated", schema: ClassGroupSchema } },
    },
    async ({ res, params, body }) => res.json(await s.updateClassGroup(params.id, body)),
  );

  route(
    {
      method: "get",
      path: "/teaching-groups",
      summary: "Teaching groups (teachers: their own)",
      tags,
      access: "class_groups.view",
      query: z.object({ classGroupId: z.uuid().optional() }),
      responses: { 200: { description: "Groups", schema: z.array(TeachingGroupSchema) } },
    },
    async ({ res, auth, query }) => res.json(await s.listTeachingGroups(auth, query.classGroupId)),
  );
  route(
    {
      method: "post",
      path: "/teaching-groups",
      summary: "Create a subgroup of a class",
      tags,
      access: "class_groups.manage",
      body: CreateSubgroupSchema,
      responses: { 201: { description: "Created", schema: TeachingGroupSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createSubgroup(body)),
  );
  route(
    {
      method: "put",
      path: "/teaching-groups/:id/members",
      summary: "Add or end subgroup memberships",
      tags,
      access: "class_groups.manage",
      params: IdParamsSchema,
      body: UpdateMembersSchema,
      responses: { 200: { description: "Current members", schema: z.object({ members: z.array(z.uuid()) }) } },
    },
    async ({ res, params, body }) => res.json(await s.updateMembers(params.id, body)),
  );

  route(
    {
      method: "get",
      path: "/subjects",
      summary: "Subjects",
      tags,
      access: "subjects.view",
      query: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
      responses: { 200: { description: "Subjects", schema: z.array(SubjectSchema) } },
    },
    async ({ res, query }) => res.json(await s.listSubjects(query.includeArchived === "true")),
  );
  route(
    {
      method: "post",
      path: "/subjects",
      summary: "Create a subject",
      tags,
      access: "subjects.manage",
      body: CreateSubjectSchema,
      responses: { 201: { description: "Created", schema: SubjectSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createSubject(body)),
  );
  route(
    {
      method: "patch",
      path: "/subjects/:id",
      summary: "Update or archive a subject",
      tags,
      access: "subjects.manage",
      params: IdParamsSchema,
      body: UpdateSubjectSchema,
      responses: { 200: { description: "Updated", schema: SubjectSchema } },
    },
    async ({ res, params, body }) => res.json(await s.updateSubject(params.id, body)),
  );

  route(
    {
      method: "get",
      path: "/teacher-assignments",
      summary: "Who teaches what where (teachers: their own)",
      tags,
      access: "teacher_assignments.view",
      query: TeacherAssignmentListQuerySchema,
      responses: { 200: { description: "Assignments", schema: pageOf(TeacherAssignmentSchema) } },
    },
    async ({ res, auth, query }) => res.json(await s.listAssignments(auth, query)),
  );
  route(
    {
      method: "post",
      path: "/teacher-assignments",
      summary: "Assign a teacher to a group and subject",
      tags,
      access: "teacher_assignments.manage",
      body: CreateTeacherAssignmentSchema,
      responses: { 201: { description: "Created", schema: TeacherAssignmentSchema } },
    },
    async ({ res, body }) => res.status(201).json(await s.createAssignment(body)),
  );
  route(
    {
      method: "post",
      path: "/teacher-assignments/:id/end",
      summary: "End an assignment (history is kept)",
      tags,
      access: "teacher_assignments.manage",
      params: IdParamsSchema,
      body: EndTeacherAssignmentSchema,
      responses: { 200: { description: "Ended", schema: TeacherAssignmentSchema } },
    },
    async ({ res, params, body }) => res.json(await s.endAssignment(params.id, body.validTo)),
  );
}
