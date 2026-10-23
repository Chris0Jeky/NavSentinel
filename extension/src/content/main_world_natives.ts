/** Invokers installed synchronously by the MAIN document_start loader. */
export interface MainWorldNatives {
  apply: typeof Reflect.apply;
  lower(value: string): string;
  trim(value: string): string;
  includes(value: string, search: string): boolean;
  starts(value: string, search: string): boolean;
  split(value: string, separator: string): string[];
  push<T>(values: T[], value: T): number;
  splice<T>(values: T[], start: number, count: number): T[];
  findIndex<T>(values: T[], predicate: (value: T) => boolean): number;
  setHas<T>(values: Set<T>, value: T): boolean;
  test(pattern: RegExp, value: string): boolean;
  mapGet<K, V>(map: Map<K, V>, key: K): V | undefined;
  mapSet<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V>;
  mapDelete<K, V>(map: Map<K, V>, key: K): boolean;
  map<K, V>(): Map<K, V>;
  mapEach<K, V>(map: Map<K, V>, callback: (value: V, key: K) => void): void;
  mapSize<K, V>(map: Map<K, V>): number;
  oldest<K, V>(map: Map<K, V>): IteratorResult<K>;
  weak<T extends WeakKey>(): WeakSet<T>;
  weakHas<T extends WeakKey>(values: WeakSet<T>, value: T): boolean;
  weakAdd<T extends WeakKey>(values: WeakSet<T>, value: T): WeakSet<T>;
  weakDelete<T extends WeakKey>(values: WeakSet<T>, value: T): boolean;
  finite: typeof Number.isFinite;
  min: typeof Math.min;
  max: typeof Math.max;
  parseFloat: typeof Number.parseFloat;
  decode: typeof decodeURIComponent;
  url(value: string, base?: string): { href: string; origin: string; pathname: string; protocol: string };
  post(port: MessagePort, message: unknown): void;
  start(port: MessagePort): void;
  close(port: MessagePort): void;
  listen(port: MessagePort, listener: (event: MessageEvent) => void): void;
  data(event: MessageEvent): unknown;
  source(event: MessageEvent): MessageEventSource | null;
  ports(event: MessageEvent): readonly MessagePort[];
  stop(event: Event): void;
  on<K extends keyof WindowEventMap>(target: Window, type: K, callback: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions): void;
}

declare global {
  var __navsentinelMainNatives: MainWorldNatives | undefined;
}
