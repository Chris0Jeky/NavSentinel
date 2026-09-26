/**
 * Deterministic MAIN-world bootstrap.
 *
 * Static module evaluation completes the guard's observational History hooks
 * before the entry body installs the single-coercion boundary around them.
 * Keeping both steps in one module graph avoids manifest-loader completion races.
 */
import "./main_guard";
import { installStableHistoryBoundary } from "./history_url_boundary";

installStableHistoryBoundary();
