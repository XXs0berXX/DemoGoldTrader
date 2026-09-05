import { config } from '../config';
import { D, Decimal, fmtPkr, parseDecimal } from '../money';
import { getRedis, keys } from '../redis/client';

/**
 * Reviewer stress controls (product_spec.md §7, API_CONTRACT.md §4).
 *
 * State lives in Redis, not in a module variable, so it survives across
 * requests and would still work if the API ran more than one process.
 * It is deliberately ephemeral: a Redis wipe returns the demo to normal.
 */

export type SourceFailureMode = 'none' | 'primary' | 'both';
export const SOURCE_FAILURE_MODES: readonly SourceFailureMode[] = ['none', 'primary', 'both'];

export type ScenarioName = 'normal' | 'low_cash' | 'low_gold' | 'low_inventory';
export const SCENARIO_NAMES: readonly ScenarioName[] = ['normal', 'low_cash', 'low_gold', 'low_inventory'];

export interface ScenarioPreset {
  pkrWallet: string;
  customerGoldG: string;
  platformGoldG: string;
  /** Shown in the UI so the reviewer knows what the preset is meant to prove. */
  intent: string;
}

export const SCENARIOS: Record<ScenarioName, ScenarioPreset> = {
  normal: {
    pkrWallet: '250000.00',
    customerGoldG: '6.8420',
    platformGoldG: '100.0000',
    intent: 'Healthy starting state — every normal trade succeeds.',
  },
  low_cash: {
    pkrWallet: '1500.00',
    customerGoldG: '6.8420',
    platformGoldG: '100.0000',
    intent: 'Wallet nearly empty — a BUY above PKR 1,500 hits INSUFFICIENT_PKR.',
  },
  low_gold: {
    pkrWallet: '250000.00',
    customerGoldG: '0.0500',
    platformGoldG: '100.0000',
    intent: 'Customer holds almost no gold — a SELL hits INSUFFICIENT_GOLD.',
  },
  low_inventory: {
    pkrWallet: '250000.00',
    customerGoldG: '6.8420',
    platformGoldG: '0.0500',
    intent: 'Platform is nearly out of gold — a BUY hits INSUFFICIENT_INVENTORY.',
  },
};

export function isSourceFailureMode(v: unknown): v is SourceFailureMode {
  return typeof v === 'string' && (SOURCE_FAILURE_MODES as readonly string[]).includes(v);
}

export function isScenarioName(v: unknown): v is ScenarioName {
  return typeof v === 'string' && (SCENARIO_NAMES as readonly string[]).includes(v);
}

export async function getSourceFailureMode(): Promise<SourceFailureMode> {
  const raw = await getRedis().get(keys.demoSourceFailure);
  return isSourceFailureMode(raw) ? raw : 'none';
}

export async function setSourceFailureMode(mode: SourceFailureMode): Promise<void> {
  if (mode === 'none') {
    await getRedis().del(keys.demoSourceFailure);
    return;
  }
  await getRedis().set(keys.demoSourceFailure, mode);
}

/** Runtime override of the BUY-price floor, so the guardrail can be made to bind. */
export async function getGuardrailOverride(): Promise<Decimal | null> {
  const raw = await getRedis().get(keys.demoGuardrail);
  if (raw === null) return null;
  return parseDecimal(raw);
}

export async function setGuardrailOverride(value: Decimal): Promise<void> {
  await getRedis().set(keys.demoGuardrail, fmtPkr(value));
}

export async function clearGuardrailOverride(): Promise<void> {
  await getRedis().del(keys.demoGuardrail);
}

/** The floor actually in force right now: runtime override, else the env default. */
export async function getEffectiveGuardrail(): Promise<Decimal> {
  return (await getGuardrailOverride()) ?? D(config.guardrailPkrPerGram);
}

export async function getScenario(): Promise<ScenarioName> {
  const raw = await getRedis().get(keys.demoScenario);
  return isScenarioName(raw) ? raw : 'normal';
}

export async function setScenario(name: ScenarioName): Promise<void> {
  await getRedis().set(keys.demoScenario, name);
}

export interface DemoStatus {
  source_failure_mode: SourceFailureMode;
  guardrail_override: string | null;
  scenario: ScenarioName;
}

export async function getDemoStatus(): Promise<DemoStatus> {
  const [mode, override, scenario] = await Promise.all([
    getSourceFailureMode(),
    getGuardrailOverride(),
    getScenario(),
  ]);
  return {
    source_failure_mode: mode,
    guardrail_override: override === null ? null : fmtPkr(override),
    scenario,
  };
}

/** Reset all demo toggles. Used by the test suite; not exposed over HTTP. */
export async function resetDemoState(): Promise<void> {
  await getRedis().del(keys.demoSourceFailure, keys.demoGuardrail, keys.demoScenario);
}
