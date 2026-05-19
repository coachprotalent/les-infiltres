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

  socket.on("adminLogin", ({ username, password }, ack) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return ack({ ok: false, error: "Identifiants admin non configures." });
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return ack({ ok: false, error: "Identifiants admin invalides." });
    const token = crypto.randomBytes(32).toString("hex");
    adminTokens.set(token, Date.now());
    ack({ ok: true, token });
  });

  socket.on("adminLogout", ({ token }) => {
    adminTokens.delete(token);
  });

  socket.on("adminListRooms", ({ token }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    ack({ ok: true, rooms: store.adminRooms() });
  });

  socket.on("adminRoomDetails", ({ token, code }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    const room = store.adminRoomDetails(code);
    if (!room) return ack({ ok: false, error: "Salon introuvable." });
    ack({ ok: true, room });
  });

  socket.on("adminDeleteRoom", ({ token, code }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    if (!store.adminDeleteRoom(code)) return ack({ ok: false, error: "Salon introuvable." });
    ack({ ok: true });
  });

  socket.on("getServerSettings", (ack) => {
    ack(store.botSettings());
  });

  socket.on("createRoom", (payload, ack) => {
    ack(store.createRoom(payload.name, payload.audioMode, socket.id, payload.sessionId, payload.config, payload.botConfig));
  });

  socket.on("joinRoom", (payload, ack) => {
    ack(store.joinRoom(payload.code, payload.name, socket.id, payload.sessionId));
  });

  socket.on("reconnectRoom", (payload, ack) => {
    ack(store.reconnect(payload.code, payload.sessionId, socket.id));
  });

  socket.on("updateConfig", ({ code, config }) => store.updateConfig(code, socket.id, config));
  socket.on("updateBotConfig", ({ code, botConfig }) => store.updateBotConfig(code, socket.id, botConfig));
  socket.on("updateAudioMode", ({ code, audioMode }) => store.updateAudioMode(code, socket.id, audioMode));
  socket.on("closeRoom", ({ code }) => store.closeRoom(code, socket.id));
  socket.on("leaveRoom", ({ code }) => store.leaveRoom(code, socket.id));
  socket.on("startGame", ({ code }) => store.startGame(code, socket.id));
  socket.on("addBot", ({ code }) => store.addBot(code, socket.id));
  socket.on("addBots", ({ code, count }) => store.addBots(code, socket.id, count));
  socket.on("fillWithBots", ({ code, targetCount }) => store.fillWithBots(code, socket.id, targetCount));
  socket.on("removeParticipant", ({ code, playerId }) => store.removeParticipant(code, socket.id, playerId));
  socket.on("nominateMayor", ({ code, targetId }) => store.nominateMayor(code, socket.id, targetId));
  socket.on("electMayor", ({ code, targetId }) => store.electMayor(code, socket.id, targetId));
  socket.on("adminNext", ({ code }) => store.adminNext(code, socket.id));
  socket.on("endGame", ({ code }) => store.endGame(code, socket.id));
  socket.on("returnToLobby", ({ code }) => store.returnToLobby(code, socket.id));
  socket.on("nightAction", ({ code, ...action }) => store.nightAction(code, socket.id, action));
  socket.on("finishNightStep", ({ code }) => store.finishNightStep(code, socket.id));
  socket.on("startDebate", ({ code, seconds }) => store.startDebate(code, socket.id, seconds));
  socket.on("grantSpeech", ({ code, playerId, seconds }) => store.grantSpeech(code, socket.id, playerId, seconds));
  socket.on("stopSpeech", ({ code }) => store.stopSpeech(code, socket.id));
  socket.on("finishDefense", ({ code, participantId }) => store.finishDefense(code, participantId, socket.id));
  socket.on("closeDebate", ({ code }) => store.closeDebate(code, socket.id));
  socket.on("nominate", ({ code, targetId }) => store.nominate(code, socket.id, targetId));
  socket.on("requestDefense", ({ code }) => store.requestDefense(code, socket.id));
  socket.on("denyDefense", ({ code, playerId }) => store.denyDefense(code, socket.id, playerId));
  socket.on("startVote", ({ code, seconds }) => store.startVote(code, socket.id, seconds));
  socket.on("vote", ({ code, targetId }) => store.vote(code, socket.id, targetId));
  socket.on("sendChat", ({ code, text }) => store.sendChat(code, socket.id, text));
  socket.on("setMuted", ({ code, playerId, muted }) => store.setMuted(code, socket.id, playerId, muted));
  socket.on("audioActivity", ({ code, speaking }) => store.audioActivity(code, socket.id, speaking));
  socket.on("audioTranscript", ({ code, text }) => store.audioTranscript(code, socket.id, text));
  socket.on("rtcSignal", ({ code, to, signal }) => {
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
