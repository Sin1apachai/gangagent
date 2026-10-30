import type { Room } from "../../../shared/types";
export type Point = { x: number; y: number };
export class RoomDraft {
  static rectangle(from: Point, to: Point, base: Room): Room {
    return {
      ...base,
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x) + 1,
      height: Math.abs(to.y - from.y) + 1,
    };
  }
  static move(room: Room, from: Point, to: Point): Room {
    return { ...room, x: room.x + to.x - from.x, y: room.y + to.y - from.y };
  }
  static resize(room: Room, corner: string, to: Point): Room {
    const fixed = {
      x: corner.includes("w") ? room.x + room.width - 1 : room.x,
      y: corner.includes("n") ? room.y + room.height - 1 : room.y,
    };
    const next = RoomDraft.rectangle(fixed, to, room);
    next.door_offset = Math.min(
      next.door_offset,
      (["north", "south"].includes(next.door_side) ? next.width : next.height) -
        1,
    );
    return next;
  }
  static resizeBoundary(room: Room, corner: string, to: Point): Room {
    return RoomDraft.resize(room, corner, {
      x: Math.round(to.x) - (corner.includes("e") ? 1 : 0),
      y: Math.round(to.y) - (corner.includes("s") ? 1 : 0),
    });
  }
  static door(room: Room, p: Point): Room | null {
    const distances = [
      ["north", Math.abs(p.y - room.y)],
      ["south", Math.abs(p.y - room.y - room.height)],
      ["west", Math.abs(p.x - room.x)],
      ["east", Math.abs(p.x - room.x - room.width)],
    ] as const;
    const [side, distance] = [...distances].sort((a, b) => a[1] - b[1])[0];
    if (
      distance > 0.65 ||
      p.x < room.x - 0.65 ||
      p.x > room.x + room.width + 0.65 ||
      p.y < room.y - 0.65 ||
      p.y > room.y + room.height + 0.65
    )
      return null;
    const horizontal = side === "north" || side === "south";
    return {
      ...room,
      door_side: side,
      door_offset: Math.max(
        0,
        Math.min(
          (horizontal ? room.width : room.height) - 1,
          Math.floor(horizontal ? p.x - room.x : p.y - room.y),
        ),
      ),
    };
  }
}
