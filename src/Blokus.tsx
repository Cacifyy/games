import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColorId,
  type PlayerId,
  type Board,
  type Shape,
  type GameState,
  type GameSettings,
  BOARD_SIZE,
  COLOR_ORDER,
  START_SQUARES,
  COLOR_NAME,
  DEFAULT_COLOR_HEX,
  DEFAULT_COLOR_LIGHT,
  COLORS_FOR,
  PLAYER_FOR_COLOR,
  PIECES,
  PIECE_BY_ID,
  lightenColor,
  rotateCW,
  flipH,
  shapeCells,
  validatePlacement,
  hasAnyLegalMove,
  colorScore,
  teamScore,
  makeInitialState,
  nextColor,
  serializeState,
  deserializeState,
} from "./games/blokus/engine";
import { BlokusSocket, type ServerEvent } from "./socket";
import { ShapePreview, GameMessage, Spinner, btn } from "./shared/ui";
import { LobbyPage, LOBBY_BG, CARD_STYLE } from "./lobby/Lobby";

// -------------------- Subcomponents --------------------

const ScorePanel: React.FC<{
  state: GameState;
  teamA: number;
  teamB: number;
  nameFor: (p: PlayerId) => string;
  gameOver: boolean;
  colorHex: Record<ColorId, string>;
  colorLight: Record<ColorId, string>;
}> = ({ state, teamA, teamB, nameFor, gameOver, colorHex, colorLight }) => {
  const colorRow = (c: ColorId) => (
    <div
      key={c}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 8px",
        background: state.current === c ? colorLight[c] : "rgba(255,255,255,0.08)",
        border: `1px solid ${colorHex[c]}`,
        borderRadius: 4,
        marginBottom: 4,
        opacity: state.passed[c] ? 0.6 : 1,
        color: state.current === c ? "#0d1117" : "#f8fafc",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-block", width: 12, height: 12, background: colorHex[c], borderRadius: 2 }} />
        <strong>{COLOR_NAME[c]}</strong>
        {state.passed[c] && <span style={{ fontSize: 11, color: "#94a3b8" }}>(out)</span>}
        {state.finished[c] && <span style={{ fontSize: 11, color: "#16a34a" }}>(done!)</span>}
      </div>
      <div style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {gameOver
          ? `${state.remaining[c].size} left • Score: ${colorScore(state, c)}`
          : `${state.remaining[c].size} left`}
      </div>
    </div>
  );

  const teamBlock = (player: PlayerId, total: number) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 6,
        background: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>{nameFor(player)}</strong>
        {gameOver && <span>Total: {total}</span>}
      </div>
      {COLORS_FOR[player].map(colorRow)}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
      {teamBlock("A", teamA)}
      {teamBlock("B", teamB)}
    </div>
  );
};

