import type { Response, Router } from "express";
import { ReportRangeQuerySchema } from "@idrok/shared";
import type { AppDeps } from "../../deps";
import { routesFor } from "../../http/route";
import type { OpenApiRegistry } from "../../openapi/registry";
import { writeAudit } from "../audit/audit.service";
import { XLSX } from "../imports/imports.processor";
import { ReportsService } from "./reports.service";

const tags = ["reports"];

export function reportsRoutes(router: Router, registry: OpenApiRegistry, deps: AppDeps) {
  const reports = new ReportsService(deps.db);
  const route = routesFor(router, registry);
  /** Sends the file and records who took which report (personal data leaves the system). */
  const send = async (res: Response, kind: string, q: { from: string; to: string }, file: Buffer) => {
    await writeAudit(deps.db, { action: "report.export", entityType: "Report", entityId: kind, after: q });
    res.setHeader("Content-Type", XLSX);
    res.setHeader("Content-Disposition", `attachment; filename="${kind}-${q.from}-${q.to}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(file);
  };

  route(
    {
      method: "get",
      path: "/reports/attendance.xlsx",
      summary: "School attendance over a range (≤ 92 days), in the caller's scope (.xlsx)",
      tags,
      access: "attendance.view",
      query: ReportRangeQuerySchema,
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, auth, query }) => send(res, "attendance", query, await reports.attendance(auth, query)),
  );
  route(
    {
      method: "get",
      path: "/reports/staff-attendance.xlsx",
      summary: "Staff attendance over a range (≤ 92 days) (.xlsx)",
      tags,
      access: "employees.view",
      query: ReportRangeQuerySchema,
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, query }) => send(res, "staff-attendance", query, await reports.staffAttendance(query)),
  );
  route(
    {
      method: "get",
      path: "/reports/scores.xlsx",
      summary: "Score entries over a range (≤ 366 days), reversals included, in the caller's scope (.xlsx)",
      tags,
      access: "assessment.view",
      query: ReportRangeQuerySchema,
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, auth, query }) => send(res, "scores", query, await reports.scores(auth, query)),
  );
  route(
    {
      method: "get",
      path: "/reports/coins.xlsx",
      summary: "Coin ledger over a range (≤ 366 days) (.xlsx)",
      tags,
      access: "coins.view",
      query: ReportRangeQuerySchema,
      responses: { 200: { description: ".xlsx" } },
    },
    async ({ res, query }) => send(res, "coins", query, await reports.coins(query)),
  );
}
