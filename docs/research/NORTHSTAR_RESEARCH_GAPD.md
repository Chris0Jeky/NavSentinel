<!-- deep-research GAP-D pass (run wf_f6aabedb-57a), 2026-06-13. Synthesis step was cut off by a session limit; these are the 24 adversarially-verified (3-vote) claims, unmerged. -->

# NavSentinel North-Star — External Research GAP-D (feedback loop / conformal calibration)

**Focus:** (1) conformal prediction w/ rejection (Transcend/Transcendent) · (2) decision-time feature-vector snapshot + session-replay · (3) labeled local corpus (IndexedDB) · (4) active learning on a tiny labeling budget.

> Note: the workflow synthesis step hit the session limit, so this is the verified-claim list (not a merged narrative). Each claim passed 3-vote adversarial verification.

## Verified claims (24)

### C1 (3-0)
**Claim.** Classification-with-rejection — quarantining likely-misclassified samples for expert analysis instead of auto-deciding them — is a viable method to cope with concept drift in security classifiers. This directly supports the research-question design of quarantining low-credibility/out-of-distribution samples for human labeling.

> One promising method to cope with concept drift is classification with rejection in which examples that are likely to be misclassified are instead quarantined until they can be expertly analyzed.

Source: https://arxiv.org/abs/2010.03856

### C2 (3-0)
**Claim.** TRANSCENDENT is a rejection framework built on Transcend, whose statistical engine is conformal evaluation derived from conformal prediction theory — confirming that the conformal-credibility/confidence p-value mechanism named in the research question is the underlying method.

> We propose TRANSCENDENT, a rejection framework built on Transcend, a recently proposed strategy based on conformal prediction theory.

Source: https://arxiv.org/abs/2010.03856

### C3 (3-0)
**Claim.** The authors develop two additional conformal evaluators that match or surpass the original's performance while significantly reducing computational overhead — relevant because a solo-developer/in-browser implementation needs the cheapest correct conformal evaluator (e.g. inductive/split rather than transductive).

> we develop two additional conformal evaluators that match or surpass the performance of the original while significantly decreasing the computational overhead

Source: https://arxiv.org/abs/2010.03856

### C4 (2-1)
**Claim.** Transcend computes a conformal p-value for a test object z against a class K as the proportion of objects in K whose non-conformity score is at least as large as z's, i.e. p = |{j : alpha_j >= alpha_z}| / |K| — a direct, implementable split/inductive-conformal formula where the non-conformity measure is taken straight from the classifier's scoring function (e.g. SVM distance-to-hyperplane), making it algorithm-agnostic.

> the p-value pCz for an object z is the proportion of objects in class K that are at least as dissimilar to other objects in C as z... pCz = |{ j : alpha_j >= alpha_z }| / |K|. ... In Transcend, the nonconformity measure (NCM) is computed directly from the scoring function of the algorithm.

Source: https://www.usenix.org/system/files/conference/usenixsecurity17/sec17-jordaney.pdf

### C5 (3-0)
**Claim.** Two decision-quality metrics are defined per prediction: algorithm credibility = the p-value for the label the classifier chose, and algorithm confidence = 1.0 minus the maximum p-value among all other (non-chosen) labels; low credibility flags out-of-distribution/drifting samples that should not be auto-trusted. This is the exact rule a single-user extension can use to decide which decisions to abstain on.

> algorithm credibility. ACred(z) is defined as the p-value for the test object z corresponding to the label chosen by the algorithm under analysis... We define the algorithm confidence as 1.0 minus the maximum p-value among all p-values except the p-value chosen by the algorithm (i.e., algorithm credibility)... a low credibility value is an indicator of either z being very different from the objects in the class chosen by the classifier or the object being poorly identified.

Source: https://www.usenix.org/system/files/conference/usenixsecurity17/sec17-jordaney.pdf

