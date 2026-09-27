import { Trace } from "./types";

let traceIdCounter = 0;

/**
 * In-memory store for module execution traces.
 * Provides the data foundation for optimization (BootstrapFewShot, etc.).
 */
class TraceStore {
  private traces: Trace[] = [];
  private maxSize = 1000;

  record(trace: Omit<Trace, "id">): Trace {
    const fullTrace: Trace = {
      id: `trace_${++traceIdCounter}`,
      ...trace,
    };
    this.traces.push(fullTrace);

    if (this.traces.length > this.maxSize) {
      this.traces = this.traces.slice(-this.maxSize);
    }

    return fullTrace;
  }

  getByModule(moduleId: string): Trace[] {
    return this.traces.filter((t) => t.moduleId === moduleId);
  }

  getSuccessful(moduleId?: string): Trace[] {
    return this.traces.filter(
      (t) => t.success && (!moduleId || t.moduleId === moduleId),
    );
  }

  getAll(): Trace[] {
    return [...this.traces];
  }

  clear(moduleId?: string): void {
    if (moduleId) {
      this.traces = this.traces.filter((t) => t.moduleId !== moduleId);
    } else {
      this.traces = [];
    }
  }

  setMaxSize(max: number): void {
    this.maxSize = max;
  }

  get size(): number {
    return this.traces.length;
  }
}

export const traceStore = new TraceStore();
export { TraceStore };
