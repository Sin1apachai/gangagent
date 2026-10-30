import React, { useState } from "react";
import type { Room, Furniture, Agent } from "../../shared/types";
import { RoomEngine } from "./domain/RoomEngine";
import "./rooms.css";
export function RoomPanel({
  rooms,
  items,
  agents,
  edit,
  onChange,
}: {
  rooms: Room[];
  items: Furniture[];
  agents: Agent[];
  edit: boolean;
  onChange: (rooms: Room[]) => void;
}) {
  const [draft, setDraft] = useState<Room | null>(null),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState("");
  const change = (k: keyof Room, v: string | number) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  function add() {
    setError("");
    setConfirm("");
    setDraft({
      id: crypto.randomUUID(),
      name: "",
      department: "",
      purpose: "",
      x: 0,
      y: 0,
      width: 6,
      height: 5,
      door_side: "south",
      door_offset: 2,
    });
  }
  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const r = {
      ...draft,
      name: draft.name.trim(),
      department: draft.department.trim(),
      purpose: draft.purpose.trim(),
    };
    const next = rooms.some((v) => v.id === r.id)
      ? rooms.map((v) => (v.id === r.id ? r : v))
      : [...rooms, r];
    const err = new RoomEngine(next).validate(items);
    setError(err);
    if (!err) {
      onChange(next);
      setDraft(null);
    }
  }
  return (
    <section className="rooms-panel" aria-label="ห้องและฝ่าย">
      <div className="rooms-heading">
        <div>
          <h3>ห้องและฝ่าย</h3>
          <p>
            แบ่งพื้นที่ตามหน้าที่ เชื่อมฝ่ายด้วยชื่อเดียวกับ Org Chart ·{" "}
            {rooms.length} ห้อง
          </p>
        </div>
        {edit && (
          <button
            className="primary"
            onClick={add}
            disabled={rooms.length >= 20}
          >
            ＋ เพิ่มห้อง
          </button>
        )}
      </div>
      {!rooms.length && (
        <p className="room-empty">
          ยังไม่มีห้อง พื้นที่ทั้งหมดเป็นส่วนกลาง
          กดจัดห้องแล้วเพิ่มห้องเพื่อเริ่มแบ่งพื้นที่
        </p>
      )}
      <div className="room-cards">
        {rooms.map((r, n) => (
          <article key={r.id} className="room-card">
            <div className="room-card-title">
              <span className={"room-swatch room-color-" + (n % 4)} />
              <h4>{r.name}</h4>
            </div>
            <p>
              {r.department || "ห้องส่วนกลาง"} · {r.width} × {r.height} ช่อง
            </p>
            <p>{r.purpose || "ยังไม่ระบุหน้าที่"}</p>
            <small>
              {
                agents.filter(
                  (a) =>
                    a.enabled && new RoomEngine(rooms).assigned(a)?.id === r.id,
                ).length
              }{" "}
              Agent ประจำห้อง · จุดเริ่ม ({r.x + 1}, {r.y + 1})
            </small>
            {edit && (
              <div className="room-actions">
                <button
                  onClick={() => {
                    setDraft({ ...r });
                    setError("");
                    setConfirm("");
                  }}
                >
                  แก้ไข {r.name}
                </button>
                {confirm === r.id ? (
                  <>
                    <span>ลบเฉพาะผนังและข้อมูลห้อง เก็บเฟอร์นิเจอร์ไว้?</span>
                    <button
                      onClick={() => {
                        onChange(rooms.filter((v) => v.id !== r.id));
                        setConfirm("");
                        if (draft?.id === r.id) setDraft(null);
                      }}
                    >
                      ยืนยันลบห้อง
                    </button>
                    <button onClick={() => setConfirm("")}>ยกเลิก</button>
                  </>
                ) : (
                  <button onClick={() => setConfirm(r.id)}>ลบ {r.name}</button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {edit && draft && (
        <form className="room-form" onSubmit={apply}>
          <h4>
            {rooms.some((r) => r.id === draft.id) ? "แก้ไขห้อง" : "ห้องใหม่"}
          </h4>
          <p>
            พิกัดเริ่มจาก 1 · เว้นทางเดินหนึ่งช่องระหว่างห้อง
            และเว้นช่องประตูทั้งด้านใน/นอก ข้อมูลยังไม่บันทึกจนกด “บันทึกออฟฟิศ”
          </p>
          <div className="room-fields">
            <label>
              ชื่อห้อง
              <input
                required
                value={draft.name}
                onChange={(e) => change("name", e.target.value)}
              />
            </label>
            <label>
              ฝ่ายประจำห้อง
              <input
                list="office-departments"
                value={draft.department}
                onChange={(e) => change("department", e.target.value)}
                placeholder="เว้นว่างสำหรับห้องส่วนกลาง"
              />
            </label>
            <datalist id="office-departments">
              {[
                ...new Set(agents.map((a) => a.department).filter(Boolean)),
              ].map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <label className="room-wide">
              หน้าที่ของห้อง
              <textarea
                value={draft.purpose}
                onChange={(e) => change("purpose", e.target.value)}
                placeholder="เช่น พัฒนาและตรวจสอบซอฟต์แวร์"
              />
            </label>
            {(
              [
                ["x", "คอลัมน์เริ่มต้น", 1, 20],
                ["y", "แถวเริ่มต้น", 1, 12],
                ["width", "ความกว้าง (ช่อง)", 3, 20],
                ["height", "ความลึก (ช่อง)", 3, 12],
              ] as const
            ).map(([k, label, min, max]) => (
              <label key={k}>
                {label}
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  value={draft[k] + (["x", "y"].includes(k) ? 1 : 0)}
                  onChange={(e) =>
                    change(
                      k,
                      Number(e.target.value) - (["x", "y"].includes(k) ? 1 : 0),
                    )
                  }
                />
              </label>
            ))}
            <label>
              ผนังที่มีประตู
              <select
                value={draft.door_side}
                onChange={(e) => change("door_side", e.target.value)}
              >
                <option value="north">ด้านบน</option>
                <option value="south">ด้านล่าง</option>
                <option value="west">ด้านซ้าย</option>
                <option value="east">ด้านขวา</option>
              </select>
            </label>
            <label>
              ช่องประตูบนผนัง (เริ่มจาก 1)
              <input
                required
                type="number"
                min={1}
                max={
                  ["north", "south"].includes(draft.door_side)
                    ? draft.width
                    : draft.height
                }
                value={draft.door_offset + 1}
                onChange={(e) =>
                  change("door_offset", Number(e.target.value) - 1)
                }
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="room-error">
              {error}
            </p>
          )}
          <div className="room-actions">
            <button className="primary" type="submit">
              ใช้การแบ่งห้อง
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              ยกเลิกแก้ไขห้อง
            </button>
          </div>
        </form>
      )}
      <p className="muted">
        ห้องช่วยจัดตำแหน่งทีม ไม่ได้เปลี่ยนสิทธิ์เข้าถึงข้อมูลหรือ Workflow ·
        โหมดอัตโนมัติใช้ห้องตามฝ่าย หากไม่พบจะใช้ส่วนกลาง เลือกห้องเองได้ที่ Team ·
        เปลี่ยนฝ่ายได้ที่โครงสร้างทีม
      </p>
    </section>
  );
}
