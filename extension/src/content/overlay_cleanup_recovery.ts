import type { OverlaySuppression } from "./overlay_cleanup";

type OverlayCleanupRecoveryOptions = {
  /** Render one extension-owned recovery control for the current suppression group. */
  present: (undo: OverlaySuppression) => void;
  /** Record the result after the user explicitly exercises recovery. */
  onRestore: (restored: boolean) => void;
};

/**
 * Owns the single visible recovery authority for the active overlay-suppression
 * group. The raw group Undo is the authority identity; UI wrappers are ephemeral.
 */
export function createOverlayCleanupRecoveryController(
  options: OverlayCleanupRecoveryOptions,
) {
  let activeSuppression: OverlaySuppression | null = null;

  const present = (suppression: OverlaySuppression): void => {
    if (activeSuppression === suppression) return;
    activeSuppression = suppression;

    options.present(() => {
      let restored = false;
      try {
        restored = suppression();
        return restored;
      } finally {
        // A stale control may still run after a newer group is presented. It
        // must never retire that newer authority.
        if (activeSuppression === suppression) activeSuppression = null;
        options.onRestore(restored);
      }
    });
  };

  return {
    present,

    /**
     * Click-path warnings remain ordinary toasts. Their cleanup authority is
     * moved to the retained recovery surface rather than expiring with them.
     */
    toastControls(
      suppression: OverlaySuppression | null,
      coalesce = false,
    ): { coalesce: boolean } {
      if (suppression) present(suppression);
      return { coalesce: coalesce && !suppression };
    },

    /** Feature shutdown explicitly retires the UI and its authority identity. */
    clear(): void {
      activeSuppression = null;
    },
  };
}
