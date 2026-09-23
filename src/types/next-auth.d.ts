import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    sessionVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    /** User.sessionVersion when the token was issued; a mismatch revokes it. */
    sv: number;
    /** When the token was last checked against the database (ms). */
    checkedAt: number;
  }
}
