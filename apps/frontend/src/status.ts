export type ServiceStatus =
  "unknown" | "online" | "offline" | "timed_out" | "http_error" | "http3_error";

export type Service = {
  id: string;
  name: string;
  url: string;
  checkHttp3: boolean;
  status: ServiceStatus;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string | null;
};

export type Category = {
  id: string;
  name: string;
  logo: string;
  services: Service[];
};

export type Severity = "minor" | "major" | "critical";

export type Incident = {
  id: string;
  title: string;
  message: string;
  severity: Severity;
  createdAt: string;
  resolvedAt: string | null;
};

export type Snapshot = {
  categories: Category[];
  incidents: Incident[];
  generatedAt: string;
};

export function parseSnapshot(message: { data: unknown }): Snapshot {
  const data = message.data as Record<string, unknown>;
  if (typeof data?.Payload !== "string") {
    throw new Error("Status response did not contain a payload");
  }
  return JSON.parse(data.Payload) as Snapshot;
}
