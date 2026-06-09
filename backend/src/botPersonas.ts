// Banques de répliques par archétype de bot.
// Objectif : même sans le service IA (BOT_AI_ENABLED=false), chaque bot parle
// avec sa propre voix — registre, vocabulaire, longueur et ton distincts — pour
// que les échanges ne se ressemblent pas. Les jetons {s} (suspect), {a}
// (accusateur) et {t} (cible de vote) sont remplacés au moment de l'usage.

export type PersonaInput = {
  role: string;
  humorLevel: number;
  defensiveAggression: number;
  accusationBias: number;
  calmingBias: number;
};

type Persona = {
  debateWithSuspect: string[];
  debateNeutral: string[];
  reply: string[];
  voteReason: string[];
  mayorReason: string[];
};

const PERSONAS: Record<string, Persona> = {
  observatrice: {
    debateWithSuspect: [
      "Je ne veux pas trancher trop vite, mais {s} reste difficile à lire. Ses réponses sont trop lisses.",
      "Si j'observe bien, {s} évite chaque question frontale. Ce n'est pas une preuve, juste un schéma.",
      "Une remarque, sans accuser : {s} parle beaucoup quand on ne le vise pas, et se tait dès qu'on s'approche."
    ],
    debateNeutral: [
      "Je préfère écouter encore un peu. On accuse vite, ici, et rarement avec des faits.",
      "Reprenons calmement. Qui a réellement justifié son vote du tour précédent ?",
      "Je note les réactions plus que les mots. Pour l'instant, rien ne se détache nettement."
    ],
    reply: [
      "Tu m'accuses, {a} ? Très bien. Dis-moi sur quel fait précis, et je te réponds posément.",
      "Pas besoin de hausser le ton. Mes silences ne sont pas des aveux, ce sont des observations.",
      "Je comprends le doute, mais regarde plutôt {s} : moi, je n'ai pas changé de version."
    ],
    voteReason: [
      "Je vote {t} après réflexion : c'est le profil le plus cohérent avec ce que j'ai observé.",
      "Mon choix se porte sur {t}, calmement, parce que ses contradictions reviennent trop souvent."
    ],
    mayorReason: ["{t} garde la tête froide. Un Maire posé vaut mieux qu'un meneur impulsif."]
  },
  stratege: {
    debateWithSuspect: [
      "Reprenons les faits. {s} a dit une chose, puis son contraire. Ça, ce n'est pas un détail.",
      "Je vais être méthodique : {s} n'explique jamais ses revirements. Pourquoi ?",
      "On me retourne les soupçons trop facilement. Le vrai problème, c'est l'incohérence de {s}."
    ],
    debateNeutral: [
      "Avant d'accuser, montrez-moi une contradiction concrète. Sinon, on vote à l'aveugle.",
      "Je veux des justifications, pas des impressions. Qui assume son vote précédent ?",
      "Structurons : un fait, une cible, un vote. Le reste, c'est du bruit pour nous égarer."
    ],
    reply: [
      "{a}, ton accusation tombe trop bien. Explique-moi ta logique, point par point.",
      "Tu m'attaques pour détourner l'attention de {s} ? C'est exactement ce que je surveille.",
      "Je me défends avec des faits, pas avec de l'émotion. Reprends mes votes : ils sont cohérents."
    ],
    voteReason: [
      "Je vote {t} : c'est la seule cible dont les contradictions tiennent debout.",
      "Logiquement, {t}. Aligne ses déclarations et ses votes, le compte n'y est pas."
    ],
    mayorReason: ["{t} sait lire une partie. Au poste de Maire, il cadrera les débats au lieu de les subir."]
  },
  reactive: {
    debateWithSuspect: [
      "Attends, sérieux ? {s}, faut que tu t'expliques là, parce que ça sent pas bon du tout.",
      "Moi je le sens pas, {s}. Y a un truc dans sa façon d'esquiver qui m'agace.",
      "Ok stop. {s} a encore évité la question. Quelqu'un d'autre l'a vu ou c'est que moi ?"
    ],
    debateNeutral: [
      "Bon, on fait quoi là ? On reste muets pendant que les Infiltrés se régalent ?",
      "Réveillez-vous ! Personne ne réagit, et c'est exactement ce qu'ils veulent.",
      "Franchement ce silence me stresse. Quelqu'un prend l'initiative, oui ?"
    ],
    reply: [
      "Quoi ?! {a}, tu m'accuses moi ? Mais c'est n'importe quoi, regarde plutôt {s} !",
      "Non mais j'hallucine. Si j'étais infiltrée je serais pas en train de gueuler comme ça.",
      "Tu retournes ça contre moi, {a} ? Trop facile. Réponds à ma question d'abord."
    ],
    voteReason: [
      "Je vote {t}, désolée mais mon instinct me hurle que c'est lui.",
      "C'est {t} pour moi, point. Sa façon de paniquer tout à l'heure, ça trompe pas."
    ],
    mayorReason: ["{t} a du répondant. Au moins avec lui en Maire, ça bougera et on s'endormira pas."]
  },
  accusateur: {
    debateWithSuspect: [
      "{s}. C'est lui. Il esquive depuis le premier tour.",
      "Arrêtons de tourner autour. {s} ment, ça se voit.",
      "Une cible : {s}. Le reste, c'est du bruit."
    ],
    debateNeutral: [
      "Quelqu'un doit tomber ce tour. On ne gagne pas en se cachant.",
      "Assez parlé. Désignez, votez. Le silence profite aux traîtres.",
      "Pas de demi-mesure : nommez vos suspects, maintenant."
    ],
    reply: [
      "Tu te défends, {a} ? Mauvais signe. Les innocents accusent, ils ne pleurnichent pas.",
      "Joli détournement, {a}. Mais c'est {s} que je vise, et je ne lâche pas.",
      "Tu me vises pour te couvrir. Ça ne marche pas avec moi."
    ],
    voteReason: [
      "Je vote {t}. Pas de doute, pas de pitié.",
      "{t}, sans hésiter. Il esquive trop pour être net."
    ],
    mayorReason: ["{t} ne se cachera pas derrière des formules. Un Maire qui tranche, c'est ce qu'il nous faut."]
  },
  sociale: {
    debateWithSuspect: [
      "J'aime bien l'ambiance, mais soyons honnêtes : {s} m'a mise mal à l'aise quand il a esquivé.",
      "Je fais confiance à mon ressenti, et là, {s} sonne faux depuis tout à l'heure.",
      "On est un groupe, non ? Alors {s}, parle-nous franchement, qu'on avance ensemble."
    ],
    debateNeutral: [
      "Discutons vraiment, pas juste pour accuser. Qui se sent visé, et pourquoi ?",
      "Je préfère qu'on s'écoute. Les vrais indices sont dans la façon dont on se répond.",
      "Restons soudés mais lucides. Le calme aussi peut cacher quelque chose."
    ],
    reply: [
      "{a}, je t'aime bien, mais là tu te trompes de cible. Regarde plutôt {s}.",
      "Tu m'accuses ? Ça me touche, mais ça ne change rien : je joue franc-jeu.",
      "Restons cordiaux. Si tu doutes de moi, {a}, pose-moi une vraie question."
    ],
    voteReason: [
      "Je vote {t} : mon ressenti et le débat pointent vers lui.",
      "Ce sera {t}. À force, son malaise se sent trop pour être ignoré."
    ],
    mayorReason: ["{t} fédère sans écraser. Il fera parler tout le monde, c'est précieux."]
  },
  "tacticien discret": {
    debateWithSuspect: [
      "Une chose, juste : {s} n'a toujours pas justifié son vote. Le reste m'importe peu.",
      "Je serai bref. {s}. Un fait : il s'est contredit. Suffisant pour ce tour.",
      "Pas de grand discours. {s} est l'angle le plus rentable à creuser."
    ],
    debateNeutral: [
      "Je garde mes mots. Mais votez utile : sur les faits, pas à l'instinct.",
      "Peu de bruit, une question : qui profite réellement du chaos actuel ?",
      "J'attends. Celui qui parle trop pour ne rien dire finit toujours par se trahir."
    ],
    reply: [
      "{a}, accusation notée. Un fait contre moi, ou on passe.",
      "Je réponds court : rien dans mon jeu ne tient de l'Infiltré. Revenons à {s}.",
      "Tu perds du temps avec moi, {a}. La vraie cible, c'est {s}."
    ],
    voteReason: [
      "Je vote {t}. Une raison concrète suffit, et je l'ai.",
      "{t}. Le calcul est simple : c'est le seul à n'avoir rien risqué."
    ],
    mayorReason: ["{t} parle peu mais juste. Un Maire efficace n'a pas besoin d'en faire trop."]
  },
  mediateur: {
    debateWithSuspect: [
      "Ne nous emballons pas. Posons une question simple à {s} et écoutons vraiment.",
      "Je veux apaiser, mais pas couvrir : {s} mérite qu'on l'entende s'expliquer.",
      "Avant de voter sous tension, donnons une dernière chance à {s} de clarifier."
    ],
    debateNeutral: [
      "Respirons. La précipitation a déjà coûté des innocents, ici.",
      "Faisons parler ceux qu'on n'entend pas. Le silence interroge, il ne condamne pas.",
      "Cherchons l'accord sur les faits avant de chercher un coupable."
    ],
    reply: [
      "{a}, je t'entends. Reformulons calmement : qu'est-ce qui te fait douter de moi exactement ?",
      "Pas de procès d'intention. Si tu m'accuses, {a}, faisons-le sur des faits, sereinement.",
      "Je ne fuis pas le débat. Mais regardons aussi {s} avant de me condamner."
    ],
    voteReason: [
      "Je vote {t} à regret : le débat ne m'a pas convaincu de son innocence.",
      "Ce sera {t}. J'ai cherché à le défendre, sans y parvenir honnêtement."
    ],
    mayorReason: ["{t} sait calmer une salle. Un Maire qui apaise évite les votes de panique."]
  },
  analyste: {
    debateWithSuspect: [
      "Un indice, une conclusion : {s} vote toujours en dernier, après avoir lu la salle.",
      "Factuellement, {s} est le seul à n'avoir pris aucun risque ce tour.",
      "Si on suit les données, {s} ressort comme l'hypothèse la plus probable."
    ],
    debateNeutral: [
      "Listons ce qu'on sait vraiment, et écartons les impressions.",
      "Sans fait nouveau, je m'appuie sur les votes publics du dernier tour.",
      "Méthode d'abord : qui a voté quoi, et qu'est-ce que ça révèle ?"
    ],
    reply: [
      "{a}, donne-moi une donnée, pas une intuition, et je révise mon analyse.",
      "Mon raisonnement est traçable. Celui de {s} l'est beaucoup moins.",
      "Tu m'accuses sans élément, {a}. Apporte un fait, je l'intègre."
    ],
    voteReason: [
      "Je vote {t} : c'est ce que disent les faits, pas mon humeur.",
      "{t}, par élimination logique. Les autres pistes ne tiennent pas."
    ],
    mayorReason: ["{t} raisonne avant de réagir. C'est le profil le plus fiable pour arbitrer."]
  },
  "enqueteur social": {
    debateWithSuspect: [
      "Petite question : {s}, pourquoi tu as changé d'avis si vite ?",
      "J'aimerais comprendre {s}. Qui l'a vu vraiment s'engager ce tour ?",
      "{s}, aide-moi : qu'est-ce qui justifie ton dernier vote, concrètement ?"
    ],
    debateNeutral: [
      "Une question pour tout le monde : à qui profite le silence, là, maintenant ?",
      "Je creuse les non-dits. Qui n'a encore rien affirmé de net ?",
      "Avant d'accuser, j'aimerais entendre ceux qu'on n'a pas écoutés."
    ],
    reply: [
      "{a}, pourquoi moi et pas {s} ? Explique, ça m'intéresse.",
      "Tu m'accuses, d'accord, mais sur quel indice précis, {a} ?",
      "Bonne objection. Maintenant retourne-la vers {s} et regarde sa réaction."
    ],
    voteReason: [
      "Je vote {t} : ses réponses soulèvent plus de questions que de réponses.",
      "{t}, parce qu'à chaque question, il esquive un peu plus."
    ],
    mayorReason: ["{t} pose les bonnes questions. Un Maire curieux fait avancer l'enquête."]
  },
  competiteur: {
    debateWithSuspect: [
      "Je joue pour gagner. {s} est mon pari : trop prudent pour être net.",
      "On perd si on hésite. {s}, maintenant.",
      "Mon viseur est sur {s}. Convaincs-moi du contraire, sinon je n'en bouge pas."
    ],
    debateNeutral: [
      "Pas le temps de tergiverser. Désignons et avançons.",
      "Le doute, c'est leur arme. Décidons vite et serrons les rangs.",
      "Chaque tour perdu nous coûte. Qui ose s'engager le premier ?"
    ],
    reply: [
      "{a}, tu me vises pour gagner du temps. Pas question, je rends les coups.",
      "Moi, infiltré ? Tu rêves, {a}. {s} est bien plus suspect.",
      "Belle tentative, {a}. Mais je ne me laisse pas sortir aussi facilement."
    ],
    voteReason: [
      "Je vote {t} : c'est le pari le plus rentable pour gagner.",
      "{t}. Quand on doute, on frappe la cible la plus exposée."
    ],
    mayorReason: ["{t} a la niaque. En Maire, il imposera un rythme et on ne stagnera pas."]
  }
};

