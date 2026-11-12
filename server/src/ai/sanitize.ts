const MAX_LENGTH = 450; // Twitch caps chat messages at 500 chars; keep margin

/**
 * Normalize an LLM-generated reply into a single plausible chat line:
 * collapse newlines, strip wrapping quotes and role prefixes, cap length.
 */
export function sanitizeChatMessage(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();

  // Strip wrapping quotes the model sometimes adds
  const quotePairs: Array<[string, string]> = [['"', '"'], ["'", "'"], ['“', '”']];
  for (const [open, close] of quotePairs) {
    if (text.startsWith(open) && text.endsWith(close) && text.length > 1) {
      text = text.slice(open.length, -close.length).trim();
    }
  }

  // Strip a leading "SomeName:" role prefix
  text = text.replace(/^[A-Za-z0-9_]{2,25}:\s+/, '');

  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH).replace(/\s+\S*$/, '');
  }
  return text;
}