const PieceTray: React.FC<{
  color: ColorId;
  remaining: Record<ColorId, Set<string>>;
  selectedPieceId: string | null;
  onPick: (id: string) => void;
  disabled: boolean;
  hideTitle?: boolean;
  cellPx?: number;
  colorHex: Record<ColorId, string>;
}> = ({ color, remaining, selectedPieceId, onPick, disabled, hideTitle, cellPx = 9, colorHex }) => {
  const minCell = 5 * cellPx + 14;
  return (
    <div style={{ marginTop: hideTitle ? 0 : 12 }}>
      {!hideTitle && <h4 style={{ margin: "8px 0" }}>{COLOR_NAME[color]}'s remaining pieces</h4>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minCell}px, 1fr))`, gap: 4 }}>
        {PIECES.map((p) => {
          const available = remaining[color].has(p.id);
          const selected = selectedPieceId === p.id;
          return (
            <button
              key={p.id}
              disabled={disabled || !available}
              onClick={() => onPick(p.id)}
              style={{
                padding: 3,
                border: selected ? `2px solid ${colorHex[color]}` : "1px solid rgba(255,255,255,0.12)",
                background: available ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                opacity: available ? 1 : 0.4,
                borderRadius: 4,
                cursor: available && !disabled ? "pointer" : "not-allowed",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
              title={p.id}
            >
              <ShapePreview shape={p.shape} color={colorHex[color]} cellPx={cellPx} muted={!available} />
            </button>
          );
        })}
      </div>
    </div>
  );
};

// -------------------- Main component --------------------

const DEV_SKIP = new URLSearchParams(window.location.search).has("dev");

const Blokus: React.FC = () => {
  const [customColors, setCustomColors] = useState<Partial<Record<ColorId, string>>>({});
  const COLOR_HEX = useMemo(
    () => ({ ...DEFAULT_COLOR_HEX, ...customColors } as Record<ColorId, string>),
    [customColors]
  );
  const COLOR_LIGHT = useMemo(
    () => ({
      1: customColors[1] ? lightenColor(customColors[1]) : DEFAULT_COLOR_LIGHT[1],
      2: customColors[2] ? lightenColor(customColors[2]) : DEFAULT_COLOR_LIGHT[2],
      3: customColors[3] ? lightenColor(customColors[3]) : DEFAULT_COLOR_LIGHT[3],
      4: customColors[4] ? lightenColor(customColors[4]) : DEFAULT_COLOR_LIGHT[4],
    } as Record<ColorId, string>),
    [customColors]
  );

  const [gameStarted, setGameStarted] = useState(DEV_SKIP);
  const [state, setState] = useState<GameState>(makeInitialState);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Shape | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [message, setMessage] = useState<string>("");
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [submitFeedback, setSubmitFeedback] = useState<"illegal" | null>(null);
  const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(null);
  const [opponentAbandoned, setOpponentAbandoned] = useState(false);

  const socketRef = useRef<BlokusSocket | null>(null);
  const boardGridRef = useRef<HTMLDivElement>(null);
  const selectedPieceIdRef = useRef(selectedPieceId);
  const [myPlayerId, setMyPlayerId] = useState<PlayerId | null>(null);
  const [myName, setMyName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [lobbyStatus, setLobbyStatus] = useState<"idle" | "waiting">("idle");
  const [gameSettings, setGameSettings] = useState<GameSettings>({ mode: "classic", timerSeconds: 20 });
  const [turnTimeLeft, setTurnTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    return () => { socketRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (disconnectCountdown === null) return;
    if (disconnectCountdown <= 0) {
      setDisconnectCountdown(null);
      setOpponentAbandoned(true);
      setGameOverDismissed(false);
      return;
    }
    const t = setTimeout(() => setDisconnectCountdown((d) => (d !== null ? d - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [disconnectCountdown]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const isFirstMoveFor: Record<ColorId, boolean> = {
    1: !state.history.some((h) => h.color === 1),
    2: !state.history.some((h) => h.color === 2),
    3: !state.history.some((h) => h.color === 3),
    4: !state.history.some((h) => h.color === 4),
  };

  const allDone =
    COLOR_ORDER.every((c) => state.passed[c] || state.finished[c]) ||
    state.consecutivePasses >= 4;
  const gameOver = allDone;

  const currentPlayer = PLAYER_FOR_COLOR[state.current];
  const isMyTurn = myPlayerId === null || currentPlayer === myPlayerId;
  const isMyTurnRef = useRef(isMyTurn);
  isMyTurnRef.current = isMyTurn;
  const currentColorRef = useRef(state.current);
  currentColorRef.current = state.current;

  const nextUpColor: ColorId | null = useMemo(() => {
    if (!myPlayerId) return null;
    const mine = COLORS_FOR[myPlayerId];
    const idx = COLOR_ORDER.indexOf(state.current);
    for (let i = 1; i <= 4; i++) {
      const c = COLOR_ORDER[(idx + i) % 4] as ColorId;
      if (mine.includes(c) && !state.passed[c] && !state.finished[c]) return c;
    }
    return null;
  }, [myPlayerId, state.current, state.passed, state.finished]);

  useEffect(() => {
    if (selectedPieceId) {
      setOrientation(PIECE_BY_ID[selectedPieceId].shape);
    } else {
      setOrientation(null);
    }
  }, [selectedPieceId]);

  useEffect(() => {
    if (gameOver) return;
    const c = state.current;

    if (state.remaining[c].size === 0 || state.passed[c]) {
      const t = setTimeout(() => {
        setState((s) => ({ ...s, current: nextColor(s.current) }));
      }, 250);
      return () => clearTimeout(t);
    }

    const canMove = hasAnyLegalMove(state.board, c, state.remaining[c], isFirstMoveFor[c]);
    if (!canMove) {
      setMessage(`${COLOR_NAME[c]} has no legal moves and is out for the rest of the game.`);
      const t = setTimeout(() => {
        setState((s) => ({
          ...s,
          passed: { ...s.passed, [c]: true },
          current: nextColor(s.current),
          consecutivePasses: s.consecutivePasses + 1,
        }));
      }, 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.current, state.board, gameOver]);

  useEffect(() => {
    if (gameSettings.mode !== "timed" || !gameStarted || gameOver) {
      setTurnTimeLeft(null);
      return;
    }
    setTurnTimeLeft(gameSettings.timerSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.current, gameStarted, gameOver, gameSettings.mode, gameSettings.timerSeconds]);

  useEffect(() => {
    if (turnTimeLeft === null || turnTimeLeft <= 0) return;
    const t = setTimeout(() => setTurnTimeLeft((v) => (v !== null ? v - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [turnTimeLeft]);

  useEffect(() => {
    if (turnTimeLeft !== 0 || gameOver) return;
    if (!isMyTurnRef.current) return;
    const c = currentColorRef.current;
    setState((prev) => {
      const newState: GameState = {
        ...prev,
        current: nextColor(prev.current),
        consecutivePasses: prev.consecutivePasses + 1,
      };
      socketRef.current?.sendMove(serializeState(newState));
      return newState;
    });
    setSelectedPieceId(null);
    setOrientation(null);
    setMessage(`Time's up! ${COLOR_NAME[c]}'s turn was skipped.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnTimeLeft, gameOver]);

  function makeSocketHandlers(socket: BlokusSocket) {
    socket.onEvent = (event: ServerEvent) => {
      if (event.type === "start") {
        setMyPlayerId(event.playerId as PlayerId);
        setOpponentName(event.opponentName);
        setGameStarted(true);
        setLobbyStatus("idle");
        setRematchWaiting(false);
        setMessage("");
      } else if (event.type === "rejoined") {
        setMyPlayerId(event.playerId as PlayerId);
        setOpponentName(event.opponentName);
        if (event.state) setState(deserializeState(event.state));
        setGameStarted(true);
        setLobbyStatus("idle");
        setRematchWaiting(false);
        setMessage("Reconnected!");
      } else if (event.type === "state") {
        setState(deserializeState(event.state));
      } else if (event.type === "reconnecting") {
        setMessage("Connection lost — reconnecting…");
      } else if (event.type === "opponent_reconnected") {
        setDisconnectCountdown(null);
        setMessage("Opponent reconnected!");
      } else if (event.type === "opponent_disconnected") {
        setDisconnectCountdown(60);
      } else if (event.type === "game_abandoned") {
        setDisconnectCountdown(null);
        setOpponentAbandoned(true);
        setGameOverDismissed(false);
      }
    };
  }

  function wsUrl() {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return import.meta.env.VITE_WS_URL ?? `${proto}://${window.location.host}/ws`;
  }

  function handleFindGame(name: string, preferredSide: "A" | "B", settings: GameSettings) {
    setMyName(name);
    setGameSettings(settings);
    setLobbyStatus("waiting");
    const socket = new BlokusSocket();
    socketRef.current = socket;
    makeSocketHandlers(socket);
    socket.connect(wsUrl(), name, preferredSide);
  }

  function handleCreateLobby(name: string, preferredSide: "A" | "B", settings: GameSettings) {
    setMyName(name);
    setGameSettings(settings);
    setLobbyStatus("waiting");
    setLobbyCode(null);
    setLobbyError(null);
    const socket = new BlokusSocket();
    socketRef.current = socket;
    socket.onEvent = (event: ServerEvent) => {
      if (event.type === "lobby_created") {
        setLobbyCode(event.code);
      } else {
        makeSocketHandlers(socket);
        socket.onEvent!(event);
      }
    };
    socket.createLobby(wsUrl(), name, preferredSide);
  }

  function handleJoinLobby(name: string, code: string, settings: GameSettings) {
    setMyName(name);
    setGameSettings(settings);
    setLobbyStatus("waiting");
    setLobbyCode(null);
    setLobbyError(null);
    const socket = new BlokusSocket();
    socketRef.current = socket;
    socket.onEvent = (event: ServerEvent) => {
      if (event.type === "lobby_not_found") {
        setLobbyError("Game code not found. Check the code and try again.");
        setLobbyStatus("idle");
      } else {
        makeSocketHandlers(socket);
        socket.onEvent!(event);
      }
    };
    socket.joinLobby(wsUrl(), name, code);
  }

  function rotateSelected() {
    if (!orientation) return;
    setOrientation(rotateCW(orientation));
  }
  function flipSelected() {
    if (!orientation) return;
    setOrientation(flipH(orientation));
  }

  function tryPlaceAt(r: number, c: number) {
    if (gameOver || !isMyTurn || !selectedPieceId || !orientation) return;
    const color = state.current;
    if (!state.remaining[color].has(selectedPieceId)) return;

    const v = validatePlacement(state.board, color, orientation, r, c, isFirstMoveFor[color]);
    if (!v.ok) {
      setMessage("That's illegal!");
      return;
    }

    const newBoard = state.board.map((row) => [...row]) as Board;
    const placedCells: [number, number][] = [];
    for (const [dr, dc] of shapeCells(orientation)) {
      const rr = r + dr;
      const cc = c + dc;
      newBoard[rr][cc] = color;
      placedCells.push([rr, cc]);
    }

    const newRemaining = { ...state.remaining };
    newRemaining[color] = new Set(state.remaining[color]);
    newRemaining[color].delete(selectedPieceId);

    const wasMonomino = selectedPieceId === "I1";
    const finished = { ...state.finished };
    if (newRemaining[color].size === 0) finished[color] = true;

    const newState: GameState = {
      ...state,
      board: newBoard,
      remaining: newRemaining,
      history: [...state.history, { color, pieceId: selectedPieceId, cells: placedCells }],
      current: nextColor(color),
      consecutivePasses: 0,
      finished,
      lastPlacedWasMonomino: { ...state.lastPlacedWasMonomino, [color]: wasMonomino },
    };

    setState(newState);
    socketRef.current?.sendMove(serializeState(newState));
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
  }

  function manualPass() {
    if (gameOver || !isMyTurn) return;
    const c = state.current;
    const newState: GameState = {
      ...state,
      passed: { ...state.passed, [c]: true },
      current: nextColor(state.current),
      consecutivePasses: state.consecutivePasses + 1,
    };
    setState(newState);
    socketRef.current?.sendMove(serializeState(newState));
    setSelectedPieceId(null);
    setOrientation(null);
    setMessage(`${COLOR_NAME[c]} resigned (no more moves this game).`);
  }

  function skipTurn() {
    if (gameOver || !isMyTurn) return;
    const c = state.current;
    const newState: GameState = {
      ...state,
      current: nextColor(state.current),
      consecutivePasses: state.consecutivePasses + 1,
    };
    setState(newState);
    socketRef.current?.sendMove(serializeState(newState));
    setSelectedPieceId(null);
    setOrientation(null);
    setMessage(`${COLOR_NAME[c]} skipped their turn.`);
  }

  function resetGame() {
    socketRef.current?.close();
    socketRef.current = null;
    setState(makeInitialState());
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
    setMyPlayerId(null);
    setMyName("");
    setOpponentName("");
    setLobbyStatus("idle");
    setGameStarted(false);
    setGameOverDismissed(false);
    setRematchWaiting(false);
    setLobbyCode(null);
    setLobbyError(null);
    setDisconnectCountdown(null);
    setOpponentAbandoned(false);
    setTurnTimeLeft(null);
    setGameSettings({ mode: "classic", timerSeconds: 20 });
  }

  function handleRematch() {
    const nextSide: PlayerId = myPlayerId === "A" ? "B" : "A";
    const name = myName;
    socketRef.current?.close();
    socketRef.current = null;
    setState(makeInitialState());
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
    setGameOverDismissed(false);
    setMyPlayerId(null);
    setOpponentName("");
    setGameStarted(false);
    setRematchWaiting(true);
    setLobbyCode(null);
    setLobbyError(null);
    setDisconnectCountdown(null);
    setOpponentAbandoned(false);
    handleFindGame(name, nextSide, gameSettings);
  }

  const preview = useMemo(() => {
    if (!hover || !orientation || !selectedPieceId || gameOver || !isMyTurn) return null;
    const color = state.current;
    const cells: [number, number][] = [];
    let allInBounds = true;
    for (const [dr, dc] of shapeCells(orientation)) {
      const r = hover.r + dr;
      const c = hover.c + dc;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) allInBounds = false;
      cells.push([r, c]);
    }
    const v = validatePlacement(state.board, color, orientation, hover.r, hover.c, isFirstMoveFor[color]);
    return { cells, ok: v.ok && allInBounds, color };
  }, [hover, orientation, selectedPieceId, state, gameOver, isMyTurn, isFirstMoveFor]);

  // -------------------- Rendering --------------------

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isMobile = windowWidth < 600;

  selectedPieceIdRef.current = selectedPieceId;

  useEffect(() => {
    if (!isMobile) return;
    const el = boardGridRef.current;
    if (!el) return;

    const getCell = (touch: Touch) => {
      const rect = el.getBoundingClientRect();
      let relX = touch.clientX - rect.left;
      let relY = touch.clientY - rect.top;
      if (myPlayerId === "B") {
        relX = rect.width - relX;
        relY = rect.height - relY;
      }
      const cellPluGap = rect.width / BOARD_SIZE;
      return {
        r: Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor(relY / cellPluGap))),
        c: Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor(relX / cellPluGap))),
      };
    };

    const handler = (e: TouchEvent) => {
      if (!selectedPieceIdRef.current) return;
      e.preventDefault();
      setHover(getCell(e.touches[0]));
    };

    el.addEventListener("touchstart", handler, { passive: false });
    el.addEventListener("touchmove", handler, { passive: false });
    return () => {
      el.removeEventListener("touchstart", handler);
      el.removeEventListener("touchmove", handler);
    };
  }, [isMobile, myPlayerId]);

  const cellSize = isMobile
    ? Math.max(11, Math.floor((windowWidth - 75) / BOARD_SIZE))
    : Math.min(34, Math.max(18, Math.floor((windowWidth * 0.46 - 32) / BOARD_SIZE)));

  const boardPx = cellSize * BOARD_SIZE + 20 + 8;
  const containerW = Math.min(1600, windowWidth) - 48;
  const panelW = isMobile
    ? containerW
    : Math.min(700, Math.max(380, containerW - boardPx - 20));
  const trayW = (panelW - 8) / 2;
  const trayCellPx = Math.max(8, Math.min(14, Math.floor(trayW / 26)));

  const teamA = teamScore(state, "A");
  const teamB = teamScore(state, "B");

  const nameFor = (player: PlayerId): string => {
    if (!myPlayerId) return player === "A" ? "Player A" : "Player B";
    return player === myPlayerId ? myName : opponentName;
  };

  let winnerText: string | null = null;
  if (opponentAbandoned) {
    winnerText = `${opponentName || "Opponent"} left the game.`;
  } else if (gameOver) {
    if (teamA < teamB) winnerText = `${nameFor("A")} wins! ${teamA} to ${teamB}.`;
    else if (teamB < teamA) winnerText = `${nameFor("B")} wins! ${teamB} to ${teamA}.`;
    else winnerText = `Tie! Both teams scored ${teamA}.`;
  }

  if (!gameStarted) {
    if (rematchWaiting) {
      return (
        <div style={{ ...LOBBY_BG, gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 48, letterSpacing: 4, fontWeight: 800 }}>BLOKUS BESTIES</h1>
          <div style={{ ...CARD_STYLE, alignItems: "center", textAlign: "center" }}>
            <Spinner />
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 15 }}>
              Waiting for {opponentName || "opponent"} to rematch…
            </p>
            <button onClick={resetGame} style={{ ...btn("ghost"), fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      );
    }
    return (
      <LobbyPage
        status={lobbyStatus}
        onFindGame={handleFindGame}
        onCreateLobby={handleCreateLobby}
        onJoinLobby={handleJoinLobby}
        lobbyCode={lobbyCode}
        lobbyError={lobbyError}
        onClearError={() => setLobbyError(null)}
        customColors={{ ...DEFAULT_COLOR_HEX, ...customColors }}
        onCustomColorChange={(id, hex) => setCustomColors((prev) => ({ ...prev, [id]: hex }))}
      />
    );
  }

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        padding: 24,
        color: "#f8fafc",
        background: "linear-gradient(135deg, #0d1117 0%, #1f0d14 50%, #0d1117 100%)",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexDirection: isMobile ? "column" : "row" }}>

          {/* Board */}
          <div style={isMobile ? { display: "flex", justifyContent: "center", width: "100%" } : undefined}>
            <div style={{ display: "inline-block", padding: 4, background: "#0d1117", borderRadius: 8, boxShadow: "0 0 40px rgba(16, 185, 129, 0.25), 0 8px 32px rgba(0,0,0,0.6)" }}>
              <div
                ref={boardGridRef}
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
                  gridTemplateRows: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
                  gap: 1,
                  background: "#161b22",
                  transform: myPlayerId === "B" ? "rotate(180deg)" : undefined,
                }}
                onMouseLeave={() => setHover(null)}
              >
                {(() => {
                  const lastMove = state.history.length > 0 ? state.history[state.history.length - 1] : null;
                  const lastMoveCellSet = lastMove
                    ? new Set(lastMove.cells.map(([r, c]) => `${r}-${c}`))
                    : new Set<string>();
                  return Array.from({ length: BOARD_SIZE }).map((_, r) =>
                    Array.from({ length: BOARD_SIZE }).map((_, c) => {
                      const cell = state.board[r][c];
                      const startColor = (Object.keys(START_SQUARES) as unknown as ColorId[])
                        .map((k) => Number(k) as ColorId)
                        .find((col) => START_SQUARES[col][0] === r && START_SQUARES[col][1] === c);

                      let bg = cell ? COLOR_HEX[cell] : "#ffffff";
                      let outline = "none";
                      let boxShadow: string | undefined;
                      if (preview) {
                        const inPreview = preview.cells.some(([pr, pc]) => pr === r && pc === c);
                        if (inPreview) {
                          bg = preview.ok ? COLOR_LIGHT[preview.color] : "#fde2e2";
                          outline = preview.ok ? `2px solid ${COLOR_HEX[preview.color]}` : "2px solid #dc2626";
                        }
                      } else if (lastMove && lastMoveCellSet.has(`${r}-${c}`)) {
                        boxShadow = `inset 0 0 0 2px white, inset 0 0 0 3px ${COLOR_HEX[lastMove.color]}, 0 0 6px 2px ${COLOR_HEX[lastMove.color]}`;
                      }

                      return (
                        <div
                          key={`${r}-${c}`}
                          onMouseEnter={() => setHover({ r, c })}
                          onClick={isMobile ? undefined : () => tryPlaceAt(r, c)}
                          style={{
                            width: cellSize,
                            height: cellSize,
                            background: bg,
                            outline,
                            outlineOffset: -2,
                            boxShadow,
                            cursor: selectedPieceId && isMyTurn ? "pointer" : "default",
                            position: "relative",
                            zIndex: boxShadow ? 1 : undefined,
                          }}
                        >
                          {startColor && cell === 0 && (
                            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: COLOR_HEX[startColor], opacity: 0.6, fontSize: 16, pointerEvents: "none" }}>
                              ●
                            </div>
                          )}
                        </div>
                      );
                    })
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Side panel */}
          <div style={{ width: isMobile ? "100%" : undefined, minWidth: isMobile ? 0 : 380, maxWidth: isMobile ? "100%" : 700 }}>
            <ScorePanel state={state} teamA={teamA} teamB={teamB} nameFor={nameFor} gameOver={gameOver} colorHex={COLOR_HEX} colorLight={COLOR_LIGHT} />

            {gameOver && gameOverDismissed && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => setGameOverDismissed(false)} style={{ ...btn(), flex: 1 }}>View results</button>
                <button onClick={handleRematch} style={{ ...btn("warn"), flex: 1 }}>Play again</button>
              </div>
            )}

            {message && <GameMessage message={message} />}

            {disconnectCountdown !== null && (
              <div style={{ marginTop: 8, padding: "10px 14px", background: "rgba(245,158,11,0.15)", border: "1px solid #f59e0b", borderRadius: 8, color: "#fde68a", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Opponent disconnected</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 15, fontWeight: 800 }}>{disconnectCountdown}s</span>
              </div>
            )}

            {!gameOver && (
              <div style={{ marginTop: 12, padding: 12, border: `2px solid ${COLOR_HEX[state.current]}`, borderRadius: 6, background: "rgba(255,255,255,0.06)", backdropFilter: "blur(8px)", boxShadow: `0 0 20px ${COLOR_HEX[state.current]}33` }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {isMyTurn ? `Your turn: ${nameFor(currentPlayer)}` : `Waiting for ${nameFor(currentPlayer)}…`}
                </div>
                <div style={{ marginBottom: 6, color: "#94a3b8", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>
                    Now playing:{" "}
                    <span style={{ background: COLOR_HEX[state.current], color: "#fff", padding: "2px 8px", borderRadius: 3, fontWeight: 600 }}>
                      {COLOR_NAME[state.current]}
                    </span>
                  </span>
                  {turnTimeLeft !== null && (
                    <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: turnTimeLeft <= 5 ? "#ef4444" : turnTimeLeft <= 10 ? "#f59e0b" : "#f8fafc", transition: "color 0.3s" }}>
                      {turnTimeLeft}s
                    </span>
                  )}
                </div>
                {turnTimeLeft !== null && (
                  <div style={{ height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginBottom: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(turnTimeLeft / gameSettings.timerSeconds) * 100}%`, background: turnTimeLeft <= 5 ? "#ef4444" : turnTimeLeft <= 10 ? "#f59e0b" : COLOR_HEX[state.current], borderRadius: 2, transition: "width 1s linear, background 0.3s" }} />
                  </div>
                )}
                {isFirstMoveFor[state.current] ? (
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>
                    First {COLOR_NAME[state.current]} move: piece must cover corner ({START_SQUARES[state.current][0] + 1}, {START_SQUARES[state.current][1] + 1}).
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>
                    Must touch a diagonal corner of an existing {COLOR_NAME[state.current]} piece, with no shared edges.
                  </div>
                )}

                {isMyTurn && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={rotateSelected} disabled={!orientation} style={btn()}>Rotate ⟳</button>
                    <button onClick={flipSelected} disabled={!orientation} style={btn()}>Flip ⇋</button>
                    <button onClick={() => setSelectedPieceId(null)} disabled={!selectedPieceId} style={btn()}>Deselect</button>
                    <button onClick={skipTurn} style={btn()}>Skip turn</button>
                    <button onClick={manualPass} style={btn("warn")}>Resign {COLOR_NAME[state.current]}</button>
                  </div>
                )}

                {orientation && isMyTurn && isMobile && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>Drag on the board to position, then tap Place:</div>
                    {submitFeedback === "illegal" && (
                      <div style={{ padding: "8px 12px", background: "rgba(220,38,38,0.2)", border: "1px solid #dc2626", borderRadius: 6, color: "#fca5a5", fontSize: 14, fontWeight: 600, textAlign: "center" }}>
                        That's illegal!
                      </div>
                    )}
                    <button
                      disabled={!hover}
                      onClick={() => {
                        if (!hover || !orientation) return;
                        const color = state.current;
                        const v = validatePlacement(state.board, color, orientation, hover.r, hover.c, isFirstMoveFor[color]);
                        if (v.ok) {
                          tryPlaceAt(hover.r, hover.c);
                          setSubmitFeedback(null);
                        } else {
                          setSubmitFeedback("illegal");
                          setTimeout(() => setSubmitFeedback(null), 2000);
                        }
                      }}
                      style={{
                        padding: "12px 0",
                        fontSize: 15,
                        fontWeight: 700,
                        borderRadius: 8,
                        border: "none",
                        background: hover ? `linear-gradient(135deg, ${COLOR_HEX[state.current]}, ${COLOR_HEX[state.current]}99)` : "rgba(255,255,255,0.08)",
                        color: hover ? "#fff" : "#475569",
                        cursor: hover ? "pointer" : "not-allowed",
                        boxShadow: hover ? `0 0 20px ${COLOR_HEX[state.current]}55` : "none",
                      }}
                    >
                      Place Piece
                    </button>
                  </div>
                )}

                {orientation && isMyTurn && !isMobile && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Click a board cell to place — that cell becomes the piece's top-left corner:</div>
                    <div style={{ transform: myPlayerId === "B" ? "rotate(180deg)" : undefined, display: "inline-block" }}>
                      <ShapePreview shape={orientation} color={COLOR_HEX[state.current]} cellPx={20} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!gameOver && (
              <div style={{ display: "flex", flexDirection: "row", gap: 8, marginTop: 12 }}>
                {(myPlayerId ? COLORS_FOR[myPlayerId] : [state.current]).map((color) => {
                  const isActive = isMyTurn && color === state.current;
                  const isNext = !isActive && color === nextUpColor;
                  return (
                    <div
                      key={color}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        border: isActive ? `2px solid ${COLOR_HEX[color]}` : `1px solid rgba(255,255,255,0.1)`,
                        borderRadius: 8,
                        padding: "8px 8px 6px",
                        background: isActive ? `${COLOR_HEX[color]}11` : "rgba(255,255,255,0.02)",
                        boxShadow: isActive ? `0 0 20px ${COLOR_HEX[color]}33` : "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: COLOR_HEX[color], flexShrink: 0 }} />
                        <strong style={{ fontSize: 12 }}>{COLOR_NAME[color]}</strong>
                        <span style={{ fontSize: 10, color: "#64748b" }}>{state.remaining[color].size} left</span>
                        {isActive && (
                          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, background: COLOR_HEX[color], color: "#fff", padding: "1px 6px", borderRadius: 10 }}>
                            Playing
                          </span>
                        )}
                        {isNext && (
                          <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8", padding: "1px 6px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)" }}>
                            Up next
                          </span>
                        )}
                      </div>
                      <PieceTray
                        color={color}
                        remaining={state.remaining}
                        selectedPieceId={isActive ? selectedPieceId : null}
                        onPick={isActive ? (id) => setSelectedPieceId(id) : () => {}}
                        disabled={!isActive}
                        hideTitle
                        cellPx={trayCellPx}
                        colorHex={COLOR_HEX}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game-over modal */}
      {(gameOver || opponentAbandoned) && !gameOverDismissed && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
          <div style={{ background: "linear-gradient(160deg, #1f0d14 0%, #0d1117 100%)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "40px 36px", maxWidth: 420, width: "100%", textAlign: "center", boxShadow: "0 0 80px rgba(236,72,153,0.3), 0 24px 64px rgba(0,0,0,0.7)", position: "relative" }}>
            <button onClick={() => setGameOverDismissed(true)} style={{ position: "absolute", top: 12, right: 14, background: "transparent", border: "none", color: "#94a3b8", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4 }} aria-label="Close">×</button>
            <div style={{ fontSize: 56, marginBottom: 12 }}>
              {opponentAbandoned ? "🚪" : teamA < teamB ? "🏆" : teamB < teamA ? "🏆" : "🤝"}
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>
              {opponentAbandoned ? "Opponent Left" : "Game Over"}
            </h2>
            <p style={{ margin: "0 0 28px", color: "#f9a8d4", fontSize: 16 }}>{winnerText}</p>

            <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
              {(["A", "B"] as PlayerId[]).map((player) => {
                const score = player === "A" ? teamA : teamB;
                const isWinner = (player === "A" && teamA < teamB) || (player === "B" && teamB < teamA);
                return (
                  <div key={player} style={{ flex: 1, padding: "14px 12px", borderRadius: 12, border: isWinner ? "1px solid rgba(236,72,153,0.6)" : "1px solid rgba(255,255,255,0.1)", background: isWinner ? "rgba(236,72,153,0.15)" : "rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>{nameFor(player)}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: isWinner ? "#f9a8d4" : "#f8fafc" }}>{score}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>points remaining</div>
                    {COLORS_FOR[player].map((c) => (
                      <div key={c} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_HEX[c], display: "inline-block" }} />
                          {COLOR_NAME[c]}
                        </span>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>{colorScore(state, c)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleRematch}
              style={{ width: "100%", padding: "14px 0", fontSize: 16, fontWeight: 700, borderRadius: 10, border: "none", background: "linear-gradient(135deg, #ec4899, #be185d)", color: "#fff", cursor: "pointer", boxShadow: "0 0 32px rgba(236,72,153,0.5)", letterSpacing: 1 }}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Blokus;
