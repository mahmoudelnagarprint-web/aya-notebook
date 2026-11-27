import type { AyaModel, AyaRole, AyaRouting } from '@ayatodoist/shared-types';

/**
 * «توزيع تلقائي ذكي» — capability-aware routing of the four Aya task roles.
 *
 * The old implementation scored every model once with a single global formula.
 * That collapses badly on real catalogues: `mini` matched "MiniMax" and `flash`
 * matched both Flash models, so all three scored identically and every role fell
 * back to the same priority-first row. Aya now scores each role separately and
 * gives models already used by another role a diversity penalty, so three
 * imported models are spread across the four slots instead of piling on one.
 */

interface Features {
  id: string;
  strength: number;
  speed: number;
  vision: number;
  longContext: number;
  availability: number;
}

/** Flagship / reasoning families. `minimax[-_ ]?m2` is intentional; plain `mini` is not. */
const FLAGSHIP =
  /(opus|sonnet|gpt-4o(?!-mini)|gpt-4\.1|gpt-5|(^|[^a-z0-9])o[134]([^0-9]|$)|deepseek(?!.*flash)|minimax[-_ ]?m\d|qwen.*max|command-r-plus|405b|235b|120b|72b|70b|large|pro([^a-z]|$)|ultra|reason|thinking)/i;

/** Fast / cheap families. `mini(?!max)` stops "MiniMax" from looking like a mini model. */
const SPEED = /(flash|mini(?!max)|nano|lite|haiku|instant|turbo|small|8b|7b|3b|1\.5b|air|tiny|glm.*flash)/i;

/** Model ids that historically expose image input. */
const VISION_HINT =
  /(vision|[-_/]vl([^a-z]|$)|gpt-4o|gpt-5|gemini|claude-(3|4)|glm-(4v|5)|minimax|pixtral|qwen.*vl|llava|internvl|gemma3|4v)/i;

/** Families known for large context windows even when `/models` omits the size. */
const LONG_HINT = /(1m|1\.0m|128k|200k|256k|long|gemini|glm|deepseek|minimax|flash|kimi)/i;

function clamp(value: number, min = 1, max = 10): number {
  return Math.max(min, Math.min(max, value));
}

function contextScore(model: AyaModel, id: string): number {
  const window = model.contextWindow ?? 0;
  let score = 4;
  if (window >= 1_000_000) score = 10;
  else if (window >= 500_000) score = 9.5;
  else if (window >= 200_000) score = 9;
  else if (window >= 128_000) score = 8;
  else if (window >= 64_000) score = 7;
  else if (window >= 32_000) score = 6;
  else if (window > 0) score = 4.5;
  if (LONG_HINT.test(id)) score += 1.5;
  return clamp(score);
}

function features(model: AyaModel): Features {
  const id = `${model.modelId} ${model.label}`.toLowerCase();
  const flagship = FLAGSHIP.test(id);
  const fast = SPEED.test(id);

  let strength = 4;
  if (flagship) strength += 5;
  if (fast) strength -= 2;
  if (/(405b|235b|120b|72b|70b)/.test(id)) strength += 1;

  let speed = 4;
  if (fast) speed += 4;
  if (flagship && !fast) speed -= 2;
  if (model.latencyMs != null && model.latencyMs > 0) {
    if (model.latencyMs < 800) speed += 1.5;
    else if (model.latencyMs > 4000) speed -= 1.5;
  }

  let vision = model.vision ? 9 : 0;
  if (VISION_HINT.test(id)) vision += 4;

  // Live probe results dominate capability guesses: a model that timed out on
  // the last test should never be auto-assigned over one that answered.
  const availability = (model.status === 'ok' ? 7 : model.status === 'failed' ? -14 : 0) + (model.failover ? 1 : 0);

  return {
    id,
    strength: clamp(strength),
    speed: clamp(speed),
    vision,
    longContext: contextScore(model, id),
    availability,
  };
}

/** Per-role capability weights — the same catalogue now yields four different answers. */
const WEIGHTS: Record<AyaRole, { strength: number; speed: number; vision: number; long: number }> = {
  chat_deep: { strength: 3, speed: 0.6, vision: 0.1, long: 0.1 },
  background_24_7: { strength: 0.5, speed: 3, vision: 0, long: 0.3 },
  vision: { strength: 0.8, speed: 0.2, vision: 3, long: 0.1 },
  memory_summarizer: { strength: 1.2, speed: 1.5, vision: 0, long: 2 },
};

