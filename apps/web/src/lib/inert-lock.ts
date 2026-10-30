/** The few DOM methods the lock needs, so it can be tested without a browser. */
export interface InertTarget {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Makes a page region inert while at least one modal is open. Locks nest: the region stays inert until the last
 * one is released, and it is only un-inerted if this lock was the one that made it so.
 */
export function createInertLock() {
  let holders = 0;
  let ownsInert = false;
  return {
    acquire(target: InertTarget | null): () => void {
      let released = false;
      holders += 1;
      if (holders === 1 && target && !target.hasAttribute('inert')) { target.setAttribute('inert', ''); ownsInert = true; }
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0 && ownsInert && target) { target.removeAttribute('inert'); ownsInert = false; }
      };
    },
    get holders() { return holders; },
  };
}

/** Next card-open target after the drawer closes: the remembered trigger, else the card's button, else the board heading. */
export function pickFocusTarget<T extends { isConnected: boolean }>(remembered: T | null, cardButton: () => T | null, heading: () => T | null): T | null {
  if (remembered?.isConnected) return remembered;
  const button = cardButton();
  if (button?.isConnected) return button;
  const h = heading();
  return h?.isConnected ? h : null;
}
