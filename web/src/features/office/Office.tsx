import { RoomEngine } from "./domain/RoomEngine";
import { drawCharacter } from "./characters";
import React, { useEffect, useRef, useState } from "react";
import type { Furniture, Agent, Task, Room } from "../../shared/types";
import { LayoutEngine, catalog, type Cell } from "./domain/LayoutEngine";
class SpriteAtlas {
  room = new Image();
  furniture = new Image();
  characters = new Image();
  constructor() {
    this.room.src = "/assets/room.png";
    this.furniture.src = "/assets/furniture.png";
    this.characters.src = "/assets/characters.png";
  }
}
const atlas = new SpriteAtlas();
export function Office({
  items,
  rooms = [],
  edit,
  tool,
  onChange,
  agents = [],
  tasks = [],
  onAgent,
  onOpen,
}: {
  items: Furniture[];
  rooms?: Room[];
  edit: boolean;
  tool: string;
  onChange: (v: Furniture[]) => void;
  agents?: Agent[];
  tasks?: Task[];
  onAgent?: (a: Agent) => void;
  onOpen?: (kind: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drag = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [cursor, setCursor] = useState<Cell>({ x: 0, y: 0 }),
    [hint, setHint] = useState(""),
    [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const resize = () => setFit(Math.min(1, node.clientWidth / 704));
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    resize();
    return () => observer.disconnect();
  }, []);
  const history = useRef<Furniture[][]>([]),
    future = useRef<Furniture[][]>([]),
    [version, force] = useState(0);
  const positions = useRef<
    Record<string, { x: number; y: number; path: Cell[]; target: string }>
  >({});
  const engine = new LayoutEngine(items, rooms);
  function change(next: Furniture[]) {
    history.current.push(structuredClone(items));
    if (history.current.length > 60) history.current.shift();
    future.current = [];
    onChange(next);
    force((v) => v + 1);
  }
  function place(c: Cell, id?: string) {
    const old = items.find((i) => i.id === id);
    const item: Furniture = {
      id: id ?? crypto.randomUUID(),
      kind: old?.kind ?? tool,
      x: c.x,
      y: c.y,
      rotation: old?.rotation ?? 0,
    };
    const error = engine.validate(item);
    if (error) {
      setHint("✕ " + error);
      return;
    }
    change(old ? items.map((i) => (i.id === id ? item : i)) : [...items, item]);
    setSelected(item.id);
    setHint("✓ วางแล้ว ยังไม่บันทึก");
  }
  function rotate() {
    const i = items.find((i) => i.id === selected);
    if (!i) return;
    const next = { ...i, rotation: (i.rotation + 90) % 360 };
    const error = engine.validate(next);
    if (error) setHint("✕ " + error);
    else change(items.map((v) => (v.id === i.id ? next : v)));
  }
  function duplicate() {
    const i = items.find((i) => i.id === selected);
    if (!i) return;
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 20; x++) {
        const next = { ...i, id: crypto.randomUUID(), x, y };
        if (!engine.validate(next)) {
          change([...items, next]);
          setSelected(next.id);
          return;
        }
      }
    setHint("✕ ไม่มีพื้นที่ว่าง");
  }
  function undo() {
    const previous = history.current.pop();
    if (previous) {
      future.current.push(structuredClone(items));
      onChange(previous);
      force((v) => v + 1);
    }
  }
  function redo() {
    const next = future.current.pop();
    if (next) {
      history.current.push(structuredClone(items));
      onChange(next);
      force((v) => v + 1);
    }
  }
  useEffect(() => {
    setHint("");
    history.current = [];
    future.current = [];
    force((v) => v + 1);
  }, [edit]);
  useEffect(() => {
    let frame = 0,
      last = 0;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    function draw(now: number) {
      const c = canvas.current?.getContext("2d");
      if (!c) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      c.imageSmoothingEnabled = false;
      c.fillStyle = "#1f2a44";
      c.fillRect(0, 0, 704, 480);
      if (atlas.room.complete && atlas.room.naturalWidth) {
        c.drawImage(atlas.room, 0, 0, 352, 224, 0, 0, 704, 448);
        for (let y = 0; y < 12; y++)
          for (let x = 0; x < 20; x++)
            c.drawImage(
              atlas.room,
              16 + (x % 4) * 16,
              32 + (y % 4) * 16,
              16,
              16,
              32 + x * 32,
              64 + y * 32,
              32,
              32,
            );
        c.drawImage(atlas.room, 0, 208, 352, 16, 0, 448, 704, 32);
      }
      for (const [index, r] of rooms.entries()) {
        const x = 32 + r.x * 32,
          y = 64 + r.y * 32,
          w = r.width * 32,
          h = r.height * 32;
        c.fillStyle = ["#8aab9c45", "#bda4ce45", "#d9b77945", "#8fb5c745"][
          index % 4
        ];
        c.fillRect(x, y, w, h);
        c.strokeStyle = "#635d55";
        c.lineWidth = 5;
        for (const side of ["north", "south", "west", "east"]) {
          const horizontal = side === "north" || side === "south";
          const length = horizontal ? r.width : r.height;
          for (let k = 0; k < length; k++) {
            if (side === r.door_side && k === r.door_offset) continue;
            c.beginPath();
            if (horizontal) {
              const sy = side === "north" ? y : y + h;
              c.moveTo(x + k * 32, sy);
              c.lineTo(x + (k + 1) * 32, sy);
            } else {
              const sx = side === "west" ? x : x + w;
              c.moveTo(sx, y + k * 32);
              c.lineTo(sx, y + (k + 1) * 32);
            }
            c.stroke();
          }
        }
        c.fillStyle = "#fbf7eee8";
        c.fillRect(x + 5, y + 5, w - 10, 20);
        c.fillStyle = "#302d28";
        c.font = "bold 12px sans-serif";
        c.fillText(r.name, x + 9, y + 19, w - 18);
      }
      c.lineWidth = 1;
      for (const item of [...items].sort((a, b) => a.y - b.y)) {
        const def = catalog[item.kind];
        if (!def) continue;
        const [sx, sy, sw, sh] = def.sprite,
          { w, h } = LayoutEngine.dimensions(item);
        const x = 32 + item.x * 32,
          y = 64 + item.y * 32;
        c.save();
        c.translate(x + w * 16, y + h * 16);
        c.rotate((item.rotation * Math.PI) / 180);
        if (atlas.furniture.complete && atlas.furniture.naturalWidth)
          c.drawImage(
            atlas.furniture,
            sx,
            sy,
            sw,
            sh,
            -def.w * 16,
            -def.h * 16 - (sh - def.h * 16) * 2,
            sw * 2,
            sh * 2,
          );
        c.restore();
        if (edit && selected === item.id) {
          c.strokeStyle = "#d9a441";
          c.lineWidth = 3;
          c.strokeRect(x, y, w * 32, h * 32);
        }
      }
      if (edit) {
        c.strokeStyle = "#fbf7ee35";
        c.lineWidth = 1;
        for (let x = 0; x <= 20; x++) {
          c.beginPath();
          c.moveTo(32 + x * 32, 64);
          c.lineTo(32 + x * 32, 448);
          c.stroke();
        }
        for (let y = 0; y <= 12; y++) {
          c.beginPath();
          c.moveTo(32, 64 + y * 32);
          c.lineTo(672, 64 + y * 32);
          c.stroke();
        }
        c.strokeStyle = "#d9a441";
        c.lineWidth = 3;
        c.strokeRect(32 + cursor.x * 32, 64 + cursor.y * 32, 32, 32);
      } else
        for (const [index, agent] of agents
          .filter((a) => a.enabled)
          .entries()) {
          const task = tasks.find(
            (t) =>
              t.agent_id === agent.id &&
              ["running", "waiting_quota", "waiting_auth", "review"].includes(
                t.status,
              ),
          );
          const working = task?.status === "running";
          const epoch = Math.floor(now / 8000);
          const room = new RoomEngine(rooms).assigned(agent);
          const goal =
            working || reduced
              ? engine.nearest(agent, room, !room)
              : engine.nearest(
                  {
                    x: (index * 5 + epoch * 3) % 20,
                    y: (index * 3 + epoch * 2) % 12,
                  },
                  room,
                  !room,
                );
          const target = `${goal.x},${goal.y}`;
          let p = positions.current[agent.id];
          if (!p) {
            const start = engine.nearest(agent, room, !room);
            p = positions.current[agent.id] = {
              ...start,
              path: [],
              target: "",
            };
          }
          if (p.target !== target) {
            p.path = engine.path(
              { x: Math.round(p.x), y: Math.round(p.y) },
              goal,
            );
            p.target = target;
          }
          const next = p.path[0];
          let moving = false;
          if (next && !reduced) {
            const dx = next.x - p.x,
              dy = next.y - p.y,
              d = Math.hypot(dx, dy);
            if (d < 0.08) p.path.shift();
            else {
              const k = Math.min((dt * 2.5) / d, 1);
              p.x += dx * k;
              p.y += dy * k;
              moving = true;
            }
          }
          const x = Math.round(32 + p.x * 32),
            y = Math.round(64 + p.y * 32);
          const skin = Math.floor((agent.character_id ?? (index % 3) * 4) / 4),
            dir = moving ? Math.floor(now / 180) % 3 : 0;
          const sx = skin * 48 + dir * 16,
            sy = working && !moving ? 40 : 0;
          if (atlas.characters.complete && atlas.characters.naturalWidth)
            drawCharacter(
              c,
              atlas.characters,
              x,
              y,
              agent.character_id ?? (index % 3) * 4,
              dir,
              sy,
            );
          if (agent.selection_passed === false) {
            c.fillStyle = "#a74651";
            c.fillRect(x - 5, y + 25, 42, 11);
            c.fillStyle = "#fff9ed";
            c.font = "9px sans-serif";
            c.fillText("ไม่ผ่าน", x + 4, y + 34);
          }
          const label =
            agent.name +
            " · " +
            (task?.status === "waiting_quota"
              ? "รอรีเซ็ต"
              : task?.status === "waiting_auth"
                ? "รอ Login"
                : task?.status === "review"
                  ? "รอตรวจ"
                  : working
                    ? "ทำงาน"
                    : "ว่าง");
          c.font = "12px sans-serif";
          const width = Math.min(c.measureText(label).width + 12, 180);
          c.fillStyle = "#fbf7ee";
          c.fillRect(x + 16 - width / 2, y - 32, width, 19);
          c.strokeStyle = "#2a1e1b";
          c.strokeRect(x + 16 - width / 2, y - 32, width, 19);
          c.fillStyle = "#2a1e1b";
          c.fillText(label, x + 22 - width / 2, y - 18, width - 8);
        }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [items, rooms, agents, tasks, edit, selected, cursor]);
  useEffect(() => {
    positions.current = {};
  }, [JSON.stringify(rooms), JSON.stringify(items)]);
  function cell(e: React.PointerEvent): Cell {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.floor((((e.clientX - r.left) * 704) / r.width - 32) / 32),
      y: Math.floor((((e.clientY - r.top) * 480) / r.height - 64) / 32),
    };
  }
  return (
    <div className="room-engine">
      <div className="room-viewport" ref={viewport}>
        <canvas
          ref={canvas}
          width={704}
          height={480}
          style={{
            width: 704 * zoom * fit,
            maxWidth: "none",
            touchAction: edit ? "none" : "pan-x pan-y",
          }}
          tabIndex={0}
          aria-label="แผนที่สำนักงาน ตาราง 20 คูณ 12 ช่อง"
          onKeyDown={(e) => {
            if (!edit) return;
            const steps: Record<string, Cell> = {
              ArrowLeft: { x: -1, y: 0 },
              ArrowRight: { x: 1, y: 0 },
              ArrowUp: { x: 0, y: -1 },
              ArrowDown: { x: 0, y: 1 },
            };
            if (steps[e.key]) {
              e.preventDefault();
              setCursor((c) => ({
                x: Math.max(0, Math.min(19, c.x + steps[e.key].x)),
                y: Math.max(0, Math.min(11, c.y + steps[e.key].y)),
              }));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              place(cursor, selected ?? undefined);
            }
            if (e.key.toLowerCase() === "r") rotate();
            if (e.key === "Escape") setSelected(null);
            if (e.key === "Delete" && selected)
              change(items.filter((i) => i.id !== selected));
            if ((e.ctrlKey || e.metaKey) && e.key === "z") {
              e.preventDefault();
              e.shiftKey ? redo() : undo();
            }
          }}
          onPointerDown={(e) => {
            const p = cell(e),
              i = engine.hit(p.x, p.y);
            setCursor(p);
            if (edit) {
              if (i) {
                setSelected(i.id);
                drag.current = i.id;
                canvas.current?.setPointerCapture(e.pointerId);
              } else place(p);
            } else {
              const a = agents.find((a) => {
                const at = positions.current[a.id];
                return (
                  at && Math.abs(at.x - p.x) < 1 && Math.abs(at.y - p.y) < 1
                );
              });
              if (a) onAgent?.(a);
              else if (i) onOpen?.(i.kind);
            }
          }}
          onPointerUp={(e) => {
            if (drag.current) {
              const p = cell(e),
                old = items.find((i) => i.id === drag.current);
              if (old && (old.x !== p.x || old.y !== p.y))
                place(p, drag.current);
              drag.current = null;
            }
          }}
        />
      </div>
      <div className="canvas-tools">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          aria-label="ย่อแผนที่"
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(1)}>
          พอดีจอ
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          aria-label="ขยายแผนที่"
        >
          +
        </button>
        {edit && (
          <>
            <button disabled={!history.current.length} onClick={undo}>
              ย้อนกลับ
            </button>
            <button disabled={!future.current.length} onClick={redo}>
              ทำซ้ำ
            </button>
            <button disabled={!selected} onClick={rotate}>
              หมุน
            </button>
            <button disabled={!selected} onClick={duplicate}>
              ทำสำเนา
            </button>
            <button
              disabled={!selected}
              onClick={() => {
                change(items.filter((i) => i.id !== selected));
                setSelected(null);
              }}
            >
              ลบเฟอร์นิเจอร์
            </button>
          </>
        )}
      </div>
      {edit && (
        <p className="muted">
          คลิกเพื่อวาง · ลากเพื่อย้าย · ลูกศร + Enter วาง · R หมุน · Ctrl/⌘ Z
          ย้อนกลับ · Esc ยกเลิกเลือก
        </p>
      )}
      {hint && <p role="status">{hint}</p>}
      {!edit && (
        <div className="agent-shortcuts">
          {agents
            .filter((a) => a.enabled)
            .map((a) => (
              <button key={a.id} onClick={() => onAgent?.(a)}>
                {a.name} · {a.provider}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