function roleScore(role: AyaRole, features: Features): number {
  const weights = WEIGHTS[role];
  return (
    weights.strength * features.strength +
    weights.speed * features.speed +
    weights.vision * features.vision +
    weights.long * features.longContext +
    features.availability
  );
}

export interface RoutingSuggestion extends AyaRouting {
  reason: Record<AyaRole, string>;
}

const ROLE_ORDER: AyaRole[] = ['chat_deep', 'background_24_7', 'vision', 'memory_summarizer'];

/**
 * Returns the model row id for each of Aya's four specialised slots.
 *
 * Diversity: a model already assigned to another role carries a penalty large
 * enough to spread three models over four slots. Only a role that genuinely
 * needs a capability (a vision model for `vision`) may reuse it cheaply.
 */
export function suggestRouting(models: AyaModel[]): RoutingSuggestion {
  const enabled = models.filter((model) => model.enabled);
  const reasons: Record<AyaRole, string> = {
    chat_deep: 'لا يوجد نموذج',
    background_24_7: 'لا يوجد نموذج',
    vision: 'لا يوجد نموذج صور',
    memory_summarizer: 'لا يوجد نموذج',
  };
  const routing: AyaRouting = {
    chat_deep: null,
    background_24_7: null,
    vision: null,
    memory_summarizer: null,
  };
  if (enabled.length === 0) return { ...routing, reason: reasons };

  const scored = enabled.map((model) => ({ model, features: features(model) }));
  const used = new Map<string, number>();
  const usage = (model: AyaModel) => used.get(model.id) ?? 0;
  const sortKey = (a: { model: AyaModel }, b: { model: AyaModel }) =>
    a.model.priority - b.model.priority || a.model.modelId.localeCompare(b.model.modelId);

  // A model already in another role is discounted, unless it is the only one
  // that truly sees images (the vision slot must not lose that capability).
  const diversityPenalty = (role: AyaRole, entry: { model: AyaModel; features: Features }) => {
    const count = usage(entry.model);
    if (count === 0) return 0;
    if (role === 'vision' && entry.model.vision) return 2 * count;
    return 8 * count;
  };

  const candidateScores = (role: AyaRole) =>
    scored
      .map((entry) => ({ ...entry, total: roleScore(role, entry.features) - diversityPenalty(role, entry) }))
      .sort((a, b) => b.total - a.total || sortKey(a, b));

  const assign = (role: AyaRole, entry: { model: AyaModel; features: Features }) => {
    routing[role] = entry.model.id;
    used.set(entry.model.id, usage(entry.model) + 1);
    reasons[role] = describe(role, entry.model, entry.features);
  };

  for (const role of ROLE_ORDER) {
    const best = candidateScores(role)[0];
    if (best) assign(role, best);
  }

  // `chat_deep` may be empty only when every candidate scored -Infinity (never in practice).
  if (!routing.chat_deep && enabled[0]) assign('chat_deep', { model: enabled[0], features: features(enabled[0]) });
  for (const role of ROLE_ORDER) if (!routing[role] && routing.chat_deep) routing[role] = routing.chat_deep;

  return { ...routing, reason: reasons };
}

function describe(role: AyaRole, model: AyaModel, features: Features): string {
  switch (role) {
    case 'chat_deep':
      return `أقوى نموذج للتفكير (${model.modelId})`;
    case 'background_24_7':
      return `سريع واقتصادي للقراءة الخلفية (${model.modelId})`;
    case 'vision':
      return features.vision > 0 ? `نموذج يقرأ الصور (${model.modelId})` : `أفضل بديل للصور (${model.modelId})`;
    case 'memory_summarizer':
      return `سياق كبير للتلخيص (${model.modelId})`;
  }
}

export function describeRouting(routing: AyaRouting, models: AyaModel[]): Record<AyaRole, string> {
  const byId = new Map(models.map((model) => [model.id, model]));
  const describe = (rowId: string | null) => {
    const model = rowId ? byId.get(rowId) : null;
    return model ? model.modelId : '—';
  };
  return {
    chat_deep: describe(routing.chat_deep),
    background_24_7: describe(routing.background_24_7),
    vision: describe(routing.vision),
    memory_summarizer: describe(routing.memory_summarizer),
  };
}
