import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { LIMITS, clientIp, hit, isLimited, reset } from "@/server/rateLimit";

/** Signalled to the login form so it can say "wait" rather than "wrong password". */
export class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}

/** What this app keeps in the session token, on top of next-auth's own fields. */
type AppToken = { id: string; role: string; name?: string | null; sv: number; checkedAt: number };

/** How often a session is re-checked against the database. */
const RECHECK_MS = 60_000;

// A fixed hash to compare against when the email doesn't exist, so a wrong
// email takes as long as a wrong password and can't be told apart by timing.
const DUMMY_HASH = "$2b$10$LwXpHL0a2ZchfjFjsCtgFOykxPYMBZPuWOfShGakZeGSvawB7Fp9i";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    // A working week; each visit within a day extends it. Revocation doesn't
    // wait for expiry — see the jwt callback.
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password || password.length > 200) return null;

        // Two limits: per account (guessing one user's password) and per
        // address (spraying many accounts). Checked before bcrypt, so a flood
        // costs us a row update rather than CPU. The address limit only counts
        // failures, so a whole office signing in from one IP is never blocked.
        const ip = clientIp(request.headers);
        const ipKey = `login-ip:${ip}`;
        const [perEmail, ipBlocked] = await Promise.all([
          hit(`login:${email}`, LIMITS.loginPerEmail.limit, LIMITS.loginPerEmail.window),
          isLimited(ipKey, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window),
        ]);
        if (!perEmail.ok || ipBlocked) throw new TooManyAttempts();

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid || !user.active) {
          await hit(ipKey, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window);
          return null;
        }

        await Promise.all([
          reset(`login:${email}`),
          prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        ]);
        return { id: user.id, name: user.name, email: user.email, role: user.role, sessionVersion: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token: rawToken, user }) {
      const token = rawToken as typeof rawToken & AppToken;
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.sv = user.sessionVersion;
        token.checkedAt = Date.now();
        return token;
      }
      // A signed token alone would stay valid for a week after the user is
      // removed, deactivated or demoted. Re-check it every minute, and end the
      // session if anything about the account has changed underneath it.
      if (!token.checkedAt || Date.now() - token.checkedAt > RECHECK_MS) {
        const current = await prisma.user
          .findUnique({ where: { id: token.id }, select: { active: true, role: true, name: true, sessionVersion: true } })
          .catch(() => undefined);
        // undefined = database unreachable: keep the session rather than log everyone out.
        if (current === null || (current && (!current.active || current.sessionVersion !== (token.sv ?? 0)))) {
          return null;
        }
        if (current) {
          token.role = current.role;
          token.name = current.name;
          token.checkedAt = Date.now();
        }
      }
      return token;
    },
    session({ session, token }) {
      const t = token as typeof token & AppToken;
      if (session.user) {
        session.user.id = t.id;
        session.user.role = t.role;
      }
      return session;
    },
  },
});
