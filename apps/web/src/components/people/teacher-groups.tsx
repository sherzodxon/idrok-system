"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Page, TeacherAssignmentDto } from "@idrok/shared";
import { useApi } from "@/components/providers/app-providers";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, QueryBoundary } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/toolbar";
import { useClassGroups } from "@/lib/queries";

/** A teacher's groups: what they teach (assignments) and their homeroom classes. Data scope comes from the API. */
export function TeacherGroups() {
  const t = useTranslations();
  const api = useApi();
  const assignments = useQuery({
    queryKey: ["teacher-assignments", "mine"],
    queryFn: () =>
      api
        .get<Page<TeacherAssignmentDto>>("/teacher-assignments?pageSize=100")
        .then((p) => p.items.filter((a) => !a.validTo)),
  });
  const classes = useClassGroups();
  return (
    <>
      <PageHeader title={t("teacher.groups")} />
      <QueryBoundary
        query={assignments}
        isEmpty={(a) => a.length === 0}
        empty={
          <Card>
            <EmptyState text={t("teacher.noGroups")} />
          </Card>
        }
      >
        {(list) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((a) => {
              const cls = classes.data?.find((c) => c.classTeachingGroupId === a.teachingGroupId);
              return (
                <Card key={a.id} className="flex flex-col gap-2 p-5">
                  <p className="text-lg font-semibold">{a.teachingGroupName}</p>
                  <Badge tone="primary">{a.subjectName}</Badge>
                  {cls && (
                    <Link
                      href={`/teacher/students?classGroupId=${cls.id}`}
                      className="mt-1 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <Users className="size-4" aria-hidden />
                      {t("teacher.studentsCount", { count: cls.studentCount })}
                    </Link>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
