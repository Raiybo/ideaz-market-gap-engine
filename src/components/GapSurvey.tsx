"use client";

/**
 * The survey that turns a country-level gap into a position you can take.
 *
 * The engine's route is chosen from the market's constraints: this country's
 * grid, credit and informality. That answer is correct and impersonal — "make
 * it here" is right for the market and useless to someone with eighty thousand
 * dollars and no factory. These five questions supply the missing half, and
 * the result says which answer moved the recommendation, so it can be argued
 * with rather than just accepted.
 *
 * Each question carries a line on why it is asked. That is not decoration:
 * the point of filling this in is to find out what you are actually looking
 * for, and a question you understand the purpose of gets a truer answer.
 */

import { useMemo, useState } from "react";

import type { MarketConditions } from "@/lib/domain/countries";
import type { Segment } from "@/lib/domain/sectors";
import { fitOperator, type OperatorProfile } from "@/lib/engine/operator";
import type { Playbook } from "@/lib/engine/playbook";
import { formatUsd } from "@/lib/engine/score";
import {
  clearProfile,
  isComplete,
  setAnswer,
  useOperatorProfile,
} from "@/lib/operator-profile";

interface Choice<K extends keyof OperatorProfile> {
  value: OperatorProfile[K];
  label: string;
  hint: string;
}

interface Question<K extends keyof OperatorProfile> {
  key: K;
  prompt: string;
  /** Why this question earns its place in a five-question survey. */
  why: string;
  choices: Array<Choice<K>>;
}

/**
 * Spelled out as a union rather than `Question<keyof OperatorProfile>` so each
 * entry's choices are checked against that key's own value type — a "6mo"
 * offered under `capital` is a compile error, not a runtime surprise.
 */
type AnyQuestion =
  | Question<"capital">
  | Question<"build">
  | Question<"horizon">
  | Question<"team">
  | Question<"regulatory">;

const QUESTIONS: AnyQuestion[] = [
  {
    key: "capital",
    prompt: "How much can you put in before any revenue arrives?",
    why: "Capital decides which position you can take against the same gap — owning production, finishing locally, or owning the channel. It is the constraint that rules out the most routes.",
    choices: [
      { value: "under-50k", label: "Under $50K", hint: "Bootstrapped or personal savings" },
      { value: "50k-250k", label: "$50K – $250K", hint: "Angel, family, or a first raise" },
      { value: "250k-1m", label: "$250K – $1M", hint: "Seed round or serious backing" },
      { value: "over-1m", label: "$1M+", hint: "Institutional or industrial capital" },
    ],
  },
  {
    key: "build",
    prompt: "What can you actually build or operate?",
    why: "The gap does not change; what you can do about it does. Someone who can only distribute and someone who can manufacture are looking at the same import bill and two different businesses.",
    choices: [
      { value: "distribute", label: "Sell and distribute", hint: "Import, stock, move, sell — no production" },
      { value: "assemble", label: "Assemble and finish", hint: "Light manufacturing from imported inputs" },
      { value: "manufacture", label: "Manufacture end to end", hint: "Own the production process outright" },
      { value: "software", label: "Software and services", hint: "Build systems, not physical goods" },
    ],
  },
  {
    key: "horizon",
    prompt: "When do you need first revenue?",
    why: "Every route here reaches cash at a different speed, and the fastest is rarely the most profitable. This is usually what decides between owning production and owning the channel.",
    choices: [
      { value: "6mo", label: "Within 6 months", hint: "Needs to pay for itself quickly" },
      { value: "2yr", label: "Within 2 years", hint: "Room to build something real" },
      { value: "3yr-plus", label: "3 years or more", hint: "Patient capital, industrial timeline" },
    ],
  },
  {
    key: "team",
    prompt: "Who is working on this?",
    why: "Labour-heavy segments fail on hiring rather than on funding, and infrastructure-heavy ones fail on neither. Knowing the shape of the team changes which failure is likely.",
    choices: [
      { value: "solo", label: "Just me", hint: "No team yet" },
      { value: "commercial", label: "Commercial team", hint: "Sales, sourcing, operations" },
      { value: "engineering", label: "Engineering team", hint: "Software or technical build capacity" },
      { value: "hardware-ops", label: "Hardware and operations", hint: "Can run a plant or a fleet" },
    ],
  },
  {
    key: "regulatory",
    prompt: "How much regulation are you willing to take on?",
    why: "Some of the largest measured gaps sit behind national licensing — defence, pharmaceuticals, aviation. A gap can be entirely real and still be closed to you, and it is better to know that before the work starts.",
    choices: [
      { value: "avoid", label: "Avoid licensed sectors", hint: "Nothing that needs a national regulator" },
      { value: "permits", label: "Permits and inspections are fine", hint: "Ordinary business licensing" },
      { value: "controlled", label: "Including controlled goods", hint: "Defence, export control, end-use certificates" },
    ],
  },
];

