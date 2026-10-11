import 'server-only';
import { auth } from '@/auth';

type SessionLike = { user?: { email?: string | null } | null } | null;

export function isQuizOwner(session: SessionLike): boolean {
  const adminFirst = process.env.ADMIN_EMAILS?.split(',')[0]?.trim();
  const owner = (process.env.QUIZ_OWNER_EMAIL || adminFirst || 'galaxytemple@gmail.com').trim();
  return !!owner && session?.user?.email?.toLowerCase() === owner.toLowerCase();
}

export async function assertQuizOwner(): Promise<void> {
  const session = await auth();
  if (!isQuizOwner(session)) throw new Error('Forbidden');
}
