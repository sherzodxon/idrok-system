// Error alerts (audit finding: no error monitoring). Provider-neutral: when ALERT_WEBHOOK_URL is set, a short JSON
// message is POSTed to it (a chat bot, an incident tool or a small relay). Only the kind, a one-line error name, the
// request id and the masked route leave the server — never bodies, headers, tokens, personal data or stack traces.
// The same alert is sent at most once per `throttleMs`, so an outage does not flood the channel. Sending never throws.
import { maskUrlSecrets } from "../logger";

export type AlertKind = "api_error" | "tenant_violation" | "worker_error" | "coin_mismatch";

export interface Alert {
  kind: AlertKind;
  /** Error class and a short message; trimmed to one line. */
  message: string;
  requestId?: string;
  route?: string;
  tenantId?: string;
}

export interface AlertSink {
  notify(alert: Alert): void;
}

export const noAlerts: AlertSink = { notify: () => undefined };

const oneLine = (s: string, max = 200) => s.split("\n")[0]!.slice(0, max);

/** "PrismaClientKnownRequestError: …" — the class and the first line, without values that could identify people. */
export function alertMessage(err: unknown): string {
  if (err instanceof Error) return oneLine(`${err.name}: ${err.message.replace(/["'`][^"'`]{0,200}["'`]/g, "…")}`);
  return "non-error thrown";
}

export function createAlertSink(
  url: string | undefined,
  opts: { service: string; environment: string; throttleMs?: number; fetchImpl?: typeof fetch; now?: () => number },
): AlertSink {
  if (!url) return noAlerts;
  const throttleMs = opts.throttleMs ?? 5 * 60_000;
  const send = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const last = new Map<string, number>();
  return {
    notify(alert) {
      const key = `${alert.kind}|${alert.message}|${alert.route ?? ""}`;
      const at = now();
      if ((last.get(key) ?? -Infinity) > at - throttleMs) return;
      last.set(key, at);
      if (last.size > 500) last.delete(last.keys().next().value!);
      const body = {
        service: opts.service,
        environment: opts.environment,
        kind: alert.kind,
        message: oneLine(alert.message),
        requestId: alert.requestId,
        route: maskUrlSecrets(alert.route),
        tenantId: alert.tenantId,
        at: new Date(at).toISOString(),
      };
      void send(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined);
    },
  };
}
