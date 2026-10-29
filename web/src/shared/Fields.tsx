import React from "react";
export function Field({
  label,
  name,
  type = "text",
  value,
  required = false,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  value?: any;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}
export function Area({
  label,
  name,
  value,
  required = false,
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <textarea name={name} defaultValue={value ?? ""} required={required} />
    </label>
  );
}
