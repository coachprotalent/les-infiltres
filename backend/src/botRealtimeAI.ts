import type { BotRoomConfig, ChatMessage, GamePhase, NightStep, Role, VoteTotal, VoteViewRecord } from "@les-infiltres/shared";
import { DEFAULT_BOT_CONFIG, ROLE_LABELS, mergeBotConfig } from "@les-infiltres/shared";
import WebSocket from "ws";

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

type RealtimeMessage = {
  type?: string;
  response?: {
    status?: string;
    status_details?: {
      error?: {
        message?: string;
      };
    };
    output?: Array<{
      content?: Array<{
        text?: string;
        transcript?: string;
      }>;
    }>;
  };
  delta?: string;
  text?: string;
  error?: {
    message?: string;
  };
  item?: {
    content?: Array<{
      text?: string;
      transcript?: string;
    }>;
  };
};

export class BotRealtimeAIService {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly maxPerRoom: number;
  readonly audioEnabled: boolean;
  readonly defaults: BotRoomConfig;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly deployment: string;
  private readonly participation: string;
  private readonly timeoutMs: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.endpoint = (env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/+$/, "");
    this.apiKey = env.AZURE_OPENAI_API_KEY ?? "";
    this.apiVersion = env.AZURE_OPENAI_API_VERSION || "2024-10-01-preview";
    this.deployment = env.AZURE_OPENAI_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
    this.enabled = (env.BOT_AI_ENABLED ?? "false").toLowerCase() === "true";
    this.configured = !!this.endpoint && !!this.apiKey;
    this.maxPerRoom = clampInt(Number(env.BOT_MAX_PER_ROOM ?? 5), 0, 20, 5);
    this.participation = env.BOT_DEFAULT_PARTICIPATION || "normal";
    this.audioEnabled = (env.BOT_AUDIO_ENABLED ?? "false").toLowerCase() === "true";
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
    console.log(`[BotAI] Bot ${context.botName} phase=${context.phase} called deployment=${this.deployment}`);
    try {
      const content = await this.requestRealtimeDecision(context, participation);
      if (!content) return undefined;
      return parseDecision(content);
    } catch (error) {
      console.error("[BotAI] Azure error:", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private async requestRealtimeDecision(context: BotAIContext, participation: string): Promise<string | undefined> {
    const urls = this.realtimeUrls();
    let lastError: unknown;
    for (const url of urls) {
      try {
        return await this.requestRealtimeUrl(url, context, participation);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return undefined;
  }

  private requestRealtimeUrl(url: string, context: BotAIContext, participation: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { "api-key": this.apiKey } });
      const chunks: string[] = [];
      let settled = false;
      const timeout = setTimeout(() => finish(undefined, new Error(`Realtime timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
      const finish = (value?: string, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
          // ignore close errors after a settled realtime request
        }
        if (error) reject(error);
        else resolve(value);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text"],
            instructions: this.systemPrompt(),
            temperature: this.temperature(participation)
          }
        }));
        ws.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(context) }]
          }
        }));
        ws.send(JSON.stringify({
          type: "response.create",
          response: {
            modalities: ["text"],
            instructions: "Retourne uniquement l'objet JSON d'action, sans Markdown ni texte autour.",
            max_output_tokens: 240
          }
        }));
      });

      ws.on("message", (raw) => {
        const message = parseRealtimeMessage(raw.toString());
        if (!message) return;
        if (message.type === "error") return finish(undefined, new Error(message.error?.message ?? "Realtime error"));
        if (message.type?.startsWith("response.") && message.delta) chunks.push(message.delta);
        if (message.type?.startsWith("response.") && message.text) chunks.push(message.text);
        if (message.response?.status === "failed") return finish(undefined, new Error(message.response.status_details?.error?.message ?? "Realtime response failed"));
        if (message.type === "response.done") return finish(responseText(message) || chunks.join("").trim());
      });

      ws.on("error", (error) => finish(undefined, error instanceof Error ? error : new Error(String(error))));
      ws.on("close", () => {
        if (!settled && chunks.length) finish(chunks.join("").trim());
        else if (!settled) finish(undefined, new Error("Realtime socket closed before response"));
      });
    });
  }

  private realtimeUrls() {
    const endpoint = new URL(this.endpoint);
    endpoint.protocol = endpoint.protocol === "http:" ? "ws:" : "wss:";
    const preview = new URL(endpoint.toString());
    preview.pathname = "/openai/realtime";
    preview.searchParams.set("api-version", this.apiVersion);
    preview.searchParams.set("deployment", this.deployment);
    const ga = new URL(endpoint.toString());
    ga.pathname = "/openai/v1/realtime";
    ga.searchParams.set("model", this.deployment);
    return this.apiVersion.includes("preview") ? [preview.toString(), ga.toString()] : [ga.toString(), preview.toString()];
  }

  private temperature(participation: string) {
    if (participation === "discreet") return 0.35;
    if (participation === "talkative") return 0.75;
    return 0.55;
  }

  private systemPrompt() {
    return [
      "Tu joues a Les Infiltres comme un joueur humain.",
      "Respecte strictement la personnalite, le style et la memoire du bot fournis dans le contexte.",
      "Tu ne connais que le contexte JSON fourni. N'invente jamais de roles caches ou d'actions invisibles.",
      "Lis les messages visibles, surtout lastMessagesAddressedToBot si un joueur t'appelle.",
      "Ne repete pas exactement une phrase recente d'un autre bot ou de toi-meme.",
      "Retourne uniquement un objet JSON avec une action autorisee.",
      "Utilise les ids exacts des joueurs pour les cibles.",
      "Messages courts, naturels, en francais."
    ].join(" ");
  }

  private logStartup() {
    console.log(`[BotAI] enabled=${this.enabled} configured=${this.configured} audio=${this.audioEnabled} deployment=${this.deployment}`);
    console.log(`[BotAI] endpoint=${this.endpoint ? "present" : "absent"} apiKey=${this.apiKey ? "present" : "absent"} apiVersion=${this.apiVersion}`);
  }
}

function parseRealtimeMessage(raw: string): RealtimeMessage | undefined {
  try {
    return JSON.parse(raw) as RealtimeMessage;
  } catch {
    return undefined;
  }
}

function responseText(message: RealtimeMessage) {
  const values: string[] = [];
  for (const output of message.response?.output ?? []) {
    if (output.content) values.push(...output.content.flatMap((item) => item.text ?? item.transcript ?? []));
  }
  return values.join("").trim();
}

function parseDecision(content: string): BotDecision | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<BotDecision>;
    if (!parsed || typeof parsed.action !== "string") return undefined;
    if (parsed.action === "speak" && typeof parsed.message === "string") return { action: "speak", message: parsed.message.slice(0, 280) };
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
  return typeof value === "string" ? value.slice(0, 280) : undefined;
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function botParticipation(value: string) {
  return value === "discreet" || value === "talkative" ? value : "normal";
}
