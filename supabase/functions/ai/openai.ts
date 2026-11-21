// OpenAI Chat Completions 래퍼 (Structured Outputs + 재시도 + 대체 모델)

export class AppError extends Error {
  status: number;
  publicMessage?: string;
  constructor(message: string, status = 500, publicMessage?: string) {
    super(message);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export const MODELS = {
  get base() { return Deno.env.get('OPENAI_MODEL') ?? 'gpt-5.4-mini'; },
  get heavy() { return Deno.env.get('OPENAI_MODEL_HEAVY') ?? 'gpt-5.4'; },
  get fallback() { return Deno.env.get('OPENAI_MODEL_FALLBACK') ?? 'gpt-4o-mini'; },
  /** A8 구체화 전용 (품질이 부족하면 HEAVY 모델로 올릴 수 있게) */
  get concretize() { return Deno.env.get('OPENAI_MODEL_CONCRETIZE') ?? Deno.env.get('OPENAI_MODEL') ?? 'gpt-5.4-mini'; },
};

/** OPENAI_API_KEY 가 표준 이름. .env 에서 OPEN_API_KEY 로 넣은 경우도 받아 준다. */
export const openaiKey = () => Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('OPEN_API_KEY') ?? '';

const isReasoning = (m: string) => /^(gpt-5|o\d)/.test(m);

export type Effort = 'minimal' | 'low' | 'medium' | 'high';

export interface CallOptions {
  model: string;
  fallbackModel?: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
  effort?: Effort;
  maxTokens?: number;
}

export interface Usage {
  model: string;          // 실제로 요청한 모델명 (ai_requests.model 에 기록)
  prompt_tokens: number;
  completion_tokens: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestOnce(model: string, o: CallOptions) {
  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: o.maxTokens ?? 4000,
    ...(isReasoning(model) ? { reasoning_effort: o.effort ?? 'low' } : { temperature: o.temperature ?? 0.5 }),
    messages: [
      { role: 'system', content: o.system },
      { role: 'user', content: o.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: o.schemaName, strict: true, schema: o.schema },
    },
  };

  return await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
}

export async function callJSON<T>(o: CallOptions): Promise<{ data: T; usage: Usage }> {
  if (!openaiKey()) {
    throw new AppError('OPENAI_API_KEY missing', 500, 'AI 키가 설정되지 않았어요. 관리자에게 문의해 주세요.');
  }

  const models = [o.model];
  if (o.fallbackModel && o.fallbackModel !== o.model) models.push(o.fallbackModel);

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await requestOnce(model, o);
      } catch (e) {
        console.error('openai fetch failed', model, e);
        await sleep(1500);
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        const detail = await res.text();
        console.warn(`openai ${res.status} on ${model}`, detail);
        // 크레딧 소진(insufficient_quota)은 계정 단위라 대체 모델·재시도 모두 소용없다 → 바로 알린다
        if (res.status === 429 && /insufficient_quota|credit_balance_exhausted/.test(detail)) {
          throw new AppError(`OpenAI insufficient_quota: ${detail.slice(0, 300)}`, 503,
            'AI 크레딧이 모두 소진됐어요. 관리자가 OpenAI 결제(크레딧)를 충전해야 해요.');
        }
        // 429(한도 초과)는 같은 모델로 재시도해도 소용없는 경우가 많으니 바로 대체 모델로
        if (res.status === 429) break;
        await sleep(1500);
        continue;
      }
      if (!res.ok) {
        throw new AppError(`OpenAI ${res.status}: ${await res.text()}`, 502, 'AI 요청이 거절됐어요. 잠시 후 다시 시도해 주세요.');
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;
      if (msg?.refusal) throw new AppError('refusal', 422, 'AI가 이 요청을 처리하지 못했어요.');
      if (choice?.finish_reason === 'length' || !msg?.content) {
        throw new AppError('truncated', 502, 'AI 응답이 너무 길어서 잘렸어요. 범위를 줄여서 다시 시도해 주세요.');
      }

      let parsed: T;
      try {
        parsed = JSON.parse(msg.content) as T;
      } catch {
        throw new AppError('invalid json', 502, 'AI 응답 형식이 올바르지 않아요. 다시 시도해 주세요.');
      }
      return {
        data: parsed,
        usage: {
          model,
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
        },
      };
    }
  }
  throw new AppError('openai unavailable', 503, 'AI 서버가 바빠요. 잠시 후 다시 시도해 주세요.');
}
