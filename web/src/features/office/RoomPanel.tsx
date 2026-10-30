import React from "react";
import type { Room, Furniture, Agent } from "../../shared/types";
import { RoomEngine } from "./domain/RoomEngine";
import "./rooms.css";
export function RoomPanel({
  rooms,
  agents,
}: {
  rooms: Room[];
  items: Furniture[];
  agents: Agent[];
  edit: boolean;
  onChange: (r: Room[]) => void;
}) {
  return (
    <section className="rooms-panel" aria-label="ห้องและฝ่าย">
      <div className="rooms-heading">
        <div>
          <h3>ห้องและฝ่าย</h3>
          <p>แบ่งพื้นที่ตามหน้าที่ · {rooms.length} ห้อง</p>
        </div>
      </div>
      {!rooms.length && (
        <p className="room-empty">
          ยังไม่มีห้อง กดจัดห้อง → ห้องและฝ่าย แล้วลากบนแผนที่เพื่อเริ่มสร้าง
        </p>
      )}
      <div className="room-cards">
        {rooms.map((r, n) => (
          <article key={r.id} className="room-card">
            <div className="room-card-title">
              <span className={"room-swatch room-color-" + (n % 4)} />
              <h4>{r.name}</h4>
            </div>
            <p>{r.department || "ห้องส่วนกลาง"}</p>
            <small>
              {
                agents.filter(
                  (a) =>
                    a.enabled && new RoomEngine(rooms).assigned(a)?.id === r.id,
                ).length
              }{" "}
              Agent ประจำห้อง
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
