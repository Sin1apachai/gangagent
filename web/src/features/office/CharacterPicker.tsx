import React from "react";
import { characters, characterPixels } from "./characters";
export function CharacterSprite({ id = 0 }: { id?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="character-sprite"
      width="32"
      height="40"
      viewBox="0 0 16 20"
      shapeRendering="crispEdges"
    >
      {characterPixels(id).map((pixel, i) => (
        <rect
          key={i}
          x={pixel.x}
          y={pixel.y}
          width="1"
          height="1"
          fill={pixel.color}
        />
      ))}
    </svg>
  );
}
export function CharacterPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (id: number) => void;
}) {
  const current = characters[value] ?? characters[0];
  return (
    <section className="character-picker">
      <input type="hidden" name="character_id" value={current.id} />
      <div className="character-preview">
        <CharacterSprite id={current.id} />
        <div>
          <b>ตัวละครใน Office</b>
          <small>{current.name}</small>
        </div>
      </div>
      <p>
        ผสมรูปลักษณ์ 3 แบบกับเครื่องประดับ 4 แบบ รวม 12 ตัวละคร
        เปลี่ยนภายหลังได้
      </p>
      <fieldset>
        <legend>รูปลักษณ์พื้นฐาน</legend>
        <div className="character-options character-bases">
          {[0, 1, 2].map((base) => (
            <label
              key={base}
              className={current.base === base ? "selected" : ""}
            >
              <input
                type="radio"
                name="character_base"
                value={base}
                checked={current.base === base}
                onChange={() => onChange(base * 4 + current.accessory)}
              />
              <CharacterSprite id={base * 4 + current.accessory} />
              <span>
                {characters[base * 4].name.split(" · ").slice(0, 2).join(" · ")}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>เครื่องประดับ</legend>
        <div className="character-options character-accessories">
          {[0, 1, 2, 3].map((accessory) => (
            <label
              key={accessory}
              className={current.accessory === accessory ? "selected" : ""}
            >
              <input
                type="radio"
                name="character_accessory"
                value={accessory}
                checked={current.accessory === accessory}
                onChange={() => onChange(current.base * 4 + accessory)}
              />
              <CharacterSprite id={current.base * 4 + accessory} />
              <span>{["คลาสสิก", "แว่นตา", "หมวก", "หูฟัง"][accessory]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
