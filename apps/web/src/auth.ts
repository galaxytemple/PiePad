import { upsertOAuthUser } from "@piepad/db";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAdminEmail } from "@/lib/admin";

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false;
      // Reject Google accounts that haven't verified ownership of the email —
      // ADMIN_EMAILS is matched against this address, so an unverified match
      // would be an account-takeover vector.
      if (account?.provider === "google" && profile?.email_verified !== true) {
        return false;
      }
      try {
        const dbUser = await upsertOAuthUser({
          email: user.email,
          name: user.name ?? profile?.name ?? null,
          avatarUrl: user.image ?? null,
          provider: account?.provider ?? "google",
          providerSubject: account?.providerAccountId ?? user.email,
        });
        // Auth.js v5 only exposes the `user` object inside the signIn
        // callback — there's no documented return-value handoff to `jwt`.
        // Stashing fields on `user` is the standard upstream-recommended
        // pattern; the project's "no mutation" rule is intentionally
        // bypassed here, scoped to this single call site.
        (user as { dbUserId?: number }).dbUserId = dbUser.id;
        (user as { dbNickname?: string | null }).dbNickname = dbUser.nickname;
      } catch (err) {
        console.error("[auth] upsertOAuthUser failed", err);
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      const t = token as {
        userId?: number;
        nickname?: string | null;
        isAdmin?: boolean;
        email?: string | null;
      };
      if (user) {
        const u = user as {
          dbUserId?: number;
          dbNickname?: string | null;
        };
        if (typeof u.dbUserId === "number") t.userId = u.dbUserId;
        if (u.dbNickname !== undefined) t.nickname = u.dbNickname;
      }
      if (typeof t.email === "string") {
        t.isAdmin = isAdminEmail(t.email);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const t = token as {
          userId?: number;
          nickname?: string | null;
          isAdmin?: boolean;
        };
        if (typeof t.userId === "number") {
          session.user.id = String(t.userId);
        }
        session.user.nickname = t.nickname ?? null;
        session.user.isAdmin = !!t.isAdmin;
      }
      return session;
    },
  },
});
