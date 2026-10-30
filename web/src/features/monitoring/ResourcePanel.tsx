import React, { useEffect, useState } from "react";
import {
  bytes,
  pct,
  type ResourceController,
  type ResourceSettings,
  type NodeStats,
} from "./useResourceMonitor";
import "./monitoring.css";
const labels: Record<string, string> = {
  vm_cpu: "CPU ของ Docker VM",
  vm_memory: "หน่วยความจำ Docker VM",
  data_disk: "พื้นที่เก็บผลงาน",
  backup_disk: "พื้นที่เก็บไฟล์สำรอง",
  app_memory: "หน่วยความจำเว็บ",
  redis_memory: "งบหน่วยความจำ Redis",
  worker_memory: "หน่วยความจำของแต่ละ Worker",
};
function Gauge({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null | undefined;
  detail: string;
}) {
  return (
    <article className="resource-card">
      <h3>{label}</h3>
      <strong>{pct(value)}</strong>
      <progress
        aria-label={label}
        max={100}
        value={typeof value === "number" ? value : undefined}
      />
      <p>{detail}</p>
    </article>
  );
}
function Node({
  name,
  node,
  online,
}: {
  name: string;
  node: NodeStats | undefined | null;
  online: boolean;
}) {
  return (
    <article className="resource-node">
      <h3>
        {name} · {online ? "ออนไลน์" : "ข้อมูลเก่าหรือออฟไลน์"}
      </h3>
      <p>
        CPU {online ? pct(node?.cpu_percent) : "ไม่มีข้อมูลปัจจุบัน"} ·
        เพดานที่มองเห็น {node?.cpu_limit_cores ?? "—"} cores
      </p>
      <p>
        หน่วยความจำ{" "}
        {online ? bytes(node?.memory_used_bytes) : "ไม่มีข้อมูลปัจจุบัน"} /{" "}
        {bytes(node?.memory_limit_bytes)} · {node?.memory_limit_explicit ? "เหลือในงบ" : "VM ยังใช้ได้อีก"}{" "}
        {online ? bytes(node?.memory_remaining_bytes) : "—"}
      </p>
      <small>
        {typeof node?.memory_used_bytes !== "number"
          ? "ยังไม่มีข้อมูลตัววัดจากคอนเทนเนอร์นี้"
          : node?.memory_limit_explicit
            ? "เพดานหน่วยความจำของคอนเทนเนอร์"
            : "ไม่มีเพดานเฉพาะ ใช้ RAM ของ Docker VM เป็นฐาน"}{" "}
        · ตัวเลขคอนเทนเนอร์รวม cache และงบไม่ใช่การจอง RAM
      </small>
    </article>
  );
}
export function ResourcePanel({ monitor: m }: { monitor: ResourceController }) {
  const [draft, setDraft] = useState<ResourceSettings | null>(null),
    [version, setVersion] = useState(0),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const data = m.data,
    s = data?.state?.sample;
  useEffect(() => {
    if (data && !dirty) {
      setDraft(structuredClone(data.config.settings));
      setVersion(data.config.version);
    }
  }, [data?.config.version, dirty]);
  function reset() {
    if (data) {
      setDraft(structuredClone(data.config.settings));
      setVersion(data.config.version);
      setDirty(false);
      setMessage("");
    }
  }
  return (
    <section className="panel resource-panel">
      <h2>ทรัพยากรระบบและเกณฑ์แจ้งเตือน</h2>
      <p>
        อัปเดตทุก 5 วินาที · วัด Docker Linux VM และคอนเทนเนอร์ ไม่ใช่
        RAM/CPU/SSD ทั้งเครื่อง macOS · ทรัพยากร VM ใช้ร่วมกับคอนเทนเนอร์อื่น
      </p>
      <p role="status" className={m.stale ? "resource-stale" : ""}>
        {m.stale ? "กำลังรอข้อมูล / ข้อมูลล่าสุดอาจเก่า" : "ข้อมูลพร้อมใช้งาน"}
        {data?.state
          ? ` · อัปเดต ${new Date(data.state.collected_at).toLocaleTimeString("th-TH")}`
          : ""}
      </p>
      {s && (
        <>
          <div className="resource-cards">
            <Gauge
              label="CPU Docker VM ที่ใช้"
              value={s.vm.cpu_percent}
              detail={`เหลือประมาณ ${pct(typeof s.vm.cpu_percent === "number" ? 100 - s.vm.cpu_percent : null)} · ${s.vm.cpu_count} cores ใช้ร่วมกัน`}
            />
            <Gauge
              label="หน่วยความจำ Docker VM ที่ใช้"
              value={s.vm.memory_percent}
              detail={`ใช้ ${bytes(s.vm.memory_used_bytes)} / ${bytes(s.vm.memory_total_bytes)} · ใช้ได้อีก ${bytes(s.vm.memory_available_bytes)}`}
            />
            <Gauge
              label="พื้นที่เก็บผลงานที่ใช้"
              value={s.data_disk?.used_percent}
              detail={`ใช้ ${bytes(s.data_disk?.used_bytes)} / ${bytes(s.data_disk?.total_bytes)} · เขียนได้อีก ${bytes(s.data_disk?.available_bytes)}`}
            />
            <Gauge
              label="งบหน่วยความจำ Redis ที่ใช้"
              value={s.redis?.percent}
              detail={`ใช้ ${bytes(s.redis?.used_bytes)} / ${bytes(s.redis?.limit_bytes)} · เหลือ ${bytes(s.redis?.remaining_bytes)}`}
            />
          </div>
          <p>
            ฐานข้อมูล PostgreSQL มีขนาด {bytes(s.postgres_database_bytes)} ·{" "}
            {s.disks_share_filesystem
              ? "ผลงานกับไฟล์สำรองอยู่บน filesystem เดียวกัน จึงไม่นำความจุมาบวกซ้ำ"
              : `พื้นที่สำรองเขียนได้อีก ${bytes(s.backup_disk?.available_bytes)}`}
          </p>
          <details>
            <summary>รายละเอียดเว็บ Worker และบริการสำรอง</summary>
            <div className="resource-nodes">
              <Node name="เว็บ" node={s.app} online={!m.stale} />
              {s.backup_service && (
                <Node
                  name="บริการสำรอง"
                  node={s.backup_service.resources}
                  online={!m.stale && s.backup_service.online}
                />
              )}
              {s.workers.map((w) => (
                <Node
                  key={w.id}
                  name={`Worker ${w.id}`}
                  node={w.resources}
                  online={!m.stale && w.online}
                />
              ))}
            </div>
            {!s.worker_inventory_available && (
              <p>ข้อมูลรายชื่อ Worker ยังไม่พร้อม</p>
            )}
          </details>
        </>
      )}
      <hr />
      <h3>ตั้งเกณฑ์แจ้งเตือน</h3>
      <p>
        ใช้เปอร์เซ็นต์ที่ใช้ไป เมื่อเกินเกณฑ์ต่อเนื่องจึงเตือนหนึ่งครั้ง
        และแจ้งอีกครั้งเมื่อกลับต่ำกว่าเกณฑ์เผื่อ
        การอ่านแจ้งเตือนไม่ได้เปลี่ยนสถานะทรัพยากร
      </p>
      {draft && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              await m.save(version, draft);
              setDirty(false);
              setMessage("บันทึกเกณฑ์แล้ว");
            } catch {
              setMessage(
                "บันทึกไม่ได้ อาจมีผู้ดูแลแก้ไขพร้อมกัน กรุณาโหลดค่าล่าสุดก่อนลองใหม่",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="resource-rule-grid">
            {Object.keys(labels)
              .map((key) => [key, draft.rules[key]] as const)
              .map(([key, r]) => (
                <div className="resource-rule" key={key}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => {
                        setDirty(true);
                        setDraft({
                          ...draft,
                          rules: {
                            ...draft.rules,
                            [key]: { ...r, enabled: e.target.checked },
                          },
                        });
                      }}
                    />
                    {labels[key] || key}
                  </label>
                  <label>
                    เตือนเมื่อใช้ถึง (%)
                    <input
                      type="number"
                      min={1}
                      max={99}
                      step="0.1"
                      required
                      aria-label={`เกณฑ์ ${labels[key] || key}`}
                      value={r.threshold_percent}
                      disabled={!r.enabled}
                      onChange={(e) => {
                        setDirty(true);
                        setDraft({
                          ...draft,
                          rules: {
                            ...draft.rules,
                            [key]: {
                              ...r,
                              threshold_percent: Number(e.target.value),
                            },
                          },
                        });
                      }}
                    />
                  </label>
                </div>
              ))}
          </div>
          <div className="resource-rule-timing">
            <label>
              ต้องเกินต่อเนื่อง (วินาที)
              <input
                type="number"
                required
                min={5}
                max={300}
                step={1}
                value={draft.hold_seconds}
                onChange={(e) => {
                  setDirty(true);
                  setDraft({ ...draft, hold_seconds: Number(e.target.value) });
                }}
              />
            </label>
            <label>
              ระยะเผื่อกลับปกติ (จุดเปอร์เซ็นต์)
              <input
                type="number"
                required
                min={1}
                max={20}
                step="0.1"
                value={draft.recovery_margin}
                onChange={(e) => {
                  setDirty(true);
                  setDraft({
                    ...draft,
                    recovery_margin: Number(e.target.value),
                  });
                }}
              />
            </label>
          </div>
          {dirty && version !== data?.config.version && (
            <p role="alert">มีการแก้เกณฑ์จากที่อื่น กรุณาโหลดค่าล่าสุด</p>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !dirty || version !== data?.config.version}
            >
              บันทึกเกณฑ์แจ้งเตือน
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                reset();
                m.refresh();
              }}
            >
              โหลดเกณฑ์ล่าสุด
            </button>
          </div>
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </section>
  );
}
