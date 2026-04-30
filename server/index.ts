import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import crypto from "crypto";

type PlayerId = "A" | "B";

interface JoinMsg         { type: "join";         name: string; preferredSide: PlayerId }
interface RejoinMsg       { type: "rejoin";       token: string }
interface MoveMsg         { type: "move";         state: unknown }
interface CreateLobbyMsg  { type: "create_lobby"; name: string; preferredSide: PlayerId }
interface JoinLobbyMsg    { type: "join_lobby";   name: string; code: string }
type ClientMsg = JoinMsg | RejoinMsg | MoveMsg | CreateLobbyMsg | JoinLobbyMsg;

const PORT = Number(process.env.PORT ?? 3001);
const GRACE_MS = 60_000; // wait 60s before declaring a player gone

interface PlayerSlot {
  token: string;
  name: string;
  ws: WebSocket | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

interface Game {
  id: string;
  players: Record<PlayerId, PlayerSlot>;
  state: unknown; // latest serialized game state (null until first move)
}

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Blokus WS server");
});

const wss = new WebSocketServer({ server: httpServer });

// token  → session info
const sessions = new Map<string, { game: Game; playerId: PlayerId }>();
// socket → session info
const sockets  = new Map<WebSocket, { game: Game; playerId: PlayerId }>();

let waiting: { ws: WebSocket; name: string; preferredSide: PlayerId } | null = null;

// code → private lobby creator
const privateLobbies = new Map<string, { ws: WebSocket; name: string; preferredSide: PlayerId }>();

function generateCode(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g. "A3F2C1"
}

