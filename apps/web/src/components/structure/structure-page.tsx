"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { ClassGroupDto, Page, StudentSummary, TeacherAssignmentDto } from "@idrok/shared";
import { schoolToday } from "@idrok/shared/time";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDrawer } from "@/components/ui/form-drawer";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { FilterSelect, PageHeader, Tabs, Toolbar } from "@/components/ui/toolbar";
import {
  personName,
  useActiveYear,
  useClassGroups,
  useEmployees,
  useGrades,
  useSubjects,
  useShifts,
  useTeachingGroups,
  useYears,
} from "@/lib/queries";
import { useListState } from "@/lib/use-list-state";
import { useSave } from "@/lib/use-save";
import { can, useMe } from "@/lib/use-me";

type Tab = "years" | "classes" | "subjects" | "assignments";

export function StructurePage() {
  const t = useTranslations("structure");
  const list = useListState(["tab"] as const);
  const tab = (
    ["years", "classes", "subjects", "assignments"].includes(list.filters.tab) ? list.filters.tab : "classes"
  ) as Tab;
  return (
    <>
      <PageHeader title={t("title")} />
      <Tabs<Tab>
        value={tab}
        onChange={(v) => list.update({ tab: v })}
        tabs={[
          { value: "classes", label: t("classes") },
          { value: "years", label: t("years") },
          { value: "subjects", label: t("subjects") },
          { value: "assignments", label: t("assignments") },
        ]}
      />
      {tab === "years" && <YearsTab />}
      {tab === "classes" && <ClassesTab />}
      {tab === "subjects" && <SubjectsTab />}
      {tab === "assignments" && <AssignmentsTab />}
    </>
  );
}

// ---------------------------------------------------------------- years

