export const MIN_PLAYERS = 7;
export const MAX_PLAYERS = 20;

export const ROLES = [
  "Croyant",
  "Infiltre",
  "Sage",
  "AgentDouble",
  "Pasteur",
  "Hackeuse",
  "Guetteuse",
  "Avocate",
  "LanceuseAlerte",
  "Ministre",
  "LeaderLouange"
] as const;

export type Role = (typeof ROLES)[number];
export type AudioMode = "integrated" | "external";
export type GamePhase =
  | "LOBBY"
  | "ROLE_DISTRIBUTION"
  | "MAYOR_NOMINATION"
  | "MAYOR_ELECTION"
  | "NIGHT"
  | "DAY_ANNOUNCEMENT"
  | "DEBATE"
  | "NOMINATION"
  | "DEFENSE_REQUESTS"
  | "DEFENSE"
  | "VOTING"
  | "RESULT"
  | "GAME_OVER";
export type Phase = GamePhase;
export type NightStep = "agent-double" | "hackeuse" | "avocate" | "lanceuse-alerte" | "infiltres" | "ministre";
export type TieRule = "none" | "revote";
export type Winner = "Croyants" | "Infiltres";

export type PhaseDurations = {
  mayorElection: number;
  nightAction: number;
  transitionNight: number;
  freeDebate: number;
  nomination: number;
  defense: number;
  vote: number;
  resultReveal: number;
};

export type GameConfig = {
  maxPlayers: number;
  tieRule: TieRule;
  deadCanHearAudio: boolean;
  requireSpecialRoles: boolean;
  enabledRoles: Role[];
  durations: PhaseDurations;
};

export type PowerKey = "ministerSave" | "ministerJail" | "lanceuseAlerte" | "agentDouble";
export type BotParticipation = "discreet" | "normal" | "talkative";

export type BotRoomConfig = {
  enabled: boolean;
  count: number;
  autoFill: boolean;
  participation: BotParticipation;
  audioEnabled: boolean;
  averageResponseMs: number;
  allowMayor: boolean;
  allowDebateSpeech: boolean;
  allowAudio: boolean;
};

export type BotVoiceConfig = {
  voiceName: string;
  voiceStyle: string;
  speakingRate: number;
  pitch: number;
  volume: number;
  autoSpeakEnabled: boolean;
};

export type PowerStatus = {
  key: PowerKey;
  label: string;
  used: boolean;
};

export type PlayerPublic = {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  alive: boolean;
  canVote: boolean;
  canSpeak: boolean;
  canAct: boolean;
  muted: boolean;
  speaking: boolean;
  audioActive: boolean;
  isHost: boolean;
  isMayor: boolean;
  revealedRole?: Role;
  botVoice?: BotVoiceConfig;
};

export type VoteRecord = {
  voterId: string;
  targetId: string;
};

export type ChatMessage = {
  id: string;
  at: number;
  playerId: string;
  playerName: string;
  isBot?: boolean;
  text: string;
  scope: "public" | "infiltres";
};

export type VoteViewRecord = VoteRecord & {
  voterName: string;
  targetName: string;
  weight: number;
  mayorBonus: boolean;
  sageBonus: boolean;
};

export type VoteTotal = {
  targetId: string;
  targetName: string;
  total: number;
};

export type DefenseRequestStatus = "pending" | "granted" | "refused" | "done";

export type DefenseRequest = {
  playerId: string;
  playerName: string;
  status: DefenseRequestStatus;
  requestedAt: number;
};

export type InfiltratorVoteView = {
  voterId: string;
  voterName: string;
  targetId: string;
  targetName: string;
};

export type LobbyInfo = {
  minPlayers: number;
  maxPlayers: number;
  playerCount: number;
  humanCount: number;
  botCount: number;
  missingPlayers: number;
  plannedInfiltrators: number;
  potentialRoles: Role[];
  roleComposition: Array<{ role: Role; count: number }>;
};

export type GameLogEntry = {
  at: number;
  round: number;
  phase: GamePhase;
  type: "vote" | "action" | "elimination" | "power" | "phase" | "system";
  message: string;
};

