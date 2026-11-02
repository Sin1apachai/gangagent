import React, { useEffect, useState } from "react";
import "./artifact-preview.css";
type Preview =
  | { kind: "text"; content: string }
  | { kind: "media"; url: string };
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let code: string[] | null = null;
  let table: string[][] = [];
  const flushTable = () => {
    if (table.length) {
      blocks.push(
        <div className="artifact-table-wrap" key={`t${blocks.length}`}>
          <table>
            <tbody>
              {table.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) =>
                    i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>,
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      table = [];
    }
  };
  for (const [i, line] of lines.entries()) {
    if (line.trim().startsWith("```")) {
      flushTable();
      if (code) {
        blocks.push(
          <pre key={i}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      if (!/^\s*\|[\s:|\-]+\|\s*$/.test(line))
        table.push(
          line
            .trim()
            .slice(1, -1)
            .split("|")
            .map((s) => s.trim()),
        );
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      blocks.push(
        React.createElement(
          `h${Math.min(heading[1].length + 1, 6)}`,
          { key: i },
          heading[2],
        ),
      );
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      blocks.push(
        <p className="artifact-bullet" key={i}>
          • {line.replace(/^\s*[-*]\s/, "")}
        </p>,
      );
      continue;
    }
    if (line.trim()) blocks.push(<p key={i}>{line}</p>);
  }
  flushTable();
  if (code)
    blocks.push(
      <pre key="last">
        <code>{code.join("\n")}</code>
      </pre>,
    );
  return <article className="artifact-markdown">{blocks}</article>;
}
export function ArtifactPreview({
  wid,
  taskId,
  file,
}: {
  wid: string;
  taskId: string;
  file: { id: string; name: string; size: number };
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const url = `/api/workspaces/${wid}/tasks/${taskId}/artifacts/${file.id}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let objectUrl = "";
    setPreview(null);
    setError("");
    (async () => {
      try {
        const response = await fetch(url + "?preview=true", {
          signal: controller.signal,
        });
        if (!response.ok)
          throw Error(
            "ไฟล์นี้ยังพรีวิวไม่ได้ หรือขนาดเกินกำหนด กรุณาดาวน์โหลดเพื่อเปิด",
          );
        if (
          response.headers.get("content-type")?.startsWith("application/json")
        ) {
          const data = await response.json();
          if (!controller.signal.aborted)
            setPreview({ kind: "text", content: data.content });
        } else {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setPreview({
            kind: "media",
            url: objectUrl,
          });
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, url]);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open]);
  return (
    <>
      <div className="artifact-file-row">
        <button
          type="button"
          className="artifact-preview-button"
          onClick={() => setOpen(true)}
        >
          ดูไฟล์ {file.name}
        </button>
        <span>{(file.size / 1024).toFixed(1)} KB</span>
        <a href={url} download>
          ดาวน์โหลด ↓
        </a>
      </div>
      {open && (
        <div className="overlay artifact-preview-overlay">
          <section
            className="modal artifact-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`พรีวิว ${file.name}`}
          >
            <header>
              <div>
                <span className="eyebrow">FILE PREVIEW</span>
                <h2>{file.name}</h2>
              </div>
              <button
                type="button"
                aria-label="ปิดพรีวิว"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="artifact-preview-toolbar">
              <span>อ่านไฟล์บนเว็บ · ต้นฉบับไม่ถูกแก้ไข</span>
              <a href={url} download>
                ดาวน์โหลดต้นฉบับ ↓
              </a>
            </div>
            <div className="artifact-preview-body">
              {error ? (
                <p role="alert" className="error">
                  {error}
                </p>
              ) : !preview ? (
                <p role="status">กำลังเปิดไฟล์…</p>
              ) : preview.kind === "text" ? (
                /\.(md|markdown|mdown)$/i.test(file.name) ? (
                  <Markdown text={preview.content} />
                ) : (
                  <pre className="artifact-source">{preview.content}</pre>
                )
              ) : (
                <img alt={file.name} src={preview.url} />
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
