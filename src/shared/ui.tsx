import React from "react";
import type { Shape } from "../games/blokus/engine";

export const ShapePreview: React.FC<{
  shape: Shape;
  color: string;
  cellPx: number;
  muted?: boolean;
}> = ({ shape, color, cellPx, muted }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${shape[0].length}, ${cellPx}px)`,
      gridTemplateRows: `repeat(${shape.length}, ${cellPx}px)`,
      gap: 1,
    }}
  >
    {shape.flatMap((row, r) =>
      row.map((v, c) => (
        <div
          key={`${r}-${c}`}
          style={{
            width: cellPx,
            height: cellPx,
            background: v ? (muted ? "#cbd5e1" : color) : "transparent",
            border: v ? "1px solid rgba(0,0,0,0.1)" : "none",
          }}
        />
      ))
    )}
  </div>
);

export const GameMessage: React.FC<{ message: string }> = ({ message }) => {
  const isError = /illegal|cannot|must|off the board|overlaps/i.test(message);
  const isSuccess = /reconnected/i.test(message);
  const isWarning = /disconnected|reconnecting|resigned|no legal moves|skipped/i.test(message);

  const colors = isError
    ? { bg: "rgba(220,38,38,0.15)", border: "#dc2626", text: "#fca5a5" }
    : isSuccess
    ? { bg: "rgba(22,163,74,0.15)", border: "#16a34a", text: "#86efac" }
    : isWarning
    ? { bg: "rgba(245,158,11,0.15)", border: "#f59e0b", text: "#fde68a" }
    : { bg: "rgba(99,102,241,0.15)", border: "#6366f1", text: "#c7d2fe" };

  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 14px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        color: colors.text,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {message}
    </div>
  );
};

export const Spinner: React.FC = () => (
  <div
    style={{
      width: 16,
      height: 16,
      border: "2px solid rgba(249,168,212,0.3)",
      borderTopColor: "#f9a8d4",
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      flexShrink: 0,
    }}
  >
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

export function btn(variant: "primary" | "warn" | "ghost" = "primary"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 4,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.1)",
    color: "#f8fafc",
    cursor: "pointer",
    fontSize: 13,
  };
  if (variant === "warn") {
    base.background = "rgba(245,158,11,0.2)";
    base.borderColor = "#f59e0b";
    base.color = "#fde68a";
  } else if (variant === "ghost") {
    base.background = "transparent";
    base.color = "#94a3b8";
    base.border = "1px solid transparent";
  }
  return base;
}
