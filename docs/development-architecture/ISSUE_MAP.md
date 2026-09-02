# Issue map

Snapshot: the 82 open issues reconciled on 2026-08-30. The machine-readable
[ISSUE_MAP.json](ISSUE_MAP.json) preserves the original title, proposed track,
priority, disposition, gate, dependencies, rationale, and URL for every issue.

## Active outcomes

- **M0 Proving Ground (10):** #419, #420, #449, #458, #460, #496, #498,
  #565, #593, #595.
- **M1 unlisted beta (8):** #175, #176, #186, #415, #455, #474, #523, #601.

#458 is the one live deviation from the package grouping: it remains open in M0
because the bundled-Chromium contract is proven but the issue's minimum/current
branded-Chrome evidence remains unverified.

## Planned and gated outcomes

- **M2 interaction integrity (12):** #389, #558, #560, #561, #563, #564,
  #566, #569, #577, #579, #580, #594.
- **M3 local evidence plane (8):** #215, #219, #237, #239, #562, #585,
  #591, #592.
- **M4 efficacy and quietness (14):** #179, #199, #200, #209, #217, #223,
  #225, #232, #269, #397, #416, #417, #418, #426.
- **M5 cohort and operations (1):** #425.

## Passive and frozen

- **Maintenance icebox (4 open after reconciliation):** #339, #408, #437,
  #462. #421/#422 are recorded in the map but close as enacted/superseded.
- **R1 post-beta horizon (18):** #127, #240, #241, #242, #243, #440, #441,
  #442, #443, #444, #445, #446, #447, #448, #450, #451, #452, #453.

## Reconcile and close

- #244 -> #452.
- #245/#246 -> #444.
- #374 -> verified RI-02 excision/current performance boundary.
- #439 -> active #449 plus #420.
- #421/#422 -> enacted operating posture; unfinished document rotation stays #437.

## Selection rules

- Start with a live PR gate/defect, then M1, then the M0 proof needed for M1.
- #417 methodology is the only planned-milestone exception.
- Do not select the maintenance icebox or frozen Horizon as fallback work.
- Do not start a new runtime vertical while the runtime WIP cap is full.
- A milestone move does not override an owner, browser, measurement, privacy,
  permission, or external gate recorded on the issue or in `ACTION_ITEMS.md`.
