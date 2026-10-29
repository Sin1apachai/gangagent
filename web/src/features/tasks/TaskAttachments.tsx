import React, { useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
export function TaskAttachments({ ctx }: { ctx: OfficeController }) {
  const { detail, wid, canWrite, busy, run } = ctx;
  const [files, setFiles] = useState<
    { id: string; name: string; size: number }[]
  >([]);
  const id = detail?.task.id;
  async function load() {
    if (id) setFiles(await api(`/workspaces/${wid}/tasks/${id}/attachments`));
  }
  useEffect(() => {
    load().catch(() => {});
  }, [id, wid]);
  if (!detail) return null;
  const writable =
    canWrite &&
    detail.task.status !== "running" &&
    !detail.task.execution_requested;
  return (
    <section className="provider-box">
      <h3>ไฟล์อ้างอิง</h3>
      <p className="muted">
        สูงสุด 5 ไฟล์ ไฟล์ละ 1 MiB · ส่งให้ Agent เมื่อเริ่มงาน
      </p>
      {writable && (
        <label>
          เพิ่มไฟล์
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const input = e.currentTarget,
                file = input.files?.[0];
              if (!file) return;
              run(async () => {
                if (file.size > 1048576)
                  throw new Error("ไฟล์ต้องไม่เกิน 1 MiB");
                await api(`/workspaces/${wid}/tasks/${id}/attachments`, {
                  name: file.name,
                  data: Array.from(new Uint8Array(await file.arrayBuffer())),
                });
                input.value = "";
                await load();
              });
            }}
          />
        </label>
      )}
      {files.map((f) => (
        <div className="list-row" key={f.id}>
          <a
            href={`/api/workspaces/${wid}/tasks/${id}/attachments/${f.id}`}
            download={f.name}
          >
            {f.name} · {(f.size / 1024).toFixed(1)} KB ↓
          </a>
          {writable && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(
                    `/workspaces/${wid}/tasks/${id}/attachments/${f.id}`,
                    undefined,
                    "DELETE",
                  );
                  await load();
                })
              }
            >
              นำไฟล์ออก
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
