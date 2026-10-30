import React, { useEffect, useRef, useState } from "react";
import type { Room, Furniture, Agent } from "../../shared/types";
import { RoomEngine } from "./domain/RoomEngine";
import { RoomDraft, type Point } from "./domain/RoomDraft";
import { Office } from "./Office";
import "./rooms.css";
type Gesture = {
  kind: "draw" | "move" | "resize";
  start: Point;
  room: Room;
  corner?: string;
};
export function RoomBuilder({
  rooms,
  items,
  agents,
  onChange,
  onPendingChange,
}: {
  rooms: Room[];
  items: Furniture[];
  agents: Agent[];
  onChange: (r: Room[]) => void;
  onPendingChange: (v: boolean) => void;
}) {
  const [tool, setTool] = useState<"select" | "draw" | "door">(
      rooms.length ? "select" : "draw",
    ),
    [selected, setSelected] = useState(""),
    [pending, setPending] = useState<Room | null>(null),
    [preview, setPreview] = useState<Room | null>(null),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [revision, setRevision] = useState(0);
  const gesture = useRef<Gesture | null>(null),
    undo = useRef<Room[][]>([]),
    redo = useRef<Room[][]>([]);
  const current = pending ?? rooms.find((r) => r.id === selected);
  useEffect(() => {
    onPendingChange(!!pending);
    return () => onPendingChange(false);
  }, [!!pending]);
  function replace(r: Room) {
    return rooms.some((x) => x.id === r.id)
      ? rooms.map((x) => (x.id === r.id ? r : x))
      : [...rooms, r];
  }
  function validate(r: Room) {
    return new RoomEngine(replace(r)).validate(items);
  }
  function commit(next: Room[]) {
    undo.current.push(structuredClone(rooms));
    undo.current = undo.current.slice(-60);
    redo.current = [];
    onChange(next);
    setRevision((n) => n + 1);
    setError("");
  }
  function apply(r: Room) {
    const e = validate(r);
    if (e) {
      setError(e);
      return false;
    }
    commit(replace(r));
    setSelected(r.id);
    return true;
  }
  function history(back: boolean) {
    const source = back ? undo : redo,
      target = back ? redo : undo;
    const next = source.current.pop();
    if (next) {
      target.current.push(structuredClone(rooms));
      onChange(next);
      setSelected("");
      setPreview(null);
      setPending(null);
      setRevision((n) => n + 1);
      setError("");
    }
  }
  function switchTool(t: typeof tool) {
    gesture.current = null;
    setPreview(null);
    setPending(null);
    setTool(t);
    setError("");
    setConfirm(false);
  }
  function point(e: React.PointerEvent<SVGSVGElement>, snap = true) {
    const b = e.currentTarget.getBoundingClientRect();
    const p = {
      x: (((e.clientX - b.left) * 704) / b.width - 32) / 32,
      y: (((e.clientY - b.top) * 480) / b.height - 64) / 32,
    };
    return snap ? { x: Math.floor(p.x), y: Math.floor(p.y) } : p;
  }
  function inside(p: Point) {
    return p.x >= 0 && p.x < 20 && p.y >= 0 && p.y < 12;
  }
  function fresh(): Room {
    let n = 1;
    while (rooms.some((r) => r.name === `ห้อง ${n}`)) n++;
    return {
      id: crypto.randomUUID(),
      name: `ห้อง ${n}`,
      department: "",
      x: 0,
      y: 0,
      width: 3,
      height: 3,
      door_side: "south",
      door_offset: 1,
    };
  }
  function defaultDoor(r: Room) {
    for (const side of ["south", "north", "east", "west"] as const) {
      const n = ["north", "south"].includes(side) ? r.width : r.height;
      for (let offset = 0; offset < n; offset++) {
        const next = { ...r, door_side: side, door_offset: offset };
        if (!validate(next)) return next;
      }
    }
    return r;
  }
  function cancel() {
    gesture.current = null;
    setPending(null);
    setPreview(null);
    setTool("select");
    setError("");
  }
  function changeMeta(k: "name" | "department", value: string) {
    if (!current || pending) return;
    const r = {
      ...current,
      [k]: value.trim() || (k === "name" ? current.name : ""),
    };
    apply(r);
  }
  const shown = preview ?? pending;
  const invalid = shown ? validate(shown) : "";
  const overlay = (
    <svg
      className={"room-builder-overlay tool-" + tool}
      viewBox="0 0 704 480"
      role="application"
      aria-label="แผนที่สร้างห้อง ลากเพื่อกำหนดขอบ คลิกผนังเพื่อใส่ประตู"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          history(!e.shiftKey);
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const p = point(e);
        const corner = (e.target as SVGElement).getAttribute("data-corner");
        if (!inside(p) && !corner) return;
        setError("");
        setConfirm(false);
        if (pending || tool === "door") {
          const raw = point(e, false);
          const r =
            pending ??
            rooms.find((r) => {
              const d = RoomDraft.door(r, raw);
              return !!d;
            });
          if (!r) {
            setError("คลิกเส้นผนังห้องเพื่อวางประตู");
            return;
          }
          const next = RoomDraft.door(r, raw);
          if (!next) {
            setError("คลิกเส้นผนังห้องเพื่อวางประตู");
            return;
          }
          if (apply(next)) {
            setPending(null);
            setPreview(null);
            setTool("select");
          }
          return;
        }
        if (tool === "draw") {
          if (rooms.length >= 20) {
            setError("เพิ่มได้สูงสุด 20 ห้อง");
            return;
          }
          const r = RoomDraft.rectangle(p, p, fresh());
          gesture.current = { kind: "draw", start: p, room: r };
          setPreview(r);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        const r = corner
          ? rooms.find((r) => r.id === selected)
          : [...rooms].reverse().find((r) => RoomEngine.contains(r, p.x, p.y));
        setSelected(r?.id ?? "");
        if (r) {
          gesture.current = {
            kind: corner ? "resize" : "move",
            start: p,
            room: r,
            corner: corner ?? undefined,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        const g = gesture.current,
          p = point(e);
        if (g) {
          let r =
            g.kind === "draw"
              ? RoomDraft.rectangle(g.start, p, g.room)
              : g.kind === "move"
                ? RoomDraft.move(g.room, g.start, p)
                : RoomDraft.resizeBoundary(g.room, g.corner!, point(e, false));
          if (g.kind === "draw") r = defaultDoor(r);
          setPreview(r);
          return;
        }
        if (pending || tool === "door") {
          const raw = point(e, false);
          const r = pending ?? rooms.find((r) => !!RoomDraft.door(r, raw));
          setPreview(r ? RoomDraft.door(r, raw) : null);
        }
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g) return;
        gesture.current = null;
        const p = point(e);
        let r =
          g.kind === "draw"
            ? RoomDraft.rectangle(g.start, p, g.room)
            : g.kind === "move"
              ? RoomDraft.move(g.room, g.start, p)
              : RoomDraft.resizeBoundary(g.room, g.corner!, point(e, false));
        if (g.kind === "draw") r = defaultDoor(r);
        const err = validate(r);
        setPreview(null);
        if (err) {
          setError(err);
          return;
        }
        if (g.kind === "draw") {
          setPending(r);
          setSelected("");
          setTool("door");
        } else if (
          r.x !== g.room.x ||
          r.y !== g.room.y ||
          r.width !== g.room.width ||
          r.height !== g.room.height
        )
          apply(r);
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setPreview(null);
      }}
    >
      <defs>
        <pattern
          id="room-builder-grid"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <path d="M32 0H0V32" fill="none" stroke="#fff8" strokeWidth="1" />
        </pattern>
      </defs>
      <rect
        x="32"
        y="64"
        width="640"
        height="384"
        fill="url(#room-builder-grid)"
      />
      {rooms.map((r) => (
        <rect
          key={r.id}
          x={32 + r.x * 32}
          y={64 + r.y * 32}
          width={r.width * 32}
          height={r.height * 32}
          fill="transparent"
          stroke={selected === r.id ? "#d9a441" : "transparent"}
          strokeWidth="3"
        />
      ))}
      {shown && (
        <g pointerEvents="none">
          <rect
            x={32 + shown.x * 32}
            y={64 + shown.y * 32}
            width={shown.width * 32}
            height={shown.height * 32}
            fill={invalid ? "#b5424244" : "#4b987155"}
            stroke={invalid ? "#b54242" : "#267751"}
            strokeWidth="4"
            strokeDasharray="8 4"
          />
          <text
            x={40 + shown.x * 32}
            y={85 + shown.y * 32}
            fill="#172c24"
            fontSize="13"
            fontWeight="bold"
          >
            {shown.name} · {shown.width} × {shown.height}
          </text>
          {preview &&
            tool === "door" &&
            (() => {
              const r = preview;
              const horizontal = ["north", "south"].includes(r.door_side);
              const x =
                32 +
                (r.x +
                  (r.door_side === "east"
                    ? r.width
                    : horizontal
                      ? r.door_offset
                      : 0)) *
                  32;
              const y =
                64 +
                (r.y +
                  (r.door_side === "south"
                    ? r.height
                    : horizontal
                      ? 0
                      : r.door_offset)) *
                  32;
              return (
                <line
                  x1={x}
                  y1={y}
                  x2={x + (horizontal ? 32 : 0)}
                  y2={y + (horizontal ? 0 : 32)}
                  stroke={invalid ? "#b54242" : "#f9da75"}
                  strokeWidth="10"
                />
              );
            })()}
        </g>
      )}
      {current &&
        !pending &&
        tool === "select" &&
        (["nw", "ne", "sw", "se"] as const).map((c) => (
          <rect
            key={c}
            data-corner={c}
            x={
              32 + (current.x + (c.includes("e") ? current.width : 0)) * 32 - 6
            }
            y={
              64 + (current.y + (c.includes("s") ? current.height : 0)) * 32 - 6
            }
            width="12"
            height="12"
            fill="#fbf7ee"
            stroke="#704a15"
            strokeWidth="2"
            style={{
              cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
            }}
          />
        ))}
    </svg>
  );
  return (
    <section className="room-builder" aria-label="สร้างห้องบนแผนที่">
      <div
        className="room-builder-tools"
        role="toolbar"
        aria-label="เครื่องมือสร้างห้อง"
      >
        <button
          type="button"
          aria-pressed={tool === "draw"}
          onClick={() => switchTool("draw")}
        >
          ▧ วาดห้อง
        </button>
        <button
          type="button"
          aria-pressed={tool === "select"}
          onClick={() => switchTool("select")}
        >
          ↖ เลือก / ย้าย / ปรับขนาด
        </button>
        <button
          type="button"
          aria-pressed={tool === "door"}
          onClick={() => {
            setTool("door");
            setPreview(null);
            setError("");
          }}
        >
          🚪 ใส่ / ย้ายประตู
        </button>
        <button
          type="button"
          disabled={!undo.current.length || !!pending}
          onClick={() => history(true)}
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          disabled={!redo.current.length || !!pending}
          onClick={() => history(false)}
        >
          ทำซ้ำ
        </button>
      </div>
      <p className="room-builder-help" role="status">
        {pending
          ? "เลือกเส้นผนังเพื่อใส่ประตูให้ห้องใหม่ หรือกดยกเลิก"
          : tool === "draw"
            ? "ลากบนพื้นเพื่อวาดห้อง ปล่อยเมาส์แล้วคลิกผนังใส่ประตู"
            : tool === "door"
              ? "คลิกผนังห้องเพื่อวางหรือย้ายประตู ช่องสีแดงคือวางไม่ได้"
              : "คลิกห้องเพื่อเลือก ลากกลางห้องเพื่อย้าย หรือลากมุมเพื่อปรับขนาด"}
      </p>
      <div className="office-stage">
        <Office
          items={items}
          rooms={rooms}
          edit={false}
          tool=""
          onChange={() => {}}
          roomOverlay={overlay}
        />
      </div>
      {(error || invalid) && (
        <p className="room-error" role="alert">
          {error || invalid}
        </p>
      )}
      {pending && (
        <button type="button" onClick={cancel}>
          ยกเลิกห้องที่กำลังวาด
        </button>
      )}
      {current && !pending && (
        <div className="room-builder-inspector" key={current.id}>
          <label>
            ชื่อห้อง
            <input
              key={current.name}
              defaultValue={current.name}
              onBlur={(e) => changeMeta("name", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
          <label>
            ฝ่ายประจำห้อง (ไม่บังคับ)
            <input
              key={current.department}
              list="room-builder-departments"
              defaultValue={current.department}
              onBlur={(e) => changeMeta("department", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
          <datalist id="room-builder-departments">
            {[
              ...new Set(
                [
                  ...agents.map((a) => a.department),
                  ...rooms.map((r) => r.department),
                ].filter(Boolean),
              ),
            ].map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <p className="form-section-help">
            ขนาด {current.width} × {current.height} ช่อง ·
            ลากมุมบนแผนที่เพื่อปรับ
          </p>
          <div className="room-actions">
            {confirm ? (
              <>
                <span>ลบเฉพาะห้อง เก็บ Agent และเฟอร์นิเจอร์ไว้?</span>
                <button
                  type="button"
                  onClick={() => {
                    commit(rooms.filter((r) => r.id !== current.id));
                    setSelected("");
                    setConfirm(false);
                  }}
                >
                  ยืนยันลบห้อง
                </button>
                <button type="button" onClick={() => setConfirm(false)}>
                  ยกเลิก
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirm(true)}>
                ลบห้องนี้
              </button>
            )}
          </div>
        </div>
      )}
      <div className="room-builder-list" aria-label="เลือกห้อง">
        {rooms.map((r) => (
          <button
            type="button"
            key={r.id}
            aria-pressed={selected === r.id}
            onClick={() => {
              cancel();
              setSelected(r.id);
            }}
          >
            {r.name}
            {r.department ? " · " + r.department : ""}
          </button>
        ))}
      </div>
      <p className="muted">
        กด “บันทึกออฟฟิศ” เมื่อจัดเสร็จ · Esc ยกเลิกการลาก · Ctrl/⌘ Z ย้อนกลับ ·
        ห้องต้องมีประตูและเว้นทางเดิน ไม่มีการลบเฟอร์นิเจอร์ให้อัตโนมัติ
      </p>
    </section>
  );
}
