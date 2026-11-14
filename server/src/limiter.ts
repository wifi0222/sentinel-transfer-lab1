export class SerialRateLimiter {
  private available: number;
  private updated = Date.now();
  constructor(private readonly bytesPerSecond: number) { this.available = bytesPerSecond; }
  async consume(bytes: number): Promise<void> {
    const now = Date.now();
    this.available = Math.min(this.bytesPerSecond, this.available + (now - this.updated) * this.bytesPerSecond / 1000);
    this.updated = now;
    if (bytes <= this.available) { this.available -= bytes; return; }
    const missing = bytes - this.available;
    this.available = 0;
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(missing * 1000 / this.bytesPerSecond)));
    this.updated = Date.now();
  }
}