function send(ws: WebSocket | null, payload: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function other(side: PlayerId): PlayerId {
  return side === "A" ? "B" : "A";
}

wss.on("connection", (ws) => {
  console.log(`Client connected (${wss.clients.size} total)`);

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(raw.toString()) as ClientMsg; }
    catch { return; }

    // ── Rejoin ──────────────────────────────────────────────────────────────
    if (msg.type === "rejoin") {
      const session = sessions.get(msg.token);
      if (!session) {
        send(ws, { type: "rejoin_failed" });
        console.log(`Rejoin failed — token not found`);
        return;
      }

      const { game, playerId } = session;
      const slot        = game.players[playerId];
      const partnerSlot = game.players[other(playerId)];

      // Cancel the grace timer
      if (slot.disconnectTimer) {
        clearTimeout(slot.disconnectTimer);
        slot.disconnectTimer = null;
      }

      // Swap old socket for new one
      if (slot.ws) {
        sockets.delete(slot.ws);
        slot.ws.onclose = null;
        slot.ws.close();
      }
      slot.ws = ws;
      sockets.set(ws, { game, playerId });

      send(ws, {
        type: "rejoined",
        playerId,
        opponentName: partnerSlot.name,
        state: game.state ?? null,
      });
      send(partnerSlot.ws, { type: "opponent_reconnected" });
      console.log(`${slot.name} rejoined game ${game.id}`);
      return;
    }

    // ── New join ─────────────────────────────────────────────────────────────
    if (msg.type === "join") {
      if (!waiting) {
        waiting = { ws, name: msg.name, preferredSide: msg.preferredSide };
        send(ws, { type: "waiting" });
        console.log(`${msg.name} is waiting for an opponent`);
      } else {
        const { ws: partnerWs, name: partnerName, preferredSide: partnerPref } = waiting;
        waiting = null;

        const gameId   = crypto.randomUUID();
        const tokenA   = crypto.randomUUID();
        const tokenB   = crypto.randomUUID();
        const sideA: PlayerId = partnerPref;
        const sideB: PlayerId = other(sideA);

        const game: Game = {
          id: gameId,
          players: {
            [sideA]: { token: tokenA, name: partnerName, ws: partnerWs, disconnectTimer: null },
            [sideB]: { token: tokenB, name: msg.name,    ws,            disconnectTimer: null },
          } as Record<PlayerId, PlayerSlot>,
          state: null,
        };

        sessions.set(tokenA, { game, playerId: sideA });
        sessions.set(tokenB, { game, playerId: sideB });
        sockets.set(partnerWs, { game, playerId: sideA });
        sockets.set(ws,        { game, playerId: sideB });

        send(partnerWs, { type: "start", playerId: sideA, opponentName: msg.name,    token: tokenA });
        send(ws,        { type: "start", playerId: sideB, opponentName: partnerName, token: tokenB });
        console.log(`Paired: ${partnerName} (${sideA}) vs ${msg.name} (${sideB}) [${gameId}]`);
      }
      return;
    }

    // ── Create private lobby ─────────────────────────────────────────────────
    if (msg.type === "create_lobby") {
      const code = generateCode();
      privateLobbies.set(code, { ws, name: msg.name, preferredSide: msg.preferredSide });
      send(ws, { type: "lobby_created", code });
      console.log(`${msg.name} created private lobby [${code}]`);
      return;
    }

    // ── Join private lobby ───────────────────────────────────────────────────
    if (msg.type === "join_lobby") {
      const code = msg.code.toUpperCase();
      const lobby = privateLobbies.get(code);
      if (!lobby) {
        send(ws, { type: "lobby_not_found" });
        return;
      }
      privateLobbies.delete(code);

      const { ws: partnerWs, name: partnerName, preferredSide: partnerPref } = lobby;
      const gameId = crypto.randomUUID();
      const tokenA = crypto.randomUUID();
      const tokenB = crypto.randomUUID();
      const sideA: PlayerId = partnerPref;
      const sideB: PlayerId = other(sideA);

      const game: Game = {
        id: gameId,
        players: {
          [sideA]: { token: tokenA, name: partnerName, ws: partnerWs, disconnectTimer: null },
          [sideB]: { token: tokenB, name: msg.name,    ws,            disconnectTimer: null },
        } as Record<PlayerId, PlayerSlot>,
        state: null,
      };

      sessions.set(tokenA, { game, playerId: sideA });
      sessions.set(tokenB, { game, playerId: sideB });
      sockets.set(partnerWs, { game, playerId: sideA });
      sockets.set(ws,        { game, playerId: sideB });

      send(partnerWs, { type: "start", playerId: sideA, opponentName: msg.name,    token: tokenA });
      send(ws,        { type: "start", playerId: sideB, opponentName: partnerName, token: tokenB });
      console.log(`Private game: ${partnerName} (${sideA}) vs ${msg.name} (${sideB}) [${gameId}]`);
      return;
    }

    // ── Move relay ───────────────────────────────────────────────────────────
    if (msg.type === "move") {
      const session = sockets.get(ws);
      if (!session) return;
      const { game, playerId } = session;
      game.state = msg.state; // persist latest state for reconnectors
      send(game.players[other(playerId)].ws, { type: "state", state: msg.state });
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected (${wss.clients.size} remaining)`);

    if (waiting?.ws === ws) { waiting = null; return; }

    for (const [code, lobby] of privateLobbies) {
      if (lobby.ws === ws) { privateLobbies.delete(code); return; }
    }

    const session = sockets.get(ws);
    if (!session) return;
    sockets.delete(ws);

    const { game, playerId } = session;
    const slot        = game.players[playerId];
    const partnerSlot = game.players[other(playerId)];

    slot.ws = null;

    // Start grace period — notify partner only if player doesn't come back.
    slot.disconnectTimer = setTimeout(() => {
      slot.disconnectTimer = null;
      send(partnerSlot.ws, { type: "opponent_disconnected" });
      sessions.delete(slot.token);
      sessions.delete(partnerSlot.token);
      console.log(`Game ${game.id} ended — ${slot.name} did not reconnect in time`);
    }, GRACE_MS);

    console.log(`${slot.name} disconnected — ${GRACE_MS / 1000}s grace period started`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Blokus WS server → ws://localhost:${PORT}`);
});
