// One device job, the same for the bridge and for the worker (directly reachable terminals). Errors become a failed
// outcome with a short message (no credentials); the caller reports it to the server.
import { IsapiError, type IsapiClient, type PushShapedEvent } from "./client";

export type DeviceJobType = "FACE_UPSERT" | "FACE_DELETE" | "FACE_CHECK" | "DEVICE_INFO" | "EVENT_HISTORY";

export interface DeviceJob {
  id: string;
  type: DeviceJobType;
  payload: Record<string, unknown>;
}

export interface JobOutcome {
  ok: boolean;
  error?: string;
  result?: Record<string, unknown>;
  /** EVENT_HISTORY: events read back from the terminal, to be ingested like pushed ones. */
  events?: PushShapedEvent[];
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "") throw new Error(`payload.${name} missing`);
  return v;
};

export function errorText(e: unknown): string {
  if (e instanceof IsapiError) return e.message.slice(0, 300);
  if (e instanceof Error) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    return (cause ? `${e.message} (${cause})` : e.message).slice(0, 300);
  }
  return "unknown error";
}

export async function runDeviceJob(
  client: IsapiClient,
  job: DeviceJob,
  loadPhoto: () => Promise<Buffer>,
): Promise<JobOutcome> {
  try {
    switch (job.type) {
      case "FACE_UPSERT": {
        const employeeNo = str(job.payload.employeeNo, "employeeNo");
        const photo = await loadPhoto();
        await client.setUpUser({ employeeNo, name: str(job.payload.name, "name") });
        // The terminal keeps one face per person: the old one goes first (MASTER_SPEC §11 step 5).
        await client.deleteFace(employeeNo);
        await client.uploadFace(employeeNo, photo);
        return { ok: true, result: { hasFace: true } };
      }
      case "FACE_DELETE":
        await client.deleteUser(str(job.payload.employeeNo, "employeeNo"));
        return { ok: true, result: { hasFace: false } };
      case "FACE_CHECK":
        return { ok: true, result: { hasFace: await client.hasFace(str(job.payload.employeeNo, "employeeNo")) } };
      case "DEVICE_INFO":
        return { ok: true, result: { ...(await client.deviceInfo()) } };
      case "EVENT_HISTORY": {
        const events = await client.searchEvents(str(job.payload.from, "from"), str(job.payload.to, "to"));
        return { ok: true, result: { count: events.length }, events };
      }
    }
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}
