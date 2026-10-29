import React, { useState, useEffect, useRef } from "react";
import type {
  Furniture,
  Agent,
  Task,
  Note,
  Workspace,
  Snapshot,
  User,
  Detail,
  ProviderLogin,
  Connections,
  Modal,
} from "../shared/types";
import { api } from "../shared/api";
export function useOfficeController() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [spaces, setSpaces] = useState<Workspace[]>([]),
    [wid, setWid] = useState(""),
    [data, setData] = useState<Snapshot | null>(null),
    [page, setPage] = useState("office"),
    [edit, setEdit] = useState(false),
    [items, setItems] = useState<Furniture[]>([]),
    [tool, setTool] = useState("desk"),
    [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [connections, setConnections] = useState<Connections | null>(null),
    [users, setUsers] = useState<User[]>([]),
    [members, setMembers] = useState<any[]>([]),
    [trash, setTrash] = useState<Record<string, any[]>>({}),
    [spaceTrash, setSpaceTrash] = useState<any[]>([]);
  const active = useRef("");
  active.current = wid;
  const role = spaces.find((w) => w.id === wid)?.role;
  const canWrite = role !== "viewer" && !!wid;
  const canManage = role === "owner" || role === "super_admin";
  const [loginCodes, setLoginCodes] = useState<Record<string, string>>({});
  async function run(f: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadSpaces() {
    const s = await api<Workspace[]>("/workspaces");
    setSpaces(s);
    const next = s.some((w) => w.id === active.current)
      ? active.current
      : (s[0]?.id ?? "");
    active.current = next;
    setWid(next);
    return s;
  }
  async function refresh() {
    const id = active.current;
    if (!id) return;
    const d = await api<Snapshot>("/workspaces/" + id);
    if (active.current === id) {
      setData(d);
      if (!edit) setItems(d.layout.items);
    }
  }
  async function extras() {
    setConnections(await api<Connections>("/connections"));
    if (page === "settings") {
      if (user?.is_super_admin) setUsers(await api<User[]>("/admin/users"));
      if (active.current && canManage)
        setMembers(await api<any[]>(`/workspaces/${active.current}/members`));
    }
    if (page === "trash") {
      setSpaceTrash(await api<any[]>("/trash"));
      setTrash(
        active.current
          ? await api<Record<string, any[]>>(
              `/workspaces/${active.current}/trash`,
            )
          : {},
      );
    }
  }
  async function after() {
    await loadSpaces();
    await refresh();
    await extras();
    if (detail) {
      try {
        setDetail(
          await api<Detail>(`/workspaces/${wid}/tasks/${detail.task.id}`),
        );
      } catch {
        setDetail(null);
      }
    }
  }
  useEffect(() => {
    api<User>("/auth/me")
      .then(async (u) => {
        setUser(u);
        await loadSpaces();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    setData(null);
    setEdit(false);
    setQuery("");
    setDetail(null);
    if (wid)
      api<Snapshot>("/workspaces/" + wid)
        .then((d) => {
          if (active.current === wid) {
            setData(d);
            setItems(d.layout.items);
          }
        })
        .catch((e) => setError(e.message));
  }, [wid]);
  useEffect(() => {
    if (user) run(extras);
  }, [user?.id, page, wid, role]);
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      if (!edit) {
        refresh().catch(() => {});
        api<Connections>("/connections")
          .then(setConnections)
          .catch(() => {});
        if (detail)
          api<Detail>(`/workspaces/${wid}/tasks/${detail.task.id}`)
            .then(setDetail)
            .catch(() => {});
      }
    }, 3000);
    return () => clearInterval(t);
  }, [user?.id, wid, edit, detail?.task.id]);
  const dirty =
    edit && JSON.stringify(items) !== JSON.stringify(data?.layout.items ?? []);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  async function remove(kind: string, value: any) {
    const path =
      kind === "workspace"
        ? `/workspaces/${value.id}`
        : kind === "user"
          ? `/admin/users/${value.id}`
          : `/workspaces/${wid}/${kind}/${value.id}`;
    await api(path, undefined, "DELETE");
    setModal(null);
    if (kind === "tasks") setDetail(null);
    await after();
    setMessage("ย้ายไปถังขยะแล้ว สามารถกู้คืนได้");
  }
  async function start(t: Task) {
    const c = connections?.settings.find((c) => c.provider === t.provider);
    if (!c?.enabled || !c.billing_acknowledged) {
      setPage("settings");
      setDetail(null);
      setError("เปิดการเชื่อมต่อและยืนยันการปิดเครดิตเพิ่มเติมก่อนเริ่มงาน");
      return;
    }
    await api(`/workspaces/${wid}/tasks/${t.id}/run`, {
      billing_acknowledged: true,
    });
    await after();
    setMessage("ส่งคำขอเริ่มงานแล้ว Worker จะตรวจ Login ก่อนทำงาน");
  }
  async function showTask(t: Task) {
    setDetail(await api<Detail>(`/workspaces/${wid}/tasks/${t.id}`));
  }
  const fixture = connections?.workers.some(
    (w) => w.online && w.mode === "fixture",
  );
  const online = connections?.workers.some((w) => w.online);
  const connected = connections?.workers.some(
    (w) => w.online && Object.values(w.providers).some((p) => p.authenticated),
  );
  return {
    user,
    setUser,
    loading,
    setLoading,
    error,
    setError,
    busy,
    setBusy,
    message,
    setMessage,
    spaces,
    setSpaces,
    wid,
    setWid,
    data,
    setData,
    page,
    setPage,
    edit,
    setEdit,
    items,
    setItems,
    tool,
    setTool,
    query,
    setQuery,
    modal,
    setModal,
    detail,
    setDetail,
    connections,
    setConnections,
    users,
    setUsers,
    members,
    setMembers,
    trash,
    setTrash,
    spaceTrash,
    setSpaceTrash,
    loginCodes,
    setLoginCodes,
    active,
    role,
    canWrite,
    canManage,
    dirty,
    fixture,
    online,
    connected,
    run,
    loadSpaces,
    refresh,
    extras,
    after,
    remove,
    start,
    showTask,
  };
}
export type OfficeController = ReturnType<typeof useOfficeController>;
