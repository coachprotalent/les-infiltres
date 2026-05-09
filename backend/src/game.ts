import crypto from "node:crypto";
import type { AdminRoomDetails, AdminRoomSummary, AudioMode, DefenseRequest, GameConfig, GameLogEntry, GamePhase, NightStep, PlayerPublic, PowerStatus, Role, RoomView, VoteRecord, VoteTotal, VoteViewRecord, Winner } from "@les-infiltres/shared";
import { DEFAULT_CONFIG, MAX_PLAYERS, MIN_PLAYERS, ROLE_LABELS, ROLES, generateRoleDistribution, getInfiltratorCount, getPotentialRoles, mergeConfig } from "@les-infiltres/shared";
import { NarrationService } from "./narration.js";

type Player = {
  id: string;
  sessionId: string;
  name: string;
  role?: Role;
  connected: boolean;
  alive: boolean;
  canVote: boolean;
  canSpeak: boolean;
  muted: boolean;
  speaking: boolean;
  audioActive: boolean;
  isHost: boolean;
  socketId?: string;
  secretInfo: string[];
  revealedRole?: Role;
};

type NightState = {
  stepIndex: number;
  steps: NightStep[];
  completed: Set<NightStep>;
  protectedId?: string;
  silencedId?: string;
  infiltratorVictimId?: string;
  ministerSavedVictimId?: string;
  ministerJailId?: string;
  infiltratorVotes: Map<string, string>;
};

type PowerState = {
  ministerSaveUsed: boolean;
  ministerJailUsed: boolean;
  lanceuseAlerteUsed: boolean;
  agentDoubleUsed: boolean;
};

type Room = {
  code: string;
  hostId: string;
  createdAt: number;
  mayorId?: string;
  audioMode: AudioMode;
  phase: GamePhase;
  round: number;
  config: GameConfig;
  players: Player[];
  reserveRoles: Role[];
  night: NightState;
  votes: VoteRecord[];
  mayorVotes: VoteRecord[];
  narrator: string;
  transition?: RoomView["transition"];
  timer?: NodeJS.Timeout;
  timerPulse?: NodeJS.Timeout;
  timerStartedAt?: number;
  timerDuration?: number;
  timerEndsAt?: number;
  lastResult?: string;
  winner?: Winner;
  powers: PowerState;
  pastorAttemptedIds: Set<string>;
  gameLog: GameLogEntry[];
  revoteTargets?: string[];
  nominations: VoteRecord[];
  nominees: string[];
  defenseRequests: DefenseRequest[];
};

const NIGHT_STEPS_FIRST: NightStep[] = ["agent-double", "hackeuse", "avocate", "lanceuse-alerte", "infiltres", "ministre"];
const NIGHT_STEPS: NightStep[] = ["hackeuse", "avocate", "lanceuse-alerte", "infiltres", "ministre"];

