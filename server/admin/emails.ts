export function parseAdminEmails(raw: string | undefined): readonly string[] {
  if (!raw) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function adminEmailsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  return parseAdminEmails(env.NOWISEE_ADMIN_EMAILS);
}
