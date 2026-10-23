import { EARLY_MAIN_NATIVES } from "../../scripts/content-loader-contract.mjs";
import { URL as NodeURL } from "node:url";

/** Install the real loader block with happy-dom's Node-port fidelity bridge. */
export async function installMainWorldNatives(): Promise<void> {
  const channel = new MessageChannel();
  const event = await new Promise<MessageEvent>((resolve) => {
    channel.port1.onmessage = resolve;
    channel.port2.postMessage("capture-test-native-event");
  });
  // happy-dom uses Node ports/events but a different global MessagePort/Event.
  const port = { prototype: Object.getPrototypeOf(channel.port1) };
  const messageEvent = { prototype: {} };
  for (const key of ["data", "source", "ports"]) {
    let proto = Object.getPrototypeOf(event);
    while (proto && !Object.getOwnPropertyDescriptor(proto, key)) proto = Object.getPrototypeOf(proto);
    const getter = proto && Object.getOwnPropertyDescriptor(proto, key)?.get;
    Object.defineProperty(messageEvent.prototype, key, { get(this: MessageEvent) {
      const own = Object.getOwnPropertyDescriptor(this, key);
      return own && "value" in own ? own.value : getter ? Reflect.apply(getter, this, []) : undefined;
    } });
  }
  // happy-dom's Window is a proxy whose listener method is bound internally.
  const eventTarget = { prototype: { addEventListener: window.addEventListener.bind(window) } };
  new Function("MessagePort", "MessageEvent", "URL", "EventTarget",
    EARLY_MAIN_NATIVES.replace("catch(_){}", "catch(error){throw error}"))(port, messageEvent, NodeURL, eventTarget);
  channel.port1.close();
  channel.port2.close();
  if (!globalThis.__navsentinelMainNatives) throw new Error("Test early native capture failed");
}