const VERDICT_STYLE: Record<
  "fits" | "stretch" | "blocked",
  { label: string; color: string; bg: string }
> = {
  fits: { label: "Fits what you have", color: "var(--positive)", bg: "rgba(34,197,94,0.10)" },
  stretch: { label: "Reachable, with strain", color: "var(--warning)", bg: "rgba(234,179,8,0.10)" },
  blocked: { label: "Not reachable as you are", color: "var(--danger)", bg: "rgba(239,68,68,0.10)" },
};

export interface GapSurveyProps {
  playbook: Playbook;
  segment: Segment;
  conditions: MarketConditions;
  physical: boolean;
  segmentName: string;
}

export function GapSurvey({
  playbook,
  segment,
  conditions,
  physical,
  segmentName,
}: GapSurveyProps) {
  const profile = useOperatorProfile();
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);

  const complete = isComplete(profile);
  const showResult = complete && !editing;

  const fit = useMemo(() => {
    if (!isComplete(profile)) return null;
    return fitOperator({ playbook, segment, conditions, profile, physical });
  }, [playbook, segment, conditions, profile, physical]);

  if (showResult && fit) {
    const style = VERDICT_STYLE[fit.verdict];
    return (
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ color: style.color, background: style.bg }}
          >
            {style.label}
          </span>
          <button
            onClick={() => {
              setEditing(true);
              setStep(0);
            }}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Change my answers
          </button>
        </div>

        <p className="mt-3 text-sm font-semibold">
          {/* A blocked verdict still names the position, but must not read as
              a recommendation to go and take it. */}
          {fit.verdict === "blocked"
            ? `Closest position, if that clears: ${fit.routeName}`
            : `Your route into ${segmentName}: ${fit.routeName}`}
        </p>
        {fit.routeChanged && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            The market alone pointed to{" "}
            <span className="line-through">{fit.defaultRouteName}</span> — your
            answers moved it.
          </p>
        )}

        <p className="mt-2 font-mono text-xs text-[var(--muted)]">
          {fit.capital.label} to start
          {fit.monthsOverHorizon === null
            ? ""
            : ` · ${fit.monthsOverHorizon} months past your deadline`}
        </p>

        {fit.blockers.length > 0 && (
          <div className="mt-3 space-y-2">
            {fit.blockers.map((b, i) => (
              <p
                key={i}
                className="rounded border-l-2 border-[var(--danger)] bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed"
              >
                {b}
              </p>
            ))}
            {fit.capitalShortfallUsd !== null && (
              <p className="font-mono text-xs text-[var(--muted)]">
                Raise {formatUsd(fit.capitalShortfallUsd)} more, or take a
                position that owns less of the production.
              </p>
            )}
          </div>
        )}

        {fit.reasons.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Why this route
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {fit.reasons.map((r, i) => (
                <li key={i} className="text-xs leading-relaxed text-[var(--muted)]">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {fit.strains.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              What will strain
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {fit.strains.map((r, i) => (
                <li key={i} className="text-xs leading-relaxed text-[var(--muted)]">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const q = QUESTIONS[Math.min(step, QUESTIONS.length - 1)];
  const answered = profile[q.key] !== undefined;

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <div className="flex items-center gap-2">
        {QUESTIONS.map((item, i) => (
          <span
            key={item.key}
            className="h-1 flex-1 rounded-full"
            style={{
              background:
                i < step
                  ? "var(--positive)"
                  : i === step
                    ? "var(--accent)"
                    : "var(--border)",
            }}
          />
        ))}
        <span className="ml-1 shrink-0 font-mono text-[11px] text-[var(--muted)]">
          {step + 1}/{QUESTIONS.length}
        </span>
      </div>

      <p className="mt-3 text-sm font-semibold">{q.prompt}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{q.why}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.choices.map((choice) => {
          const selected = profile[q.key] === choice.value;
          return (
            <button
              key={String(choice.value)}
              onClick={() => {
                // The pair is correct by construction — the union above ties
                // each key to its own choices — but TypeScript cannot see the
                // correlation once both sides are widened to the union.
                setAnswer(q.key, choice.value as never);
                if (step < QUESTIONS.length - 1) setStep(step + 1);
                else setEditing(false);
              }}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? "border-[var(--accent)] bg-[var(--surface)]"
                  : "border-[var(--border)] hover:border-[var(--accent)]"
              }`}
            >
              <span className="block text-xs font-medium">{choice.label}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                {choice.hint}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4">
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            ← Back
          </button>
        )}
        {answered && step < QUESTIONS.length - 1 && (
          <button
            onClick={() => setStep(step + 1)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Skip ahead →
          </button>
        )}
        {complete && (
          <button
            onClick={() => setEditing(false)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Show my result →
          </button>
        )}
        <button
          onClick={() => {
            clearProfile();
            setStep(0);
          }}
          className="ml-auto text-xs text-[var(--muted)] hover:underline"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
