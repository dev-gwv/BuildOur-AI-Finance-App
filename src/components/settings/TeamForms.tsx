"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MoreHorizontal, Power, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Field, Input, useFieldErrors } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { request } from "./request";

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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MEMBER" | "ADMIN">("MEMBER");
  const [access, setAccess] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const { errors, apply, clear } = useFieldErrors<"name" | "email" | "password">();
  const pwProblem = password ? passwordProblem(password) : null;

  function close() {
    setOpen(false);
    clear();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const local: Partial<Record<"name" | "email" | "password", string>> = {};
    if (!name.trim()) local.name = "Enter their name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) local.email = "Enter a valid email";
    const problem = passwordProblem(password);
    if (problem) local.password = problem;
    if (Object.keys(local).length) return apply(local);

    setPending(true);
    const created = await request<{ user: { id: string } }>("/api/users", "POST", {
      name: name.trim(),
      email: email.trim(),
      password,
      role,
    });
    if (!created.ok) {
      setPending(false);
      apply(created.fields as Partial<Record<"name" | "email" | "password", string>>);
      return toast.error(created.error);
    }
    if (role === "MEMBER" && access.size > 0 && created.data.user?.id) {
      const granted = await request(`/api/users/${created.data.user.id}/businesses`, "PUT", { businessIds: [...access] });
      if (!granted.ok) toast.error(`User created, but access wasn't saved: ${granted.error}`);
    }
    setPending(false);
    toast.success(`${name.trim()} can now sign in`);
    setOpen(false);
    setName("");
    setEmail("");
    setPassword("");
    setAccess(new Set());
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Add person
      </Button>
      <Modal
        open={open}
        onClose={close}
        dismissible={!pending}
        title="Add a person"
        description="They sign in with their email and this temporary password."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="create-user" loading={pending}>
              Create user
            </Button>
          </>
        }
      >
        <form id="create-user" onSubmit={onSubmit} noValidate className="grid gap-4">
          <Field label="Full name" error={errors.name}>
            <Input value={name} onChange={(e) => { setName(e.target.value); clear("name"); }} maxLength={80} autoComplete="off" />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); clear("email"); }} autoComplete="off" />
          </Field>
          <Field
            label="Temporary password"
            error={errors.password}
            hint={pwProblem ?? "At least 10 characters with letters and numbers. Share it privately; they can change it under Account."}
          >
            <Input
              type="text"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clear("password");
              }}
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">Role</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  aria-pressed={role === key}
                  className={`rounded-xl border p-3 text-left ${
                    role === key
                      ? "border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-500/10"
                      : "border-neutral-200 dark:border-white/10"
                  }`}
                >
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">{label}</p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">{hint}</p>
                </button>
              ))}
            </div>
          </fieldset>
          {role === "MEMBER" && businesses.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-200">Businesses they can work in</legend>
              <div className="flex flex-wrap gap-2">
                {businesses.map((b) => {
                  const on = access.has(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setAccess((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(b.id);
                          else next.add(b.id);
                          return next;
                        })
                      }
                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ${
                        on
                          ? "border-brand-400 bg-brand-50 text-brand-800 dark:border-brand-400/50 dark:bg-brand-500/15 dark:text-brand-200"
                          : "border-neutral-300 text-neutral-700 dark:border-white/15 dark:text-neutral-300"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </form>
      </Modal>
    </>
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
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
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
    return <span className="text-xs text-neutral-500 dark:text-neutral-400">You</span>;
  }

  return (
    <div ref={menuRef} className="relative flex items-center justify-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 sm:h-8 sm:w-8 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
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
      <Modal
        open={settingPassword}
        onClose={() => setSettingPassword(false)}
        dismissible={!pending}
        size="sm"
        title={`New password for ${user.name}`}
        description="They'll be signed out everywhere within a minute and sign in with this."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setSettingPassword(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={`pw-${user.id}`} loading={pending} disabled={!password || Boolean(pwProblem)}>
              Set password
            </Button>
          </>
        }
      >
        <form id={`pw-${user.id}`} onSubmit={savePassword} noValidate>
          <Field label="New password" error={pwProblem} hint="At least 10 characters with letters and numbers.">
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className="font-mono" />
          </Field>
        </form>
      </Modal>
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
      className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${
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
