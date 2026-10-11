import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Category, Incident, Service, ServiceStatus } from "../status";
import { useStatus } from "../use-status";
import { formatTime } from "../utils";
import {
  Button,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@methanium/ui";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { snapshot } = useStatus();
  const [showPastIncidents, setShowPastIncidents] = useState(false);
  const services =
    snapshot?.categories.flatMap((category) => category.services) ?? [];
  const failures = services.filter(
    (service) => service.status !== "online" && service.status !== "unknown",
  );
  const activeIncidents =
    snapshot?.incidents.filter((incident) => !incident.resolvedAt) ?? [];
  const pastIncidents =
    snapshot?.incidents
      .filter((incident) => incident.resolvedAt)
      .toReversed()
      .slice(0, 5) ?? [];
  const pending = services.some((service) => service.status === "unknown");
  const ready = snapshot !== null && !pending;
  const healthy =
    ready && failures.length === 0 && activeIncidents.length === 0;

  return (
    <main className="flex flex-col gap-10 py-10">
      <div className="w-full flex gap-3 justify-center items-center">
        <div>
          {healthy ? (
            <Check className="size-7" />
          ) : ready ? (
            <AlertTriangle className="size-7" />
          ) : (
            <RefreshCw className="size-7" />
          )}
        </div>
        <div className="flex flex-col justify-start">
          <p className="text-lg">
            {healthy
              ? "We're up and running"
              : ready
                ? `${failures.length + activeIncidents.length} active disruption${failures.length + activeIncidents.length === 1 ? "" : "s"}`
                : "Loading data..."}
          </p>
          <p className="text-sm text-muted-foreground">
            {!healthy && ready
              ? "More details below."
              : snapshot
                ? ""
                : "Connecting..."}
          </p>
        </div>
      </div>

      {activeIncidents.length > 0 && (
        <div className="grid w-full grid-cols-1 justify-center gap-6 sm:grid-cols-[repeat(auto-fit,24rem)]">
          {activeIncidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}

      <div className="w-full flex flex-col lg:flex-row! gap-15 items-center justify-center">
        {snapshot?.categories.map((category) => (
          <div
            key={category.id}
            className="pt-4 text-sm flex flex-col gap-4 overflow-hidden rounded-xl border border-[#C5CED6] bg-[#EDF1F4] dark:border-[#242D38] dark:bg-[#242D38]"
          >
            <CardHeader className="flex gap-3 items-center">
              <img src={category.logo} alt={category.name} className="size-8" />

              <p className="text-lg font-medium">{category.name}</p>
            </CardHeader>
            <CardContent className="px-0! flex flex-col gap-2 bg-[#E2E7EB] dark:bg-[#1D262F]">
              {category.id === "tensamin" ? (
                <TensaminServices category={category} />
              ) : (
                category.services.map((service, index) => (
                  <ServiceRow
                    key={service.id}
                    index={index}
                    max={category.services.length}
                    service={service}
                  />
                ))
              )}
            </CardContent>
          </div>
        ))}
      </div>

      <section
        aria-labelledby="maintenance-heading"
        className="mx-auto flex max-w-2xl flex-col gap-2 rounded-xl border px-5 py-4 text-sm border-[#C5CED6] bg-[#EDF1F4] dark:border-[#242D38] dark:bg-[#242D38]"
      >
        <h2 id="maintenance-heading" className="font-medium text-lg">
          Weekly maintenance
        </h2>
        <p>
          Every Sunday, 18:00 to Monday 00:00, Europe/Berlin. This is 16:00 to
          22:00 UTC in summer and 17:00 to 23:00 UTC in winter.
        </p>
        <p className="text-muted-foreground">
          Services may be temporarily unavailable while we perform updates and
          restart systems.
        </p>
      </section>

      {pastIncidents.length > 0 && (
        <section className="pt-10 w-full flex flex-col items-center">
          <Button
            type="button"
            variant="ghost"
            aria-expanded={showPastIncidents}
            aria-controls="past-incidents"
            onClick={() => setShowPastIncidents((visible) => !visible)}
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform",
                showPastIncidents && "rotate-90",
              )}
            />
            Show Past Incidents
          </Button>
          {showPastIncidents && (
            <div
              id="past-incidents"
              className="mt-4 grid w-full grid-cols-1 justify-center gap-6 sm:grid-cols-[repeat(auto-fit,24rem)]"
            >
              {pastIncidents.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function TensaminServices({ category }: { category: Category }) {
  const regularServices = category.services.filter(
    (service) =>
      !/^tensamin-(dev|stable|canary)-/.test(service.id) &&
      !["tensamin-app", "tensamin-dev", "tensamin-omega"].includes(service.id),
  );
  return (
    <>
      {regularServices.map((service, index) => (
        <ServiceRow
          key={service.id}
          service={service}
          index={index}
          max={regularServices.length}
        />
      ))}
      <Tabs defaultValue="stable" className="border bg-card p-1">
        <TabsList aria-label="Tensamin channel" className="w-full">
          {["dev", "stable", "canary"].map((channel) => (
            <TabsTrigger key={channel} value={channel}>
              {channel.charAt(0).toUpperCase() + channel.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        {["dev", "stable", "canary"].map((channel) => (
          <TabsContent key={channel} value={channel}>
            <ChannelServices category={category} channel={channel} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function ChannelServices({
  category,
  channel,
}: {
  category: Category;
  channel: string;
}) {
  const channelServices = category.services.filter((service) =>
    service.id.startsWith(`tensamin-${channel}-`),
  );
  const omikrons = channelServices.filter((service) =>
    service.id.startsWith(`tensamin-${channel}-omikron-`),
  );
  const visibleServices = ["app", "omega"].flatMap((kind) =>
    channelServices.filter(
      (service) => service.id === `tensamin-${channel}-${kind}`,
    ),
  );
  const online = omikrons.filter(
    (service) => service.status === "online",
  ).length;

  return (
    <>
      {visibleServices.map((service, index) => (
        <ServiceRow
          key={service.id}
          service={service}
          index={index}
          max={visibleServices.length}
        />
      ))}
      {channelServices.length === 0 && (
        <p className="px-4 py-3 text-muted-foreground">
          No checks configured for this channel.
        </p>
      )}
      <details
        key={channel}
        className="border-t border-[#C5CED6] dark:border-[#242D38]"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <ChevronRight className="size-4" />
            Omikrons
          </span>
          <span
            className={cn(
              "text-xs",
              online === omikrons.length && omikrons.length > 0
                ? "text-emerald-500"
                : "text-muted-foreground",
            )}
          >
            {online}/{omikrons.length} online
          </span>
        </summary>
        {omikrons.map((service, index) => (
          <ServiceRow
            key={service.id}
            service={service}
            index={index}
            max={omikrons.length}
          />
        ))}
        {omikrons.length === 0 && (
          <p className="px-4 pb-3 text-muted-foreground">
            No Omikrons configured.
          </p>
        )}
      </details>
    </>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  const messageRef = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const message = messageRef.current;
    if (!message) return;

    const update = () =>
      setTruncated(message.scrollHeight > message.clientHeight + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(message);
    return () => observer.disconnect();
  }, [incident.message]);

  const severity =
    incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1);

  return (
    <article className="flex h-52 w-96 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden rounded-xl border border-[#C5CED6] bg-[#EDF1F4] pt-4 text-sm dark:border-[#242D38] dark:bg-[#242D38]">
      <CardHeader className="flex items-center gap-3">
        <p className="line-clamp-2 text-lg font-medium [overflow-wrap:anywhere]">
          {incident.title}
        </p>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 bg-[#E2E7EB] px-0! dark:bg-[#1D262F]">
        <p
          ref={messageRef}
          className="line-clamp-3 whitespace-pre-wrap px-4 pt-2 leading-5 [overflow-wrap:anywhere]"
        >
          {incident.message}
        </p>
        {truncated && (
          <Dialog>
            <DialogTrigger
              render={
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto self-start px-4 py-0"
                >
                  Read more
                </Button>
              }
            />
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{incident.title}</DialogTitle>
                <DialogDescription>
                  {severity} incident{" "}
                  {incident.resolvedAt ? "resolved" : "started"}{" "}
                  {formatTime(incident.resolvedAt ?? incident.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
                {incident.message}
              </p>
            </DialogContent>
          </Dialog>
        )}
        <div className="mt-auto flex gap-3 border-t border-[#C5CED6] px-4 py-2 dark:border-[#242D38]">
          <p>{severity}</p>
          <p>
            {incident.resolvedAt ? "Resolved" : "Started"}{" "}
            {formatTime(incident.resolvedAt ?? incident.createdAt)}
          </p>
        </div>
      </CardContent>
    </article>
  );
}

const statusDetails: Record<
  ServiceStatus,
  { label: string; icon: typeof Check; color: string }
> = {
  online: { label: "Operational", icon: Check, color: "text-emerald-500" },
  unknown: { label: "Pending", icon: Clock3, color: "text-muted-foreground" },
  offline: { label: "Offline", icon: WifiOff, color: "text-red-500" },
  timed_out: { label: "Timed out", icon: Clock3, color: "text-red-500" },
  http_error: {
    label: "HTTP error",
    icon: AlertTriangle,
    color: "text-red-500",
  },
  http3_error: {
    label: "HTTP/3 error",
    icon: ShieldAlert,
    color: "text-red-500",
  },
};

function ServiceRow({
  service,
  index,
  max,
}: {
  service: Service;
  index: number;
  max: number;
}) {
  const details = statusDetails[service.status];
  const Icon = details.icon;
  return (
    <div
      className={cn(
        "px-4 flex items-center justify-between py-2 min-w-80 md:min-w-130",
        index < max - 1
          ? "border-border border-b border-[#C5CED6] dark:border-[#242D38]"
          : "",
      )}
    >
      <div className="min-w-0">
        <a
          href={service.url}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-1.5 font-medium hover:underline"
        >
          <span className="truncate">{service.name}</span>
          <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </a>
        <p className="mt-1 truncate text-xs max-w-40 md:max-w-80 text-muted-foreground">
          {service.error ??
            (service.latencyMs !== null
              ? `${service.latencyMs} ms${service.checkHttp3 ? " (HTTP/3 verified)" : ""}`
              : new URL(service.url).hostname)}
        </p>
      </div>
      <div
        className={`flex items-center gap-2 text-xs font-medium ${details.color}`}
      >
        <Icon className="size-4" />
        {details.label}
        {service.statusCode && service.status === "http_error"
          ? ` ${service.statusCode}`
          : ""}
      </div>
    </div>
  );
}