### C6 (3-0)
**Claim.** Per-class rejection thresholds are set by solving a constrained optimization on a held-out calibration set: maximize kept-set F1 (performance among accepted predictions) subject to a minimum F1 (0.99) and a minimum kept-fraction (0.766); thresholds derived on calibration are then enforced at deployment so predictions with p-values below threshold are quarantined as untrustworthy. This is precisely the 'maximize kept-F1 under a bounded rejection rate' design in the research question.

> we asked Transcend to identify suitable quality thresholds... with the aim to maximize the F1-score as derived by the calibration dataset, subject to a minimum F1-score of 0.99 and a minimum percentage of kept element of 0.766... such thresholds are derived from the calibration dataset but are enforced to detect concept drift on a testing dataset.

Source: https://www.usenix.org/system/files/conference/usenixsecurity17/sec17-jordaney.pdf

### C7 (3-0)
**Claim.** On a real drift scenario (SVM/Drebin trained 2010-2012, tested on Marvin 2010-2014), filtering out low-p-value predictions raised malicious-class precision from 0.61 to 0.89 and recall from 0.36 to 0.76 — a concrete, quantitative demonstration that abstaining on low-credibility samples recovers accuracy under concept drift.

> Results show how flagging predictions of testing objects with p-values below the cut-off thresholds as unreliable improves precision and recall for the positive (malicious) class, from 0.61 to 0.89 and from 0.36 to 0.76, respectively.

Source: https://www.usenix.org/system/files/conference/usenixsecurity17/sec17-jordaney.pdf

### C8 (3-0)
**Claim.** The credibility p-value in TRANSCENDENT's official implementation is computed as a split/inductive conformal p-value: the proportion of same-class training (calibration) points whose nonconformity measure (NCM) is greater than or equal to the test point's NCM, divided by the count of training points in that class. This is directly portable to a tiny single-user calibration set since it requires no model retraining, only stored calibration NCMs.

> single_cred_p_value = (how_many_are_greater_than_single_test_ncm / sum(1 for y in groundtruth_train if y == single_y_test)) ... They're computed as the proportion of points with greater NCMs (the number of points _less conforming_ than the reference point) over the total number of points.

Source: https://github.com/s2labres/transcendent-release

### C9 (3-0)
**Claim.** The nonconformity measure for the SVM classifier is simply the (sign-flipped, per-class) decision-function distance from the separating hyperplane, confirming that the 'nonconformity = decision score / distance-to-boundary' approach in the research question is exactly how the official implementation works for a binary security classifier.

> In binary classification with a linear SVM, the output score is the distance from the hyperplane with respect to the positive class... To perform thresholding with conformal evaluator, we need the distance from the hyperplane with respect to *both* classes, so we simply flip the sign to get the 'reflection' for the other class.

Source: https://github.com/s2labres/transcendent-release

### C10 (3-0)
**Claim.** Per-class quarantine thresholds are set by random search that maximizes the F1 of kept (non-rejected) predictions while minimizing the F1 of rejected predictions, subject to an explicit bounded rejection-rate constraint (e.g. reject_total_perc:0.25 = reject at most 25%). This directly implements the research question's 'maximize kept-F1 under a bounded rejection rate' design.

> Random search for thresholds maximising F1 above threshold and minimising F1 of rejected predictions while enforcing thresholds for credibility and confidence: ... -t random-search -c cred+conf --rs-max f1_k --rs-min f1_r --rs-limit reject_total_perc:0.25 --rs-samples 500

Source: https://github.com/s2labres/transcendent-release

### C11 (3-0)
**Claim.** Classification-with-rejection for drifting malware classifiers is implemented via the TRANSCENDENT conformal-evaluation framework using an inductive conformal evaluator (ICE) and a nonconformity measure (NCM); low-confidence predictions are quarantined into a 'quarantine zone' for manual review rather than auto-decided. For DNNs the NCM is adapted from the model's final SoftMax probabilistic outputs.

