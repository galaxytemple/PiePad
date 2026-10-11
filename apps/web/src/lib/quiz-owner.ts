import 'server-only';
import { auth } from '@/auth';

type SessionLike = { user?: { email?: string | null } | null } | null;

export function isQuizOwner(session: SessionLike): boolean {
  const owner = process.env.QUIZ_OWNER_EMAIL?.trim();
  return !!owner && session?.user?.email === owner;
}

export async function assertQuizOwner(): Promise<void> {
  const session = await auth();
  if (!isQuizOwner(session)) throw new Error('Forbidden');
}
