import { FormTabs } from "../../shared/FormTabs";
import React, { useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { Agent } from "../../shared/types";
import type { OfficeController } from "../../application/useOfficeController";
import type { Skill, Organization } from "./types";
export function AgentOrganization({
  agent,
  ctx,
  org,
  skills,
  onClose,
  onSaved,
}: {
  agent: Agent;
  ctx: OfficeController;
  org: Organization;
  skills: Skill[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    version: agent.version,
    manager_id: agent.manager_id || null,
    department: agent.department || "",
    responsibilities: agent.responsibilities || "",
    decision_scope: agent.decision_scope || "",
    skills: org.bindings
      .filter((b) => b.agent_id === agent.id)
      .map((b) => ({ skill_id: b.skill_id, pinned_version: b.pinned_version })),
  });
  const [tab, setTab] = useState("role");
  const [versions, setVersions] = useState<Record<string, Skill[]>>({});
  useEffect(() => {
    let live = true;
    Promise.all(
      form.skills.map(
        async (b) =>
          [
            b.skill_id,
            await api<Skill[]>(`/workspaces/${ctx.wid}/skills/${b.skill_id}`),
          ] as const,
      ),
    )
      .then((rows) => {
        if (live) setVersions(Object.fromEntries(rows));
      })
      .catch((e) => ctx.setError(String(e)));
    return () => {
      live = false;
    };
  }, []);
  const selected = (id: string) => form.skills.find((b) => b.skill_id === id);
  return (
    <div className="overlay">
      <section
        className="modal org-modal"
        role="dialog"
        aria-modal="true"
        aria-label="บทบาทและ Skill ของ Agent"
      >
        <button className="close" aria-label="ปิด" onClick={onClose}>
          ×
        </button>
        {ctx.error && (
          <p className="error" role="alert">
            {ctx.error}
          </p>
        )}
        <span className="eyebrow">AGENT PROFILE</span>
        <h2>{agent.name}</h2>
        <p>
          {agent.role} · {agent.provider}
        </p>
        <FormTabs
          label="บทบาท Agent"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "role", label: "หน้าที่และสายรายงาน" },
            { id: "skills", label: `Skills (${form.skills.length})` },
          ]}
        />
        <div hidden={tab !== "role"}>
          <details>
            <summary>คำสั่งประจำบทบาท</summary>
            <pre>{agent.instructions || "ยังไม่มีคำสั่ง"}</pre>
          </details>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ctx.run(async () => {
              await api(
                `/workspaces/${ctx.wid}/agents/${agent.id}/organization`,
                form,
                "PUT",
              );
              await onSaved();
              ctx.setMessage("บันทึกบทบาทและ Skill แล้ว");
            });
          }}
        >
          <fieldset disabled={!ctx.canManage || ctx.busy}>
            <div
              role="tabpanel"
              aria-label="หน้าที่และสายรายงาน"
              hidden={tab !== "role"}
            >
              <div className="org-fields">
                <label>
                  ฝ่าย / แผนก
                  <input
                    maxLength={100}
                    value={form.department}
                    onChange={(e) =>
                      setForm({ ...form, department: e.target.value })
                    }
                  />
                </label>
                <label>
                  รายงานต่อ
                  <select
                    value={form.manager_id || ""}
                    onChange={(e) =>
                      setForm({ ...form, manager_id: e.target.value || null })
                    }
                  >
                    <option value="">ไม่มีหัวหน้าในทีม</option>
                    {org.agents
                      .filter((a) => a.id !== agent.id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label>
                หน้าที่รับผิดชอบ
                <textarea
                  rows={5}
                  maxLength={10000}
                  value={form.responsibilities}
                  onChange={(e) =>
                    setForm({ ...form, responsibilities: e.target.value })
                  }
                />
              </label>
              <label>
                ขอบเขตการตัดสินใจ
                <textarea
                  rows={4}
                  maxLength={5000}
                  value={form.decision_scope}
                  onChange={(e) =>
                    setForm({ ...form, decision_scope: e.target.value })
                  }
                />
              </label>
            </div>
            <div
              role="tabpanel"
              aria-label="Skills ประจำ Agent"
              hidden={tab !== "skills"}
            >
              <h3>Skills ประจำ Agent ({form.skills.length}/8)</h3>
              <p>
                ติดตามล่าสุดสำหรับงานใหม่ หรือเลือกตรึงเวอร์ชัน
                งานที่เริ่มแล้วคงเวอร์ชันเดิม
              </p>
              {skills
                .filter((s) => !s.deleted_at || selected(s.id))
                .map((s) => (
                  <div className="org-skill-binding" key={s.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!selected(s.id)}
                        onChange={(e) => {
                          setForm({
                            ...form,
                            skills: e.target.checked
                              ? [
                                  ...form.skills,
                                  { skill_id: s.id, pinned_version: null },
                                ]
                              : form.skills.filter((b) => b.skill_id !== s.id),
                          });
                          if (e.target.checked)
                            ctx.run(async () => {
                              const rows = await api<Skill[]>(
                                `/workspaces/${ctx.wid}/skills/${s.id}`,
                              );
                              setVersions((v) => ({ ...v, [s.id]: rows }));
                            });
                        }}
                      />
                      {s.title}
                      {s.deleted_at && (
                        <small>
                          เก็บถาวร ·
                          ต้องยกเลิกการมอบหมายหรือกู้คืนก่อนเริ่มงานใหม่
                        </small>
                      )}
                    </label>
                    {selected(s.id) && (
                      <select
                        aria-label={`เวอร์ชัน ${s.title}`}
                        value={selected(s.id)?.pinned_version ?? "latest"}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            skills: form.skills.map((b) =>
                              b.skill_id === s.id
                                ? {
                                    ...b,
                                    pinned_version:
                                      e.target.value === "latest"
                                        ? null
                                        : Number(e.target.value),
                                  }
                                : b,
                            ),
                          })
                        }
                      >
                        <option value="latest">
                          ติดตามล่าสุด · v{s.version + 1}
                        </option>
                        {(versions[s.id] || [s]).map((v) => (
                          <option key={v.version} value={v.version}>
                            ตรึง v{v.version + 1}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              {!skills.length && (
                <p>ยังไม่มี Skill · สร้างใน Skill Library ก่อน</p>
              )}
            </div>
            {ctx.canManage && (
              <button className="primary">บันทึกบทบาทและ Skill</button>
            )}
          </fieldset>
        </form>
        {!ctx.canManage && (
          <p className="notice">
            เจ้าของ Workspace จัดการโครงสร้างทีมและ Skill ที่มอบหมายได้
          </p>
        )}
      </section>
    </div>
  );
}
