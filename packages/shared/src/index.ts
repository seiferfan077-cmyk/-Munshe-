export const BUILD_STATUSES = [
  "queued",
  "preparing",
  "installing",
  "building",
  "completed",
  "failed",
  "cancelled",
] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export interface BuildSummary {
  id: string;
  projectName: string;
  status: BuildStatus;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
  artifactAvailable: boolean;
}

export interface BuildLogEntry {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

/** Accept only HTTPS links to a GitHub repository root, never arbitrary URLs. */
export function normalizePublicGitHubRepoUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  const match =
    /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/?$/.exec(
      url.pathname,
    );
  if (!match) return null;

  const [, owner, pathRepo] = match;
  if (!owner || !pathRepo) return null;
  const repo = pathRepo.replace(/\.git$/i, "");
  if (!repo || repo.endsWith(".")) return null;
  return `https://github.com/${owner}/${repo}.git`;
}

export const STATUS_LABELS_AR: Record<BuildStatus, string> = {
  queued: "في الطابور",
  preparing: "بنجهز مشروعك...",
  installing: "بنثبت المتطلبات...",
  building: "بنبني التطبيق...",
  completed: "التطبيق خلص 🎉",
  failed: "حصلت مشكلة أثناء البناء",
  cancelled: "اتلغى البناء",
};