export type RoomView = {
  code: string;
  hostId: string;
  mayorId?: string;
  phase: Phase;
  audioMode: AudioMode;
  round: number;
  config: GameConfig;
  lobby: LobbyInfo;
  botAi: {
    enabled: boolean;
    maxPerRoom: number;
    audioEnabled: boolean;
    config: BotRoomConfig;
  };
  players: PlayerPublic[];
  you?: {
    id: string;
    name: string;
    role?: Role;
    sessionId: string;
    alive: boolean;
    canVote: boolean;
    canSpeak: boolean;
    canAct: boolean;
    isHost: boolean;
    isMayor: boolean;
    secretInfo: string[];
    powerStatuses: PowerStatus[];
    nightChannel?: "infiltres" | "solo" | "sleep";
    canHearAudio: boolean;
    audioPeerIds: string[];
  };
  narrator: string;
  transition?: "night-falls" | "day-rises";
  currentNightStep?: NightStep;
  activeRole?: Role;
  activePlayerId?: string;
  timerStartedAt?: number;
  timerDuration?: number;
  timerEndsAt?: number;
  votes: VoteRecord[];
  voteDetails: VoteViewRecord[];
  voteTotals: VoteTotal[];
  mayorVotes: VoteRecord[];
  mayorVoteDetails: VoteViewRecord[];
  mayorVoteTotals: VoteTotal[];
  mayorNominations: VoteRecord[];
  mayorNominationDetails: VoteViewRecord[];
  mayorNominationTotals: VoteTotal[];
  mayorNominees: string[];
  nominations: VoteRecord[];
  nominationDetails: VoteViewRecord[];
  nominationTotals: VoteTotal[];
  nominees: string[];
  defenseRequests: DefenseRequest[];
  chatMessages: ChatMessage[];
  botThinking: string[];
  infiltratorVotes?: InfiltratorVoteView[];
  infiltratorVoteLeader?: VoteTotal;
  lastResult?: string;
  winner?: Winner;
  roleOptions?: Role[];
  gameLog?: GameLogEntry[];
};

export type AdminRoomStatus = "lobby" | "inGame" | "finished";

export type AdminRoomSummary = {
  code: string;
  hostName: string;
  connectedPlayers: number;
  playerCount: number;
  status: AdminRoomStatus;
  phase: GamePhase;
  audioMode: AudioMode;
  botAi: {
    enabled: boolean;
    config: BotRoomConfig;
  };
  createdAt: number;
};

export type AdminRoomDetails = AdminRoomSummary & {
  players: Pick<PlayerPublic, "id" | "name" | "isBot" | "connected" | "alive" | "isHost" | "isMayor" | "botVoice">[];
  round: number;
};

export type ServerSettings = {
  botAi: {
    enabled: boolean;
    maxPerRoom: number;
    audioEnabled: boolean;
    defaults: BotRoomConfig;
  };
  narratorTts: {
    enabled: boolean;
  };
};

export type AdminResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

