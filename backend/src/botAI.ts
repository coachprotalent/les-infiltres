import type { BotRoomConfig, ChatMessage, GamePhase, NightStep, Role, VoteTotal, VoteViewRecord } from "@les-infiltres/shared";
import { DEFAULT_BOT_CONFIG, ROLE_LABELS, mergeBotConfig } from "@les-infiltres/shared";

export type BotAllowedAction = "speak" | "nominateMayor" | "voteMayor" | "nominate" | "requestDefense" | "vote" | "nightAction" | "pass";

export type BotDecision =
  | { action: "speak"; message: string }
  | { action: "nominateMayor"; targetPlayerId: string }
  | { action: "voteMayor"; targetPlayerId: string; reason?: string }
  | { action: "nominate"; targetPlayerId: string }
  | { action: "requestDefense"; message?: string }
  | { action: "vote"; targetPlayerId: string; reason?: string }
  | { action: "nightAction"; targetPlayerId?: string; roleChoice?: Role; ministerAction?: "save" | "jail" }
  | { action: "pass"; reason?: string };

export type BotAIContext = {
  botName: string;
  botPersonality: string;
  botRoleplayProfile?: {
    role: string;
    temperament: string;
    suspicionLevel: number;
    humorLevel: number;
    defensiveAggression: number;
    accusationBias: number;
    calmingBias: number;
  };
  speakingStyle: string;
  botRole?: Role;
  phase: GamePhase;
  currentNightStep?: NightStep;
  publicEvents: string[];
  visibleMessages: ChatMessage[];
  lastMessagesAddressedToBot: ChatMessage[];
  alivePlayers: Array<{ id: string; name: string; isSelf: boolean; isMayor: boolean }>;
  nominatedPlayers: Array<{ id: string; name: string }>;
  currentVoteState: {
    votes: VoteViewRecord[];
    totals: VoteTotal[];
  };
  knownSuspicions: Array<{ playerId: string; playerName: string; suspicion: number }>;
  memory: string[];
  privateRoleInfo: string[];
  currentStrategy: string;
  allowedActions: BotAllowedAction[];
};

/**
 * Service IA des bots — un seul cerveau : Azure OpenAI chat completions.
 * Il decide ce qu'un bot dit ou fait (objet JSON d'action), avec un contexte
 * filtre anti-triche fourni par game.ts. Si l'IA est desactivee, non configuree,
 * ou en erreur/timeout, decide() renvoie undefined et game.ts retombe sur les
 * personnalites hors-ligne (botPersonas).
 */
