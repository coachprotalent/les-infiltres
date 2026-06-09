import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@les-infiltres/shared";
import { GameStore } from "./game.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:3000";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? process.env.CLIENT_URL ?? PUBLIC_URL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: CORS_ORIGIN, credentials: true }
});
const store = new GameStore();
const adminTokens = new Map<string, number>();

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "les-infiltres", botAi: store.botSettings().botAi });
});

app.post("/api/rooms/:roomCode/finish-defense", (req, res) => {
  const participantId = typeof req.body?.participantId === "string" ? req.body.participantId : "";
  if (!participantId) return res.status(400).json({ ok: false, error: "participantId requis." });
  const ok = store.finishDefense(req.params.roomCode, participantId);
  if (!ok) return res.status(409).json({ ok: false, error: "Defense introuvable ou deja terminee." });
  res.json({ ok: true });
});

const publicDir = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(publicDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

store.setBroadcaster((room) => {
  for (const { socketId, view } of store.views(room.code)) io.to(socketId).emit("roomState", view);
});
store.setNotifier((socketId, message) => {
  io.to(socketId).emit("toast", message);
});
store.setCloseNotifier((socketId, message) => {
  io.to(socketId).emit("roomClosed", message);
});

io.on("connection", (socket) => {
  const validateAdmin = (token: string) => {
    const createdAt = adminTokens.get(token);
    if (!createdAt) return false;
    if (Date.now() - createdAt > ADMIN_TOKEN_TTL_MS) {
      adminTokens.delete(token);
      return false;
    }
    return true;
  };

  // Enveloppe chaque handler : une exception (payload malforme, etc.) ne doit jamais crasher le process.
  const on = <E extends keyof ClientToServerEvents>(event: E, handler: (...args: any[]) => void) => {
    socket["on"](event as any, ((...args: any[]) => {
      try {
        handler(...args);
      } catch (error) {
        console.error(`[socket] erreur handler ${String(event)} :`, error instanceof Error ? error.message : error);
      }
    }) as any);
  };

  on("adminLogin", ({ username, password }, ack) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return ack({ ok: false, error: "Identifiants admin non configures." });
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return ack({ ok: false, error: "Identifiants admin invalides." });
    const token = crypto.randomBytes(32).toString("hex");
    adminTokens.set(token, Date.now());
    ack({ ok: true, token });
  });

  on("adminLogout", ({ token }) => {
    adminTokens.delete(token);
  });

  on("adminListRooms", ({ token }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    ack({ ok: true, rooms: store.adminRooms() });
  });

  on("adminRoomDetails", ({ token, code }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    const room = store.adminRoomDetails(code);
    if (!room) return ack({ ok: false, error: "Salon introuvable." });
    ack({ ok: true, room });
  });

  on("adminDeleteRoom", ({ token, code }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    if (!store.adminDeleteRoom(code)) return ack({ ok: false, error: "Salon introuvable." });
    ack({ ok: true });
  });

  on("getServerSettings", (ack) => {
    ack(store.botSettings());
  });

  on("createRoom", (payload, ack) => {
    ack(store.createRoom(payload.name, payload.audioMode, socket.id, payload.sessionId, payload.config, payload.botConfig));
  });

  on("joinRoom", (payload, ack) => {
    ack(store.joinRoom(payload.code, payload.name, socket.id, payload.sessionId));
  });

  on("reconnectRoom", (payload, ack) => {
    ack(store.reconnect(payload.code, payload.sessionId, socket.id));
  });

  on("updateConfig", ({ code, config }) => store.updateConfig(code, socket.id, config));
  on("updateBotConfig", ({ code, botConfig }) => store.updateBotConfig(code, socket.id, botConfig));
  on("updateAudioMode", ({ code, audioMode }) => store.updateAudioMode(code, socket.id, audioMode));
  on("closeRoom", ({ code }) => store.closeRoom(code, socket.id));
  on("leaveRoom", ({ code }) => store.leaveRoom(code, socket.id));
  on("startGame", ({ code }) => store.startGame(code, socket.id));
  on("addBot", ({ code }) => store.addBot(code, socket.id));
  on("addBots", ({ code, count }) => store.addBots(code, socket.id, count));
  on("fillWithBots", ({ code, targetCount }) => store.fillWithBots(code, socket.id, targetCount));
  on("removeParticipant", ({ code, playerId }) => store.removeParticipant(code, socket.id, playerId));
  on("nominateMayor", ({ code, targetId }) => store.nominateMayor(code, socket.id, targetId));
  on("electMayor", ({ code, targetId }) => store.electMayor(code, socket.id, targetId));
  on("adminNext", ({ code }) => store.adminNext(code, socket.id));
  on("endGame", ({ code }) => store.endGame(code, socket.id));
  on("returnToLobby", ({ code }) => store.returnToLobby(code, socket.id));
  on("nightAction", ({ code, ...action }) => store.nightAction(code, socket.id, action));
  on("finishNightStep", ({ code }) => store.finishNightStep(code, socket.id));
  on("startDebate", ({ code, seconds }) => store.startDebate(code, socket.id, seconds));
  on("grantSpeech", ({ code, playerId, seconds }) => store.grantSpeech(code, socket.id, playerId, seconds));
  on("stopSpeech", ({ code }) => store.stopSpeech(code, socket.id));
  on("finishDefense", ({ code, participantId }) => store.finishDefense(code, participantId, socket.id));
  on("closeDebate", ({ code }) => store.closeDebate(code, socket.id));
  on("nominate", ({ code, targetId }) => store.nominate(code, socket.id, targetId));
  on("requestDefense", ({ code }) => store.requestDefense(code, socket.id));
  on("denyDefense", ({ code, playerId }) => store.denyDefense(code, socket.id, playerId));
  on("startVote", ({ code, seconds }) => store.startVote(code, socket.id, seconds));
  on("vote", ({ code, targetId }) => store.vote(code, socket.id, targetId));
  on("sendChat", ({ code, text }) => store.sendChat(code, socket.id, text));
  on("setMuted", ({ code, playerId, muted }) => store.setMuted(code, socket.id, playerId, muted));
  on("audioActivity", ({ code, speaking }) => store.audioActivity(code, socket.id, speaking));
  on("audioTranscript", ({ code, text }) => store.audioTranscript(code, socket.id, text));
  on("rtcSignal", ({ code, to, signal }) => {
    const fromView = store.viewBySocket(code, socket.id);
    if (!fromView?.you) return;
    if (fromView.audioMode !== "integrated") return socket.emit("toast", "L'audio integre n'est pas actif dans cette partie.");
    if (!store.canRelayRtcSignal(code, socket.id, to)) return;
    const targetSocketId = store.socketIdForPlayer(code, to);
    if (targetSocketId) io.to(targetSocketId).emit("rtcSignal", { from: fromView.you.id, signal });
  });
  socket.on("disconnect", () => store.disconnect(socket.id));
});

server.listen(PORT, HOST, () => {
  console.log(`Les Infiltrés listening on http://${HOST}:${PORT}`);
});
