export interface ReputationLoadOptions {
  debug?: boolean;
  warnOnFailure?: boolean;
}

export interface ReputationStatus {
  knownBad: boolean;
  filterReady: boolean;
}