export type ClientToServerEvents = {
  getServerSettings: (ack: (settings: ServerSettings) => void) => void;
  createRoom: (payload: { name: string; audioMode: AudioMode; sessionId?: string; config?: Partial<GameConfig>; botConfig?: Partial<BotRoomConfig> }, ack: (view: RoomView) => void) => void;
  joinRoom: (payload: { code: string; name: string; sessionId?: string }, ack: (result: { ok: true; view: RoomView } | { ok: false; error: string }) => void) => void;
  reconnectRoom: (payload: { code: string; sessionId: string }, ack: (result: { ok: true; view: RoomView } | { ok: false; error: string }) => void) => void;
  adminLogin: (payload: { username: string; password: string }, ack: (result: AdminResult<{ token: string }>) => void) => void;
  adminLogout: (payload: { token: string }) => void;
  adminListRooms: (payload: { token: string }, ack: (result: AdminResult<{ rooms: AdminRoomSummary[] }>) => void) => void;
  adminRoomDetails: (payload: { token: string; code: string }, ack: (result: AdminResult<{ room: AdminRoomDetails }>) => void) => void;
  adminDeleteRoom: (payload: { token: string; code: string }, ack: (result: AdminResult) => void) => void;
  updateConfig: (payload: { code: string; config: Partial<GameConfig> }) => void;
  updateBotConfig: (payload: { code: string; botConfig: Partial<BotRoomConfig> }) => void;
  updateAudioMode: (payload: { code: string; audioMode: AudioMode }) => void;
  closeRoom: (payload: { code: string }) => void;
  leaveRoom: (payload: { code: string }) => void;
  startGame: (payload: { code: string }) => void;
  addBot: (payload: { code: string }) => void;
  addBots: (payload: { code: string; count: number }) => void;
  fillWithBots: (payload: { code: string; targetCount: number }) => void;
  removeParticipant: (payload: { code: string; playerId: string }) => void;
  nominateMayor: (payload: { code: string; targetId: string }) => void;
  electMayor: (payload: { code: string; targetId: string }) => void;
  adminNext: (payload: { code: string }) => void;
  endGame: (payload: { code: string }) => void;
  returnToLobby: (payload: { code: string }) => void;
  nightAction: (payload: { code: string; targetId?: string; roleChoice?: Role; ministerAction?: "save" | "jail" }) => void;
  finishNightStep: (payload: { code: string }) => void;
  startDebate: (payload: { code: string; seconds?: number }) => void;
  grantSpeech: (payload: { code: string; playerId: string; seconds?: number }) => void;
  stopSpeech: (payload: { code: string }) => void;
  finishDefense: (payload: { code: string; participantId: string }) => void;
  closeDebate: (payload: { code: string }) => void;
  nominate: (payload: { code: string; targetId: string }) => void;
  requestDefense: (payload: { code: string }) => void;
  denyDefense: (payload: { code: string; playerId: string }) => void;
  startVote: (payload: { code: string; seconds?: number }) => void;
  vote: (payload: { code: string; targetId: string }) => void;
  sendChat: (payload: { code: string; text: string }) => void;
  setMuted: (payload: { code: string; playerId: string; muted: boolean }) => void;
  audioActivity: (payload: { code: string; speaking: boolean }) => void;
  audioTranscript: (payload: { code: string; text: string }) => void;
  rtcSignal: (payload: { code: string; to: string; signal: unknown }) => void;
};

export type ServerToClientEvents = {
  roomState: (view: RoomView) => void;
  toast: (message: string) => void;
  roomClosed: (message: string) => void;
  rtcSignal: (payload: { from: string; signal: unknown }) => void;
};

export const DEFAULT_DURATIONS: PhaseDurations = {
  mayorElection: 60,
  nightAction: 10,
  transitionNight: 5,
  freeDebate: 180,
  nomination: 60,
  defense: 45,
  vote: 60,
  resultReveal: 20
};

export const DEFAULT_BOT_CONFIG: BotRoomConfig = {
  enabled: true,
  count: 1,
  autoFill: false,
  participation: "normal",
  audioEnabled: false,
  averageResponseMs: 1500,
  allowMayor: true,
  allowDebateSpeech: true,
  allowAudio: false
};

export const DEFAULT_CONFIG: GameConfig = {
  maxPlayers: MAX_PLAYERS,
  tieRule: "none",
  deadCanHearAudio: true,
  requireSpecialRoles: true,
  enabledRoles: ROLES.filter((role) => role !== "Croyant"),
  durations: DEFAULT_DURATIONS
};

export const ROLE_LABELS: Record<Role, string> = {
  Croyant: "Croyant simple",
  Infiltre: "Infiltre",
  Sage: "Sage",
  AgentDouble: "Agent Double",
  Pasteur: "Pasteur",
  Hackeuse: "Hackeuse",
  Guetteuse: "Guetteuse",
  Avocate: "Avocate",
  LanceuseAlerte: "Lanceuse d'Alerte",
  Ministre: "Ministre",
  LeaderLouange: "Leader de Louange"
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Croyant: "Vous cherchez a identifier tous les Infiltres.",
  Infiltre: "La nuit, vous vous concertez avec les autres Infiltres pour emprisonner une victime.",
  Sage: "Votre intuition compte : votre voix pese double lors du depouillement.",
  AgentDouble: "Au premier tour seulement, vous pouvez echanger votre role contre l'une de deux cartes non distribuees.",
  Pasteur: "Vous resistez a une premiere designation des Infiltres. Cette information reste secrete.",
  Hackeuse: "Chaque nuit, vous decouvrez secretement le role d'un joueur.",
  Guetteuse: "Pendant la nuit des Infiltres, vous pouvez observer discretement qui agit.",
  Avocate: "Chaque nuit, vous protegez une personne, vous incluse.",
  LanceuseAlerte: "Une seule fois dans la partie, vous privez une personne de vote pour le prochain jour.",
  Ministre: "Vous pouvez une fois sauver la victime des Infiltres et une fois emprisonner une autre personne.",
  LeaderLouange: "Role secret distinct du Maire. Vous restez dans le camp des Croyants."
};

