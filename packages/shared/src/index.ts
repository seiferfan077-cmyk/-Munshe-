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

export const STATUS_LABELS_AR: Record<BuildStatus, string> = {
  queued: "في الطابور",
  preparing: "بنجهز مشروعك...",
  installing: "بنثبت المتطلبات...",
  building: "بنبني التطبيق...",
  completed: "التطبيق خلص 🎉",
  failed: "حصلت مشكلة أثناء البناء",
  cancelled: "اتلغى البناء",
};