export class BotAIService {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly autoSpeakEnabled: boolean;
  readonly voiceVariationEnabled: boolean;
  readonly defaultVoice: string;
  readonly availableVoices: string[];
  readonly speakCooldownSeconds: number;
  readonly maxMessagesPerMinute: number;
  readonly maxPerRoom: number;
  readonly audioEnabled: boolean;
  readonly defaults: BotRoomConfig;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly deployment: string;
  private readonly maxOutputTokens: number;
  private readonly responseStyle: string;
  private readonly personalityVariation: boolean;
  private readonly participation: string;
  private readonly timeoutMs: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    // Connexion Azure OpenAI (noms clairs + compatibilite avec les anciens noms "reasoning").
    this.endpoint = (env.AZURE_OPENAI_ENDPOINT ?? env.AZURE_OPENAI_REASONING_ENDPOINT ?? "").replace(/\/+$/, "");
    this.apiKey = env.AZURE_OPENAI_API_KEY ?? env.AZURE_OPENAI_REASONING_API_KEY ?? "";
    this.apiVersion = env.AZURE_OPENAI_API_VERSION ?? env.AZURE_OPENAI_REASONING_API_VERSION ?? "2024-08-01-preview";
    this.deployment = env.AZURE_OPENAI_DEPLOYMENT || env.AZURE_OPENAI_REASONING_DEPLOYMENT || "gpt-4o-mini";
    this.enabled = (env.BOT_AI_ENABLED ?? "false").toLowerCase() === "true";
    this.configured = !!this.endpoint && !!this.apiKey;
    this.maxPerRoom = clampInt(Number(env.BOT_MAX_PER_ROOM ?? 20), 0, 20, 20);
    this.participation = env.BOT_DEFAULT_PARTICIPATION || "normal";
    this.audioEnabled = (env.BOT_AUDIO_ENABLED ?? "false").toLowerCase() === "true";
    this.maxOutputTokens = clampInt(Number(env.BOT_MAX_OUTPUT_TOKENS ?? env.BOT_MAX_REASONING_TOKENS ?? 1200), 120, 4000, 1200);
    this.responseStyle = env.BOT_RESPONSE_STYLE || "advanced";
    this.personalityVariation = (env.BOT_PERSONALITY_VARIATION ?? "true").toLowerCase() === "true";
    this.autoSpeakEnabled = (env.BOT_AUTO_SPEAK_ENABLED ?? "true").toLowerCase() === "true";
    this.voiceVariationEnabled = (env.BOT_VOICE_VARIATION_ENABLED ?? "true").toLowerCase() === "true";
    this.defaultVoice = env.BOT_DEFAULT_VOICE || "alloy";
    this.availableVoices = (env.BOT_AVAILABLE_VOICES || "alloy,ash,ballad,coral,echo,onyx,nova,sage,shimmer,verse")
      .split(",")
      .map((voice) => voice.trim())
      .filter(Boolean);
    this.speakCooldownSeconds = clampInt(Number(env.BOT_SPEAK_COOLDOWN_SECONDS ?? 20), 5, 300, 20);
    this.maxMessagesPerMinute = clampInt(Number(env.BOT_MAX_MESSAGES_PER_MINUTE ?? 2), 1, 10, 2);
    this.timeoutMs = clampInt(Number(env.BOT_AI_TIMEOUT_MS ?? 12000), 3000, 60000, 12000);
    this.defaults = mergeBotConfig({
      enabled: this.enabled,
      count: clampInt(Number(env.BOT_DEFAULT_COUNT ?? 1), 0, this.maxPerRoom, DEFAULT_BOT_CONFIG.count),
      autoFill: (env.BOT_AUTO_FILL_ENABLED ?? "false").toLowerCase() === "true",
      participation: botParticipation(this.participation),
      audioEnabled: this.audioEnabled,
      averageResponseMs: clampInt(Number(env.BOT_AVERAGE_RESPONSE_MS ?? 1500), 250, 10000, 1500),
      allowMayor: (env.BOT_ALLOW_MAYOR ?? "true").toLowerCase() === "true",
      allowDebateSpeech: (env.BOT_ALLOW_DEBATE_SPEECH ?? "true").toLowerCase() === "true",
      allowAudio: (env.BOT_ALLOW_AUDIO ?? "false").toLowerCase() === "true"
    });
    this.logStartup();
  }

  async decide(context: BotAIContext, participation = this.participation): Promise<BotDecision | undefined> {
    if (!this.enabled || !this.configured) return undefined;
    console.log(`[BotAI] Bot ${context.botName} phase=${context.phase} deployment=${this.deployment}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const endpoint = new URL(this.endpoint);
      endpoint.pathname = `/openai/deployments/${encodeURIComponent(this.deployment)}/chat/completions`;
      endpoint.searchParams.set("api-version", this.apiVersion);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: this.systemPrompt() },
            { role: "user", content: JSON.stringify({ ...context, responseStyle: this.responseStyle, personalityVariation: this.personalityVariation }) }
          ],
          temperature: this.temperature(participation),
          max_tokens: this.maxOutputTokens
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Azure OpenAI HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content?.trim();
      return content ? parseDecision(content) : undefined;
    } catch (error) {
      console.error("[BotAI] Azure error:", error instanceof Error ? error.message : error);
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private temperature(participation: string) {
    if (participation === "discreet") return 0.35;
    if (participation === "talkative") return 0.75;
    return 0.55;
  }

  private systemPrompt() {
    return [
      "Tu joues a Les Infiltres comme un joueur humain.",
      "Tu controles un bot dans un jeu social de discussion. Le bot doit parler comme une vraie personne, avec une personnalite distincte.",
      "Analyse le contexte: qui parle, ce qui vient d'etre dit, la personnalite du bot, et s'il doit repondre, se defendre, accuser, calmer le jeu ou se taire.",
      "Ne reponds pas toujours. Si le bot parle, donne une reponse naturelle, adaptee a son caractere, avec un raisonnement implicite sans reveler qu'il est une IA.",
      "Respecte strictement la personnalite, le style et la memoire du bot fournis dans le contexte.",
      "Incarne pleinement botRoleplayProfile et speakingStyle : adapte le registre, le vocabulaire, la longueur des phrases et la ponctuation au caractere du bot.",
      "Un accusateur frontal est bref et tranchant ; une mediatrice apaise et nuance ; une reactive est emotive et directe ; un stratege cite des contradictions ; une analyste reste factuelle. Deux bots ne doivent jamais sonner pareil.",
      "Varie tes formulations d'un tour a l'autre : evite les tournures passe-partout et les phrases interchangeables entre personnages.",
      "Tu ne connais que le contexte JSON fourni. N'invente jamais de roles caches ou d'actions invisibles.",
      "Lis les messages visibles, surtout lastMessagesAddressedToBot si un joueur t'appelle.",
      "Ne repete pas exactement une phrase recente d'un autre bot ou de toi-meme.",
      "Retourne uniquement un objet JSON avec une action autorisee.",
      "Utilise les ids exacts des joueurs pour les cibles.",
      "Quand l'action est speak, le message peut etre plus developpe et personnel, mais reste jouable en conversation orale."
    ].join(" ");
  }

  private logStartup() {
    console.log(`[BotAI] enabled=${this.enabled} configured=${this.configured} deployment=${this.deployment} endpoint=${this.endpoint ? "present" : "absent"} apiKey=${this.apiKey ? "present" : "absent"} apiVersion=${this.apiVersion}`);
    console.log(`[BotAI] voices variation=${this.voiceVariationEnabled} default=${this.defaultVoice} available=${this.availableVoices.join(",")}`);
  }
}

function parseDecision(content: string): BotDecision | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<BotDecision>;
    if (!parsed || typeof parsed.action !== "string") return undefined;
    if (parsed.action === "speak" && typeof parsed.message === "string") return { action: "speak", message: parsed.message.slice(0, 480) };
    if (parsed.action === "nominateMayor" && typeof parsed.targetPlayerId === "string") return { action: "nominateMayor", targetPlayerId: parsed.targetPlayerId };
    if (parsed.action === "voteMayor" && typeof parsed.targetPlayerId === "string") return { action: "voteMayor", targetPlayerId: parsed.targetPlayerId, reason: stringOrUndefined(parsed.reason) };
    if (parsed.action === "nominate" && typeof parsed.targetPlayerId === "string") return { action: "nominate", targetPlayerId: parsed.targetPlayerId };
    if (parsed.action === "requestDefense") return { action: "requestDefense", message: stringOrUndefined(parsed.message) };
    if (parsed.action === "vote" && typeof parsed.targetPlayerId === "string") return { action: "vote", targetPlayerId: parsed.targetPlayerId, reason: stringOrUndefined(parsed.reason) };
    if (parsed.action === "nightAction") {
      return {
        action: "nightAction",
        targetPlayerId: stringOrUndefined(parsed.targetPlayerId),
        roleChoice: isRole(parsed.roleChoice) ? parsed.roleChoice : undefined,
        ministerAction: parsed.ministerAction === "save" || parsed.ministerAction === "jail" ? parsed.ministerAction : undefined
      };
    }
    if (parsed.action === "pass") return { action: "pass", reason: stringOrUndefined(parsed.reason) };
  } catch {
    return undefined;
  }
  return undefined;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_LABELS;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value.slice(0, 480) : undefined;
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function botParticipation(value: string) {
  return value === "discreet" || value === "talkative" ? value : "normal";
}