const DEFAULT_PERSONA = PERSONAS.analyste;

function personaFor(role: string): Persona {
  return PERSONAS[role] ?? DEFAULT_PERSONA;
}

function build(lines: string[], tokens: { s?: string; a?: string; t?: string }): string[] {
  return lines
    .filter((line) => (line.includes("{s}") ? !!tokens.s : true) && (line.includes("{t}") ? !!tokens.t : true))
    .map((line) =>
      line
        .split("{s}").join(tokens.s ?? "")
        .split("{a}").join(tokens.a ?? "toi")
        .split("{t}").join(tokens.t ?? "")
    );
}

function shuffle<T>(items: T[]): T[] {
  return items
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}

/** Répliques de débat (intervention spontanée), dans la voix du bot. */
export function personaDebateLines(persona: PersonaInput, suspectName?: string): string[] {
  const p = personaFor(persona.role);
  const lines = suspectName ? [...p.debateWithSuspect, ...p.debateNeutral] : [...p.debateNeutral];
  return shuffle(build(lines, { s: suspectName }));
}

/** Répliques de réponse quand le bot est interpellé ou accusé. */
export function personaReplyLines(persona: PersonaInput, accuserName?: string, suspectName?: string): string[] {
  const p = personaFor(persona.role);
  return shuffle(build(p.reply, { a: accuserName, s: suspectName }));
}

/** Justification de vote, dans la voix du bot. */
export function personaVoteReason(persona: PersonaInput, targetName: string): string {
  const p = personaFor(persona.role);
  const lines = build(p.voteReason, { t: targetName });
  return shuffle(lines)[0] ?? `Je vote ${targetName}.`;
}

/** Justification de vote pour le Maire. */
export function personaMayorReason(persona: PersonaInput, targetName: string): string {
  const p = personaFor(persona.role);
  const lines = build(p.mayorReason, { t: targetName });
  return shuffle(lines)[0] ?? `${targetName} me semble capable de tenir la salle.`;
}
