import { passwordRules } from "@/lib/password";
import { CheckIcon } from "./icons";

/** Live checklist. Status is text ("done" / "not yet"), never colour alone. */
export function PasswordChecklist({ id, value }: { id: string; value: string }) {
  return (
    <ul id={id} aria-live="polite" className="m-0 flex list-none flex-col gap-1.5 p-0">
      {passwordRules(value).map((r) => (
        <li
          key={r.label}
          className={`flex items-center gap-2 text-sm transition-colors duration-150 ${
            r.ok ? "text-primary-ink" : "text-muted"
          }`}
        >
          <span
            className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-white ${
              r.ok ? "bg-primary" : "bg-line"
            }`}
          >
            {r.ok && <CheckIcon size={12} />}
          </span>
          {r.label}
          <span className="sr-only">{r.ok ? ", done" : ", not yet"}</span>
        </li>
      ))}
    </ul>
  );
}
