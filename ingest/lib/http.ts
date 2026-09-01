import { PROVIDERS, type Provider, type ProviderId } from '../../config/providers.ts';

export class BudgetExceededError extends Error {
  constructor(provider: ProviderId, limit: string) {
    super(`Budget exhausted for ${provider} (${limit}). Refusing to send.`);
    this.name = 'BudgetExceededError';
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * Per-provider request accounting and pacing for a single ingestion run.
 *
 * The budget is deliberately enforced in code rather than trusted to the
 * provider's 429s: a free tier that is blown for the day takes the dashboard
 * down until midnight, and finding that out from a 429 is finding out too late.
 */
export class ProviderClient {
  readonly provider: Provider;
  private readonly providerId: ProviderId;
  /** Requests already spent in the current window, carried over from health.json. */
  private readonly carriedOver: number;
  private used = 0;
  private lastRequestAt = 0;

  constructor(providerId: ProviderId, carriedOver = 0) {
    this.providerId = providerId;
    this.carriedOver = carriedOver;
    this.provider = PROVIDERS[providerId];
  }

  get requestsUsed(): number {
    return this.used;
  }

  private get minSpacingMs(): number {
    const perMinute = this.provider.budget.perMinute;
    // Leave 20% headroom under the documented per-minute ceiling.
    return perMinute ? Math.ceil((60_000 / perMinute) * 1.2) : 0;
  }

  private assertBudget(): void {
    const { perDay, perMonth } = this.provider.budget;
    const spent = this.carriedOver + this.used;
    if (perDay !== null && spent >= perDay) {
      throw new BudgetExceededError(this.providerId, `${perDay}/day`);
    }
    if (perMonth !== null && spent >= perMonth) {
      throw new BudgetExceededError(this.providerId, `${perMonth}/month`);
    }
  }

  private async pace(): Promise<void> {
    const wait = this.minSpacingMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
  }

  /**
   * GET JSON with exponential backoff.
   *
   * Retries only what is worth retrying: network faults, 429, and 5xx. A 4xx
   * other than 429 means we asked the wrong question, and asking it four more
   * times just spends budget.
   */
  async getJson<T>(url: string, { attempts = 4 }: { attempts?: number } = {}): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      this.assertBudget();
      await this.pace();

      try {
        this.used++;
        this.lastRequestAt = Date.now();
        const res = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': USER_AGENT },
          signal: AbortSignal.timeout(20_000),
        });

        if (res.ok) return (await res.json()) as T;

        const body = await res.text().catch(() => '');
        const err = new HttpError(res.status, url, body);
        if (res.status !== 429 && res.status < 500) throw err;

        lastError = err;
        // Honour Retry-After when the provider bothers to send one.
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffMs(attempt));
      } catch (err) {
        if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
        if (err instanceof BudgetExceededError) throw err;
        lastError = err;
        if (attempt < attempts - 1) await sleep(backoffMs(attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

const USER_AGENT = 'Value/0.1 (+https://github.com/CandanUmut/OpenValue)';

/** 1s, 2s, 4s, 8s with jitter, so parallel runners do not resynchronise. */
function backoffMs(attempt: number): number {
  return 2 ** attempt * 1000 + Math.floor(Math.random() * 250);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