function YearsTab() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const years = useYears();
  const [creating, setCreating] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const activate = useSave(
    (id: string) => api.post(`/academic-years/${id}/activate`),
    ["academic-years"],
    () => setActivating(null),
  );
  const manage = can(me.data, "academic_years.manage");
  return (
    <Card>
      {manage && (
        <Toolbar>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t("structure.addYear")}
          </Button>
        </Toolbar>
      )}
      <QueryBoundary query={years} isEmpty={(y) => y.length === 0} empty={<EmptyState text={t("structure.noYears")} />}>
        {(rows) => (
          <DataTable
            rows={rows}
            columns={[
              { key: "name", header: t("structure.year"), primary: true, cell: (y) => y.name },
              {
                key: "dates",
                header: t("structure.dates"),
                cell: (y) => <span className="tabular">{`${y.startDate} — ${y.endDate}`}</span>,
              },
              {
                key: "status",
                header: t("students.statusLabel"),
                cell: (y) => (
                  <Badge tone={y.status === "ACTIVE" ? "success" : "neutral"}>
                    {t(`structure.yearStatus.${y.status}`)}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                cell: (y) =>
                  manage && y.status !== "ACTIVE" && y.status !== "ARCHIVED" ? (
                    <Button size="sm" variant="secondary" onClick={() => setActivating(y.id)}>
                      {t("structure.activate")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryBoundary>
      {creating && <YearDrawer onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={!!activating}
        title={t("structure.activate")}
        text={t("structure.activateConfirm")}
        loading={activate.isPending}
        onCancel={() => setActivating(null)}
        onConfirm={() => activating && activate.mutate(activating)}
      />
    </Card>
  );
}

function YearDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("structure");
  const api = useApi();
  const [name, setName] = useState("");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const save = useSave((body: object) => api.post("/academic-years", body), ["academic-years"], onClose);
  return (
    <FormDrawer title={t("addYear")} formId="year-form" busy={save.isPending} onClose={onClose}>
      <form
        id="year-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate({ name, startDate, endDate }))}
      >
        <Field label={t("year")} hint={t("yearHint")}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              required
              pattern="\d{4}-\d{4}"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("startDate")}>
          {(id) => <Input id={id} type="date" required value={startDate} onChange={(e) => setStart(e.target.value)} />}
        </Field>
        <Field label={t("endDate")}>
          {(id) => <Input id={id} type="date" required value={endDate} onChange={(e) => setEnd(e.target.value)} />}
        </Field>
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- classes

function ClassesTab() {
  const t = useTranslations();
  const me = useMe();
  const years = useYears();
  const active = useActiveYear();
  const [yearId, setYearId] = useState<string>("");
  const selectedYear = yearId || active.data?.id;
  const classes = useClassGroups(selectedYear);
  const employees = useEmployees(can(me.data, "employees.view"));
  const [editing, setEditing] = useState<ClassGroupDto | "new" | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);
  const manage = can(me.data, "class_groups.manage");
  const teacherName = (id: string | null) => {
    const e = id ? employees.data?.find((x) => x.id === id) : undefined;
    return e ? personName(e) : "—";
  };
  return (
    <Card>
      <Toolbar>
        <FilterSelect
          label={t("structure.year")}
          allLabel={t("structure.activeYear")}
          value={yearId}
          onChange={setYearId}
          options={(years.data ?? []).map((y) => ({ value: y.id, label: y.name }))}
        />
        {manage && (
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="secondary" onClick={() => setGradeOpen(true)}>
              {t("structure.addGrade")}
            </Button>
            <Button onClick={() => setEditing("new")} disabled={!selectedYear}>
              <Plus className="size-4" aria-hidden />
              {t("structure.addClass")}
            </Button>
          </div>
        )}
      </Toolbar>
      <QueryBoundary
        query={classes}
        isEmpty={(c) => c.length === 0}
        empty={<EmptyState text={t("structure.noClasses")} />}
      >
        {(rows) => (
          <DataTable
            testId="classes-table"
            rows={rows}
            onRowClick={manage ? (c) => setEditing(c) : undefined}
            columns={[
              { key: "name", header: t("students.class"), primary: true, cell: (c) => c.name },
              {
                key: "students",
                header: t("structure.students"),
                cell: (c) => <span className="tabular">{c.studentCount}</span>,
              },
              { key: "homeroom", header: t("structure.homeroom"), cell: (c) => teacherName(c.homeroomTeacherId) },
              { key: "capacity", header: t("structure.capacity"), cell: (c) => c.capacity ?? "—" },
            ]}
          />
        )}
      </QueryBoundary>
      {editing && selectedYear && (
        <ClassDrawer yearId={selectedYear} cls={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
      {gradeOpen && <GradeDrawer onClose={() => setGradeOpen(false)} />}
    </Card>
  );
}

function GradeDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("structure");
  const api = useApi();
  const grades = useGrades();
  const [level, setLevel] = useState("");
  const [name, setName] = useState("");
  const save = useSave((body: object) => api.post("/grades", body), ["grades"], onClose);
  return (
    <FormDrawer title={t("addGrade")} formId="grade-form" busy={save.isPending} onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        {t("existingGrades", { list: (grades.data ?? []).map((g) => g.level).join(", ") || "—" })}
      </p>
      <form
        id="grade-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate({ level: Number(level), name }))}
      >
        <Field label={t("level")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={11}
              required
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("gradeName")}>
          {(id) => <Input id={id} required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </form>
    </FormDrawer>
  );
}

function ClassDrawer({ yearId, cls, onClose }: { yearId: string; cls: ClassGroupDto | null; onClose: () => void }) {
  const t = useTranslations();
  const api = useApi();
  const grades = useGrades();
  const employees = useEmployees();
  const groups = useTeachingGroups(cls?.id);
  const [gradeId, setGradeId] = useState("");
  const [section, setSection] = useState("");
  const [capacity, setCapacity] = useState(cls?.capacity ? String(cls.capacity) : "");
  const [homeroom, setHomeroom] = useState(cls?.homeroomTeacherId ?? "");
  const [shiftId, setShiftId] = useState(cls?.shiftId ?? "");
  const shifts = useShifts();
  const [subgroup, setSubgroup] = useState("");
  const save = useSave(
    (body: object) => (cls ? api.patch(`/class-groups/${cls.id}`, body) : api.post("/class-groups", body)),
    ["class-groups", "teaching-groups"],
    onClose,
  );
  const addSubgroup = useSave(
    (name: string) => api.post("/teaching-groups", { classGroupId: cls!.id, name }),
    ["teaching-groups"],
    () => setSubgroup(""),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const common = {
      capacity: capacity ? Number(capacity) : null,
      homeroomTeacherId: homeroom || null,
      shiftId: shiftId || null,
    };
    save.mutate(cls ? common : { academicYearId: yearId, gradeId, section, ...common });
  };
  return (
    <FormDrawer
      title={cls ? cls.name : t("structure.addClass")}
      formId="class-form"
      busy={save.isPending}
      onClose={onClose}
    >
      <form id="class-form" className="flex flex-col gap-4" onSubmit={submit}>
        {!cls && (
          <>
            <Field label={t("structure.level")}>
              {(id) => (
                <Select id={id} required value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
                  <option value="">—</option>
                  {(grades.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("structure.section")}>
              {(id) => (
                <Input
                  id={id}
                  required
                  maxLength={10}
                  value={section}
                  onChange={(e) => setSection(e.target.value.toUpperCase())}
                />
              )}
            </Field>
          </>
        )}
        <Field label={t("calendar.shift")}>
          {(id) => (
            <Select id={id} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">—</option>
              {(shifts.data ?? [])
                .filter((x) => !x.archived || x.id === shiftId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t("structure.homeroom")}>
          {(id) => (
            <Select id={id} value={homeroom} onChange={(e) => setHomeroom(e.target.value)}>
              <option value="">—</option>
              {(employees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {personName(e)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("structure.capacity")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={60}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          )}
        </Field>
      </form>
      {cls && (
        <section className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">{t("structure.subgroups")}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {(groups.data ?? [])
              .filter((g) => g.kind === "SUBGROUP")
              .map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2">
                  <span>{g.name}</span>
                  <SubgroupMembers groupId={g.id} classGroupId={cls.id} />
                </li>
              ))}
          </ul>
          <div className="flex gap-2">
            <Input
              aria-label={t("structure.subgroupName")}
              placeholder={t("structure.subgroupName")}
              value={subgroup}
              onChange={(e) => setSubgroup(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={!subgroup.trim()}
              loading={addSubgroup.isPending}
              onClick={() => addSubgroup.mutate(subgroup.trim())}
            >
              {t("common.add")}
            </Button>
          </div>
        </section>
      )}
    </FormDrawer>
  );
}

/** Adds class students to a subgroup (from a chosen date). */
function SubgroupMembers({ groupId, classGroupId }: { groupId: string; classGroupId: string }) {
  const t = useTranslations();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [validFrom, setValidFrom] = useState<string>(schoolToday());
  const students = useQuery({
    queryKey: ["students", "class", classGroupId],
    queryFn: () =>
      api.get<Page<StudentSummary>>(`/students?classGroupId=${classGroupId}&pageSize=100`).then((p) => p.items),
    enabled: open,
  });
  const save = useSave(
    () =>
      api.put(`/teaching-groups/${groupId}/members`, { add: selected.map((studentId) => ({ studentId, validFrom })) }),
    ["teaching-groups"],
    () => setOpen(false),
  );
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("structure.members")}
      </Button>
    );
  }
  return (
    <FormDrawer
      title={t("structure.members")}
      formId={`members-${groupId}`}
      busy={save.isPending}
      onClose={() => setOpen(false)}
    >
      <form
        id={`members-${groupId}`}
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate(undefined))}
      >
        <Field label={t("students.validFrom")}>
          {(id) => (
            <Input id={id} type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          )}
        </Field>
        {(students.data ?? []).map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) =>
                setSelected((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))
              }
            />
            {personName(s)}
          </label>
        ))}
      </form>
    </FormDrawer>
  );
}

// ---------------------------------------------------------------- subjects

function SubjectsTab() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const subjects = useSubjects(true);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const manage = can(me.data, "subjects.manage");
  const add = useSave(
    (body: object) => api.post("/subjects", body),
    ["subjects"],
    () => (setName(""), setShortName("")),
  );
  const toggle = useSave(
    ({ id, archived }: { id: string; archived: boolean }) => api.patch(`/subjects/${id}`, { archived }),
    ["subjects"],
  );
  return (
    <Card>
      {manage && (
        <form
          className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row"
          onSubmit={(e) => (e.preventDefault(), add.mutate({ name, ...(shortName ? { shortName } : {}) }))}
        >
          <Input
            aria-label={t("structure.subjectName")}
            placeholder={t("structure.subjectName")}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label={t("structure.shortName")}
            placeholder={t("structure.shortName")}
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            className="sm:w-40"
          />
          <Button type="submit" loading={add.isPending}>
            <Plus className="size-4" aria-hidden />
            {t("common.add")}
          </Button>
        </form>
      )}
      <QueryBoundary
        query={subjects}
        isEmpty={(s) => s.length === 0}
        empty={<EmptyState text={t("structure.noSubjects")} />}
      >
        {(rows) => (
          <DataTable
            rows={rows}
            columns={[
              { key: "name", header: t("structure.subjectName"), primary: true, cell: (s) => s.name },
              { key: "short", header: t("structure.shortName"), cell: (s) => s.shortName ?? "—" },
              {
                key: "status",
                header: t("students.statusLabel"),
                cell: (s) => (
                  <Badge tone={s.archived ? "neutral" : "success"}>
                    {t(s.archived ? "structure.archived" : "structure.active")}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                cell: (s) =>
                  manage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggle.mutate({ id: s.id, archived: !s.archived })}
                    >
                      {t(s.archived ? "structure.restore" : "structure.archive")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryBoundary>
    </Card>
  );
}

// ---------------------------------------------------------------- teacher assignments

function AssignmentsTab() {
  const t = useTranslations();
  const api = useApi();
  const me = useMe();
  const list = useListState(["teacherId", "subjectId"] as const);
  const employees = useEmployees(can(me.data, "employees.view"));
  const subjects = useSubjects();
  const assignments = useQuery({
    queryKey: ["teacher-assignments", list.apiQuery],
    queryFn: () => api.get<Page<TeacherAssignmentDto>>(`/teacher-assignments?${list.apiQuery}`),
  });
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<TeacherAssignmentDto | null>(null);
  const manage = can(me.data, "teacher_assignments.manage");
  return (
    <Card>
      <Toolbar>
        <FilterSelect
          label={t("structure.teacher")}
          allLabel={t("structure.allTeachers")}
          value={list.filters.teacherId}
          onChange={(v) => list.update({ teacherId: v })}
          options={(employees.data ?? []).map((e) => ({ value: e.id, label: personName(e) }))}
        />
        <FilterSelect
          label={t("structure.subject")}
          allLabel={t("structure.allSubjects")}
          value={list.filters.subjectId}
          onChange={(v) => list.update({ subjectId: v })}
          options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        {manage && (
          <Button className="sm:ml-auto" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t("structure.addAssignment")}
          </Button>
        )}
      </Toolbar>
      <QueryBoundary
        query={assignments}
        isEmpty={(p) => p.total === 0}
        empty={<EmptyState text={t("structure.noAssignments")} />}
      >
        {(p) => (
          <>
            <DataTable
              rows={p.items}
              columns={[
                { key: "teacher", header: t("structure.teacher"), primary: true, cell: (a) => a.teacherName },
                { key: "group", header: t("structure.group"), cell: (a) => a.teachingGroupName },
                { key: "subject", header: t("structure.subject"), cell: (a) => a.subjectName },
                {
                  key: "dates",
                  header: t("structure.dates"),
                  cell: (a) => <span className="tabular">{`${a.validFrom} — ${a.validTo ?? "…"}`}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  cell: (a) =>
                    manage && !a.validTo ? (
                      <Button size="sm" variant="ghost" onClick={() => setEnding(a)}>
                        {t("structure.end")}
                      </Button>
                    ) : null,
                },
              ]}
            />
            <Pagination
              page={p.page}
              pageSize={p.pageSize}
              total={p.total}
              onPage={(page) => list.update({ page }, false)}
            />
          </>
        )}
      </QueryBoundary>
      {creating && <AssignmentDrawer onClose={() => setCreating(false)} />}
      {ending && <EndAssignmentDrawer assignment={ending} onClose={() => setEnding(null)} />}
    </Card>
  );
}

function AssignmentDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("structure");
  const api = useApi();
  const employees = useEmployees();
  const subjects = useSubjects();
  const groups = useTeachingGroups();
  const [teacherId, setTeacher] = useState("");
  const [teachingGroupId, setGroup] = useState("");
  const [subjectId, setSubject] = useState("");
  const [validFrom, setValidFrom] = useState<string>(schoolToday());
  const save = useSave((body: object) => api.post("/teacher-assignments", body), ["teacher-assignments"], onClose);
  const select = (
    label: string,
    value: string,
    set: (v: string) => void,
    options: { value: string; label: string }[],
  ) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} required value={value} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  return (
    <FormDrawer title={t("addAssignment")} formId="assignment-form" busy={save.isPending} onClose={onClose}>
      <form
        id="assignment-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (
          e.preventDefault(),
          save.mutate({ teacherId, teachingGroupId, subjectId, validFrom })
        )}
      >
        {select(
          t("teacher"),
          teacherId,
          setTeacher,
          (employees.data ?? []).map((e) => ({ value: e.id, label: personName(e) })),
        )}
        {select(
          t("group"),
          teachingGroupId,
          setGroup,
          (groups.data ?? []).map((g) => ({ value: g.id, label: g.name })),
        )}
        {select(
          t("subject"),
          subjectId,
          setSubject,
          (subjects.data ?? []).map((s) => ({ value: s.id, label: s.name })),
        )}
        <Field label={t("startDate")}>
          {(id) => (
            <Input id={id} type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          )}
        </Field>
      </form>
    </FormDrawer>
  );
}

function EndAssignmentDrawer({ assignment, onClose }: { assignment: TeacherAssignmentDto; onClose: () => void }) {
  const t = useTranslations("structure");
  const api = useApi();
  const [validTo, setValidTo] = useState<string>(schoolToday());
  const save = useSave(
    (body: object) => api.post(`/teacher-assignments/${assignment.id}/end`, body),
    ["teacher-assignments"],
    onClose,
  );
  return (
    <FormDrawer title={t("end")} formId="end-form" busy={save.isPending} onClose={onClose}>
      <form
        id="end-form"
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate({ validTo }))}
      >
        <p className="text-sm text-muted">{`${assignment.teacherName} · ${assignment.teachingGroupName} · ${assignment.subjectName}`}</p>
        <Field label={t("endDate")}>
          {(id) => <Input id={id} type="date" required value={validTo} onChange={(e) => setValidTo(e.target.value)} />}
        </Field>
      </form>
    </FormDrawer>
  );
}
