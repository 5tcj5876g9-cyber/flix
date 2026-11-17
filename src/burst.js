/* حد التزامن العام: فوقه نرد 503 بدل ما نبلع الرام.
   هذا خط الدفاع الأول ضد flood بسيط قبل ما يوصل Cloudflare. */

const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT ?? 80);

class BurstGuard {
  constructor(limit) {
    this.limit = limit;
    this.current = 0;
    this.peak = 0;
  }

  enter() {
    if (this.current >= this.limit) return false;
    this.current += 1;
    if (this.current > this.peak) this.peak = this.current;
    return true;
  }

  leave() {
    if (this.current > 0) this.current -= 1;
  }
}

export const burstGuard = new BurstGuard(MAX_INFLIGHT);
