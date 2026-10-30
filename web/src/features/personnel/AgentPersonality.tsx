import React from "react";
import type { Agent } from "../../shared/types";
export function AgentPersonality({ agent }: { agent?: Agent }) {
  const p = agent?.personality;
  return (
    <section className="personality-summary">
      <p className="form-section-help">
        บุคลิกตัวละคร AI สมมติที่ใช้ราศีเป็นธีม ไม่ใช่การคำนวณลัคนา
        และไม่ใช้ราศีเป็นเกณฑ์คัดเลือก
      </p>
      {p ? (
        <>
          <h3>บุคลิกที่บันทึกไว้ · {p.zodiac_name}</h3>
          <p>
            วันเกิด: {p.birth_date} · Master v{p.master_version}
          </p>
          <div className="personality-tags">
            {p.traits.map((t) => (
              <span key={t.id} className="tag">
                {t.name}
              </span>
            ))}
          </div>
          <details>
            <summary>วิธีทำงานและจุดที่ต้องระวัง</summary>
            {p.traits.map((t) => (
              <div key={t.id}>
                <b>{t.name}</b>
                <p>{t.instructions}</p>
                <small>{t.caution}</small>
              </div>
            ))}
          </details>
        </>
      ) : (
        <p>
          บันทึกวันเกิดเพื่อสร้างบุคลิกประจำตัว
          ระบบจะเก็บผลไว้และไม่สุ่มใหม่เมื่อเปิดเครื่อง
        </p>
      )}
      <small>
        เมื่อแก้วันเกิด ระบบจะคำนวณใหม่ตอนบันทึก
        งานที่เริ่มแล้วใช้สำเนาบุคลิกเดิม
      </small>
    </section>
  );
}
export function SelectionRibbon({ agent }: { agent: Agent }) {
  return agent.selection_passed === false ? (
    <div className="selection-failed">
      <span className="selection-ribbon">ไม่ผ่านคัดเลือก</span>
      <p>{agent.selection_reason}</p>
    </div>
  ) : agent.selection_passed === true ? (
    <span className="tag selected-pass">ผ่านคัดเลือก</span>
  ) : null;
}
