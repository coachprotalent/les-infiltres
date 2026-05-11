import type { ChatMessage, GamePhase, NightStep, Role, VoteTotal, VoteViewRecord } from "@les-infiltres/shared";
import { ROLE_LABELS } from "@les-infiltres/shared";

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
  botRole?: Role;
  phase: GamePhase;
  currentNightStep?: NightStep;
  publicEvents: string[];
  visibleMessages: ChatMessage[];
  alivePlayers: Array<{ id: string; name: string; isSelf: boolean; isMayor: boolean }>;
  nominatedPlayers: Array<{ id: string; name: string }>;
  currentVoteState: {
    votes: VoteViewRecord[];
    totals: VoteTotal[];
  };
  privateRoleInfo: string[];
  allowedActions: BotAllowedAction[];
};

type AzureChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class BotRealtimeAIService {
  readonly enabled: boolean;
  readonly maxPerRoom: number;
  readonly audioEnabled: boolean;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly deployment: string;
  private readonly participation: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.endpoint = (env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/+$/, "");
    this.apiKey = env.AZURE_OPENAI_API_KEY ?? "";
    this.apiVersion = env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";
    this.deployment = env.AZURE_OPENAI_REALTIME_DEPLOYMENT || env.AZURE_OPENAI_DEPLOYMENT || "gpt-realtime-1.5";
    this.enabled = (env.BOT_AI_ENABLED ?? "false").toLowerCase() === "true" && !!this.endpoint && !!this.apiKey;
    this.maxPerRoom = clampInt(Number(env.BOT_MAX_PER_ROOM ?? 5), 0, 20, 5);
    this.participation = env.BOT_DEFAULT_PARTICIPATION || "normal";
    this.audioEnabled = (env.BOT_AUDIO_ENABLED ?? "false").toLowerCase() === "true";
  }

  async decide(context: BotAIContext): Promise<BotDecision | undefined> {
    if (!this.enabled) return undefined;
    try {
      const response = await this.requestDecision(context, true);
      const usableResponse = response.ok ? response : response.status === 400 ? await this.requestDecision(context, false) : response;
      if (!usableResponse.ok) {
        console.error(`BotRealtimeAIService Azure error ${usableResponse.status}: ${await usableResponse.text()}`);
        return undefined;
      }
      const data = await usableResponse.json() as AzureChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) return undefined;
      return parseDecision(content);
    } catch (error) {
      console.error("BotRealtimeAIService failed", error);
      return undefined;
    }
  }

  private requestDecision(context: BotAIContext, jsonMode: boolean) {
    return fetch(`${this.endpoint}/openai/deployments/${encodeURIComponent(this.deployment)}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`, {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: this.systemPrompt() },
            { role: "user", content: JSON.stringify(context) }
          ],
          temperature: this.participation === "conservative" ? 0.4 : 0.7,
          max_tokens: 220,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {})
        })
      });
  }

  private systemPrompt() {
    return [
      "Tu joues a Les Infiltres comme un joueur humain.",
      "Tu ne connais que le contexte JSON fourni. N'invente jamais de roles caches ou d'actions invisibles.",
      "Retourne uniquement un objet JSON avec une action autorisee.",
      "Utilise les ids exacts des joueurs pour les cibles.",
      "Messages courts, naturels, en francais."
    ].join(" ");
  }
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
