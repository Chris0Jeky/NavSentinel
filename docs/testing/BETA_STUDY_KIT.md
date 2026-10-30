# Small-beta study kit

For EV-01 / #425 and the beta study kit in #1177. The recruitment targets are
15 invitations and 10 activated daily-use installs, with D14 and D30 check-ins.
These are targets, not observed results. This kit prepares the study; it does
not close the [pre-beta gates](../Product_Strategy.md#pre-beta-gates), authorise
distribution, or establish protection efficacy. The current build is a private
development pre-release, without a Chrome Web Store listing.

## Purpose, choice and privacy

We want to learn how often Heedline interrupts ordinary tasks, whether people
understand its wording and choices, how they recover, whether they keep it
enabled, and what weeks with no noticed intervention feel like. A quiet week is
useful evidence of experience, not proof that protection ran or prevented harm.
This small, self-selected cohort cannot establish a population protection rate
or an independent security verdict. The strategy's E4 small-beta evidence must
remain scoped to what participants actually report.

Keep this worksheet offline, on paper or in a local text file you control.
Participation, answering any question, and sharing any part are your choices.
You may stop, skip a question, withhold a week, or delete your own copy. No
account, automated collection or telemetry is part of this kit. Heedline has no
telemetry; the kit must not add any. Missing returns stay missing and are never
filled in from other weeks, extension logs, or assumptions about continued use.

Do not record or request sites or hostnames, URLs, page content, credentials,
names, exact timestamps, or screenshots of other people's data. Use week
numbers, task categories and rough duration buckets only. Do not attach
screenshots, recordings, browser history or extension exports to this study.
The [privacy document](../../PRIVACY.md) explains that local records and exports
can contain browsing-related information, including hostnames and timestamps;
they are not substitutes for this worksheet. Local does not mean anonymous.

If you choose to share, review the selected rows yourself and omit identifying
details. Do not put participant worksheets in Git, public issues or public
attachments. The maintainer should receive only the selected categories and
non-identifying comments through an agreed private route, keep them offline,
and agree a deletion point with you before accepting them. If no private route
is agreed, keep the worksheet yourself. The maintainer records aggregate counts
and paraphrased themes, without inferring withheld information. Do not transcribe
unexpected personal details; ask the participant to omit them.

## Weekly worksheet

Use one participant-chosen study code, unrelated to your name or accounts.
Day 0 means your own confirmation that you installed and enabled the agreed
study build, not an invitation, download, or onboarding page saying it is active.
Record a non-personal build/version label if known; otherwise use unknown.
Week 1 covers days 1–7 after activation, then weeks 2, 3 and 4 cover days 8–14,
15–21 and 22–28. Keep days 29–30 as a separate partial period at D30, outside
the weekly denominator. No calendar dates or exact times are needed.

Copy this form for each week. A blank answer is allowed.

```text
Study code:
Study build/version, or unknown:
Week number (1 / 2 / 3 / 4):
Week state (choose exactly one from the list below):
Optional disable reason category:
Interruption rows complete for this week? yes / no / unsure
Optional comment about ease, confusion, recovery or no noticed benefit:
  (no sites, page details, people or exact times)
```

Choose the week state in this order so the choices do not overlap:

| State | Meaning |
| --- | --- |
| unsure | You cannot choose reliably, including uncertainty about whether Heedline was enabled. Do not guess. |
| disabled | You know the extension or a guard was off for some or all of the week, including remaining off from an earlier week or being uninstalled. This takes priority over use earlier that week. |
| did not use | You did no browsing with the study browser that week and did not disable Heedline. |
| used / interrupted | You browsed with Heedline enabled, did not disable it that week, and noticed at least one intervention affecting a task. |
| used / no interruption | You browsed with Heedline enabled, did not disable it that week, and noticed no intervention affecting a task. |

Optional disable reason categories: interruption burden / unclear wording /
recovery difficulty / performance / compatibility / privacy concern / study
finished / other / prefer not to say. Choose categories only; no identifying
explanation is needed. Record a partial protection-lowering choice here as
disabled even if other guards stayed enabled. Trust and one-use allowances are
choices, not automatically a disabled week.

For each noticed interruption, add one row below. Count one task episode once,
even if it involved several prompts or journal records. If Heedline did several
things during that episode, choose the action that most affected the task and
note uncertainty without page details. Rows may also describe episodes before
a disable or during an unsure week; they do not change the week state. A
remembered interruption without a completed row is still an interrupted week;
never invent its details. Do not seek out risky pages to complete the form.

| Episode number within week | Task category | What Heedline did | Recovery time | Outcome | Your classification |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |

- Task category: shopping / banking / work tool / social / news / other.
- What Heedline did: warned / blocked / rolled back / hid an overlay / other.
- Recovery time: <10 s / 10–60 s / 1–5 min / >5 min / gave up.
- Outcome: completed task / abandoned / unknown.
- Your classification: helpful / unnecessary / unsure.

Estimate recovery time from noticing the interruption until you could continue
the task or stopped trying. Exactly 60 seconds belongs to 10–60 s; more than
60 seconds up to and including 5 minutes belongs to 1–5 min. Use gave up when
you stopped trying to recover. If you cannot recall a field, leave it blank;
the maintainer records it as unavailable, not as zero. Your classification is
your judgement, not a verified malicious/benign label.

## Maintainer counting rules

For any zero denominator, report unavailable (no observations), not 0%.

1. Keep recruitment separate: invitations sent, confirmed installs, and
   participant-confirmed activations. Report actual counts, including unknown
   install/activation status. The target conversion is 10/15; never substitute
   those targets for observations. Ask non-install reasons only if the person
   chooses to answer; withheld reasons stay unavailable.
2. One activated participant contributes one expected slot per completed
   seven-day study week. State the number of activated participants, completed
   weeks and expected slots. Not-yet-due weeks are pending, outside that
   denominator. Count one final participant-confirmed state per returned slot;
   clarify conflicting answers without selecting a state for them. Unresolved
   conflicts are unsure. A missing return is a separate administrative status,
   never a sixth participant choice. Report returns / expected slots, then
   counts of all five states and missing slots / expected slots.
3. Used weeks = used / no interruption + used / interrupted. Report quiet weeks
   / used weeks and interrupted weeks / used weeks. Keep did not use, disabled,
   unsure and missing separate. A partial disabled week stays disabled; do not
   move it into the quiet or used denominator. Report its episodes separately.
   These are participant-week measures, not rates per browsing hour or task.
4. Count supplied episode rows separately from weeks and from local event-log
   records. Always name which week states supplied them and how many weeks
   reported complete rows. For comparable used weeks, report episodes / used
   weeks only when every interrupted used week confirms complete rows;
   otherwise report the supplied count as incomplete, without an estimated
   rate. A quiet week needs no episode rows. Never turn missing episode rows
   into zero episodes. Do not infer tasks/sessions observed from these forms.
5. For episode classification, outcomes and recovery buckets, report counts /
   all supplied episodes, with unavailable fields explicit. Report unnecessary
   interruptions and abandoned tasks on that denominator; do not call either a
   verified false-positive rate. Keep unsure and unknown responses visible.
   Do not replace buckets with precise seconds or interpret counts as attacks
   prevented. Describe voluntary recovery/reversal comments as unverified
   participant accounts, without inferring that an alternative was safe.
6. D14 and D30 are separate participant-relative checkpoints, 14 and 30 days
   after Day 0. Ask for status at that checkpoint: enabled / disabled /
   uninstalled / unsure. Enabled means the extension remains installed and the
   study guards are enabled; a guard left Off counts as disabled. Ask separately
   whether the study browser was used in the preceding seven days: yes / no /
   unsure. Enabled retention and recent use are different measures. Do not
   infer either from a quiet week, saved preferences, or a previous check-in.
7. At each checkpoint the denominator is all confirmed activated participants
   whose checkpoint is due, including non-responders and people who stopped.
   Report confirmed enabled / that denominator, plus disabled, uninstalled,
   unsure and missing counts. This is the confirmed enabled proportion, not a
   claim that missing people disabled or stayed enabled. If any status is
   unknown, full-cohort retention remains unresolved. Also report status
   returns / due activations and, if useful, enabled / known statuses (enabled
   + disabled + uninstalled), labelled as conditional on known status. Never
   carry a D14 answer forward to D30. A late answer that cannot recall the
   checkpoint stays unsure; today's status cannot replace it. Pending people
   are listed separately until due. The roadmap's 7/10 D14 and 6/10 D30 are
   targets for ten actual activations, not evidence or values to fill in.

### Worked example: fictional weeks

Suppose five people were invited, four confirmed installation, and three
confirmed activation. The fifth person's install status is unknown; one known
installer did not activate. These are fictional figures, not the cohort target.
All three activated participants have reached D30. Their four full weeks give
3 × 4 = 12 expected slots; none is pending.

| Study code | Week 1 | Week 2 | Week 3 | Week 4 |
| --- | --- | --- | --- | --- |
| A | used / no interruption | used / interrupted (I1, I2) | used / no interruption | used / no interruption |
| B | used / interrupted (I3) | did not use | disabled | disabled |
| C | used / no interruption | unsure | missing return | missing return |

A and B confirm their interruption rows are complete for the interrupted weeks.
B optionally gives interruption burden as the reason for both disabled weeks.
There are no episode rows from disabled or unsure weeks in this example.

| Episode | Task category | What Heedline did | Recovery time | Outcome | Participant classification |
| --- | --- | --- | --- | --- | --- |
| I1 (A, week 2) | shopping | warned | <10 s | completed task | helpful |
| I2 (A, week 2) | work tool | blocked | 1–5 min | completed task | unnecessary |
| I3 (B, week 1) | news | hid an overlay | 10–60 s | abandoned | unsure |

Applying the rules:

- Recruitment: 5 invitations, 4 confirmed installs / 5 invitations (80%),
  1 unknown install status / 5; 3 activations / 5 invitations (60%), or
  3 / 4 confirmed installs (75%).
- Returns: 10 / 12 expected weeks (83.3%). States / 12: quiet 4, interrupted 2,
  did not use 1, disabled 2, unsure 1, missing 2. The ten returned forms include
  the unsure week. Missing weeks are not quiet weeks.
- Used weeks: 4 + 2 = 6. Quiet: 4/6 (66.7%); interrupted: 2/6 (33.3%).
  Complete supplied episodes: 3 across those 6 weeks = 0.5 episodes per used
  week. Both interrupted weeks (2/2) confirm complete rows. This is not a
  per-task rate and does not describe the disabled or missing weeks.
- Of 3 episodes: helpful 1/3, unnecessary 1/3, unsure 1/3; completed 2/3,
  abandoned 1/3, unknown 0/3. Recovery: <10 s 1/3, 10–60 s 1/3, 1–5 min 1/3,
  >5 min 0/3, gave up 0/3. No episode fields are unavailable. Warned, blocked
  and hid an overlay each account for 1/3; rolled back and other are 0/3.

The checkpoint answers are separate from that weekly table:

| Study code | D14 status | D30 status |
| --- | --- | --- |
| A | enabled | enabled |
| B | enabled | disabled |
| C | missing return | missing return |

- D14: 2 confirmed enabled / 3 due activations (66.7%); disabled 0,
  uninstalled 0, unsure 0, missing 1. Status returns: 2/3; enabled among known
  statuses: 2/2 (100%). B can be enabled without having used the browser in
  week 2.
- D30: 1 confirmed enabled / 3 due activations (33.3%); disabled 1,
  uninstalled 0, unsure 0, missing 1. Status returns: 2/3; enabled among known
  statuses: 1/2 (50%).

Full-cohort retention is unresolved at both checkpoints because C's status is
missing. There is no imputation and no claim that a target was met.

## Three-card teach-back

Use these fictional cards offline, without opening a real site, changing a
setting or submitting anything. Show one card at a time and hide its answer
key until the first answer is recorded. Ask the question as written; do not
hint, correct, or explain while the participant answers. A participant may say
they are unsure or decline. Record only a brief, non-identifying paraphrase.
These source quotations describe current wording, not a promise that every
guard or consent gate is complete.

### Card 1: What happened?

Fictional situation: during a shopping task you see the onboarding prompt
example labelled **Caution**, with **This may be a deceptive redirect.** and
the choices **Allow once** and **Block**. Each bold string is quoted verbatim
from `extension/src/onboarding/onboarding.html`. This is an onboarding example,
not evidence of a live incident or a claim that every prompt has this layout.

Ask: What happened? What do you know, and what is still uncertain?

### Card 2: What will this choice change?

Fictional situation: in the popup control labelled **Navigation guard mode**,
you consider selecting **Off**. Those strings are quoted verbatim from
`extension/src/popup/popup.html` (the control label is its accessible label).
The onboarding describes Off as **Monitoring only. Events are logged but nothing is blocked or prompted.**
This sentence is quoted verbatim from
`extension/src/onboarding/onboarding.html`.

Ask: What will this choice change? Does it mean nothing is being recorded?

### Card 3: Does this score establish danger?

Fictional situation: a credential entry in **Evidence journal** has a score
of 72 points. The page offers **With a score** as a filter. Both bold strings
are quoted verbatim from `extension/src/evidence/evidence.html`; the number is
invented for this exercise. Its reason reads **This site is not on your trusted list**,
quoted verbatim from `extension/src/evidence/evidence_reasons.ts`
(`UNTRUSTED_DOMAIN`). Do not supply a real hostname or an incident timestamp.

Ask: Does this score establish danger? What does this entry tell you, and
what can it not tell you?

### First-answer record and answer key

| Card | First answer, paraphrased before explanation | Participant confidence (sure / unsure / declined) | Maintainer assessment (understood / wrong / uncertain / declined) | Explanation shown afterwards? |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

Keep the first answer even if the participant changes their mind afterwards.
Use wrong for an explicit contradictory claim, uncertain for an incomplete or
ambiguous answer or uncertainty about the wording, and declined for a skipped card. Mark
understood only when the answer captures the distinction in the key. Record
any later answer separately as after explanation; never replace the first one
or repeat the question until it is correct. Report each assessment count per
card / participants offered that card, with declines and missing records
separate. If repeated at D30, label it a repeat after possible D14 explanation;
it is not another uncoached first exposure.

Reveal the relevant key only after recording that card's first answer:

1. Heedline is warning about a possible deceptive redirect. The caution alone
   does not establish maliciousness, a prevented attack, or that the task
   completed. Allow once and Block offer different decisions; neither proves
   safety. Calling this a proven attack or a confirmed successful block is
   wrong; recognising a warning while remaining uncertain about danger is
   understood.
2. Off lowers the selected navigation guard to monitoring: it stops that
   guard's blocking and prompting, while event logging continues. It does not
   switch off every guard or mean that nothing is recorded. An answer saying
   all protection or all recording stops is wrong. Do not ask the participant
   to make the change.
3. No. A heuristic score ranks recorded signals; it is not a probability,
   a safety verdict, a protection rate, or proof of an attack or prevention.
   Being outside a trusted list does not itself establish danger. The page
   says **Counts are observations, not protection rates or safety verdicts.**
   and **Records prove neither complete coverage nor prevention.** Both are
   verbatim from `extension/src/evidence/evidence.html`. Treat an assertion
   that 72 points proves danger or means a 72% chance of harm as wrong;
   uncertainty about what the number means is uncertain, not a pass.

## D14 and D30 facilitator script: 10 minutes

Use the same order at both check-ins, privately and without screen sharing.
The participant can stop or skip any question. Ask open questions before
showing categories or explanations, and avoid praise that favours any answer.

| Time | Script and action |
| --- | --- |
| 0–1 min | Confirm the person still wishes to take part and choose what to share. Remind them to leave out sites, page details, people and exact times. |
| 1–3 min | Ask: How has browsing felt since we last spoke? What, if anything, stood out about Heedline? Let them describe a quiet period without implying something should have happened. |
| 3–5 min | Ask: If anything interrupted you, what were you trying to do, and what happened next? What helped or made it harder to continue? If nothing happened, what did you make of that? Then offer the weekly categories and accept blanks. Do not ask for a site, log or demonstration. |
| 5–8 min | Offer the three fictional teach-back cards. Record each first answer and confidence before revealing its key. At D30 flag prior exposure. If time runs out, leave remaining cards missing; do not fill them in. |
| 8–9 min | Ask: What is your Heedline status at this checkpoint, and what influenced it? Then offer enabled / disabled / uninstalled / unsure. Separately ask about study-browser use in the preceding seven days. Accept a withheld status as missing and a volunteered category-only disable reason. At D30 ask separately about days 29–30; do not count these as a full week. |
| 9–10 min | Ask: What would you change, or want us to understand? Confirm which rows or paraphrases they wish to share and the agreed deletion point. At D14 agree whether they want a D30 check-in; at D30 close participation without asking them to keep Heedline enabled. |

Keep unanswered questions and non-returns visible in the summary. Do not coach
participants towards a retention target or infer protection from a quiet week.
Existing owner decisions and manual browser checks remain in
[ACTION_ITEMS.md](../../ACTION_ITEMS.md); this kit does not resolve them.
