import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      isAdmin?: boolean;
      nickname?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: number;
    nickname?: string | null;
    isAdmin?: boolean;
  }
}

// NextAuth v5 re-exports JWT from @auth/core/jwt; augment that too so the
// `token` parameter in callbacks is typed correctly.
declare module "@auth/core/jwt" {
  interface JWT {
    userId?: number;
    nickname?: string | null;
    isAdmin?: boolean;
  }
}
