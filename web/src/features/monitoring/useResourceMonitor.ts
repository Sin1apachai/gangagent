import { useEffect, useRef, useState } from "react";
import { api } from "../../shared/api";
export type Rule = { enabled: boolean; threshold_percent: number };
export type ResourceSettings = {
  hold_seconds: number;
  recovery_margin: number;
  rules: Record<string, Rule>;
};
export type NodeStats = {
  cpu_percent: number | null;
  cpu_limit_cores: number;
  memory_used_bytes: number | null;
  memory_limit_bytes: number | null;
  memory_remaining_bytes: number | null;
  memory_percent: number | null;
  memory_limit_explicit: boolean;
  pids_current: number | null;
  pids_limit: number | null;
};
export type DiskStats = {
  total_bytes: number;
  available_bytes: number;
  used_bytes: number;
  used_percent: number;
} | null;
export type Notice = {
  id: string;
  kind: "warning" | "recovery";
  label: string;
  value_percent: number | null;
  threshold_percent: number;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  read: boolean;
};
export type ResourceData = {
  config: { version: number; settings: ResourceSettings };
  state: {
    collected_at: string;
    stale: boolean;
    sample: {
      vm: {
        cpu_percent: number | null;
        cpu_count: number;
        memory_total_bytes: number | null;
        memory_available_bytes: number | null;
        memory_used_bytes: number | null;
        memory_percent: number | null;
      };
      app: NodeStats;
      data_disk: DiskStats;
      backup_disk: DiskStats;
      disks_share_filesystem: boolean;
      workers: {
        id: string;
        online: boolean;
        resources: NodeStats;
        observed_at: string;
      }[];
      backup_service: {
        online: boolean;
        resources: NodeStats;
        observed_at: string;
      } | null;
      worker_inventory_available: boolean;
      postgres_database_bytes: number | null;
      redis: {
        used_bytes: number | null;
        limit_bytes: number | null;
        remaining_bytes: number | null;
        percent: number | null;
      } | null;
    };
  } | null;
  notifications: Notice[];
  unread_count: number;
  active_count: number;
};
export function useResourceMonitor(userId: string | null) {
  const [data, setData] = useState<ResourceData | null>(null),
    [error, setError] = useState(false),
    [now, setNow] = useState(Date.now()),
    [toast, setToast] = useState<Notice | null>(null),
    [openRequest, setOpenRequest] = useState(0);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let live = true,
      busy = false;
    let pending: AbortController | null = null;
    const seen = new Set<string>();
    setData(null);
    setError(false);
    setToast(null);
    const fetchData = async () => {
      if (!userId || busy) return;
      busy = true;
      pending = new AbortController();
      const t = setTimeout(() => pending?.abort(), 6000);
      try {
        const r = await fetch("/api/admin/resources", {
          headers: { "X-Office-Client": "1" },
          signal: pending.signal,
        });
        if (!r.ok) throw new Error("unavailable");
        const next: ResourceData = await r.json();
        if (live) {
          setData(next);
          setError(false);
          const fresh = next.notifications.filter(
            (n) =>
              !seen.has(n.id) &&
              !n.read &&
              Date.now() - Date.parse(n.created_at) < 60000,
          );
          for (const n of next.notifications) seen.add(n.id);
          if (fresh.length) setToast(fresh[0]);
        }
      } catch {
        if (live) setError(true);
      } finally {
        clearTimeout(t);
        busy = false;
      }
    };
    refresh.current = fetchData;
    if (userId) fetchData();
    const timer = setInterval(() => {
      setNow(Date.now());
      fetchData();
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
      pending?.abort();
    };
  }, [userId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast?.id]);
  const stale =
    error ||
    !data?.state ||
    data.state.stale ||
    now - Date.parse(data.state.collected_at) > 20000;
  async function markRead(ids?: string[]) {
    await api(
      "/admin/resources/notifications/read",
      ids ? { ids } : { all: true },
    );
    setData((d) =>
      d
        ? {
            ...d,
            unread_count: ids
              ? Math.max(
                  0,
                  d.unread_count -
                    d.notifications.filter((n) => !n.read && ids.includes(n.id))
                      .length,
                )
              : 0,
            notifications: d.notifications.map((n) =>
              !ids || ids.includes(n.id) ? { ...n, read: true } : n,
            ),
          }
        : d,
    );
  }
  async function save(version: number, settings: ResourceSettings) {
    await api("/admin/resources/settings", { version, settings }, "PUT");
    await refresh.current();
  }
  return {
    data,
    error,
    stale,
    toast,
    dismissToast: () => setToast(null),
    markRead,
    save,
    refresh: () => refresh.current(),
    openRequest,
    openSettings: () => setOpenRequest((n) => n + 1),
  };
}
export type ResourceController = ReturnType<typeof useResourceMonitor>;
export function bytes(n: number | null | undefined) {
  if (typeof n !== "number") return "ไม่มีข้อมูล";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}
export function pct(n: number | null | undefined) {
  return typeof n === "number" ? `${n.toFixed(1)}%` : "ไม่มีข้อมูล";
}
export function noticeText(n: Notice) {
  if (n.reason === "rule_disabled") return `หยุดเตือน ${n.label} ตามการตั้งค่า`;
  if (n.kind === "recovery") return `${n.label} กลับต่ำกว่าเกณฑ์เตือนแล้ว`;
  return `${n.label} ใช้ ${pct(n.value_percent)} เกินเกณฑ์ ${pct(n.threshold_percent)}`;
}
