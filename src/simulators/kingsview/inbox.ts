/** In-memory record of SES → partner deliveries received by the simulator (lost on restart, by design). */
export interface InboxMessage {
  connectionId: string;
  id: string;
  type: string;
  data: unknown;
  signatureValid: boolean;
  receivedAt: string;
}

const g = globalThis as unknown as { __sesSimInbox?: InboxMessage[] };
const inbox = (g.__sesSimInbox ??= []);

export function recordInbox(m: InboxMessage) {
  inbox.unshift(m);
  inbox.length = Math.min(inbox.length, 100);
}

export const simulatorInbox = () => inbox;
