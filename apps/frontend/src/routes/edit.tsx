import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@methanium/ui";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Check, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import type { Incident, Severity } from "../status";
import { formatTime } from "../utils";

export const Route = createFileRoute("/edit")({
  beforeLoad: async () => {
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      if (response.status !== 204) throw notFound();
    } catch {
      throw notFound();
    }
  },
  component: IncidentEditor,
});

const severityLabels: Record<Severity, string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical",
};

function IncidentEditor() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const response = await fetch("/api/incidents", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}`);
      }
      setIncidents((await response.json()) as Incident[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);
    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: data.get("title"),
          message: data.get("message"),
          severity: data.get("severity"),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(
          body.error ?? `Request failed with HTTP ${response.status}`,
        );
      }
      form.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function resolve(id: string) {
    try {
      const response = await fetch(`/api/incidents/${id}/resolve`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}`);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function deleteIncident(id: string) {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/incidents/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}`);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingId(null);
    }
  }

  const active = incidents.filter((incident) => !incident.resolvedAt);
  const resolved = incidents
    .filter((incident) => incident.resolvedAt)
    .toReversed();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="flex items-center gap-3">
        <ShieldAlert className="size-7" />
        <h1 className="text-xl font-medium">Incident management</h1>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <form
          onSubmit={create}
          className="rounded-xl border border-[#C5CED6] bg-[#EDF1F4] p-4 dark:border-[#242D38] dark:bg-[#242D38]"
        >
          <h2 className="font-medium">Create incident</h2>

          <Label className="mt-5 block text-sm" htmlFor="title">
            Title
          </Label>
          <Input
            required
            id="title"
            name="title"
            maxLength={120}
            className="mt-2 w-full"
          />

          <Label className="mt-4 block text-sm" htmlFor="message">
            Message
          </Label>
          <Textarea
            required
            id="message"
            name="message"
            maxLength={2000}
            rows={6}
            className="py-2"
          />

          <Label className="mt-4 block text-sm" htmlFor="severity">
            Severity
          </Label>
          <Select name="severity" defaultValue="minor">
            <SelectTrigger id="severity" className="mt-2 w-full">
              <SelectValue>
                {(value) => severityLabels[value as Severity]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="border!">
              <SelectItem value="minor">Minor</SelectItem>
              <SelectItem value="major">Major</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>

          <Button type="submit" disabled={submitting} className="mt-5 w-full">
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Publish incident
          </Button>
        </form>

        <section aria-labelledby="active-incidents">
          <div className="mb-4 flex items-baseline gap-2">
            <h2 id="active-incidents" className="font-medium">
              Active incidents
            </h2>
            <span className="text-sm text-muted-foreground">
              {active.length}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {loading && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading incidents
              </div>
            )}
            {!loading && active.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#C5CED6] px-4 py-10 text-center text-sm text-muted-foreground dark:border-[#445161]">
                No active incidents
              </div>
            )}
            {active.map((incident) => (
              <article
                key={incident.id}
                className="rounded-xl border border-[#C5CED6] bg-[#EDF1F4] dark:border-[#242D38] dark:bg-[#242D38]"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-medium [overflow-wrap:anywhere]">
                        {incident.title}
                      </h3>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void resolve(incident.id)}
                    >
                      <Check className="size-4" />
                      Resolve
                    </Button>
                  </div>
                  <IncidentExcerpt
                    incident={incident}
                    lines={3}
                    className="mt-3"
                  />
                </div>
                <div className="flex gap-2 border-t border-[#C5CED6] px-4 py-2 text-xs text-muted-foreground dark:border-[#445161]">
                  <span className="capitalize">{incident.severity}</span>
                  <span>Started {formatTime(incident.createdAt)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {resolved.length > 0 && (
        <section aria-labelledby="resolved-incidents">
          <div className="mb-4 flex items-baseline gap-2">
            <h2 id="resolved-incidents" className="font-medium">
              Resolved
            </h2>
            <span className="text-sm text-muted-foreground">
              {resolved.length}
            </span>
          </div>
          <div className="divide-y divide-[#C5CED6] border-y border-[#C5CED6] dark:divide-[#445161] dark:border-[#445161]">
            {resolved.map((incident) => (
              <div
                key={incident.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {incident.title}
                  </p>
                  <IncidentExcerpt incident={incident} lines={1} />
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <p className="text-xs text-muted-foreground">
                    {formatTime(incident.resolvedAt!)}
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={deletingId === incident.id}
                    onClick={() => void deleteIncident(incident.id)}
                  >
                    {deletingId === incident.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function IncidentExcerpt({
  incident,
  lines,
  className,
}: {
  incident: Incident;
  lines: 1 | 3;
  className?: string;
}) {
  const messageRef = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const message = messageRef.current;
    if (!message) return;

    const update = () =>
      setTruncated(
        message.scrollHeight > message.clientHeight + 1 ||
          message.scrollWidth > message.clientWidth + 1,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(message);
    return () => observer.disconnect();
  }, [incident.message]);

  const severity =
    incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1);

  return (
    <div className={cn("min-w-0", className)}>
      <p
        ref={messageRef}
        className={cn(
          "text-sm text-muted-foreground [overflow-wrap:anywhere]",
          lines === 1 ? "truncate" : "line-clamp-3 whitespace-pre-wrap",
        )}
      >
        {incident.message}
      </p>
      {truncated && (
        <Dialog>
          <DialogTrigger
            render={
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 py-0"
              >
                Read more
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{incident.title}</DialogTitle>
              <DialogDescription>
                {severity} incident started {formatTime(incident.createdAt)}
                {incident.resolvedAt &&
                  ` and resolved ${formatTime(incident.resolvedAt)}`}
              </DialogDescription>
            </DialogHeader>
            <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
              {incident.message}
            </p>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