> classifiers can designate decisions as "low confidence" ... effectively placing uncertain predictions into a quarantine zone pending manual review ... utilizing the TRANSCENDENT framework ... the inductive conformal evaluator (ICE) is used to pinpoint and exclude examples that deviate from expected patterns ... an adaptation of NCM has been developed for DNN (DEEPDREBIN) in this work, drawing upon the probabilistic outputs from its final SoftMax layer.

Source: https://arxiv.org/pdf/2402.01359

### C12 (2-1)
**Claim.** Active learning by uncertainty sampling selects the most uncertain (near-decision-boundary) test objects for human labeling; performance gains are observable when retraining as few as 1% of samples monthly, and reach optimal performance at a 25% maximum monthly retraining rate, with a 25% rate equating to a labeling cost of 50,355 labeled samples over 48 months.

> the data indicates discernible performance gains with the retraining of as few as 1% of samples monthly ... both DREBIN and DEEPDREBIN achieve optimal performance when the monthly retraining rate is at its maximum of 25% ... employing Active Learning (AL) with a 25% relabeling rate results in a labeling cost of 50,355 samples over 48 months

Source: https://arxiv.org/pdf/2402.01359

### C13 (3-0)
**Claim.** Manual labeling of security samples is severely budget-constrained: the paper cites an estimate that an average company could only manually label 80 objects per day, framing both active-learning relabeling cost (Lc) and rejection/quarantine cost (Qc) as the dominant practical constraints on tuning loops.

> Miller et al. [48] estimated that an average company could only manually label 80 objects per day

Source: https://arxiv.org/pdf/2402.01359

### C14 (3-0)
**Claim.** The paper provides a non-asymptotic O(1/n) convergence rate for margin-based uncertainty-sampling active learning to the optimal linear predictor in the separable (no-noise) regime, for both binary and multi-class classification, using only O(d) first-order updates per step (d = feature dimension).

> We provide a non-asymptotic rate of convergence of order O(1/n), where n is number of iterations of the algorithms which is also number of unlabeled samples seen by the algorithm for both binary and multi-class classification problems.

Source: https://proceedings.mlr.press/v162/raj22a/raj22a.pdf

### C15 (3-0)
**Claim.** They define a concrete, directly implementable margin-based query probability for binary classification: μ(θ,x) = 1/(1+μ|θᵀx|), i.e., the probability of asking the human for a label decays with the absolute margin |θᵀx| (distance to the decision boundary), with a single tunable aggressiveness parameter μ.

> for the choice of (, x) = 1 1+�| x| , step size  = min 1 � ,  -1 1+� R2 max{1, 1 �}

Source: https://proceedings.mlr.press/v162/raj22a/raj22a.pdf

### C16 (3-0)
**Claim.** The labeling budget is controlled by the single parameter μ: smaller budgets require more aggressive sampling and thus larger μ, and the algorithm provably converges for all choices of μ (μ must be chosen by experiment, and the bound diverges as μ→∞).

> It is also to keep in mind that the choice of � depends on the sampling budget. Less budget will require to do more aggressive sampling and hence will require to choose much larger � and vice versa.

Source: https://proceedings.mlr.press/v162/raj22a/raj22a.pdf

### C17 (3-0)
**Claim.** Transcend (Jordaney et al., USENIX Security 2017) is a peer-reviewed framework that detects concept drift in deployed malware classifiers in vivo, flagging an aging model before its accuracy degrades, rather than retraining retrospectively after poor performance is observed. This directly supports the research question's drift-detection-for-quarantine goal.

> The work proposes Transcend, a framework to identify aging classification models in vivo during deployment ... a significant departure from conventional approaches that retrain aging models retrospectively when poor performance is observed.

Source: https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/jordaney

