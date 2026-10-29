import React, { useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
import { statusLabel } from "../../shared/constants";
type Project = {
  id: string;
  name: string;
  description: string;
  version: number;
  deleted_at: string | null;
};
type Step = {
  title: string;
  description: string;
  agent_id: string;
  depends_on: number[];
};
type Plan = {
  id: string;
  goal: string;
  status: string;
  steps: Step[];
  version: number;
  planner_task_id: string | null;
  created_by: string;
};
export function CollaborationPage({ ctx }: { ctx: OfficeController }) {
  const { wid, data, page, user, canWrite, run, busy, after, showTask } = ctx;
  const [projects, setProjects] = useState<Project[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [drafts, setDrafts] = useState<Record<string, Step[]>>({}),
    [approved, setApproved] = useState<Record<string, boolean>>({});
  async function load() {
    if (!wid) return;
    const [p, l] = await Promise.all([
      api<Project[]>(`/workspaces/${wid}/projects`),
      api<Plan[]>(`/workspaces/${wid}/plans`),
    ]);
    setProjects(p);
    setPlans(l);
  }
  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [wid]);
  if (!wid || !data || !user || !["projects", "plans"].includes(page))
    return null;
  const agents = data.agents.filter((a) => a.enabled);
  function edit(id: string, steps: Step[]) {
    setDrafts((d) => ({ ...d, [id]: steps }));
  }
  return (
    <>
      {page === "projects" && (
        <section className="panel">
          <h2>โปรเจกต์ใน {data.name}</h2>
          {canWrite && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = Object.fromEntries(new FormData(form));
                run(async () => {
                  await api(`/workspaces/${wid}/projects`, f);
                  form.reset();
                  await load();
                });
              }}
            >
              <label>
                ชื่อโปรเจกต์
                <input name="name" required maxLength={100} />
              </label>
              <label>
                รายละเอียด
                <textarea name="description" maxLength={5000} />
              </label>
              <button disabled={busy} className="primary">
                สร้างโปรเจกต์
              </button>
            </form>
          )}
          {projects.map((p) => (
            <form
              key={p.id}
              className="provider-box"
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                run(async () => {
                  await api(
                    `/workspaces/${wid}/projects/${p.id}`,
                    { ...f, version: p.version },
                    "PUT",
                  );
                  await load();
                });
              }}
            >
              <label>
                ชื่อ
                <input
                  name="name"
                  defaultValue={p.name}
                  key={p.name}
                  required
                  disabled={!canWrite || !!p.deleted_at}
                />
              </label>
              <label>
                รายละเอียด
                <textarea
                  name="description"
                  defaultValue={p.description}
                  key={p.description}
                  disabled={!canWrite || !!p.deleted_at}
                />
              </label>
              {canWrite && (
                <div className="actions">
                  {!p.deleted_at && <button disabled={busy}>บันทึก</button>}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(
                          `/workspaces/${wid}/projects/${p.id}${p.deleted_at ? "/restore" : ""}`,
                          p.deleted_at ? {} : undefined,
                          p.deleted_at ? "POST" : "DELETE",
                        );
                        await load();
                      })
                    }
                  >
                    {p.deleted_at ? "กู้คืน" : "ย้ายไปถังขยะ"}
                  </button>
                </div>
              )}
            </form>
          ))}
          {!projects.length && <p className="muted">ยังไม่มีโปรเจกต์</p>}
        </section>
      )}
      {page === "plans" && (
        <>
          <section className="panel">
            <h2>ให้ทีมช่วยกันทำเป้าหมาย</h2>
            <p>
              สร้างร่าง → ตรวจแผน → อนุมัติเริ่มทีม
              งานถัดไปจะรอให้งานที่เกี่ยวข้องผ่านการตรวจรับก่อน
            </p>
            {canWrite && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    f = new FormData(form);
                  run(async () => {
                    await api(`/workspaces/${wid}/plans`, {
                      goal: f.get("goal"),
                      manager_agent_id: f.get("manager") || null,
                      steps: [],
                    });
                    form.reset();
                    await load();
                    await after();
                  });
                }}
              >
                <label>
                  เป้าหมาย
                  <textarea name="goal" required maxLength={20000} />
                </label>
                <label>
                  ผู้จัดการเสนอแผน
                  <select name="manager">
                    <option value="">จัดแผนเอง</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.provider}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  สร้างร่างแผน
                </button>
                <p className="muted">
                  การสร้างร่างยังไม่เรียก AI หากเลือกผู้จัดการ
                  ระบบจะสร้างงานเสนอแผนให้คุณกดเริ่มเอง
                </p>
              </form>
            )}
          </section>
          {plans.map((p) => {
            const steps = drafts[p.id] ?? p.steps,
              editable =
                canWrite && p.created_by === user.id && p.status === "draft";
            return (
              <section key={p.id} className="panel">
                <div className="panel-heading">
                  <h3>{p.goal}</h3>
                  <span className="tag">
                    {p.status === "draft"
                      ? "ร่างแผน"
                      : p.status === "approved"
                        ? "อนุมัติแล้ว"
                        : "ยกเลิกแล้ว"}
                  </span>
                </div>
                {p.planner_task_id && (
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const d = await api<any>(
                            `/workspaces/${wid}/tasks/${p.planner_task_id}`,
                          );
                          ctx.setDetail(d);
                        })
                      }
                    >
                      เปิดงานเสนอแผน
                    </button>
                    {editable && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/workspaces/${wid}/plans/${p.id}/import`,
                              {},
                            );
                            setDrafts((d) => {
                              const n = { ...d };
                              delete n[p.id];
                              return n;
                            });
                            await load();
                          })
                        }
                      >
                        นำข้อเสนอ AI มาให้ตรวจ
                      </button>
                    )}
                  </div>
                )}
                <ol className="plan-steps">
                  {steps.map((s, index) => (
                    <li key={index}>
                      <label>
                        งานที่ {index + 1}
                        <input
                          value={s.title}
                          disabled={!editable}
                          maxLength={200}
                          onChange={(e) =>
                            edit(
                              p.id,
                              steps.map((v, n) =>
                                n === index
                                  ? { ...v, title: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        รายละเอียด / เกณฑ์ตรวจรับ
                        <textarea
                          value={s.description}
                          disabled={!editable}
                          onChange={(e) =>
                            edit(
                              p.id,
                              steps.map((v, n) =>
                                n === index
                                  ? { ...v, description: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        ผู้รับผิดชอบ
                        <select
                          value={s.agent_id}
                          disabled={!editable}
                          onChange={(e) =>
                            edit(
                              p.id,
                              steps.map((v, n) =>
                                n === index
                                  ? { ...v, agent_id: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        >
                          <option value="">เลือก Agent</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.provider}
                            </option>
                          ))}
                        </select>
                      </label>
                      {index > 0 && (
                        <fieldset>
                          <legend>รอผลตรวจรับจากงาน</legend>
                          {steps.slice(0, index).map((prior, n) => (
                            <label className="check" key={n}>
                              <input
                                type="checkbox"
                                checked={s.depends_on.includes(n)}
                                disabled={!editable}
                                onChange={(e) =>
                                  edit(
                                    p.id,
                                    steps.map((v, i) =>
                                      i === index
                                        ? {
                                            ...v,
                                            depends_on: e.target.checked
                                              ? [...v.depends_on, n]
                                              : v.depends_on.filter(
                                                  (x) => x !== n,
                                                ),
                                          }
                                        : v,
                                    ),
                                  )
                                }
                              />
                              {n + 1}. {prior.title || "ยังไม่ตั้งชื่อ"}
                            </label>
                          ))}
                        </fieldset>
                      )}
                    </li>
                  ))}
                </ol>
                {editable && (
                  <>
                    <div className="actions">
                      <button
                        disabled={busy || steps.length >= 8}
                        onClick={() =>
                          edit(p.id, [
                            ...steps,
                            {
                              title: "",
                              description: "",
                              agent_id: agents[0]?.id ?? "",
                              depends_on: steps.length
                                ? [steps.length - 1]
                                : [],
                            },
                          ])
                        }
                      >
                        เพิ่มขั้นตอน (สูงสุด 8)
                      </button>
                      <button
                        disabled={busy || !steps.length}
                        onClick={() => edit(p.id, steps.slice(0, -1))}
                      >
                        ลบขั้นตอนสุดท้าย
                      </button>
                      <button
                        disabled={busy || !steps.length}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/workspaces/${wid}/plans/${p.id}`,
                              { goal: p.goal, steps, version: p.version },
                              "PUT",
                            );
                            setDrafts((d) => {
                              const n = { ...d };
                              delete n[p.id];
                              return n;
                            });
                            await load();
                          })
                        }
                      >
                        บันทึกร่าง
                      </button>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!approved[p.id]}
                        onChange={(e) =>
                          setApproved((v) => ({
                            ...v,
                            [p.id]: e.target.checked,
                          }))
                        }
                      />
                      ฉันตรวจแผนแล้ว และอนุญาตให้ใช้โควตาสมาชิกตามงานในแผน
                    </label>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !approved[p.id] ||
                        !p.steps.length ||
                        !!drafts[p.id]
                      }
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/workspaces/${wid}/plans/${p.id}/approve`,
                            { version: p.version, billing_acknowledged: true },
                          );
                          await load();
                          await after();
                        })
                      }
                    >
                      อนุมัติและเริ่มทีม
                    </button>
                  </>
                )}
                {canWrite &&
                  p.created_by === user.id &&
                  p.status !== "cancelled" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/workspaces/${wid}/plans/${p.id}/cancel`,
                            {},
                          );
                          await load();
                          await after();
                        })
                      }
                    >
                      หยุดแผนนี้
                    </button>
                  )}
                <div className="list">
                  {data.tasks
                    .filter((t) => (t as any).plan_id === p.id)
                    .map((t) => (
                      <div className="list-row" key={t.id}>
                        <span>
                          {t.title} · {statusLabel[t.status]}
                          {t.status === "queued"
                            ? " · รอตรวจรับงานก่อนหน้าหรือรอเครื่อง"
                            : ""}
                        </span>
                        <button onClick={() => run(() => showTask(t))}>
                          เปิดงาน
                        </button>
                      </div>
                    ))}
                </div>
              </section>
            );
          })}
          {!plans.length && <p className="muted">ยังไม่มีแผนทีม</p>}
        </>
      )}
    </>
  );
}
