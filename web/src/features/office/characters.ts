export const characters = Array.from({ length: 12 }, (_, id) => ({
  id,
  base: Math.floor(id / 4),
  accessory: id % 4,
  name: `${["ผมเข้ม · ชุดเขียว", "ผมสีน้ำตาล · ชุดอุ่น", "ผิวเข้ม · ชุดน้ำเงิน"][Math.floor(id / 4)]} · ${["คลาสสิก", "แว่นตา", "หมวก", "หูฟัง"][id % 4]}`,
}));
const shape = [
  ".....hhhhhh.....",
  "....hhhhhhhh....",
  "...hhhhhhhhhh...",
  "...hhsssssshh...",
  "...hssssssssh...",
  "....sesse ss....".replace(" ", "s"),
  "....ssssssss....",
  ".....ssssss.....",
  "....bbbsbbbb....",
  "...sbbbbbbbbs...",
  "...sbbbbbbbbs...",
  "...sbbbbbbbbs...",
  "....bbbbbbbb....",
  "....bbddddbb....",
  ".....pppppp.....",
  ".....pp..pp.....",
  ".....pp..pp.....",
  ".....pp..pp.....",
  "....fff..fff....",
  "....fff..fff....",
];
const palettes = [
  {
    h: "#322838",
    s: "#e8bd94",
    b: "#45765e",
    p: "#2e4056",
    f: "#262532",
    e: "#272230",
    d: "#d4aa54",
  },
  {
    h: "#a65f35",
    s: "#f0c8a0",
    b: "#bd7959",
    p: "#41415c",
    f: "#312838",
    e: "#272230",
    d: "#e6b95e",
  },
  {
    h: "#241f2d",
    s: "#9f684d",
    b: "#5d77ad",
    p: "#333f62",
    f: "#272630",
    e: "#211b24",
    d: "#d5ad57",
  },
];
type Pixel = { x: number; y: number; color: string };
const cache = new Map<string, Pixel[]>();
export function characterPixels(
  id: number,
  frame = 0,
  working = false,
): Pixel[] {
  const ch = characters[id] ?? characters[0],
    key = `${ch.id}:${frame}:${working}`;
  const saved = cache.get(key);
  if (saved) return saved;
  const palette = palettes[ch.base] as Record<string, string>;
  const pixels: Pixel[] = [];
  shape.forEach((line, y) =>
    Array.from(line).forEach((code, x) => {
      if (palette[code]) {
        let dy = 0;
        if (y >= 15 && !working && frame !== 0)
          dy = x < 8 ? (frame === 1 ? -1 : 0) : frame === 2 ? -1 : 0;
        pixels.push({ x, y: y + dy, color: palette[code] });
      }
    }),
  );
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    for (let xx = x; xx < x + w; xx++)
      for (let yy = y; yy < y + h; yy++) pixels.push({ x: xx, y: yy, color });
  };
  if (ch.accessory === 1) {
    rect(4, 5, 3, 2, "#24334b");
    rect(9, 5, 3, 2, "#24334b");
    rect(7, 5, 2, 1, "#24334b");
  }
  if (ch.accessory === 2) {
    rect(4, 0, 8, 2, "#d4a743");
    rect(2, 2, 12, 1, "#bd8e30");
  }
  if (ch.accessory === 3) {
    rect(2, 3, 2, 5, "#26394b");
    rect(12, 3, 2, 5, "#26394b");
    rect(4, 0, 8, 1, "#26394b");
  }
  cache.set(key, pixels);
  return pixels;
}
export function drawCharacter(
  c: CanvasRenderingContext2D,
  _atlas: HTMLImageElement,
  x: number,
  y: number,
  id: number,
  frame: number,
  row: number,
) {
  for (const pixel of characterPixels(id, frame, row === 40)) {
    c.fillStyle = pixel.color;
    c.fillRect(x + pixel.x * 2, y - 10 + pixel.y * 2, 2, 2);
  }
}
