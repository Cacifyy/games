import React, { useState } from "react";
import type { ColorId, GameMode, GameSettings } from "../games/blokus/engine";
import { COLOR_NAME, PALETTE } from "../games/blokus/engine";
import { Spinner, btn } from "../shared/ui";

export const LOBBY_BG: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  background: "linear-gradient(135deg, #0d1117 0%, #1f0d14 50%, #0d1117 100%)",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#f8fafc",
  gap: 40,
  padding: 24,
  boxSizing: "border-box",
};

export const CARD_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  padding: "32px 28px",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.05)",
  backdropFilter: "blur(8px)",
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

export const LobbyPage: React.FC<{
  status: "idle" | "waiting";
  onFindGame: (name: string, preferredSide: "A" | "B", settings: GameSettings) => void;
  onCreateLobby: (name: string, preferredSide: "A" | "B", settings: GameSettings) => void;
  onJoinLobby: (name: string, code: string, settings: GameSettings) => void;
  lobbyCode: string | null;
  lobbyError: string | null;
  onClearError: () => void;
  customColors: Record<ColorId, string>;
  onCustomColorChange: (id: ColorId, hex: string) => void;
}> = ({
  status,
  onFindGame,
  onCreateLobby,
  onJoinLobby,
  lobbyCode,
  lobbyError,
  onClearError,
  customColors,
  onCustomColorChange,
}) => {
  const [name, setName] = useState("");
  const [joinMode, setJoinMode] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [openPicker, setOpenPicker] = useState<ColorId | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>("classic");
  const [timerSeconds, setTimerSeconds] = useState(20);

  const settings: GameSettings = { mode: gameMode, timerSeconds };
  const hasName = name.trim().length > 0;
  const canPlay = hasName && status === "idle";
  const canCreate = hasName && status === "idle";
  const canJoin = codeInput.trim().length === 6 && status === "idle";

  const randomSide = (): "A" | "B" => (Math.random() > 0.5 ? "A" : "B");

  return (
    <div style={LOBBY_BG}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 48, letterSpacing: 4, fontWeight: 800 }}>
          BLOCK-IT BESTIES
        </h1>
        <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15 }}>
          4 colours · classic rules
        </p>
      </div>

      <div style={CARD_STYLE}>
        {/* Name input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, color: "#94a3b8" }}>Your name</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && canPlay && onFindGame(name.trim(), randomSide(), settings)
            }
            placeholder="Enter your name…"
            maxLength={24}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.08)",
              color: "#f8fafc",
              fontSize: 16,
              outline: "none",
            }}
          />
        </div>

        {/* Game mode */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 13, color: "#94a3b8" }}>Game Mode</label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["classic", "timed"] as GameMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setGameMode(mode)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  border: gameMode === mode ? "2px solid #ec4899" : "1px solid rgba(255,255,255,0.2)",
                  background: gameMode === mode ? "rgba(236,72,153,0.12)" : "rgba(255,255,255,0.04)",
                  color: gameMode === mode ? "#f9a8d4" : "#64748b",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <div>{mode === "classic" ? "Classic" : "Timed"}</div>
                <div style={{ fontSize: 11, marginTop: 2, opacity: 0.7 }}>
                  {mode === "classic" ? "No time limit" : "Timer per move"}
                </div>
              </button>
            ))}
          </div>

          {gameMode === "timed" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: 13, color: "#94a3b8" }}>Seconds per move</label>
                <span style={{ fontSize: 22, fontWeight: 800, color: "#f9a8d4", fontVariantNumeric: "tabular-nums" }}>
                  {timerSeconds}s
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={30}
                step={5}
                value={timerSeconds}
                onChange={(e) => setTimerSeconds(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#ec4899", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#475569" }}>
                <span>10s</span><span>15s</span><span>20s</span><span>25s</span><span>30s</span>
              </div>
            </div>
          )}
        </div>

        {/* Status banners */}
        {status === "waiting" && !lobbyCode && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: "rgba(236,72,153,0.15)", border: "1px solid rgba(236,72,153,0.4)", fontSize: 14, color: "#f9a8d4" }}>
            <Spinner />
            Finding a match…
          </div>
        )}
        {lobbyCode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 8, background: "rgba(22,163,74,0.15)", border: "1px solid rgba(22,163,74,0.4)" }}>
            <div style={{ fontSize: 12, color: "#86efac" }}>Share this code with your friend:</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 800, letterSpacing: 6, color: "#f8fafc" }}>
                {lobbyCode}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(lobbyCode)}
                style={{ ...btn(), fontSize: 12, padding: "4px 10px" }}
              >
                Copy
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#86efac" }}>
              <Spinner />
              Waiting for them to join…
            </div>
          </div>
        )}
        {lobbyError && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 8, background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.4)", fontSize: 13, color: "#fca5a5" }}>
            {lobbyError}
            <button onClick={onClearError} style={{ background: "transparent", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px" }}>
              ×
            </button>
          </div>
        )}

        {/* Play button */}
        <button
          disabled={!canPlay}
          onClick={() => { onClearError(); onFindGame(name.trim(), randomSide(), settings); }}
          style={{
            padding: "14px 0",
            fontSize: 16,
            fontWeight: 700,
            borderRadius: 10,
            border: "none",
            background: canPlay ? "linear-gradient(135deg, #ec4899, #be185d)" : "rgba(255,255,255,0.08)",
            color: canPlay ? "#fff" : "#475569",
            cursor: canPlay ? "pointer" : "not-allowed",
            boxShadow: canPlay ? "0 0 32px rgba(236,72,153,0.5)" : "none",
            letterSpacing: 1,
          }}
        >
          {gameMode === "classic" ? "Play Classic" : `Play Timed (${timerSeconds}s)`}
        </button>

        {/* Colour picker */}
        <div style={{ display: "flex", gap: 32, justifyContent: "center" }}>
          {([["Team A", [1, 3] as ColorId[]], ["Team B", [2, 4] as ColorId[]]] as [string, ColorId[]][]).map(
            ([label, ids]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                  {label}
                </span>
                <div style={{ display: "flex", gap: 10 }}>
                  {ids.map((id) => (
                    <div key={id} style={{ position: "relative" }}>
                      <button
                        onClick={() => setOpenPicker(openPicker === id ? null : id)}
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          background: customColors[id],
                          border: openPicker === id ? "2px solid #f8fafc" : "2px solid rgba(255,255,255,0.15)",
                          cursor: "pointer",
                          boxShadow: `0 2px 12px ${customColors[id]}77`,
                          transition: "border-color 0.15s",
                        }}
                        title={COLOR_NAME[id]}
                      />
                      {openPicker === id && (
                        <div style={{
                          position: "absolute",
                          top: "calc(100% + 8px)",
                          left: "50%",
                          transform: "translateX(-50%)",
                          zIndex: 10,
                          background: "#1e293b",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 10,
                          padding: 8,
                          display: "grid",
                          gridTemplateColumns: "repeat(8, 24px)",
                          gap: 4,
                          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                        }}>
                          {PALETTE.map((hex) => (
                            <button
                              key={hex}
                              onClick={() => { onCustomColorChange(id, hex); setOpenPicker(null); }}
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 4,
                                background: hex,
                                border: customColors[id] === hex ? "2px solid #fff" : "2px solid transparent",
                                cursor: "pointer",
                                padding: 0,
                              }}
                              title={hex}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize: 12, color: "#475569" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
        </div>

        {/* Private lobby */}
        {!joinMode ? (
          <div style={{ display: "flex", gap: 10 }}>
            <button
              disabled={!canCreate}
              onClick={() => { onClearError(); onCreateLobby(name.trim(), randomSide(), settings); }}
              style={{
                flex: 1,
                padding: "11px 0",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: canCreate ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                color: canCreate ? "#f8fafc" : "#475569",
                cursor: canCreate ? "pointer" : "not-allowed",
              }}
            >
              Create Private Game
            </button>
            <button
              disabled={!hasName || status === "waiting"}
              onClick={() => { onClearError(); setJoinMode(true); }}
              style={{
                flex: 1,
                padding: "11px 0",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: hasName ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                color: hasName ? "#f8fafc" : "#475569",
                cursor: hasName && status === "idle" ? "pointer" : "not-allowed",
              }}
            >
              Join with Code
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              autoFocus
              type="text"
              value={codeInput}
              onChange={(e) => { onClearError(); setCodeInput(e.target.value.toUpperCase().slice(0, 6)); }}
              onKeyDown={(e) => e.key === "Enter" && canJoin && onJoinLobby(name.trim(), codeInput, settings)}
              placeholder="Enter 6-character code…"
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.08)",
                color: "#f8fafc",
                fontSize: 16,
                outline: "none",
                fontFamily: "monospace",
                letterSpacing: 4,
                textTransform: "uppercase",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={!canJoin}
                onClick={() => onJoinLobby(name.trim(), codeInput, settings)}
                style={{
                  flex: 1,
                  padding: "11px 0",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "none",
                  background: canJoin ? "linear-gradient(135deg, #ec4899, #be185d)" : "rgba(255,255,255,0.08)",
                  color: canJoin ? "#fff" : "#475569",
                  cursor: canJoin ? "pointer" : "not-allowed",
                }}
              >
                Join Game
              </button>
              <button
                onClick={() => { setJoinMode(false); setCodeInput(""); onClearError(); }}
                style={{ ...btn("ghost"), padding: "11px 14px" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
