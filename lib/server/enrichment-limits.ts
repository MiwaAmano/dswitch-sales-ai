/** Process-local protection for the local prototype, not a public-service billing cap. */
export class EnrichmentBudget {
  private minuteCalls: number[] = [];
  private day = '';
  private dailyCalls = 0;
  take(now = Date.now()): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (this.day !== day) {
      this.day = day;
      this.dailyCalls = 0;
    }
    this.minuteCalls = this.minuteCalls.filter((at) => at > now - 60000);
    if (this.minuteCalls.length >= 30 || this.dailyCalls >= 200) return false;
    this.minuteCalls.push(now);
    this.dailyCalls++;
    return true;
  }
}
