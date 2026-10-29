import React, { useState } from "react";
import { FormTabs } from "../../shared/FormTabs";
import type { Agent } from "../../shared/types";
import type { Step, Skill, Binding, Reviewer } from "./types";
import { emptyStep } from "./types";
export function StepEditor({
  steps,
  onChange,
  agents,
  skills,
  bindings,
  reviewers,
  disabled = false,
}: {
  steps: Step[];
  onChange: (s: Step[]) => void;
  agents: Agent[];
  skills: Skill[];
  bindings: Binding[];
  reviewers: Reviewer[];
  disabled?: boolean;
}) {
  const [activeStep, setActiveStep] = useState(0),
    [section, setSection] = useState("brief");
  const current = Math.min(activeStep, Math.max(0, steps.length - 1));
  const change = (i: number, patch: Partial<Step>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div
      className="workflow-steps"
      onInvalidCapture={(e) => {
        const input = e.target as HTMLInputElement;
        const parent = input.closest("[data-step]") as HTMLElement | null;
        setActiveStep(Number(parent?.dataset.step || 0));
        setSection("brief");
        requestAnimationFrame(() => input.focus());
      }}
    >
      <ol className="workflow-map" aria-label="ลำดับขั้นตอน">
        {steps.map((s, i) => (
          <li key={i}>
            <b>
              {i + 1}. {s.title || "ขั้นตอนใหม่"}
            </b>
            <small>
              {s.depends_on.length
                ? `รอขั้น ${s.depends_on.map((d) => d + 1).join(", ")} ผ่านตรวจรับ`
                : "เริ่มได้หลังอนุมัติแผน"}
            </small>
          </li>
        ))}
      </ol>
      <div className="workflow-step-nav" aria-label="เลือกขั้นตอนที่ต้องการแก้">
        {steps.map((s, i) => (
          <button
            type="button"
            key={i}
            aria-pressed={current === i}
            className={current === i ? "active" : ""}
            onClick={() => {
              setActiveStep(i);
              setSection("brief");
            }}
          >
            {i + 1}. {s.title || "ขั้นตอนใหม่"}
          </button>
        ))}
      </div>
      {steps.map((s, i) => (
        <fieldset
          data-step={i}
          hidden={i !== current}
          key={i}
          className="workflow-step"
        >
          <legend>ขั้นตอน {i + 1}</legend>
          <FormTabs
            label={`รายละเอียดขั้นตอน ${i + 1}`}
            value={section}
            onChange={setSection}
            tabs={[
              { id: "brief", label: "งานและผู้รับผิดชอบ" },
              { id: "delivery", label: "การส่งมอบ" },
              { id: "dependencies", label: "Skill และลำดับงาน" },
            ]}
          />
          <div
            role="tabpanel"
            aria-label="งานและผู้รับผิดชอบ"
            hidden={section !== "brief"}
          >
            <div className="org-fields">
              <label>
                ชื่องาน
                <input
                  disabled={disabled}
                  required
                  maxLength={200}
                  value={s.title}
                  onChange={(e) => change(i, { title: e.target.value })}
                />
              </label>
              <label>
                Agent ผู้รับผิดชอบ
                <select
                  disabled={disabled}
                  required
                  value={s.agent_id}
                  onChange={(e) =>
                    change(i, { agent_id: e.target.value, skill_ids: [] })
                  }
                >
                  <option value="">เลือก Agent</option>
                  {agents
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.role}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              รายละเอียด
              <textarea
                disabled={disabled}
                required
                value={s.description}
                maxLength={20000}
                onChange={(e) => change(i, { description: e.target.value })}
              />
            </label>
          </div>
          <div
            role="tabpanel"
            aria-label="การส่งมอบ"
            hidden={section !== "delivery"}
          >
            <div className="org-fields">
              <label>
                ข้อมูลที่ต้องได้รับ
                <textarea
                  disabled={disabled}
                  value={s.input_contract || ""}
                  maxLength={4000}
                  onChange={(e) =>
                    change(i, { input_contract: e.target.value })
                  }
                />
              </label>
              <label>
                ผลงานที่ต้องส่ง
                <textarea
                  disabled={disabled}
                  value={s.output_contract || ""}
                  maxLength={4000}
                  onChange={(e) =>
                    change(i, { output_contract: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              เกณฑ์ตรวจรับ
              <textarea
                disabled={disabled}
                value={s.acceptance_criteria || ""}
                maxLength={10000}
                onChange={(e) =>
                  change(i, { acceptance_criteria: e.target.value })
                }
              />
            </label>
            <div className="org-fields">
              <label>
                ไฟล์ที่ต้องมี (หนึ่งชื่อ/บรรทัด)
                <textarea
                  disabled={disabled}
                  placeholder="report.md"
                  value={(s.required_files || []).join("\n")}
                  onChange={(e) =>
                    change(i, {
                      required_files: e.target.value
                        .split("\n")
                        .filter(Boolean),
                    })
                  }
                />
                <small>
                  ใช้เส้นทางภายในผลงาน เช่น docs/report.md · สูงสุด 10 ไฟล์
                </small>
              </label>
              <label>
                ผู้ตรวจรับ
                <select
                  disabled={disabled}
                  value={s.reviewer_id || ""}
                  onChange={(e) =>
                    change(i, { reviewer_id: e.target.value || null })
                  }
                >
                  <option value="">ผู้อนุมัติแผน</option>
                  {reviewers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <small>เจ้าของ Workspace และ Super Admin ตรวจรับแทนได้</small>
              </label>
            </div>
          </div>
          <div
            role="tabpanel"
            aria-label="Skill และลำดับงาน"
            hidden={section !== "dependencies"}
          >
            <div className="org-choice">
              <b>Skill ที่จำเป็น</b>
              {skills
                .filter(
                  (k) =>
                    !k.deleted_at &&
                    bindings.some(
                      (b) => b.agent_id === s.agent_id && b.skill_id === k.id,
                    ),
                )
                .map((k) => (
                  <label key={k.id}>
                    <input
                      disabled={disabled}
                      type="checkbox"
                      checked={(s.skill_ids || []).includes(k.id)}
                      onChange={(e) =>
                        change(i, {
                          skill_ids: e.target.checked
                            ? [...(s.skill_ids || []), k.id]
                            : (s.skill_ids || []).filter((id) => id !== k.id),
                        })
                      }
                    />
                    {k.title}
                  </label>
                ))}
              {!bindings.some((b) => b.agent_id === s.agent_id) && (
                <small>กำหนด Skill ให้ Agent ในโครงสร้างทีมก่อน</small>
              )}
            </div>
            <div className="org-choice">
              <b>รอขั้นตอนก่อนหน้า</b>
              {steps.slice(0, i).map((prev, j) => (
                <label key={j}>
                  <input
                    disabled={disabled}
                    type="checkbox"
                    checked={s.depends_on.includes(j)}
                    onChange={(e) =>
                      change(i, {
                        depends_on: e.target.checked
                          ? [...s.depends_on, j]
                          : s.depends_on.filter((d) => d !== j),
                      })
                    }
                  />
                  {j + 1}. {prev.title || "ยังไม่มีชื่อ"}
                </label>
              ))}
              {i === 0 && <small>ขั้นแรกไม่มีงานที่ต้องรอ</small>}
            </div>
          </div>
          <button
            type="button"
            className="danger"
            disabled={disabled}
            onClick={() =>
              onChange(
                steps
                  .filter((_, j) => j !== i)
                  .map((x) => ({
                    ...x,
                    depends_on: x.depends_on
                      .filter((d) => d !== i)
                      .map((d) => (d > i ? d - 1 : d)),
                  })),
              )
            }
          >
            ลบขั้นตอน {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={disabled || steps.length >= 8}
        onClick={() => {
          setActiveStep(steps.length);
          setSection("brief");
          onChange([...steps, emptyStep()]);
        }}
      >
        ＋ เพิ่มขั้นตอน ({steps.length}/8)
      </button>
    </div>
  );
}
