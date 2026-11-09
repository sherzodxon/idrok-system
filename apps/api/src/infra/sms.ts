// SMS fallback channel (M7, Q-57). No provider is connected yet: the interface and the school setting exist, and a
// notification that would need SMS is skipped with the reason NO_SMS_PROVIDER. An adapter (Eskiz, Play Mobile, …)
// implements this interface once the owner chooses a provider.

export interface SmsProvider {
  readonly configured: boolean;
  /** `phone` is E.164. Never log it or the text. */
  send(phone: string, text: string): Promise<void>;
}

export const noSmsProvider: SmsProvider = {
  configured: false,
  send() {
    return Promise.reject(new Error("no SMS provider configured"));
  },
};
