export function safeTokenFromQuery(value: string | readonly string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.length > 2048) return null;
  if (!/^[A-Za-z0-9_-]+$/u.test(token)) return null;
  return token;
}
