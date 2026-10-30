/**
 * Provider-agnostic transactional mail (B-10). The rest of the API depends only on the Mailer
 * interface. BrevoMailer is the one provider today; it talks to Brevo's HTTP API with fetch.
 *
 * Privacy: a send never logs the body, the recipient, the key or the provider response. Errors
 * carry a short reason code only, so a token inside an email cannot reach a log line.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailOutcome =
  | { status: 'sent'; providerMessageId: string }
  // Transient: a network error, timeout, 429 or 5xx. The outbox retries with backoff.
  | { status: 'retry'; reason: string }
  // Permanent: a 4xx other than 429. Retrying the same message would only repeat the refusal.
  | { status: 'permanent'; reason: string };

export interface Mailer {
  /** The configured origin that accept links are built from. Never taken from a request. */
  readonly appOrigin: string;
  send(message: MailMessage): Promise<MailOutcome>;
}

/** Non-secret sender identity and the origin used to build links. */
export interface MailSettings {
  fromEmail: string;
  fromName: string;
  appOrigin: string;
}

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 10_000;

export class BrevoMailer implements Mailer {
  private readonly apiKey: string;
  private readonly settings: MailSettings;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, settings: MailSettings, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.apiKey = apiKey;
    this.settings = settings;
    this.fetchImpl = fetchImpl;
  }

  get appOrigin(): string {
    return this.settings.appOrigin;
  }

  async send(message: MailMessage): Promise<MailOutcome> {
    let response: Response;
    try {
      response = await this.fetchImpl(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.settings.fromEmail, name: this.settings.fromName },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      return { status: 'retry', reason: 'network' };
    }

    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return { status: 'retry', reason: `brevo_http_${response.status}` };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: 'permanent', reason: `brevo_http_${response.status}` };
    }

    const json = (await response.json().catch(() => ({}))) as { messageId?: unknown };
    return {
      status: 'sent',
      providerMessageId: typeof json.messageId === 'string' ? json.messageId.slice(0, 200) : 'unknown',
    };
  }
}

/** Environment bindings the mailer reads. BREVO_API_KEY is a secret; the rest are plain vars. */
export interface MailEnv {
  BREVO_API_KEY?: string;
  MAIL_FROM_EMAIL?: string;
  MAIL_FROM_NAME?: string;
  APP_ORIGIN?: string;
}

/** Validates APP_ORIGIN: https, or plain http for a local development host only. No path or query. */
export function validAppOrigin(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

const EMAIL_ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * The Brevo mailer, or null when mail is disabled. Disabled means: no key, no valid sender, or no
 * valid APP_ORIGIN. A disabled mailer leaves outbox rows pending; nothing else changes.
 */
export function mailerFromEnv(env: MailEnv | undefined, fetchImpl?: typeof fetch): BrevoMailer | null {
  const apiKey = env?.BREVO_API_KEY?.trim();
  const fromEmail = env?.MAIL_FROM_EMAIL?.trim();
  const appOrigin = validAppOrigin(env?.APP_ORIGIN?.trim());
  if (!apiKey || !fromEmail || !EMAIL_ADDRESS.test(fromEmail) || !appOrigin) return null;
  const fromName = (env?.MAIL_FROM_NAME?.trim() || 'Flowboard').replace(/[\p{Cc}]/gu, '').slice(0, 80);
  return new BrevoMailer(apiKey, { fromEmail, fromName, appOrigin }, fetchImpl);
}
