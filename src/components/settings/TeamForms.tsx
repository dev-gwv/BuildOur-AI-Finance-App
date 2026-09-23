"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MoreHorizontal, Power, ShieldCheck, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { hintClass, inputClass, labelClass, request } from "./request";

/** Mirrors the server's rule (src/server/validation.ts `password`) so it's caught before sending. */
export function passwordProblem(p: string): string | null {
  if (p.length < 10) return "Use at least 10 characters";
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return "Use both letters and numbers";
  return null;
}

type BusinessOption = { id: string; name: string; color: string };

export function CreateUserForm({ businesses }: { businesses: BusinessOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"MEMBER" | "ADMIN">("MEMBER");
  const [access, setAccess] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>();
  const [pending, setPending] = useState(false);
  const pwProblem = password ? passwordProblem(password) : null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setFields(undefined);
    const created = await request<{ user: { id: string } }>("/api/users", "POST", {
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      password,
      role,
    });
    if (!created.ok) {
      setPending(false);
      setFields(created.fields);
      return toast.error(created.error);
    }
    if (role === "MEMBER" && access.size > 0 && created.data.user?.id) {
      const granted = await request(`/api/users/${created.data.user.id}/businesses`, "PUT", { businessIds: [...access] });
      if (!granted.ok) toast.error(`User created, but access wasn't saved: ${granted.error}`);
    }
    setPending(false);
    toast.success("User created");
    setOpen(false);
    setPassword("");
    setAccess(new Set());
    router.refresh();
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Add person
      </Button>
    );
  }

  const err = (name: string) => fields?.[name] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fields[name]}</p>;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh] backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg animate-fade-up rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-pop dark:border-white/10 dark:bg-neutral-900"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">Add a person</h2>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-neutral-400 hover:text-neutral-900 dark:hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-4">
          <label className={labelClass}>
            Full name
            <input name="name" required maxLength={80} className={inputClass} autoFocus />
            {err("name")}
          </label>
          <label className={labelClass}>
            Email
            <input name="email" type="email" required className={inputClass} />
            {err("email")}
          </label>
          <label className={labelClass}>
            Temporary password
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="off"
              className={`${inputClass} font-mono`}
            />
            <p className={pwProblem ? "mt-1 text-xs text-amber-700 dark:text-amber-400" : hintClass}>
              {pwProblem ?? "At least 10 characters with letters and numbers. Share it privately; they can change it under Account."}
            </p>
            {err("password")}
          </label>
          <div>
            <p className={labelClass}>Role</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(
                [
                  ["MEMBER", "Member", "Works in the businesses they're given"],
                  ["ADMIN", "Admin", "Sees every business and manages settings"],
                ] as const
              ).map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRole(key)}
                  className={`rounded-xl border p-3 text-left ${
                    role === key
                      ? "border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-500/10"
                      : "border-neutral-200 dark:border-white/10"
                  }`}
                >
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">{label}</p>
                  <p className="text-xs text-neutral-500">{hint}</p>
                </button>
              ))}
            </div>
          </div>
          {role === "MEMBER" && businesses.length > 0 && (
            <div>
              <p className={labelClass}>Businesses they can work in</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {businesses.map((b) => {
                  const on = access.has(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() =>
                        setAccess((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(b.id);
                          else next.add(b.id);
                          return next;
                        })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
                        on
                          ? "border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-400/50 dark:bg-brand-500/15 dark:text-brand-200"
                          : "border-neutral-200 text-neutral-600 dark:border-white/10 dark:text-neutral-300"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={Boolean(pwProblem) || !password}>
            Create user
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Per-user actions: role, deactivate/reactivate, set a new password. */
export function UserActions({
  user,
  isSelf,
}: {
  user: { id: string; name: string; role: string; active: boolean };
  isSelf: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const pwProblem = password ? passwordProblem(password) : null;

  async function patch(body: Record<string, unknown>, success: string) {
    setPending(true);
    const result = await request(`/api/users/${user.id}`, "PATCH", body);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(success);
    setOpen(false);
    router.refresh();
    return true;
  }

  async function toggleRole() {
    const toAdmin = user.role !== "ADMIN";
    const ok = await confirm({
      title: toAdmin ? `Make ${user.name} an admin?` : `Make ${user.name} a member?`,
      description: toAdmin
        ? "Admins see every business and can manage businesses, the team and integrations. They'll be signed out and back in with the new access within a minute."
        : "They'll only see the businesses they're assigned to, and will be signed out within a minute.",
      confirmLabel: toAdmin ? "Make admin" : "Make member",
    });
    if (ok) await patch({ role: toAdmin ? "ADMIN" : "MEMBER" }, "Role changed");
  }

  async function toggleActive() {
    if (user.active) {
      const ok = await confirm({
        title: `Deactivate ${user.name}?`,
        description:
          "They can't sign in, and any open session ends within a minute. Everything they recorded stays. You can reactivate them later.",
        confirmLabel: "Deactivate",
        danger: true,
      });
      if (!ok) return;
    }
    await patch({ active: !user.active }, user.active ? "Deactivated" : "Reactivated");
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pwProblem) return;
    if (await patch({ password }, `New password set for ${user.name}`)) {
      setSettingPassword(false);
      setPassword("");
    }
  }

  if (isSelf) {
    return <span className="text-xs text-neutral-400">You</span>;
  }

  return (
    <div className="relative flex items-center justify-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-white"
        aria-label={`Actions for ${user.name}`}
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 animate-fade-up rounded-xl border border-neutral-200/80 bg-white p-1 shadow-pop dark:border-white/10 dark:bg-neutral-900">
          <MenuItem icon={ShieldCheck} onClick={toggleRole} disabled={pending}>
            {user.role === "ADMIN" ? "Make member" : "Make admin"}
          </MenuItem>
          <MenuItem
            icon={KeyRound}
            onClick={() => {
              setOpen(false);
              setSettingPassword(true);
            }}
          >
            Set a new password
          </MenuItem>
          <MenuItem icon={Power} onClick={toggleActive} disabled={pending} danger={user.active}>
            {user.active ? "Deactivate" : "Reactivate"}
          </MenuItem>
        </div>
      )}
      {settingPassword && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh] backdrop-blur-sm">
          <form
            onSubmit={savePassword}
            className="w-full max-w-sm animate-fade-up rounded-2xl border border-neutral-200/80 bg-white p-6 text-left shadow-pop dark:border-white/10 dark:bg-neutral-900"
          >
            <h2 className="text-base font-semibold text-neutral-950 dark:text-white">New password for {user.name}</h2>
            <p className="mt-1 text-sm text-neutral-500">They&apos;ll be signed out everywhere within a minute and sign in with this.</p>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="off"
              className={`${inputClass} mt-4 font-mono`}
            />
            <p className={pwProblem ? "mt-1 text-xs text-amber-700 dark:text-amber-400" : hintClass}>
              {pwProblem ?? "At least 10 characters with letters and numbers."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSettingPassword(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={!password || Boolean(pwProblem)}>
                Set password
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  disabled,
  danger,
  children,
}: {
  icon: typeof KeyRound;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/[0.06]"
      }`}
    >
      <Icon className="h-4 w-4 opacity-70" />
      {children}
    </button>
  );
}

/** Which businesses a member can work in, as toggle chips that save immediately. */
export function UserBusinessAccess({
  userId,
  businesses,
  assigned,
}: {
  userId: string;
  businesses: BusinessOption[];
  assigned: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState(() => new Set(assigned));
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPendingId(id);
    const result = await request(`/api/users/${userId}/businesses`, "PUT", { businessIds: [...next] });
    setPendingId(null);
    if (!result.ok) return toast.error(result.error);
    setSelected(next);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {businesses.map((b) => {
        const on = selected.has(b.id);
        return (
          <button
            key={b.id}
            type="button"
            disabled={pendingId === b.id}
            onClick={() => toggle(b.id)}
            title={on ? `Remove access to ${b.name}` : `Give access to ${b.name}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              on
                ? "border-transparent bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "border-dashed border-neutral-300 text-neutral-400 hover:text-neutral-700 dark:border-white/15 dark:hover:text-neutral-200"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
            {b.name}
          </button>
        );
      })}
      {businesses.length === 0 && <span className="text-xs text-neutral-400">No businesses yet</span>}
    </div>
  );
}
