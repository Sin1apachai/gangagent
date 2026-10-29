import React, { useId } from "react";
export function FormTabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const uid = useId();
  return (
    <div className="form-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          id={`${uid}-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            const move =
              e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (move || e.key === "Home" || e.key === "End") {
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : (i + move + tabs.length) % tabs.length;
              onChange(tabs[next].id);
              (
                e.currentTarget.parentElement?.children[
                  next
                ] as HTMLButtonElement
              )?.focus();
            }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