const stepRole: Partial<Record<NightStep, Role>> = {
  "agent-double": "AgentDouble",
  hackeuse: "Hackeuse",
  avocate: "Avocate",
  "lanceuse-alerte": "LanceuseAlerte",
  infiltres: "Infiltre",
  ministre: "Ministre"
};

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class GameStore {
  private rooms = new Map<string, Room>();
  private onChange: (room: Room) => void = () => undefined;
  private onToast: (socketId: string, message: string) => void = () => undefined;
  private onClose: (socketId: string, message: string) => void = () => undefined;

  setBroadcaster(onChange: (room: Room) => void) {
    this.onChange = onChange;
  }

  setNotifier(onToast: (socketId: string, message: string) => void) {
    this.onToast = onToast;
  }

  setCloseNotifier(onClose: (socketId: string, message: string) => void) {
    this.onClose = onClose;
  }

  createRoom(name: string, audioMode: AudioMode, socketId: string, sessionId = randomId(), config?: Partial<GameConfig>): RoomView {
    const code = this.createCode();
    const host = createPlayer(name, socketId, sessionId, true);
    const room: Room = {
      code,
      hostId: host.id,
      createdAt: Date.now(),
      audioMode,
      phase: "LOBBY",
      round: 0,
      config: mergeConfig(config),
      players: [host],
      reserveRoles: [],
      night: emptyNight(false),
      votes: [],
      mayorVotes: [],
      nominations: [],
      nominees: [],
      defenseRequests: [],
      narrator: "Salle creee. En attente des joueurs.",
      powers: emptyPowers(),
      pastorAttemptedIds: new Set(),
      gameLog: []
    };
    this.log(room, "system", "Salle creee.");
    this.rooms.set(code, room);
    return this.viewFor(room, host.id);
  }

  adminRooms(): AdminRoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => this.adminSummary(room))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  adminRoomDetails(code: string): AdminRoomDetails | undefined {
    const room = this.getRoom(code);
    if (!room) return undefined;
    return {
      ...this.adminSummary(room),
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        connected: player.connected,
        alive: player.alive,
        isHost: player.id === room.hostId,
        isMayor: player.id === room.mayorId
      })),
      round: room.round
    };
  }

  adminDeleteRoom(code: string) {
    const room = this.getRoom(code);
    if (!room) return false;
    this.clearTimer(room);
    const sockets = room.players.flatMap((player) => (player.socketId ? [player.socketId] : []));
    this.rooms.delete(room.code);
    for (const socketId of sockets) this.onClose(socketId, "Ce salon a été supprimé par l'administrateur.");
    return true;
  }

  joinRoom(code: string, name: string, socketId: string, sessionId = randomId()) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: "Partie introuvable." };
    if (room.phase !== "LOBBY") return { ok: false as const, error: "La partie a deja commence." };
    if (room.players.length >= room.config.maxPlayers) return { ok: false as const, error: "La partie est complete." };
    const existing = room.players.find((p) => p.sessionId === sessionId);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      this.emit(room);
      return { ok: true as const, view: this.viewFor(room, existing.id) };
    }
    const player = createPlayer(name, socketId, sessionId, false);
    room.players.push(player);
    room.narrator = `${player.name} a rejoint la salle.`;
    this.log(room, "system", `${player.name} rejoint la salle.`);
    this.emit(room);
    return { ok: true as const, view: this.viewFor(room, player.id) };
  }

  reconnect(code: string, sessionId: string, socketId: string) {
    const room = this.getRoom(code);
    const player = room?.players.find((p) => p.sessionId === sessionId);
    if (!room || !player) return { ok: false as const, error: "Session introuvable pour cette partie." };
    player.socketId = socketId;
    player.connected = true;
    this.log(room, "system", `${player.name} reconnecte.`);
    this.emit(room);
    return { ok: true as const, view: this.viewFor(room, player.id) };
  }

  disconnect(socketId: string) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) {
        player.connected = false;
        player.speaking = false;
        player.audioActive = false;
        this.emit(room);
      }
    }
  }

  leaveRoom(code: string, actorSocketId: string) {
    const room = this.getRoom(code);
    const player = room?.players.find((p) => p.socketId === actorSocketId);
    if (!room || !player) return this.reject(actorSocketId, "Partie introuvable.");
    if (room.phase === "LOBBY") return this.leaveLobby(room, player);
    player.connected = false;
    player.socketId = undefined;
    player.audioActive = false;
    if (player.alive) this.eliminate(room, player, "depart");
    room.narrator = `${player.name} a quitte la partie.`;
    this.log(room, "system", `${player.name} quitte volontairement la partie.`);
    this.checkWin(room);
    this.emit(room);
  }

  updateConfig(code: string, actorSocketId: string, config: Partial<GameConfig>) {
    const room = this.requireHost(code, actorSocketId);
    if (!room) return;
    if (room.phase !== "LOBBY") return this.reject(actorSocketId, "La configuration ne peut etre modifiee que dans le lobby.");
    const nextConfig = mergeConfig({ ...room.config, ...config, durations: { ...room.config.durations, ...config.durations } });
    if (nextConfig.maxPlayers < room.players.length) return this.reject(actorSocketId, "Le nombre maximum ne peut pas etre inferieur au nombre de joueurs deja connectes.");
    room.config = nextConfig;
    room.narrator = "Configuration avancee mise a jour.";
    this.log(room, "system", "Configuration mise a jour par l'hote.");
    this.emit(room);
  }

  updateAudioMode(code: string, actorSocketId: string, audioMode: AudioMode) {
    const room = this.requireHost(code, actorSocketId);
    if (!room) return;
    if (room.phase !== "LOBBY") return this.reject(actorSocketId, "Le mode audio ne peut etre modifie que dans le lobby.");
    room.audioMode = audioMode;
    room.players.forEach((player) => {
      player.muted = false;
      player.audioActive = false;
      player.canSpeak = true;
    });
    room.narrator = audioMode === "integrated" ? "Audio integre selectionne. Les joueurs peuvent tester leur micro." : "Audio externe selectionne.";
    this.log(room, "system", `Mode audio modifie : ${audioMode}.`);
    this.emit(room);
  }

  closeRoom(code: string, actorSocketId: string) {
    const room = this.requireHost(code, actorSocketId);
    if (!room) return;
    if (room.phase !== "LOBBY") return this.reject(actorSocketId, "Le salon ne peut etre ferme qu'avant le lancement de la partie.");
    this.clearTimer(room);
    const sockets = room.players.flatMap((player) => (player.socketId ? [player.socketId] : []));
    this.rooms.delete(room.code);
    for (const socketId of sockets) this.onClose(socketId, "Le salon a ete ferme par l'hote.");
  }

  private leaveLobby(room: Room, player: Player) {
    const leavingSocketId = player.socketId;
    room.players = room.players.filter((candidate) => candidate.id !== player.id);
    if (!room.players.length) {
      this.rooms.delete(room.code);
      if (leavingSocketId) this.onClose(leavingSocketId, "Vous avez quitte le salon.");
      return;
    }
    if (player.id === room.hostId) {
      room.hostId = room.players[0].id;
      player.isHost = false;
      room.players[0].isHost = true;
      room.narrator = `${player.name} a quitte le salon. ${room.players[0].name} devient hote.`;
      this.log(room, "system", `${player.name} quitte le salon. Hote transfere a ${room.players[0].name}.`);
    } else {
      room.narrator = `${player.name} a quitte le salon.`;
      this.log(room, "system", `${player.name} quitte le salon.`);
    }
    if (leavingSocketId) this.onClose(leavingSocketId, "Vous avez quitte le salon.");
    this.emit(room);
  }

  startGame(code: string, actorSocketId: string) {
    const room = this.requireHost(code, actorSocketId);
    if (!room) return;
    if (room.phase !== "LOBBY") return this.reject(actorSocketId, "La partie a deja commence.");
    if (room.players.length < MIN_PLAYERS) {
      room.narrator = `Il faut au moins ${MIN_PLAYERS} joueurs pour lancer la partie.`;
      this.reject(actorSocketId, room.narrator);
      return this.emit(room);
    }
    room.phase = "ROLE_DISTRIBUTION";
    this.assignRoles(room);
    room.phase = "MAYOR_ELECTION";
    room.mayorVotes = [];
    room.players.forEach((p) => {
      p.canVote = p.alive;
      p.canSpeak = p.alive;
      p.audioActive = false;
      p.muted = room.audioMode === "integrated" ? !p.alive : p.muted;
    });
    room.narrator = "Les roles sont distribues. L'election publique du Maire commence : chaque voix peut encore changer jusqu'au dernier instant.";
    this.log(room, "phase", "Roles distribues et election du Maire ouverte.");
    this.startTimer(room, room.config.durations.mayorElection, () => this.resolveMayorElection(room));
    this.emit(room);
  }

  electMayor(code: string, actorSocketId: string, targetId: string) {
    const room = this.getRoom(code);
    const voter = room?.players.find((p) => p.socketId === actorSocketId);
    const target = room?.players.find((p) => p.id === targetId);
    if (!room || !voter) return this.reject(actorSocketId, "Partie introuvable.");
    if (room.phase !== "MAYOR_ELECTION") return this.reject(actorSocketId, "Vous ne pouvez pas voter pour le Maire pendant cette phase.");
    if (!voter.alive) return this.reject(actorSocketId, "Vous etes elimine.");
    if (!voter.canVote) return this.reject(actorSocketId, "Vous ne pouvez pas voter.");
    if (!target?.alive) return this.reject(actorSocketId, "Cible invalide.");
    room.mayorVotes = room.mayorVotes.filter((vote) => vote.voterId !== voter.id).concat({ voterId: voter.id, targetId });
    this.log(room, "vote", `${voter.name} vote pour ${target.name} comme Maire.`);
    const eligible = room.players.filter((p) => p.alive && p.canVote).length;
    if (room.mayorVotes.length >= eligible) return this.resolveMayorElection(room);
    room.narrator = "Election du Maire en cours. Les derniers choix peuvent encore bouleverser la salle.";
    this.emit(room);
  }

  adminNext(code: string, actorSocketId: string) {
    const room = this.requireHost(code, actorSocketId);
    if (!room) return;
    if (room.phase === "MAYOR_ELECTION") return this.resolveMayorElection(room);
    if (room.phase === "NIGHT") return this.advanceNight(room);
    if (room.phase === "DAY_ANNOUNCEMENT") return this.startTimedPhase(room, "DEBATE", room.config.durations.freeDebate, "Debat libre en cours. Les regards cherchent la faille.");
    if (room.phase === "DEBATE") return this.startNomination(room);
    if (room.phase === "NOMINATION") return this.startDefenseRequests(room);
    if (room.phase === "DEFENSE_REQUESTS") return this.startVoteFromDefenseRequests(room);
    if (room.phase === "DEFENSE") return this.completeDefense(room);
    if (room.phase === "VOTING") return this.resolveVote(room);
    if (room.phase === "RESULT") return this.startNight(room);
    return this.reject(actorSocketId, "Aucune phase a debloquer maintenant.");
  }

  endGame(code: string, actorSocketId: string) {
    const room = this.requireHost(code, actorSocketId);
    if (!room) return;
    if (room.phase === "GAME_OVER") return this.reject(actorSocketId, "La partie est deja terminee.");
    if (room.phase === "LOBBY") return this.reject(actorSocketId, "Fermez le salon avant lancement au lieu de mettre fin a la partie.");
    this.finish(room, undefined, "Partie terminee par l'hote.");
    this.emit(room);
  }

  returnToLobby(code: string, actorSocketId: string) {
    const room = this.requireHost(code, actorSocketId);
    if (!room) return;
    if (room.phase !== "GAME_OVER") return this.reject(actorSocketId, "La partie doit etre terminee avant de revenir au lobby.");
    this.clearTimer(room);
    room.phase = "LOBBY";
    room.round = 0;
    room.mayorId = undefined;
    room.reserveRoles = [];
    room.night = emptyNight(false);
    room.votes = [];
    room.mayorVotes = [];
    room.nominations = [];
    room.nominees = [];
    room.defenseRequests = [];
    room.transition = undefined;
    room.timerStartedAt = undefined;
    room.timerDuration = undefined;
    room.timerEndsAt = undefined;
    room.lastResult = undefined;
    room.winner = undefined;
    room.revoteTargets = undefined;
    room.powers = emptyPowers();
    room.pastorAttemptedIds = new Set();
    room.narrator = "Retour au lobby. En attente du lancement par l'hote.";
    room.players.forEach((player) => {
      player.role = undefined;
      player.alive = true;
      player.canVote = true;
      player.canSpeak = true;
      player.muted = false;
      player.speaking = false;
      player.audioActive = false;
      player.secretInfo = [];
      player.revealedRole = undefined;
    });
    this.log(room, "system", "Retour au lobby par l'hote.");
    this.emit(room);
  }

  nightAction(code: string, actorSocketId: string, action: { targetId?: string; roleChoice?: Role; ministerAction?: "save" | "jail" }) {
    const room = this.getRoom(code);
    const actor = room?.players.find((p) => p.socketId === actorSocketId);
    if (!room || !actor) return this.reject(actorSocketId, "Partie introuvable.");
    if (room.phase !== "NIGHT") return this.reject(actorSocketId, "Vous ne pouvez pas agir pendant cette phase.");
    if (!actor.alive) return this.reject(actorSocketId, "Vous etes elimine.");
    const step = room.night.steps[room.night.stepIndex];
    const alive = room.players.filter((p) => p.alive);
    const hasRole = (role: Role) => actor.role === role && actor.alive;

    if (step === "agent-double" && hasRole("AgentDouble")) {
      if (room.powers.agentDoubleUsed) return this.reject(actorSocketId, "Pouvoir deja utilise.");
      if (!action.roleChoice || !room.reserveRoles.includes(action.roleChoice)) return this.reject(actorSocketId, "Choix de role invalide.");
      room.reserveRoles = room.reserveRoles.filter((role) => role !== action.roleChoice);
      if (actor.role) room.reserveRoles.push(actor.role);
      actor.role = action.roleChoice;
      room.powers.agentDoubleUsed = true;
      actor.secretInfo.push(`Vous avez choisi le role ${ROLE_LABELS[action.roleChoice]}.`);
      this.log(room, "power", `${actor.name} utilise le pouvoir Agent Double.`);
      return this.completeStep(room, step);
    }
    if (step === "hackeuse" && hasRole("Hackeuse") && action.targetId) {
      const target = alive.find((p) => p.id === action.targetId);
      if (!target?.role) return this.reject(actorSocketId, "Cible invalide.");
      actor.secretInfo.push(`${target.name} est ${ROLE_LABELS[target.role]}.`);
      this.log(room, "action", `${actor.name} consulte le role de ${target.name}.`);
      return this.completeStep(room, step);
    }
    if (step === "avocate" && hasRole("Avocate") && action.targetId && alive.some((p) => p.id === action.targetId)) {
      room.night.protectedId = action.targetId;
      this.log(room, "action", `${actor.name} protege un joueur.`);
      return this.completeStep(room, step);
    }
    if (step === "lanceuse-alerte" && hasRole("LanceuseAlerte")) {
      if (room.powers.lanceuseAlerteUsed) return this.reject(actorSocketId, "Pouvoir deja utilise.");
      if (!action.targetId || !alive.some((p) => p.id === action.targetId)) return this.reject(actorSocketId, "Cible invalide.");
      room.night.silencedId = action.targetId;
      room.powers.lanceuseAlerteUsed = true;
      actor.secretInfo.push("Vous avez utilise votre pouvoir unique de Lanceuse d'Alerte.");
      this.log(room, "power", `${actor.name} utilise le pouvoir Lanceuse d'Alerte.`);
      return this.completeStep(room, step);
    }
    if (step === "infiltres" && actor.role === "LeaderLouange") {
      room.night.infiltratorVictimId = undefined;
      room.narrator = "Le Leader de Louange entonne un cantique. Tout le monde ouvre les yeux et le jour commence.";
      this.log(room, "power", `${actor.name} interrompt la nuit avec un cantique.`);
      return this.resolveNight(room);
    }
    if (step === "infiltres" && actor.role === "Infiltre" && action.targetId) {
      const target = alive.find((p) => p.id === action.targetId && p.role !== "Infiltre");
      if (!target) return this.reject(actorSocketId, "Les Infiltres doivent cibler un joueur vivant qui n'est pas Infiltre.");
      room.night.infiltratorVotes.set(actor.id, target.id);
      room.night.infiltratorVictimId = infiltratorVoteLeader(room)?.targetId ?? target.id;
      this.log(room, "action", `${actor.name} designe une victime des Infiltres.`);
      const infiltrators = alive.filter((p) => p.role === "Infiltre").length;
      if (room.night.infiltratorVotes.size >= Math.max(1, infiltrators)) return this.completeStep(room, step);
      room.narrator = "Les Infiltres se concertent encore.";
      return this.emit(room);
    }
    if (step === "ministre" && hasRole("Ministre")) {
      if (!action.ministerAction) return this.completeStep(room, step);
      if (action.ministerAction === "save") {
        if (room.powers.ministerSaveUsed) return this.reject(actorSocketId, "Pouvoir deja utilise.");
        room.night.ministerSavedVictimId = room.night.infiltratorVictimId;
        room.night.infiltratorVictimId = undefined;
        room.powers.ministerSaveUsed = true;
        actor.secretInfo.push("Vous avez utilise votre sauvegarde unique.");
        this.log(room, "power", `${actor.name} utilise la sauvegarde du Ministre.`);
        return this.completeStep(room, step);
      }
      if (action.ministerAction === "jail" && action.targetId && alive.some((p) => p.id === action.targetId)) {
        if (room.powers.ministerJailUsed) return this.reject(actorSocketId, "Pouvoir deja utilise.");
        room.night.ministerJailId = action.targetId;
        room.powers.ministerJailUsed = true;
        actor.secretInfo.push("Vous avez utilise votre emprisonnement unique.");
        this.log(room, "power", `${actor.name} utilise l'emprisonnement du Ministre.`);
        return this.completeStep(room, step);
      }
      return this.reject(actorSocketId, "Cible invalide.");
    }
    return this.reject(actorSocketId, "Ce n'est pas a votre role d'agir maintenant.");
  }

  startDebate(code: string, actorSocketId: string, seconds?: number) {
    const room = this.requireMayor(code, actorSocketId);
    if (room && (room.phase === "DAY_ANNOUNCEMENT" || room.phase === "DEBATE")) {
      this.startTimedPhase(room, "DEBATE", seconds ?? room.config.durations.freeDebate, "Debat libre en cours. Les soupcons circulent, et chaque silence pese.");
    } else if (room) {
      this.reject(actorSocketId, "Le debat ne peut pas etre ouvert pendant cette phase.");
    }
  }

  grantSpeech(code: string, actorSocketId: string, playerId: string, seconds?: number) {
    const room = this.requireMayor(code, actorSocketId);
    if (!room) return;
    const target = room.players.find((p) => p.id === playerId && p.alive);
    if (!target) return this.reject(actorSocketId, "Ce joueur ne peut pas parler.");

    if (room.phase === "DAY_ANNOUNCEMENT" || room.phase === "DEBATE") {
      room.phase = "DEBATE";
      room.players.forEach((p) => {
        p.speaking = p.id === target.id;
        p.canSpeak = p.alive && p.id === target.id;
        p.audioActive = false;
        p.muted = room.audioMode === "integrated" ? p.id !== target.id : p.muted;
      });
      if (seconds) this.startTimer(room, seconds, () => this.stopSpeech(room));
      room.narrator = `${target.name} a la parole pendant le debat.`;
      this.log(room, "phase", `Parole de debat accordee a ${target.name}.`);
      return this.emit(room);
    }

    if (room.phase !== "DEFENSE_REQUESTS") return this.reject(actorSocketId, "La defense ne peut pas etre accordee pendant cette phase.");
    if (!room.nominees.includes(target.id)) return this.reject(actorSocketId, "Seuls les joueurs nomines peuvent se defendre.");
    const request = room.defenseRequests.find((item) => item.playerId === target.id);
    if (!request || request.status !== "pending") return this.reject(actorSocketId, "Ce nomine n'a pas de demande de defense en attente.");
    request.status = "granted";
    room.phase = "DEFENSE";
    room.players.forEach((p) => {
      p.speaking = p.id === target.id;
      p.canSpeak = p.alive && p.id === target.id;
      p.audioActive = false;
      p.muted = room.audioMode === "integrated" ? p.id !== target.id : p.muted;
    });
    this.startTimer(room, seconds ?? room.config.durations.defense, () => this.stopSpeech(room));
    room.narrator = `${target.name} a la parole pour sa defense.`;
    this.log(room, "phase", `Defense individuelle de ${target.name}.`);
    this.emit(room);
  }

  stopSpeech(codeOrRoom: string | Room, actorSocketId?: string) {
    const room = typeof codeOrRoom === "string" ? this.requireMayor(codeOrRoom, actorSocketId ?? "") : codeOrRoom;
    if (!room) return;
    if (room.phase === "DEFENSE") return this.completeDefense(room);
    if (room.phase !== "DEBATE") this.clearTimer(room);
    room.players.forEach((p) => {
      p.speaking = false;
      p.canSpeak = p.alive;
      p.audioActive = false;
      if (room.audioMode === "integrated") p.muted = !p.alive && !room.config.deadCanHearAudio;
    });
    room.phase = "DEBATE";
    room.narrator = "Parole coupee. Discussion libre.";
    this.emit(room);
  }

  closeDebate(code: string, actorSocketId: string) {
    const room = this.requireMayor(code, actorSocketId);
    if (!room) return;
    if (!["DAY_ANNOUNCEMENT", "DEBATE"].includes(room.phase)) return this.reject(actorSocketId, "Le debat ne peut pas etre cloture pendant cette phase.");
    this.startNomination(room);
  }

  nominate(code: string, actorSocketId: string, targetId: string) {
    const room = this.getRoom(code);
    const voter = room?.players.find((p) => p.socketId === actorSocketId);
    const target = room?.players.find((p) => p.id === targetId);
    if (!room || !voter) return this.reject(actorSocketId, "Partie introuvable.");
    if (room.phase !== "NOMINATION") return this.reject(actorSocketId, "Vous ne pouvez pas nominer pendant cette phase.");
    if (!voter.alive) return this.reject(actorSocketId, "Vous etes emprisonne.");
    if (!voter.canVote) return this.reject(actorSocketId, "Vous ne pouvez pas nominer.");
    if (!target?.alive || target.id === voter.id) return this.reject(actorSocketId, "Cible invalide.");
    room.nominations = room.nominations.filter((vote) => vote.voterId !== voter.id).concat({ voterId: voter.id, targetId });
    this.log(room, "vote", `${voter.name} nomine ${target.name}.`);
    room.narrator = "Les nominations s'accumulent. Les suspects sont exposes devant tous.";
    this.emit(room);
  }

  requestDefense(code: string, actorSocketId: string) {
    const room = this.getRoom(code);
    const actor = room?.players.find((p) => p.socketId === actorSocketId);
    if (!room || !actor) return this.reject(actorSocketId, "Partie introuvable.");
    if (room.phase !== "DEFENSE_REQUESTS") return this.reject(actorSocketId, "Vous ne pouvez pas demander une defense pendant cette phase.");
    if (!actor.alive) return this.reject(actorSocketId, "Vous etes elimine.");
    if (!room.nominees.includes(actor.id)) return this.reject(actorSocketId, "Seuls les joueurs nomines peuvent demander une defense.");
    const existing = room.defenseRequests.find((request) => request.playerId === actor.id);
    if (existing) return this.reject(actorSocketId, "Votre demande de defense est deja enregistree ou traitee.");
    room.defenseRequests.push({ playerId: actor.id, playerName: actor.name, status: "pending", requestedAt: Date.now() });
    room.narrator = `${actor.name} demande a se defendre. Le Maire decide de lui accorder la parole ou de passer.`;
    this.log(room, "phase", `${actor.name} demande une defense.`);
    this.emit(room);
  }

  denyDefense(code: string, actorSocketId: string, playerId: string) {
    const room = this.requireMayor(code, actorSocketId);
    if (!room) return;
    if (room.phase !== "DEFENSE_REQUESTS") return this.reject(actorSocketId, "Aucune demande de defense ne peut etre traitee maintenant.");
    const request = room.defenseRequests.find((item) => item.playerId === playerId);
    if (!request || request.status !== "pending") return this.reject(actorSocketId, "Aucune demande en attente pour ce nomine.");
    request.status = "refused";
    room.narrator = `Le Maire passe la defense de ${request.playerName}.`;
    this.log(room, "phase", `Defense refusee ou passee pour ${request.playerName}.`);
    if (shouldAutoVoteAfterDefenseRequests(room)) return this.startVoteFromDefenseRequests(room);
    this.emit(room);
  }

  startVote(code: string, actorSocketId: string, seconds?: number) {
    const room = this.requireMayor(code, actorSocketId);
    if (!room) return;
    if (room.phase === "NOMINATION") return this.startDefenseRequests(room);
    if (room.phase === "DEFENSE_REQUESTS") return this.startVoteFromDefenseRequests(room, seconds);
    if (room.phase === "DAY_ANNOUNCEMENT" || room.phase === "DEBATE") return this.startNomination(room);
    return this.reject(actorSocketId, "Le vote ne peut pas etre lance pendant cette phase.");
  }

  vote(code: string, actorSocketId: string, targetId: string) {
    const room = this.getRoom(code);
    const voter = room?.players.find((p) => p.socketId === actorSocketId);
    const target = room?.players.find((p) => p.id === targetId);
    if (!room || !voter) return this.reject(actorSocketId, "Partie introuvable.");
    if (room.phase !== "VOTING") return this.reject(actorSocketId, "Vous ne pouvez pas voter pendant cette phase.");
    if (!voter.alive) return this.reject(actorSocketId, "Vous etes elimine.");
    if (!voter.canVote) return this.reject(actorSocketId, "Vous ne pouvez pas voter.");
    if (!target?.alive) return this.reject(actorSocketId, "Cible invalide.");
    if (room.nominees.length && !room.nominees.includes(target.id)) return this.reject(actorSocketId, "Le vote est limite aux joueurs nomines.");
    if (room.revoteTargets && !room.revoteTargets.includes(target.id)) return this.reject(actorSocketId, "Le second tour est limite aux joueurs a egalite.");
    room.votes = room.votes.filter((vote) => vote.voterId !== voter.id).concat({ voterId: voter.id, targetId });
    this.log(room, "vote", `${voter.name} vote contre ${target.name}.`);
    const eligible = room.players.filter((p) => p.alive && p.canVote).length;
    if (room.votes.length >= eligible) return this.resolveVote(room);
    this.emit(room);
  }

  setMuted(code: string, actorSocketId: string, playerId: string, muted: boolean) {
    const room = this.getRoom(code);
    const actor = room?.players.find((p) => p.socketId === actorSocketId);
    const target = room?.players.find((p) => p.id === playerId);
    if (!room || !actor || !target) return this.reject(actorSocketId, "Partie introuvable.");
    if (room.audioMode !== "integrated") return this.reject(actorSocketId, "L'audio integre n'est pas actif dans cette partie.");
    if (actor.id !== target.id && actor.id !== room.mayorId) return this.reject(actorSocketId, "Seul le Maire peut gerer le micro des autres joueurs.");
    if (!target.alive && (actor.id !== room.mayorId || !room.config.deadCanHearAudio)) return this.reject(actorSocketId, "Ce joueur ne peut pas utiliser l'audio.");
    if (!muted && !target.canSpeak) return this.reject(actorSocketId, "Ce joueur n'a pas le droit de parler maintenant.");
    target.muted = muted;
    if (muted) target.audioActive = false;
    this.emit(room);
  }

  audioActivity(code: string, actorSocketId: string, speaking: boolean) {
    const room = this.getRoom(code);
    const player = room?.players.find((p) => p.socketId === actorSocketId);
    if (!room || !player || room.audioMode !== "integrated") return;
    const canSpeakNow = room.phase !== "GAME_OVER" && player.canSpeak && !player.muted && player.alive;
    const next = speaking && canSpeakNow;
    if (player.audioActive === next) return;
    player.audioActive = next;
    this.emit(room);
  }

  views(code: string): Array<{ socketId: string; view: RoomView }> {
    const room = this.getRoom(code);
    if (!room) return [];
    return room.players.flatMap((p) => (p.socketId ? [{ socketId: p.socketId, view: this.viewFor(room, p.id) }] : []));
  }

  socketIdForPlayer(code: string, playerId: string) {
    return this.getRoom(code)?.players.find((p) => p.id === playerId)?.socketId;
  }

  canRelayRtcSignal(code: string, fromSocketId: string, toPlayerId: string) {
    const room = this.getRoom(code);
    const from = room?.players.find((p) => p.socketId === fromSocketId);
    const to = room?.players.find((p) => p.id === toPlayerId);
    if (!room || !from || !to || room.audioMode !== "integrated") return false;
    return canHearPlayer(to, from, room) || canHearPlayer(from, to, room);
  }

  viewBySocket(code: string, socketId: string) {
    const room = this.getRoom(code);
    const player = room?.players.find((p) => p.socketId === socketId);
    return room && player ? this.viewFor(room, player.id) : undefined;
  }

  private resolveMayorElection(room: Room) {
    this.clearTimer(room);
    const alive = room.players.filter((p) => p.alive);
    const scores = tally(room.mayorVotes, room);
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const topScore = ranked[0]?.[1] ?? 0;
    const tied = ranked.filter(([, score]) => score === topScore);
    const mayorId = tied.length === 1 ? tied[0][0] : alive[Math.floor(Math.random() * alive.length)]?.id;
    room.mayorId = mayorId;
    const mayor = room.players.find((p) => p.id === mayorId);
    room.narrator = `${mayor?.name ?? "Un joueur"} est elu Maire. Le Maire gerera la parole pendant les debats.`;
    this.log(room, "phase", `${mayor?.name ?? "Un joueur"} devient Maire.`);
    this.startNight(room);
  }

  private startNomination(room: Room) {
    this.clearTimer(room);
    room.phase = "NOMINATION";
    room.transition = undefined;
    room.nominations = [];
    room.nominees = [];
    room.defenseRequests = [];
    room.votes = [];
    room.revoteTargets = undefined;
    room.players.forEach((p) => {
      p.speaking = false;
      p.canSpeak = false;
      p.audioActive = false;
      if (room.audioMode === "integrated") p.muted = true;
    });
    room.narrator = NarrationService.fallback({ type: "nomination", phase: room.phase, round: room.round }, "Les nominations sont ouvertes. Chaque joueur vivant peut designer un suspect, et peut changer d'avis avant la fin.");
    this.log(room, "phase", "Nominations ouvertes.");
    this.startTimer(room, room.config.durations.nomination, () => this.startDefenseRequests(room));
    this.emit(room);
  }

  private startDefenseRequests(room: Room) {
    this.clearTimer(room);
    room.nominees = Array.from(new Set(room.nominations.map((vote) => vote.targetId))).filter((id) => room.players.some((p) => p.id === id && p.alive));
    if (!room.nominees.length) {
      room.phase = "RESULT";
      room.votes = [];
      room.revoteTargets = undefined;
      room.lastResult = "Aucun joueur n'a ete nomine. Personne n'est exclu, et la nuit reprend.";
      room.narrator = "Aucun nom ne reste dans la lumiere. La journee s'acheve sans emprisonnement.";
      this.log(room, "phase", room.lastResult);
      this.startTimer(room, room.config.durations.resultReveal, () => this.startNight(room));
      return this.emit(room);
    }
    room.phase = "DEFENSE_REQUESTS";
    room.defenseRequests = [];
    room.players.forEach((p) => {
      p.speaking = false;
      p.canSpeak = false;
      p.audioActive = false;
      if (room.audioMode === "integrated") p.muted = true;
    });
    const nomineeNames = room.nominees.map((id) => room.players.find((p) => p.id === id)?.name).filter(Boolean).join(", ");
    room.narrator = `Nominations verrouillees : ${nomineeNames}. Les nomines peuvent demander une defense au Maire.`;
    this.log(room, "phase", `Demandes de defense ouvertes pour : ${nomineeNames}.`);
    this.emit(room);
  }

  private startVoteFromDefenseRequests(room: Room, seconds?: number) {
    this.clearTimer(room);
    if (!room.nominees.length) {
      room.nominees = Array.from(new Set(room.nominations.map((vote) => vote.targetId))).filter((id) => room.players.some((p) => p.id === id && p.alive));
    }
    room.defenseRequests = room.defenseRequests.map((request) => request.status === "pending" ? { ...request, status: "refused" } : request);
    this.startTimedPhase(room, "VOTING", seconds ?? room.config.durations.vote, NarrationService.fallback({ type: "vote", phase: "VOTING", round: room.round }, "Vote ouvert parmi les joueurs nomines. Les choix sont publics, les voix se comptent devant tous."));
  }

  private completeDefense(room: Room) {
    this.clearTimer(room);
    const speaker = room.players.find((p) => p.speaking);
    if (speaker) {
      const request = room.defenseRequests.find((item) => item.playerId === speaker.id && item.status === "granted");
      if (request) request.status = "done";
      this.log(room, "phase", `Defense terminee pour ${speaker.name}.`);
    }
    room.players.forEach((p) => {
      p.speaking = false;
      p.canSpeak = false;
      p.audioActive = false;
      if (room.audioMode === "integrated") p.muted = true;
    });
    if (shouldAutoVoteAfterDefenseRequests(room)) return this.startVoteFromDefenseRequests(room);
    room.phase = "DEFENSE_REQUESTS";
    room.narrator = "Defense terminee. Le Maire peut traiter les autres demandes ou passer au vote.";
    this.emit(room);
  }

  private startNight(room: Room) {
    this.clearTimer(room);
    if (this.checkWin(room)) return this.emit(room);
    room.phase = "NIGHT";
    room.transition = "night-falls";
    room.round += 1;
    room.votes = [];
    room.nominations = [];
    room.nominees = [];
    room.defenseRequests = [];
    room.revoteTargets = undefined;
    room.players.forEach((p) => {
      p.canVote = p.alive;
      p.canSpeak = false;
      p.speaking = false;
      p.audioActive = false;
      if (room.audioMode === "integrated") p.muted = p.alive || !room.config.deadCanHearAudio;
    });
    room.night = emptyNight(room.round === 1);
    room.narrator = NarrationService.fallback({ type: "nightStart", phase: room.phase, round: room.round }, `La nuit tombe sur le groupe. Nuit ${room.round}. Les roles se reveillent un a un.`);
    this.log(room, "phase", `Nuit ${room.round}.`);
    this.skipMissingRoles(room);
    this.emit(room);
  }

  private advanceNight(room: Room) {
    this.completeStep(room, room.night.steps[room.night.stepIndex]);
  }

  private completeStep(room: Room, step: NightStep, timedOut = false) {
    this.clearTimer(room);
    if (timedOut) {
      room.narrator = "Temps ecoule, le jeu continue.";
      this.log(room, "phase", `Temps ecoule pour ${step}.`);
    }
    room.night.completed.add(step);
    room.night.stepIndex += 1;
    if (room.night.stepIndex >= room.night.steps.length) return this.resolveNight(room);
    this.skipMissingRoles(room);
    this.emit(room);
  }

  private skipMissingRoles(room: Room) {
    while (room.night.stepIndex < room.night.steps.length) {
      const step = room.night.steps[room.night.stepIndex];
      const role = stepRole[step];
      if (step === "agent-double" && room.powers.agentDoubleUsed) {
        room.night.stepIndex += 1;
        continue;
      }
      if (step === "lanceuse-alerte" && room.powers.lanceuseAlerteUsed) {
        room.night.stepIndex += 1;
        continue;
      }
      if (step === "ministre" && room.powers.ministerSaveUsed && room.powers.ministerJailUsed) {
        room.night.stepIndex += 1;
        continue;
      }
      if (!role || room.players.some((p) => p.alive && p.role === role)) {
        room.narrator = narratorForStep(step, room);
        applyIntegratedAudioState(room);
        this.startTimer(room, room.config.durations.nightAction, () => this.completeStep(room, step, true));
        return;
      }
      room.night.stepIndex += 1;
    }
    this.resolveNight(room);
  }

  private resolveNight(room: Room) {
    this.clearTimer(room);
    const victim = room.night.infiltratorVictimId ? room.players.find((p) => p.id === room.night.infiltratorVictimId) : undefined;
    const ministerSavedVictim = room.night.ministerSavedVictimId ? room.players.find((p) => p.id === room.night.ministerSavedVictimId) : undefined;
    const ministerJailed = room.night.ministerJailId ? room.players.find((p) => p.id === room.night.ministerJailId) : undefined;
    const protectedVictim = victim && victim.id === room.night.protectedId;
    const pastorSaved = victim?.role === "Pasteur" && !this.hasPastorSecondAttempt(room, victim.id);
    const morningEvents: string[] = [];
    if (victim && !protectedVictim && !pastorSaved) {
      this.eliminate(room, victim, "nuit");
      morningEvents.push(`${victim.name} a ete emprisonne pendant la nuit. Son role etait ${ROLE_LABELS[victim.role ?? "Croyant"]}.`);
    } else if (victim?.role === "Pasteur" && !protectedVictim && pastorSaved) {
      room.pastorAttemptedIds.add(victim.id);
      this.log(room, "action", "Premiere tentative secrete contre le Pasteur.");
    } else if (victim && protectedVictim) {
      morningEvents.push("La victime des Infiltres a ete protegee pendant la nuit.");
    }
    if (ministerSavedVictim) {
      morningEvents.push(`Le Ministre a sauve ${ministerSavedVictim.name} pendant la nuit.`);
    }
    if (ministerJailed?.alive) {
      this.eliminate(room, ministerJailed, "nuit");
      morningEvents.push(`Le Ministre a emprisonne ${ministerJailed.name}. Son role etait ${ROLE_LABELS[ministerJailed.role ?? "Croyant"]}.`);
    }
    if (room.night.silencedId) {
      const silenced = room.players.find((p) => p.id === room.night.silencedId && p.alive);
      if (silenced) silenced.canVote = false;
    }
    const result = morningEvents.length ? morningEvents.join(" ") : "Aucun joueur n'a ete emprisonne pendant la nuit.";
    room.phase = "DAY_ANNOUNCEMENT";
    room.transition = "day-rises";
    room.lastResult = result;
    room.narrator = `${NarrationService.fallback({ type: "dayStart", phase: "DAY_ANNOUNCEMENT", round: room.round, summary: result }, "Le jour se leve, et chacun cherche les signes de trahison.")} ${result} ${this.silencedText(room)} Le Maire peut ouvrir le debat.`;
    room.players.forEach((p) => {
      p.speaking = false;
      p.canSpeak = p.alive;
      p.audioActive = false;
      if (room.audioMode === "integrated") p.muted = !p.alive && !room.config.deadCanHearAudio;
    });
    this.log(room, "phase", "Jour ouvert apres resolution de nuit.");
    this.checkWin(room);
    this.emit(room);
  }

  private resolveVote(room: Room) {
    this.clearTimer(room);
    const scores = tally(room.votes, room, true);
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    if (!top) {
      room.phase = "RESULT";
      room.lastResult = "Aucun vote valide. Personne n'est exclu.";
      room.narrator = room.lastResult;
      this.log(room, "phase", room.lastResult);
      this.startTimer(room, room.config.durations.resultReveal, () => this.startNight(room));
      return this.emit(room);
    }
    const tied = ranked.filter(([, score]) => score === top[1]);
    if (tied.length > 1) {
      if (room.config.tieRule === "revote" && !room.revoteTargets) {
        room.revoteTargets = tied.map(([id]) => id);
        room.votes = [];
        room.narrator = "Egalite au vote. Second tour automatique entre les joueurs a egalite.";
        this.log(room, "phase", "Second tour automatique apres egalite.");
        this.startTimedPhase(room, "VOTING", room.config.durations.vote, room.narrator);
        return;
      }
      room.phase = "RESULT";
      room.revoteTargets = undefined;
      room.lastResult = "Egalite au vote. Personne n'est exclu.";
      room.narrator = room.lastResult;
      this.log(room, "phase", room.lastResult);
      this.startTimer(room, room.config.durations.resultReveal, () => this.startNight(room));
      return this.emit(room);
    }
    const excluded = room.players.find((p) => p.id === top[0]);
    if (excluded) {
      this.eliminate(room, excluded, "vote");
      room.lastResult = `${excluded.name} est exclu. Son role etait ${ROLE_LABELS[excluded.role ?? "Croyant"]}.`;
      room.narrator = room.lastResult;
    }
    room.phase = "RESULT";
    room.revoteTargets = undefined;
    if (!this.checkWin(room)) this.startTimer(room, room.config.durations.resultReveal, () => this.startNight(room));
    this.emit(room);
  }

  private eliminate(room: Room, player: Player, reason: "vote" | "nuit" | "depart") {
    player.alive = false;
    player.canVote = false;
    player.canSpeak = false;
    player.speaking = false;
    player.audioActive = false;
    player.revealedRole = player.role;
    player.muted = room.audioMode === "integrated" ? !room.config.deadCanHearAudio : player.muted;
    if (player.id === room.mayorId) room.mayorId = this.pickNextMayor(room);
    const label = reason === "depart" ? "depart volontaire" : reason;
    this.log(room, "elimination", `${player.name} elimine par ${label}. Role revele : ${ROLE_LABELS[player.role ?? "Croyant"]}.`);
  }

  private checkWin(room: Room) {
    const alive = room.players.filter((p) => p.alive);
    const infiltrators = alive.filter((p) => p.role === "Infiltre").length;
    const croyants = alive.length - infiltrators;
    if (infiltrators === 0 && room.round > 0) return this.finish(room, "Croyants", "Les Croyants gagnent. Tous les Infiltres ont ete trouves.");
    if (infiltrators >= croyants && infiltrators > 0) return this.finish(room, "Infiltres", "Les Infiltres gagnent. Ils sont au moins aussi nombreux que les Croyants restants.");
    return false;
  }

  private finish(room: Room, winner: Winner | undefined, message: string) {
    this.clearTimer(room);
    room.phase = "GAME_OVER";
    room.winner = winner;
    room.narrator = message;
    room.lastResult = message;
    room.transition = undefined;
    room.votes = [];
    room.mayorVotes = [];
    room.nominations = [];
    room.nominees = [];
    room.defenseRequests = [];
    room.revoteTargets = undefined;
    room.players.forEach((p) => {
      p.canVote = false;
      p.canSpeak = false;
      p.speaking = false;
      p.audioActive = false;
      p.revealedRole = p.role;
      if (room.audioMode === "integrated") p.muted = true;
    });
    this.log(room, "system", message);
    return true;
  }

  private startTimedPhase(room: Room, phase: GamePhase, seconds: number, narrator: string) {
    this.clearTimer(room);
    room.phase = phase;
    room.transition = undefined;
    room.narrator = narrator;
    if (phase === "VOTING") {
      room.votes = [];
      room.players.forEach((p) => {
        p.speaking = false;
        p.canSpeak = false;
        p.audioActive = false;
        if (room.audioMode === "integrated") p.muted = p.alive || (!p.alive && !room.config.deadCanHearAudio);
      });
    } else if (phase === "DEBATE") {
      room.players.forEach((p) => {
        p.speaking = false;
        p.canSpeak = p.alive;
        p.audioActive = false;
        if (room.audioMode === "integrated") p.muted = !p.alive && !room.config.deadCanHearAudio;
      });
    }
    this.log(room, "phase", narrator);
    this.startTimer(room, seconds, () => {
      if (phase === "VOTING") return this.resolveVote(room);
      if (phase === "DEBATE") return this.startNomination(room);
      this.emit(room);
    });
    this.emit(room);
  }

  private startTimer(room: Room, seconds: number, done: () => void) {
    this.clearTimer(room);
    const duration = Math.max(5, seconds);
    const startedAt = Date.now();
    room.timerStartedAt = startedAt;
    room.timerDuration = duration;
    room.timerEndsAt = startedAt + duration * 1000;
    room.timer = setTimeout(done, duration * 1000);
    room.timerPulse = setInterval(() => this.emit(room), 1000);
  }

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    if (room.timerPulse) clearInterval(room.timerPulse);
    room.timer = undefined;
    room.timerPulse = undefined;
    room.timerStartedAt = undefined;
    room.timerDuration = undefined;
    room.timerEndsAt = undefined;
  }

  private assignRoles(room: Room) {
    const roles = shuffle(generateRoleDistribution(room.players.length, room.config));
    const reserveCandidates = ROLES.filter((role) => !roles.includes(role) && role !== "Infiltre");
    room.reserveRoles = shuffle(reserveCandidates).slice(0, 2);
    room.powers = emptyPowers();
    room.pastorAttemptedIds = new Set();
    room.players.forEach((p, index) => {
      p.role = roles[index] ?? "Croyant";
      p.alive = true;
      p.canVote = true;
      p.canSpeak = true;
      p.revealedRole = undefined;
      p.secretInfo = [`Votre role secret est ${ROLE_LABELS[p.role]}.`];
    });
  }

  private hasPastorSecondAttempt(room: Room, pastorId: string) {
    return room.pastorAttemptedIds.has(pastorId);
  }

  private pickNextMayor(room: Room) {
    return room.players.find((p) => p.alive)?.id;
  }

  private silencedText(room: Room) {
    const silenced = room.night.silencedId ? room.players.find((p) => p.id === room.night.silencedId) : undefined;
    return silenced?.alive ? `${silenced.name} ne pourra pas voter aujourd'hui.` : "";
  }

  private requireHost(code: string, socketId: string) {
    const room = this.getRoom(code);
    const actor = room?.players.find((p) => p.socketId === socketId);
    if (!room || !actor) {
      this.reject(socketId, "Partie introuvable.");
      return undefined;
    }
    if (actor.id !== room.hostId) {
      this.reject(socketId, "Seul l'hote peut effectuer cette action.");
      return undefined;
    }
    return room;
  }

  private requireMayor(code: string, socketId: string) {
    const room = this.getRoom(code);
    const actor = room?.players.find((p) => p.socketId === socketId);
    if (!room || !actor) {
      this.reject(socketId, "Partie introuvable.");
      return undefined;
    }
    if (!actor.alive) {
      this.reject(socketId, "Vous etes elimine.");
      return undefined;
    }
    if (actor.id !== room.mayorId) {
      this.reject(socketId, "Seul le Maire peut effectuer cette action.");
      return undefined;
    }
    return room;
  }

  private getRoom(code: string) {
    return this.rooms.get(code.trim().toUpperCase());
  }

  private adminSummary(room: Room): AdminRoomSummary {
    const host = room.players.find((player) => player.id === room.hostId);
    return {
      code: room.code,
      hostName: host?.name ?? "Hote inconnu",
      connectedPlayers: room.players.filter((player) => player.connected).length,
      playerCount: room.players.length,
      status: room.phase === "LOBBY" ? "lobby" : room.phase === "GAME_OVER" ? "finished" : "inGame",
      phase: room.phase,
      audioMode: room.audioMode,
      createdAt: room.createdAt
    };
  }

  private createCode() {
    let code = "";
    do {
      code = Array.from({ length: 5 }, () => codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  private log(room: Room, type: GameLogEntry["type"], message: string) {
    room.gameLog.push({ at: Date.now(), round: room.round, phase: room.phase, type, message });
  }

  private emit(room: Room) {
    this.onChange(room);
  }

  private reject(socketId: string, message: string) {
    this.onToast(socketId, message);
  }

  private viewFor(room: Room, playerId: string): RoomView {
    const player = room.players.find((p) => p.id === playerId);
    const activeStep = room.phase === "NIGHT" ? room.night.steps[room.night.stepIndex] : undefined;
    const activeRole = activeStep ? stepRole[activeStep] : undefined;
    const canSeeOwnRole = room.phase !== "LOBBY" && !!player?.role;
    const playerCanAct = player ? canActFor(player, room, activeStep) : false;
    const secretInfo = player?.secretInfo ?? [];
    const infiltratorNames =
      player?.role === "Infiltre"
        ? [`Infiltres vivants : ${room.players.filter((p) => p.alive && p.role === "Infiltre").map((p) => p.name).join(", ")}.`]
        : [];
    const ministerInfo =
      player?.role === "Ministre" && activeStep === "ministre" && room.night.infiltratorVictimId
        ? [`Victime designee : ${room.players.find((p) => p.id === room.night.infiltratorVictimId)?.name ?? "inconnue"}.`]
        : [];
    const watcherInfo =
      player?.role === "Guetteuse" && activeStep === "infiltres" && player.alive
        ? [`Observation risquee : ${room.players.filter((p) => p.alive && p.role === "Infiltre").map((p) => p.name).join(", ")} agissent cette nuit.`]
        : [];
    const isAdminVisible = player?.id === room.hostId || room.phase === "GAME_OVER";
    return {
      code: room.code,
      hostId: room.hostId,
      mayorId: room.mayorId,
      phase: room.phase,
      audioMode: room.audioMode,
      round: room.round,
      config: room.config,
      lobby: lobbyInfo(room.players.length, room.config),
      players: room.players.map((p) => publicPlayer(p, room, activeStep, player)),
      you: player
        ? {
            id: player.id,
            name: player.name,
            role: canSeeOwnRole ? player.role : undefined,
            sessionId: player.sessionId,
            alive: player.alive,
            canVote: player.canVote,
            canSpeak: player.canSpeak,
            canAct: playerCanAct,
            isHost: player.id === room.hostId,
            isMayor: player.id === room.mayorId,
            secretInfo: [...secretInfo, ...infiltratorNames, ...ministerInfo, ...watcherInfo],
            powerStatuses: powerStatusesFor(player, room),
            nightChannel: nightChannelFor(player, room, activeStep),
            canHearAudio: canUseIntegratedAudio(player, room),
            audioPeerIds: audioPeerIdsFor(player, room)
          }
        : undefined,
      narrator: room.narrator,
      transition: room.transition,
      currentNightStep: activeStep,
      activeRole,
      activePlayerId: visibleActivePlayerId(room, player),
      timerStartedAt: room.timerStartedAt,
      timerDuration: room.timerDuration,
      timerEndsAt: room.timerEndsAt,
      votes: room.phase === "VOTING" ? room.votes : [],
      voteDetails: room.phase === "VOTING" ? voteDetailsFor(room.votes, room, true) : [],
      voteTotals: room.phase === "VOTING" ? voteTotalsFor(room.votes, room, true) : [],
      mayorVotes: room.phase === "MAYOR_ELECTION" ? room.mayorVotes : [],
      mayorVoteDetails: room.phase === "MAYOR_ELECTION" ? voteDetailsFor(room.mayorVotes, room, false) : [],
      mayorVoteTotals: room.phase === "MAYOR_ELECTION" ? voteTotalsFor(room.mayorVotes, room, false) : [],
      nominations: showsNominations(room.phase) ? room.nominations : [],
      nominationDetails: showsNominations(room.phase) ? voteDetailsFor(room.nominations, room, false) : [],
      nominationTotals: showsNominations(room.phase) ? voteTotalsFor(room.nominations, room, false) : [],
      nominees: showsNominations(room.phase) ? room.nominees : [],
      defenseRequests: showsNominations(room.phase) ? room.defenseRequests : [],
      infiltratorVotes: canSeeInfiltratorVotes(player, room, activeStep) ? infiltratorVoteDetails(room) : undefined,
      infiltratorVoteLeader: canSeeInfiltratorVotes(player, room, activeStep) ? infiltratorVoteLeader(room) : undefined,
      lastResult: room.lastResult,
      winner: room.winner,
      roleOptions: activeStep === "agent-double" && player?.role === "AgentDouble" && !room.powers.agentDoubleUsed ? room.reserveRoles.slice(0, 2) : undefined,
      gameLog: isAdminVisible ? room.gameLog.slice(-100) : undefined
    };
  }
}

function emptyNight(firstRound: boolean): NightState {
  return {
    stepIndex: 0,
    steps: firstRound ? NIGHT_STEPS_FIRST : NIGHT_STEPS,
    completed: new Set(),
    infiltratorVotes: new Map()
  };
}

function emptyPowers(): PowerState {
  return {
    ministerSaveUsed: false,
    ministerJailUsed: false,
    lanceuseAlerteUsed: false,
    agentDoubleUsed: false
  };
}

function createPlayer(name: string, socketId: string, sessionId: string, isHost: boolean): Player {
  return {
    id: randomId(),
    sessionId,
    name: name.trim().slice(0, 32) || "Joueur",
    connected: true,
    alive: true,
    canVote: true,
    canSpeak: true,
    muted: false,
    speaking: false,
    audioActive: false,
    isHost,
    socketId,
    secretInfo: []
  };
}

function publicPlayer(player: Player, room: Room, activeStep?: NightStep, viewer?: Player): PlayerPublic {
  const hidePrivateInfiltratorAudio = activeStep === "infiltres" && player.role === "Infiltre" && !canSeeInfiltratorChannel(viewer, room);
  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
    alive: player.alive,
    canVote: player.canVote,
    canSpeak: hidePrivateInfiltratorAudio ? false : player.canSpeak,
    canAct: viewer?.id === player.id ? canActFor(player, room, activeStep) : false,
    muted: hidePrivateInfiltratorAudio ? true : player.muted,
    speaking: hidePrivateInfiltratorAudio ? false : player.speaking,
    audioActive: hidePrivateInfiltratorAudio ? false : player.audioActive,
    isHost: player.isHost,
    isMayor: player.id === room.mayorId,
    revealedRole: player.revealedRole
  };
}

function canActFor(player: Player, room: Room, activeStep?: NightStep) {
  if (!player.alive || room.phase !== "NIGHT" || !activeStep) return false;
  if (activeStep === "infiltres" && (player.role === "Infiltre" || player.role === "LeaderLouange" || player.role === "Guetteuse")) return true;
  return stepRole[activeStep] === player.role;
}

function showsNominations(phase: GamePhase) {
  return phase === "NOMINATION" || phase === "DEFENSE_REQUESTS" || phase === "DEFENSE" || phase === "VOTING";
}

function shouldAutoVoteAfterDefenseRequests(room: Room) {
  return room.nominees.length > 0 && room.nominees.every((playerId) => {
    const request = room.defenseRequests.find((item) => item.playerId === playerId);
    return !!request && request.status !== "pending" && request.status !== "granted";
  });
}

function lobbyInfo(playerCount: number, config: GameConfig) {
  return {
    minPlayers: MIN_PLAYERS,
    maxPlayers: config.maxPlayers,
    playerCount,
    missingPlayers: Math.max(0, MIN_PLAYERS - playerCount),
    plannedInfiltrators: getInfiltratorCount(playerCount),
    potentialRoles: getPotentialRoles(playerCount, config)
  };
}

function powerStatusesFor(player: Player, room: Room): PowerStatus[] {
  if (player.role === "Ministre") {
    return [
      { key: "ministerSave", label: "Sauver une victime", used: room.powers.ministerSaveUsed },
      { key: "ministerJail", label: "Emprisonner quelqu'un", used: room.powers.ministerJailUsed }
    ];
  }
  if (player.role === "LanceuseAlerte") return [{ key: "lanceuseAlerte", label: "Lanceuse d'Alerte", used: room.powers.lanceuseAlerteUsed }];
  if (player.role === "AgentDouble") return [{ key: "agentDouble", label: "Agent Double", used: room.powers.agentDoubleUsed || room.round > 1 }];
  return [];
}

function nightChannelFor(player: Player, room: Room, activeStep?: NightStep): NonNullable<RoomView["you"]>["nightChannel"] {
  if (room.phase !== "NIGHT" || !player.alive) return undefined;
  if (activeStep === "infiltres" && player.role === "Infiltre") return "infiltres";
  if (activeStep === "infiltres" && player.role === "Guetteuse") return "solo";
  if (activeStep === "infiltres" && player.role === "LeaderLouange") return "solo";
  if (activeStep && stepRole[activeStep] === player.role) return "solo";
  return "sleep";
}

function visibleActivePlayerId(room: Room, viewer?: Player) {
  const speaker = room.players.find((p) => p.speaking);
  if (!speaker) return undefined;
  const activeStep = room.phase === "NIGHT" ? room.night.steps[room.night.stepIndex] : undefined;
  if (activeStep === "infiltres" && speaker.role === "Infiltre" && !canSeeInfiltratorChannel(viewer, room)) return undefined;
  return speaker.id;
}

function canSeeInfiltratorChannel(player: Player | undefined, room: Room) {
  return room.phase === "NIGHT" && room.night.steps[room.night.stepIndex] === "infiltres" && !!player?.alive && player.role === "Infiltre";
}

function canSeeInfiltratorVotes(player: Player | undefined, room: Room, activeStep?: NightStep) {
  return room.phase === "NIGHT" && activeStep === "infiltres" && !!player?.alive && player.role === "Infiltre";
}

function canHearPlayer(listener: Player, speaker: Player, room: Room) {
  if (room.audioMode !== "integrated" || room.phase === "GAME_OVER") return false;
  if (!listener.alive && !room.config.deadCanHearAudio) return false;
  if (!speaker.alive || !speaker.canSpeak || speaker.muted) return false;
  if (room.phase === "LOBBY") return true;
  if (room.phase === "NIGHT") return canSeeInfiltratorChannel(listener, room) && speaker.role === "Infiltre";
  if (room.phase === "DEFENSE") return room.players.some((p) => p.id === speaker.id && p.speaking);
  return room.phase === "DAY_ANNOUNCEMENT" || room.phase === "DEBATE";
}

function canUseIntegratedAudio(player: Player, room: Room) {
  if (room.audioMode !== "integrated" || room.phase === "GAME_OVER") return false;
  if (room.phase === "LOBBY") return true;
  if (room.phase === "NIGHT") return canSeeInfiltratorChannel(player, room);
  return player.alive || room.config.deadCanHearAudio;
}

function audioPeerIdsFor(player: Player, room: Room) {
  if (!canUseIntegratedAudio(player, room)) return [];
  return room.players
    .filter((candidate) => candidate.id !== player.id && candidate.connected && (canHearPlayer(player, candidate, room) || canHearPlayer(candidate, player, room)))
    .map((candidate) => candidate.id);
}

function applyIntegratedAudioState(room: Room) {
  if (room.audioMode !== "integrated") return;
  if (room.phase === "NIGHT") {
    const activeStep = room.night.steps[room.night.stepIndex];
    room.players.forEach((player) => {
      const canSpeakAtNight = player.alive && activeStep === "infiltres" && player.role === "Infiltre";
      player.canSpeak = canSpeakAtNight;
      player.speaking = false;
      player.audioActive = false;
      player.muted = !canSpeakAtNight;
    });
  }
}

function voteWeightFor(voter: Player, room: Room, weighted: boolean) {
  if (!weighted) return 1;
  return (voter.role === "Sage" ? 2 : 1) + (voter.id === room.mayorId ? 1 : 0);
}

function voteDetailsFor(votes: VoteRecord[], room: Room, weighted: boolean): VoteViewRecord[] {
  return votes.flatMap((vote) => {
    const voter = room.players.find((p) => p.id === vote.voterId);
    const target = room.players.find((p) => p.id === vote.targetId);
    if (!voter?.alive || !voter.canVote || !target?.alive) return [];
    return [{
      voterId: voter.id,
      voterName: voter.name,
      targetId: target.id,
      targetName: target.name,
      weight: voteWeightFor(voter, room, weighted),
      mayorBonus: weighted && voter.id === room.mayorId,
      sageBonus: weighted && voter.role === "Sage"
    }];
  });
}

function voteTotalsFor(votes: VoteRecord[], room: Room, weighted: boolean): VoteTotal[] {
  const names = new Map(room.players.map((p) => [p.id, p.name]));
  const totals = new Map<string, number>();
  for (const vote of voteDetailsFor(votes, room, weighted)) {
    totals.set(vote.targetId, (totals.get(vote.targetId) ?? 0) + vote.weight);
  }
  return [...totals.entries()]
    .map(([targetId, total]) => ({ targetId, targetName: names.get(targetId) ?? "Joueur inconnu", total }))
    .sort((a, b) => b.total - a.total || a.targetName.localeCompare(b.targetName));
}

function infiltratorVoteDetails(room: Room): NonNullable<RoomView["infiltratorVotes"]> {
  return [...room.night.infiltratorVotes.entries()].flatMap(([voterId, targetId]) => {
    const voter = room.players.find((p) => p.id === voterId);
    const target = room.players.find((p) => p.id === targetId);
    if (!voter || !target) return [];
    return [{ voterId, voterName: voter.name, targetId, targetName: target.name }];
  });
}

function infiltratorVoteLeader(room: Room): VoteTotal | undefined {
  return voteTotalsFor(infiltratorVoteDetails(room), room, false)[0];
}

function tally(votes: VoteRecord[], room: Room, weighted = false) {
  const scores = new Map<string, number>();
  for (const vote of votes) {
    const voter = room.players.find((p) => p.id === vote.voterId);
    const target = room.players.find((p) => p.id === vote.targetId);
    if (!voter?.alive || !voter.canVote || !target?.alive) continue;
    const weight = voteWeightFor(voter, room, weighted);
    scores.set(vote.targetId, (scores.get(vote.targetId) ?? 0) + weight);
  }
  return scores;
}

function shuffle<T>(items: T[]) {
  return items
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}

function narratorForStep(step: NightStep, room: Room) {
  const role = stepRole[step];
  if (step === "infiltres") return "Les Infiltres se reveillent et designent une victime.";
  if (step === "ministre" && room.powers.ministerSaveUsed && room.powers.ministerJailUsed) return "Pouvoir deja utilise.";
  return role ? `${ROLE_LABELS[role]} se reveille et agit.` : "La nuit continue.";
}

function randomId() {
  return crypto.randomBytes(12).toString("hex");
}

void DEFAULT_CONFIG;
void MAX_PLAYERS;
