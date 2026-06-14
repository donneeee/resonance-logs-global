const CLOCK_INTERVAL_MS = 100;

const overlayClock = $state({
  nowMs: Date.now(),
  timerId: null as number | null,
  cleanup: null as (() => void) | null,
});

function getAlignedNowMs(timestamp = Date.now()) {
  return timestamp - (timestamp % CLOCK_INTERVAL_MS);
}

function refreshOverlayClockNow(timestamp = Date.now()) {
  overlayClock.nowMs = getAlignedNowMs(timestamp);
}

function clearOverlayClockTimer() {
  if (overlayClock.timerId !== null) {
    window.clearTimeout(overlayClock.timerId);
    overlayClock.timerId = null;
  }
}

function scheduleNextOverlayClockTick() {
  clearOverlayClockTimer();
  const now = Date.now();
  const remainder = now % CLOCK_INTERVAL_MS;
  const delay = remainder === 0 ? CLOCK_INTERVAL_MS : CLOCK_INTERVAL_MS - remainder;
  overlayClock.timerId = window.setTimeout(() => {
    refreshOverlayClockNow();
    scheduleNextOverlayClockTick();
  }, delay);
}

export function overlayNow() {
  return overlayClock.nowMs;
}

export function refreshOverlayClock() {
  refreshOverlayClockNow();
}

export function initOverlayClock() {
  if (overlayClock.cleanup) {
    refreshOverlayClockNow();
    return overlayClock.cleanup;
  }

  if (typeof window === "undefined") {
    return () => {};
  }

  const resyncOverlayClock = () => {
    refreshOverlayClockNow();
    scheduleNextOverlayClockTick();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      resyncOverlayClock();
    }
  };

  resyncOverlayClock();
  window.addEventListener("focus", resyncOverlayClock);
  window.addEventListener("pageshow", resyncOverlayClock);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  overlayClock.cleanup = () => {
    clearOverlayClockTimer();
    window.removeEventListener("focus", resyncOverlayClock);
    window.removeEventListener("pageshow", resyncOverlayClock);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    overlayClock.cleanup = null;
  };

  return overlayClock.cleanup;
}
