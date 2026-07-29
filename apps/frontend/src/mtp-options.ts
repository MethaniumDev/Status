import type { MTPClientOptions, MTPLogEvent } from "mtp";

const configuredUrl = import.meta.env.VITE_MTP_URL as string | undefined;
const configuredCertificateHash = import.meta.env.VITE_MTP_CERT_HASH as
  string | undefined;

function logMTP(event: MTPLogEvent) {
  const label = `[MTP] ${event.direction ?? "internal"} ${event.type}`;
  if (event.hint === "error") {
    console.error(label, event);
  } else if (event.hint === "warning") {
    console.warn(label, event);
  } else {
    console.info(label, event);
  }
}

export const mtpOptions: MTPClientOptions | null = location.pathname.startsWith(
  "/edit",
)
  ? null
  : {
      url: configuredUrl ?? `${location.origin}/mtp`,
      descriptor: "methanium-status-frontend",
      pings: false,
      logger: logMTP,
      serverCertificateHashes: configuredCertificateHash
        ? [configuredCertificateHash]
        : undefined,
    };
