import React, { useEffect, useRef, useState } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
import type { Workflow } from "../organization/types";
import { FormTabs } from "../../shared/FormTabs";
import { PersonnelNavigation } from "./PersonnelNavigation";
import "./personnel.css";
type Entry = {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  caution?: string;
  start?: number[];
  end?: number[];
  weight?: number;
};
type Master = {
  versions: { version: number; imported_at: string }[];
  basis: string;
  zodiac: Entry[];
  trait: Entry[];
  criterion: Entry[];
};
type Application = {
  id: string;
  plan_id: string;
  candidate_name: string;
  role_title: string;
  status: string;
  passed: boolean | null;
  reason: string;
  version: number;
  created_at: string;
  scores: { criterion_id: string; score: number; reason: string }[] | null;
};
const labels: Record<string, string> = {
  draft: "รออนุมัติแผน",
  evaluating: "กำลังประเมิน",
  awaiting_decision: "รอใช้ผลจาก Agent",
  passed: "ผ่าน",
  rejected: "ไม่ผ่าน",
  cancelled: "ยกเลิก",
};
export function PersonnelPage({ ctx }: { ctx: OfficeController }) {
  const { page, wid, data, run, busy, canManage } = ctx;
  const active = ["recruitment", "master"].includes(page);
  const [master, setMaster] = useState<Master | null>(null),
    [apps, setApps] = useState<Application[]>([]),
    [workflows, setWorkflows] = useState<Workflow[]>([]),
    [section, setSection] = useState("zodiac"),
    [creating, setCreating] = useState(false),
    [filter, setFilter] = useState("all");
  const sequence = useRef(0);
  async function load() {
    const n = ++sequence.current;
    const m = await api<Master>("/master-data");
    if (n !== sequence.current) return;
    setMaster(m);
    if (wid) {
      const [a, w] = await Promise.all([
        api<Application[]>(`/workspaces/${wid}/recruitment`),
        api<Workflow[]>(`/workspaces/${wid}/workflows`),
      ]);
      if (n !== sequence.current) return;
      setApps(a);
      setWorkflows(w);
    }
  }
  useEffect(() => {
    if (!active) return;
    setApps([]);
    setWorkflows([]);
    setCreating(false);
    load().catch((e) => ctx.setError(String(e)));
    const timer = setInterval(() => load().catch(() => {}), 10000);
    return () => {
      sequence.current++;
      clearInterval(timer);
    };
  }, [active, wid]);
  if (!active) return null;
  return (
    <div className="personnel-feature">
      <PersonnelNavigation ctx={ctx} />
      {page === "master" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">BUILT-IN MASTER DATA</span>
              <h2>ข้อมูลตั้งต้นที่ติดไปกับระบบ</h2>
            </div>
            <span className="tag">
              v{master?.versions.at(-1)?.version ?? "…"}
            </span>
          </div>
          <p>
            นำเข้าไฟล์ JSON อัตโนมัติครั้งแรก ตรวจเวอร์ชันเมื่อเริ่มระบบ
            ไม่เพิ่ม Workspace หรือ Agent ตัวอย่าง
          </p>
          <FormTabs
            label="หมวดข้อมูลพื้นฐาน"
            value={section}
            onChange={setSection}
            tabs={[
              { id: "zodiac", label: "ราศี" },
              { id: "trait", label: "บุคลิก" },
              { id: "criterion", label: "เกณฑ์คัดเลือก" },
              { id: "imports", label: "ประวัตินำเข้า" },
            ]}
          />
          {section === "imports" ? (
            <>
              <p>
                ไฟล์อยู่ใน server/master-data และฝังไปกับรุ่นแอป
                ประวัติที่นำเข้าแล้วไม่ถูกนำเข้าซ้ำ
              </p>
              {master?.versions.map((v) => (
                <p key={v.version}>
                  Master v{v.version} ·{" "}
                  {new Date(v.imported_at).toLocaleString("th-TH")}
                </p>
              ))}
            </>
          ) : (
            <>
              <p className="notice neutral">
                ชุดข้อมูลบุคลิกสมมติสำหรับตัวละคร AI ใช้ราศีเป็นธีม
                ไม่ใช่ลัคนาทางโหราศาสตร์หรือเกณฑ์ตัดสินบุคคลจริง
              </p>
              <div className="master-grid">
                {(
                  master?.[section as "zodiac" | "trait" | "criterion"] || []
                ).map((entry) => (
                  <article key={entry.id}>
                    <span className="eyebrow">{entry.id}</span>
                    <h3>{entry.name}</h3>
                    {entry.start && entry.end && (
                      <p>
                        {entry.start[1]}/{entry.start[0]} – {entry.end[1]}/
                        {entry.end[0]}
                      </p>
                    )}
                    <p>{entry.instructions || entry.description}</p>
                    {entry.caution && <small>ควรระวัง: {entry.caution}</small>}
                    {entry.weight && (
                      <span className="tag">น้ำหนัก {entry.weight}%</span>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          <section className="panel org-intro">
            <div>
              <span className="eyebrow">RECRUITMENT WORKFLOW</span>
              <h2>ให้ Agent ประเมินจากผลงาน</h2>
              <p>
                เลือกผู้สมัครและแม่แบบ งานทดลองอาจมอบหมายให้ผู้สมัครได้
                แต่ผู้ประเมินขั้นสุดท้ายต้องเป็นคนละ Agent
                ทุกงานต้องผ่านการตรวจรับก่อนนำผลมาใช้
              </p>
            </div>
            {canManage && wid && (
              <button className="primary" onClick={() => setCreating(true)}>
                ＋ เปิดรอบคัดเลือก
              </button>
            )}
          </section>
          <label>
            กรองผลคัดเลือก
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">ทุกสถานะ</option>
              {Object.entries(labels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="recruitment-list">
            {apps
              .filter((a) => filter === "all" || a.status === filter)
              .map((a) => (
                <article key={a.id} className="panel">
                  <div className="org-card-title">
                    <div>
                      <h3>{a.candidate_name}</h3>
                      <p>{a.role_title}</p>
                    </div>
                    <span
                      className={`tag ${a.passed === false ? "selected-reject" : ""}`}
                    >
                      {labels[a.status]}
                    </span>
                  </div>
                  {a.reason && <p className="preserve">เหตุผล: {a.reason}</p>}
                  {a.scores && (
                    <details>
                      <summary>คะแนนและหลักฐาน</summary>
                      {a.scores.map((s) => (
                        <p key={s.criterion_id}>
                          <b>
                            {master?.criterion.find(
                              (c) => c.id === s.criterion_id,
                            )?.name || s.criterion_id}{" "}
                            · {s.score}/100
                          </b>
                          <br />
                          {s.reason}
                        </p>
                      ))}
                    </details>
                  )}
                  <small>
                    {new Date(a.created_at).toLocaleString("th-TH")}
                  </small>
                  <div className="actions">
                    <button onClick={() => ctx.setPage("plans")}>
                      เปิดแผนคัดเลือก
                    </button>
                    {a.status === "awaiting_decision" && canManage && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/workspaces/${wid}/recruitment/${a.id}/decision`,
                              { version: a.version },
                            );
                            await load();
                            await ctx.refresh();
                            ctx.setMessage("นำผลคัดเลือกจาก Agent มาใช้แล้ว");
                          })
                        }
                      >
                        ใช้ผลคัดเลือกจาก Agent
                      </button>
                    )}
                  </div>
                </article>
              ))}
          </div>
          {!apps.length && (
            <section className="empty">
              <h3>ยังไม่มีรอบคัดเลือก</h3>
              <p>สร้าง Agent และ Workflow ก่อน แล้วเปิดรอบประเมินตามตำแหน่ง</p>
            </section>
          )}
          {creating && (
            <div className="overlay">
              <section
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label="เปิดรอบคัดเลือก"
              >
                <button
                  className="close"
                  aria-label="ปิด"
                  onClick={() => setCreating(false)}
                >
                  ×
                </button>
                <h2>เปิดรอบคัดเลือก</h2>
                {ctx.error && (
                  <p className="error" role="alert">
                    {ctx.error}
                  </p>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = Object.fromEntries(new FormData(e.currentTarget));
                    const w = workflows.find((w) => w.id === f.workflow_id);
                    run(async () => {
                      await api(`/workspaces/${wid}/recruitment`, {
                        ...f,
                        workflow_version: w?.version,
                      });
                      await load();
                      setCreating(false);
                      ctx.setMessage(
                        "สร้างแผนคัดเลือกฉบับร่างแล้ว ตรวจและอนุมัติในหน้าแผนทีม",
                      );
                    });
                  }}
                >
                  <label>
                    ผู้สมัคร
                    <select name="candidate_id" required>
                      <option value="">เลือก Agent</option>
                      {data?.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    ตำแหน่งที่คัดเลือก
                    <input name="role_title" required maxLength={200} />
                  </label>
                  <label>
                    Workflow คัดเลือก
                    <select name="workflow_id" required>
                      <option value="">เลือก Workflow</option>
                      {workflows
                        .filter((w) => !w.deleted_at)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.title} · v{w.version + 1}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    โจทย์งานทดลอง / เป้าหมาย
                    <textarea name="goal" required maxLength={5000} />
                  </label>
                  <p className="form-section-help">
                    ระบบจะเพิ่มรายงาน selection.json ในขั้นสุดท้าย
                    ราศีและวันเกิดไม่ใช่เกณฑ์ให้คะแนน ยังไม่เรียก AI
                    จนกว่าจะอนุมัติแผน
                  </p>
                  <button className="primary" disabled={busy}>
                    สร้างแผนคัดเลือก
                  </button>
                </form>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
