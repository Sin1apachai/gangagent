import React, { useState } from "react";
import type { Agent, Room, Furniture } from "../../shared/types";
import { Office } from "./Office";
export function AgentRoomPicker({
  agent,
  rooms,
  items,
}: {
  agent?: Agent;
  rooms: Room[];
  items: Furniture[];
}) {
  const [value, setValue] = useState(
    agent?.office_placement === "room" && agent.office_room_id
      ? "room:" + agent.office_room_id
      : (agent?.office_placement ?? "auto"),
  );
  return (
    <section style={{ marginTop: 20 }} aria-label="ห้องประจำ Agent">
      <label>
        ห้องประจำ Agent
        <select
          name="agent_room"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="auto">จัดให้อัตโนมัติตามฝ่าย</option>
          <option value="common">พื้นที่ส่วนกลาง</option>
          {rooms.map((r) => (
            <option key={r.id} value={"room:" + r.id}>
              {r.name}
              {r.department ? " · " + r.department : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="form-section-help">
        {value === "auto"
          ? "ระบบเลือกห้องให้ตามฝ่ายในโครงสร้างทีม หากยังไม่มีห้องของฝ่ายจะใช้พื้นที่ส่วนกลาง"
          : value === "common"
            ? "ระบบเลือกจุดว่างในพื้นที่ส่วนกลางให้เอง"
            : "ระบบเลือกจุดว่างภายในห้องที่เลือกให้เอง"}{" "}
        ไม่ต้องกำหนดพิกัด
      </p>
      {rooms.length > 0 && (
        <details>
          <summary>เลือกห้องจากภาพแผนที่</summary>
          <p className="form-section-help">
            คลิกภายในห้องเพื่อเลือก หรือคลิกทางเดินเพื่อเลือกพื้นที่ส่วนกลาง
            แล้วกดบันทึก Agent
          </p>
          <Office
            items={items}
            rooms={rooms}
            edit={false}
            tool=""
            onChange={() => {}}
            onRoomPick={(r) => setValue(r ? "room:" + r.id : "common")}
          />
        </details>
      )}
    </section>
  );
}
