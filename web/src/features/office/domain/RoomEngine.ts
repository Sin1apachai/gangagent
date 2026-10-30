import type { Room, Furniture, Agent } from "../../../shared/types";
import { LayoutEngine } from "./LayoutEngine.ts";
export class RoomEngine {
  rooms: readonly Room[];
  constructor(rooms: readonly Room[]) {
    this.rooms = rooms;
  }
  static contains(r: Room, x: number, y: number) {
    return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
  }
  static door(r: Room) {
    const n = r.door_offset;
    switch (r.door_side) {
      case "north":
        return [
          { x: r.x + n, y: r.y },
          { x: r.x + n, y: r.y - 1 },
        ];
      case "south":
        return [
          { x: r.x + n, y: r.y + r.height - 1 },
          { x: r.x + n, y: r.y + r.height },
        ];
      case "west":
        return [
          { x: r.x, y: r.y + n },
          { x: r.x - 1, y: r.y + n },
        ];
      default:
        return [
          { x: r.x + r.width - 1, y: r.y + n },
          { x: r.x + r.width, y: r.y + n },
        ];
    }
  }
  static crosses(
    r: Room,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) {
    if (RoomEngine.contains(r, a.x, a.y) === RoomEngine.contains(r, b.x, b.y))
      return false;
    const [inside, outside] = RoomEngine.door(r);
    return !(
      (a.x === inside.x &&
        a.y === inside.y &&
        b.x === outside.x &&
        b.y === outside.y) ||
      (b.x === inside.x &&
        b.y === inside.y &&
        a.x === outside.x &&
        a.y === outside.y)
    );
  }
  assigned(agent: Agent) {
    if (agent.office_placement === "common") return undefined;
    if (agent.office_placement === "room")
      return this.rooms.find((r) => r.id === agent.office_room_id);
    return this.rooms.find(
      (r) =>
        r.department.trim() &&
        r.department.trim().toLowerCase() ===
          (agent.department ?? "").trim().toLowerCase(),
    );
  }
  validate(items: readonly Furniture[]) {
    if (this.rooms.length > 20) return "เพิ่มได้สูงสุด 20 ห้อง";
    const ids = new Set<string>(),
      departments = new Set<string>();
    const engine = new LayoutEngine(items);
    for (const [n, r] of this.rooms.entries()) {
      if (
        !r.id ||
        ids.has(r.id) ||
        !r.name.trim() ||
        new TextEncoder().encode(r.name).length > 100 ||
        new TextEncoder().encode(r.department).length > 100 ||
        new TextEncoder().encode(r.purpose).length > 500
      )
        return "ชื่อห้อง/ฝ่าย/หน้าที่ไม่ถูกต้องหรือยาวเกินไป";
      ids.add(r.id);
      if (
        ![r.x, r.y, r.width, r.height, r.door_offset].every(Number.isInteger) ||
        r.width < 3 ||
        r.height < 3 ||
        r.x < 0 ||
        r.y < 0 ||
        r.x + r.width > 20 ||
        r.y + r.height > 12
      )
        return "ห้องต้องอยู่ในแผนที่และมีขนาดอย่างน้อย 3 × 3 ช่อง";
      const dep = r.department.trim().toLowerCase();
      if (dep && departments.has(dep))
        return "แต่ละฝ่ายมีห้องประจำได้หนึ่งห้อง กรุณาใช้ฝ่ายอื่นหรือเว้นว่างสำหรับห้องส่วนกลาง";
      if (dep) departments.add(dep);
      if (
        !["north", "south", "east", "west"].includes(r.door_side) ||
        r.door_offset < 0 ||
        r.door_offset >=
          (["north", "south"].includes(r.door_side) ? r.width : r.height)
      )
        return "ตำแหน่งประตูอยู่นอกผนัง";
      if (
        this.rooms
          .slice(0, n)
          .some(
            (o) =>
              r.x <= o.x + o.width &&
              o.x <= r.x + r.width &&
              r.y <= o.y + o.height &&
              o.y <= r.y + r.height,
          )
      )
        return "เว้นทางเดินอย่างน้อยหนึ่งช่องระหว่างห้อง";
      const [inside, outside] = RoomEngine.door(r);
      if (outside.x < 0 || outside.x >= 20 || outside.y < 0 || outside.y >= 12)
        return "ประตูต้องเปิดเข้าสู่ทางเดินในแผนที่";
      if (
        items.some((i) =>
          engine
            .cells(i)
            .some(
              (c) =>
                (c.x === inside.x && c.y === inside.y) ||
                (c.x === outside.x && c.y === outside.y),
            ),
        )
      )
        return "เฟอร์นิเจอร์ขวางประตูหรือช่องทางเข้าห้อง";
      if (
        items.some((i) => {
          const cs = engine.cells(i),
            count = cs.filter((c) => RoomEngine.contains(r, c.x, c.y)).length;
          return count > 0 && count < cs.length;
        })
      )
        return "เฟอร์นิเจอร์คร่อมผนังห้อง กรุณาย้ายทั้งชิ้นเข้าหรือออกจากห้อง";
    }
    return "";
  }
}