### C18 (3-0)
**Claim.** Transcend builds prediction-quality metrics by statistically comparing each deployment sample against the training samples, using a conformal evaluator to assess model credibility and confidence -- i.e. the credibility/confidence p-value pair the research question asks about for abstention.

> The TRANSCEND framework identifies concept drift in classification models through statistical metrics and a conformal evaluator to assess model credibility and confidence.

Source: https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/jordaney

### C19 (3-0)
**Claim.** Transcend's conformal evaluation derives p-values from a nonconformity measure (how dissimilar a sample is from each class's prior examples), and from the prediction region computes two metrics -- confidence and credibility -- enabling rejection of new drifting examples that violate the classifier's assumptions (the abstention/quarantine mechanism).

> conformal evaluators borrow the same statistical tools (i.e., nonconformity measures and p-values) but use them to evaluate the quality of the prediction ... by detecting instances which appear to violate assumptions they can reject new drifting examples.

Source: https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/jordaney

### C20 (3-0)
**Claim.** rrweb records web sessions as a serialized initial DOM full-snapshot plus timestamped incremental mutation/event records (not video), and replays them by reapplying mutations one-by-one according to their timestamps — making it a deterministic DOM-reconstruction mechanism rather than a screen recording.

> snapshot is used to convert the DOM and its state into a serializable data structure with a unique identifier ... record function is used to record all the mutations in the DOM ... replay is to replay the recorded mutations one by one according to the corresponding timestamp

Source: https://github.com/rrweb-io/rrweb

### C21 (3-0)
**Claim.** rrweb's only built-in compression is an fflate-based per-event pack function (@rrweb/packer); the docs explicitly recommend compressing the whole session (e.g. with deflate) on the backend for a better ratio, and the canonical storage-optimization recipe gives NO numeric size-reduction figures or ratios.

> an fflate-based simple compress function in [@rrweb/packer] ... compress the whole session in the backend, which will have a more efficient compression ratio for some algorithms like deflate

Source: https://github.com/rrweb-io/rrweb

### C22 (3-0)
**Claim.** rrweb offers an fflate-based per-event compression function exposed as the packFn recording option, but the docs explicitly recommend compressing the whole session in the backend instead, because algorithms like deflate achieve a more efficient compression ratio over the full session than per-event packing.

> Use packFn to compress every event may not get the best result. It's recommended to compress the whole session in the backend, which will have a more efficient compression ratio for some algorithms like deflate.

Source: https://rrweb.com/docs/recipes/optimize-storage

### C23 (3-0)
**Claim.** rrweb storage size can be reduced at capture time via a sampling configuration object that throttles or disables high-volume event streams — e.g. disabling mousemove, throttling scroll to a millisecond interval (example 150), setting media timing (example 800), and recording only the final input value when many characters are typed (input: 'last').

> scroll: 150

Source: https://rrweb.com/docs/recipes/optimize-storage

### C24 (3-0)
**Claim.** rrweb serializes the DOM into a JSON tree where every node (Document, Element, Text, Comment) is recorded as an object with a type, optional tagName/attributes, childNodes, and a unique integer id — meaning a full page snapshot is a self-contained, deterministic data structure rather than raw HTML.

> When we traverse the DOM tree, we use Node as the unit. Therefore, in addition to the 'element type' nodes in the DOM, we also include records of all other types of Nodes such as Text Node and Comment Node.

Source: https://github.com/rrweb-io/rrweb/blob/master/docs/serialization.md

## Refuted (transparency)

- "Conformal rejection can outperform a larger active-learning labeling budget while quarantining fewer samples: TRANSCENDENT rejection raised DEEPDREBIN's AUT(F1,24m) from 0.658 to 0.717 and AUT(F1,48m) from 0.537 to 0.558, and even outperformed the 25%-budget active-learning scenario while rejecting fewer objects; combining the tuned malware ratio with rejection cut DREBIN's rejected samples by roughly two-thirds." (vote 0-3, https://arxiv.org/pdf/2402.01359)