export const ROLE_ABILITIES: Record<Role, string[]> = {
  Croyant: [
    "Votre camp gagne quand tous les Infiltres sont elimines.",
    "Vous participez aux debats et aux votes tant que vous etes vivant."
  ],
  Infiltre: [
    "Chaque nuit, les Infiltres designent ensemble un Chretien a emprisonner.",
    "Votre camp gagne quand les Infiltres sont au moins aussi nombreux que les Chretiens restants."
  ],
  Sage: [
    "Votre vote compte double lors du depouillement.",
    "Si vous etes Maire, le bonus de Maire s'ajoute a votre voix."
  ],
  AgentDouble: [
    "Au premier tour seulement, vous voyez deux roles non distribues.",
    "Vous pouvez echanger votre role contre l'une de ces cartes."
  ],
  Pasteur: [
    "Vous resistez a une premiere designation des Infiltres.",
    "Les joueurs ne sont pas informes que vous avez ete cible."
  ],
  Hackeuse: [
    "Chaque nuit, vous choisissez un joueur.",
    "Le serveur vous revele secretement son role."
  ],
  Guetteuse: [
    "Pendant l'etape des Infiltres, vous pouvez observer discretement.",
    "Cette observation reste une information personnelle et ne donne aucune action de vote supplementaire."
  ],
  Avocate: [
    "Chaque nuit, vous protegez un joueur contre l'emprisonnement.",
    "Vous pouvez vous proteger vous-meme."
  ],
  LanceuseAlerte: [
    "Une seule fois dans la partie, vous choisissez un joueur.",
    "Ce joueur participe au debat du jour suivant mais ne peut pas voter."
  ],
  Ministre: [
    "Une seule fois, vous pouvez sauver la victime des Infiltres.",
    "Une seule fois, vous pouvez emprisonner une personne que vous soupconnez."
  ],
  LeaderLouange: [
    "Vous ne pouvez pas etre empeche de chanter pendant le tour des Infiltres.",
    "Si vous entonnez un cantique, tout le monde ouvre les yeux et le jeu passe directement au debat du jour."
  ]
};

export function getInfiltratorCount(playerCount: number) {
  if (playerCount >= 16) return 4;
  if (playerCount >= 11) return 3;
  if (playerCount >= 7) return 2;
  return 0;
}

export function mergeConfig(config?: Partial<GameConfig>): GameConfig {
  const enabledRoles = config?.enabledRoles?.filter((role) => ROLES.includes(role)) ?? DEFAULT_CONFIG.enabledRoles;
  const legacyDurations = config?.durations as Partial<PhaseDurations> & { night?: number } | undefined;
  return {
    maxPlayers: clampInt(config?.maxPlayers, MIN_PLAYERS, MAX_PLAYERS, DEFAULT_CONFIG.maxPlayers),
    tieRule: config?.tieRule === "revote" ? "revote" : "none",
    deadCanHearAudio: config?.deadCanHearAudio ?? DEFAULT_CONFIG.deadCanHearAudio,
    requireSpecialRoles: config?.requireSpecialRoles ?? DEFAULT_CONFIG.requireSpecialRoles,
    enabledRoles: Array.from(new Set(["Infiltre" as Role, ...enabledRoles])),
    durations: {
      mayorElection: clampInt(config?.durations?.mayorElection, 10, 600, DEFAULT_DURATIONS.mayorElection),
      nightAction: clampInt(config?.durations?.nightAction ?? legacyDurations?.night, 5, 60, DEFAULT_DURATIONS.nightAction),
      transitionNight: clampInt(config?.durations?.transitionNight, 0, 120, DEFAULT_DURATIONS.transitionNight),
      freeDebate: clampInt(config?.durations?.freeDebate, 15, 3600, DEFAULT_DURATIONS.freeDebate),
      nomination: clampInt(config?.durations?.nomination, 10, 600, DEFAULT_DURATIONS.nomination),
      defense: clampInt(config?.durations?.defense, 10, 600, DEFAULT_DURATIONS.defense),
      vote: clampInt(config?.durations?.vote, 10, 600, DEFAULT_DURATIONS.vote),
      resultReveal: clampInt(config?.durations?.resultReveal, 5, 300, DEFAULT_DURATIONS.resultReveal)
    }
  };
}

