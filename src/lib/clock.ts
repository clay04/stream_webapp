"use client";

/**
 * Koreksi selisih jam perangkat terhadap jam server (mirip NTP sederhana),
 * supaya `sentAt` dari dua perangkat bisa dibandingkan dengan akurat.
 */
let offsetMs = 0;
let synced: Promise<void> | null = null;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function syncClock(): Promise<void> {
  if (synced) return synced;
  synced = (async () => {
    const samples: { offset: number; rtt: number }[] = [];
    for (let i = 0; i < 4; i++) {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        const { now } = (await res.json()) as { now: number };
        const t1 = Date.now();
        const rtt = t1 - t0;
        samples.push({ offset: now + rtt / 2 - t1, rtt });
      } catch {
        // abaikan sampel gagal
      }
    }
    if (samples.length) {
      samples.sort((a, b) => a.rtt - b.rtt);
      offsetMs = samples[0].offset;
    }
  })();
  return synced;
}

