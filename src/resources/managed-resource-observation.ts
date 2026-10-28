interface Observation {
  at: number;
  pending: boolean;
  running: boolean;
}

/** Share bounded background observations across instances and project reads. */
export class ManagedResourceObservation {
  private readonly results = new Map<string, Observation>();

  record(key: string, running: boolean): void {
    if (!this.results.has(key) && this.results.size >= 128) {
      const oldest = this.results.keys().next().value;
      if (oldest) {
        this.results.delete(oldest);
      }
    }
    this.results.set(key, { at: Date.now(), pending: false, running });
  }

  inspect(key: string, observe: () => Promise<boolean>): boolean {
    if (!this.results.has(key)) {
      this.record(key, false);
      const initial = this.results.get(key);
      if (initial) {
        initial.at = 0;
      }
    }
    const result = this.results.get(key);
    if (!result) {
      return false;
    }
    if (!result.pending && Date.now() - result.at > 4000) {
      result.pending = true;
      ManagedResourceObservation.refresh(result, observe);
    }
    return result.running;
  }
  private static async refresh(
    result: Observation,
    observe: () => Promise<boolean>
  ): Promise<void> {
    try {
      result.running = await observe();
    } catch {
      result.running = false;
    } finally {
      result.at = Date.now();
      result.pending = false;
    }
  }
}
