import { useId, useState } from "react";

// Form fields: a visible label above each control, hints above, errors below.

export type Pair = { key: string; value: string };

/** A radio drawn as a card, for a first decision whose options need a line of explanation. */
export function Choice({
  group,
  label,
  hint,
  checked,
  onSelect,
}: {
  group: string;
  label: string;
  hint: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="choice">
      <input checked={checked} name={group} onChange={onSelect} type="radio" />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  type = "text",
  mono,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  required?: boolean;
  type?: "text" | "url";
  mono?: boolean;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {required ? null : <span className="optional">optional</span>}
      </label>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <input
        aria-describedby={[hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        aria-required={required}
        autoComplete={autoComplete}
        className={mono ? "mono" : undefined}
        id={id}
        inputMode={type === "url" ? "url" : undefined}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        type={type}
        value={value}
      />
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SecretField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="optional">optional</span>
      </label>
      <div className="input-with-action">
        <input
          autoComplete="off"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          type={shown ? "text" : "password"}
          value={value}
        />
        <button className="button small quiet" onClick={() => setShown(!shown)} type="button">
          {shown ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export function PairsField({
  label,
  keyLabel,
  addLabel,
  pairs,
  onChange,
}: {
  label: string;
  keyLabel: string;
  addLabel: string;
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
}) {
  const set = (index: number, patch: Partial<Pair>) => onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)));
  return (
    <div className="field">
      <span className="label">
        {label} <span className="optional">optional</span>
      </span>
      {pairs.length > 0 ? (
        <div aria-hidden="true" className="pair pair-head">
          <span>Name</span>
          <span>Value</span>
        </div>
      ) : null}
      {pairs.map((pair, index) => (
        <div className="pair" key={index}>
          <input
            aria-label={`${keyLabel} ${index + 1} name`}
            autoComplete="off"
            autoFocus={!pair.key && !pair.value}
            className="mono"
            onChange={(event) => set(index, { key: event.target.value })}
            spellCheck={false}
            value={pair.key}
          />
          <input
            aria-label={`${keyLabel} ${index + 1} value`}
            autoComplete="off"
            className="mono"
            onChange={(event) => set(index, { value: event.target.value })}
            spellCheck={false}
            value={pair.value}
          />
          <button aria-label={`Remove ${keyLabel.toLowerCase()} ${index + 1}`} className="icon-button" onClick={() => onChange(pairs.filter((_, i) => i !== index))} type="button">
            <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      ))}
      <button className="button small quiet add" onClick={() => onChange([...pairs, { key: "", value: "" }])} type="button">
        {addLabel}
      </button>
    </div>
  );
}

export function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="radios">
      <legend className="label">{label}</legend>
      {options.map((option) => (
        <label className="radio" key={option.value}>
          <input checked={value === option.value} name={name} onChange={() => onChange(option.value)} type="radio" />
          <span>
            {option.label}
            {option.hint ? <small>{option.hint}</small> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
