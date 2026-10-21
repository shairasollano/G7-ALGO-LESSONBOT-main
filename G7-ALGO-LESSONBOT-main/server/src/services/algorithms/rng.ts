/**
 * Deterministic seedable pseudorandom generator (mulberry32).
 * Used by randomized algorithms in teaching mode so that a fixed seed
 * reproduces the exact same sequence of trials.
 */
import { ValidationError } from "./graph-utils.js";

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // Normalize to a 32-bit unsigned integer.
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in {0, 1} — a fair coin flip. */
  bit(): 0 | 1 {
    return this.next() < 0.5 ? 0 : 1;
  }
}

/** Validate a seed: must be a non-negative integer within safe bounds. */
export function validateSeed(seed: unknown): number {
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new ValidationError("invalid_seed", "seed must be an integer between 0 and 4294967295.");
  }
  return seed;
}
