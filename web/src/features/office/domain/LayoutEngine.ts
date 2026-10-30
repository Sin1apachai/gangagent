import { RoomEngine } from "./RoomEngine.ts";
import type { Room } from "../../../shared/types";
import type { Furniture } from "../../../shared/types";
export const catalog: Record<
  string,
  { name: string; w: number; h: number; sprite: number[] }
> = {
  desk: { name: "โต๊ะทำงาน", w: 2, h: 1, sprite: [0, 0, 32, 16] },
  chair: { name: "เก้าอี้", w: 1, h: 1, sprite: [33, 0, 16, 16] },
  computer: { name: "คอมพิวเตอร์", w: 1, h: 1, sprite: [50, 0, 16, 16] },
  meeting: { name: "โต๊ะประชุม", w: 3, h: 2, sprite: [67, 0, 48, 32] },
  sofa: { name: "โซฟา", w: 2, h: 1, sprite: [0, 33, 32, 16] },
  bookshelf: { name: "ชั้นหนังสือ", w: 2, h: 1, sprite: [33, 33, 32, 24] },
  plant: { name: "ต้นไม้", w: 1, h: 1, sprite: [66, 33, 16, 24] },
  rug: { name: "พรม", w: 3, h: 2, sprite: [0, 58, 48, 32] },
  lamp: { name: "โคมไฟ", w: 1, h: 1, sprite: [49, 58, 16, 24] },
  board: { name: "กระดานงาน", w: 2, h: 1, sprite: [66, 58, 32, 24] },
  wall: { name: "ผนังกั้น", w: 1, h: 1, sprite: [0, 91, 16, 16] },
  coffee: { name: "เครื่องชงกาแฟ", w: 1, h: 1, sprite: [17, 91, 16, 24] },
};
export type Cell = { x: number; y: number };
export class LayoutEngine {
  items: readonly Furniture[];
  rooms: readonly Room[];
  constructor(items: readonly Furniture[], rooms: readonly Room[] = []) {
    this.items = items;
    this.rooms = rooms;
  }
  static dimensions(i: Furniture) {
    const c = catalog[i.kind] ?? catalog.plant;
    return i.rotation % 180 ? { w: c.h, h: c.w } : { w: c.w, h: c.h };
  }
  cells(i: Furniture): Cell[] {
    const { w, h } = LayoutEngine.dimensions(i);
    return Array.from({ length: w * h }, (_, n) => ({
      x: i.x + (n % w),
      y: i.y + Math.floor(n / w),
    }));
  }
  hit(x: number, y: number) {
    return [...this.items]
      .reverse()
      .find((i) => this.cells(i).some((c) => c.x === x && c.y === y));
  }
  validate(i: Furniture): string {
    if (!catalog[i.kind]) return "ไม่รู้จักเฟอร์นิเจอร์";
    const cells = this.cells(i);
    if (cells.some((c) => c.x < 0 || c.x >= 20 || c.y < 0 || c.y >= 12))
      return "อยู่นอกพื้นที่ห้อง";
    if (
      cells.some((c) =>
        this.items.some(
          (o) =>
            o.id !== i.id &&
            this.cells(o).some((p) => p.x === c.x && p.y === c.y),
        ),
      )
    )
      return "ทับเฟอร์นิเจอร์ชิ้นอื่น";
    return new RoomEngine(this.rooms).validate([
      ...this.items.filter((o) => o.id !== i.id),
      i,
    ]);
  }
  walkable(c: Cell) {
    return (
      c.x >= 0 &&
      c.x < 20 &&
      c.y >= 0 &&
      c.y < 12 &&
      !this.items.some(
        (i) =>
          i.kind !== "rug" &&
          this.cells(i).some((p) => p.x === c.x && p.y === c.y),
      )
    );
  }
  nearest(c: Cell, room?: Room, common = false): Cell {
    let best: Cell = { x: 0, y: 0 },
      distance = Infinity;
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 20; x++) {
        const p = { x, y },
          d = Math.abs(c.x - x) + Math.abs(c.y - y);
        if (
          this.walkable(p) &&
          (!room || RoomEngine.contains(room, x, y)) &&
          (!common || !this.rooms.some((r) => RoomEngine.contains(r, x, y))) &&
          d < distance
        ) {
          distance = d;
          best = p;
        }
      }
    return best;
  }
  path(from: Cell, to: Cell): Cell[] {
    const start = this.nearest(from),
      end = this.nearest(to),
      queue = [start],
      seen = new Map<string, Cell | null>([[`${start.x},${start.y}`, null]]);
    for (let n = 0; n < queue.length; n++) {
      const c = queue[n];
      if (c.x === end.x && c.y === end.y) {
        const path: Cell[] = [];
        let p: Cell | null = c;
        while (p) {
          path.unshift(p);
          p = seen.get(`${p.x},${p.y}`) ?? null;
        }
        return path;
      }
      for (const p of [
        { x: c.x + 1, y: c.y },
        { x: c.x - 1, y: c.y },
        { x: c.x, y: c.y + 1 },
        { x: c.x, y: c.y - 1 },
      ]) {
        const k = `${p.x},${p.y}`;
        if (
          this.walkable(p) &&
          !seen.has(k) &&
          !this.rooms.some((r) => RoomEngine.crosses(r, c, p))
        ) {
          seen.set(k, c);
          queue.push(p);
        }
      }
    }
    return [start];
  }
}
