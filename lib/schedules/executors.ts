/**
 * Every executor, imported for its registration side effect.
 *
 * The registry is a module-level `Map`, so a consumer has to import the module
 * that registers the executor it wants. Phase 1 learned this the expensive way
 * and put the side-effect import at the top of `tick.ts` with a comment warning
 * what happens without it: the registry is empty at runtime, every schedule
 * answers `invalid_target`, and neither the type-check nor the unit suite
 * notices, because both are happy with a `null` nobody calls.
 *
 * Phase 2 adds three more consumers -- the schedules API, the dispatch seam, and
 * the per-target UI's `describe` call -- and a warning in one file does not
 * travel. So the imports live here, in one place, and everything that runs at
 * request time imports `getExecutor`/`validateTarget` from *this* module rather
 * than from `registry.ts`.
 *
 * `registry.ts` stays pure: the unit tests and anything that needs an empty map
 * import it directly.
 */
import "@/lib/schedules/executor-agent";
import "@/lib/schedules/executor-workflow";

export { getExecutor, registerExecutor, validateTarget } from "@/lib/schedules/registry";
export type {
  ClaimedRun,
  TargetValidation,
  TriggerExecutor,
  TriggerResult,
} from "@/lib/schedules/registry";