export function mergeBotConfig(config?: Partial<BotRoomConfig>, defaults: BotRoomConfig = DEFAULT_BOT_CONFIG): BotRoomConfig {
  return {
    enabled: config?.enabled ?? defaults.enabled,
    count: clampInt(config?.count, 0, 20, defaults.count),
    autoFill: config?.autoFill ?? defaults.autoFill,
    participation: isBotParticipation(config?.participation) ? config.participation : defaults.participation,
    audioEnabled: config?.audioEnabled ?? defaults.audioEnabled,
    averageResponseMs: clampInt(config?.averageResponseMs, 250, 10000, defaults.averageResponseMs),
    allowMayor: config?.allowMayor ?? defaults.allowMayor,
    allowDebateSpeech: config?.allowDebateSpeech ?? defaults.allowDebateSpeech,
    allowAudio: config?.allowAudio ?? defaults.allowAudio
  };
}

function isBotParticipation(value: unknown): value is BotParticipation {
  return value === "discreet" || value === "normal" || value === "talkative";
}

export function generateRoleDistribution(playerCount: number, config: GameConfig = DEFAULT_CONFIG): Role[] {
  const infiltrators = getInfiltratorCount(playerCount);
  const enabled = new Set(config.enabledRoles);
  const suggestedSpecials: Role[] =
    playerCount >= 17
      ? ["Ministre", "Hackeuse", "Pasteur", "LeaderLouange", "LanceuseAlerte", "Guetteuse"]
      : playerCount >= 11
        ? ["Ministre", "Hackeuse", "Pasteur", "LeaderLouange", "LanceuseAlerte"]
        : ["Ministre", "Hackeuse", "Pasteur"];
  const advancedSpecials: Role[] = ["Avocate", "AgentDouble", "Sage"];
  const relaxedOrder: Role[] =
    playerCount >= 11
      ? ["Ministre", "Hackeuse", "Pasteur", "Avocate", "Sage", "LeaderLouange", "LanceuseAlerte", "AgentDouble", "Guetteuse"]
      : ["Ministre", "Hackeuse", "Pasteur", "Sage", "Avocate", "AgentDouble"];
  const specialOrder = config.requireSpecialRoles ? [...suggestedSpecials, ...advancedSpecials] : relaxedOrder;
  const specialCount = Math.min(playerCount - infiltrators, getSpecialRoleCount(playerCount));
  const selectedSpecials = specialOrder.filter((role) => enabled.has(role)).slice(0, specialCount);
  const roles: Role[] = [
    ...Array.from({ length: infiltrators }, () => "Infiltre" as Role),
    ...selectedSpecials
  ];
  while (roles.length < playerCount) roles.push("Croyant");
  return roles.slice(0, playerCount);
}

export function getPotentialRoles(playerCount: number, config: GameConfig = DEFAULT_CONFIG): Role[] {
  return Array.from(new Set(generateRoleDistribution(Math.max(playerCount, MIN_PLAYERS), config)));
}

// Composition exacte (et deterministe) de la partie : combien de chaque role.
// Seule l'attribution qui-a-quoi est aleatoire ; les quantites, elles, sont fixes.
export function getRoleComposition(playerCount: number, config: GameConfig = DEFAULT_CONFIG): Array<{ role: Role; count: number }> {
  const distribution = generateRoleDistribution(Math.max(playerCount, MIN_PLAYERS), config);
  const counts = new Map<Role, number>();
  for (const role of distribution) counts.set(role, (counts.get(role) ?? 0) + 1);
  const rank = (role: Role) => (role === "Infiltre" ? -1 : role === "Croyant" ? ROLES.length + 1 : ROLES.indexOf(role));
  return [...counts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => rank(a.role) - rank(b.role));
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function getSpecialRoleCount(playerCount: number) {
  if (playerCount >= 19) return 8;
  if (playerCount >= 17) return 7;
  if (playerCount >= 14) return 6;
  if (playerCount >= 12) return 5;
  if (playerCount >= 9) return 4;
  if (playerCount >= 7) return 3;
  return 0;
}
