import {
  APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE,
  isApplyWorldLayoutMessage,
} from "@/shared/contracts/worldLayoutBridge";

export type WorldLayoutBridgeRequest =
  | {
      kind: "import";
      requestId?: string;
      worldLayoutUrl: string;
    }
  | {
      kind: "invalid";
      requestId?: string;
      message: string;
    };

type PostWorldLayoutBridgeResultParams = {
  target: MessageEventSource | null;
  origin: string;
  requestId?: string;
  ok: boolean;
  message: string;
};

type WindowMessageTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void;
};

const hasWindowPostMessage = (
  target: MessageEventSource | null,
): target is MessageEventSource & WindowMessageTarget =>
  typeof (target as { postMessage?: unknown } | null)?.postMessage === "function";

export const isTrustedWorldLayoutBridgeOrigin = (
  eventOrigin: string,
  currentOrigin: string,
): boolean => eventOrigin === currentOrigin || eventOrigin === "null";

export const resolveWorldLayoutBridgeReplyOrigin = (eventOrigin: string): string =>
  eventOrigin === "null" ? "*" : eventOrigin;

export const readWorldLayoutBridgeRequest = (
  messageData: unknown,
): WorldLayoutBridgeRequest | null => {
  if (!isApplyWorldLayoutMessage(messageData)) return null;
  const worldLayoutUrl = messageData.worldLayoutUrl?.trim() ?? "";
  if (!worldLayoutUrl) {
    return {
      kind: "invalid",
      requestId: messageData.requestId,
      message: "World layout URL is required.",
    };
  }
  return {
    kind: "import",
    requestId: messageData.requestId,
    worldLayoutUrl,
  };
};

export const postWorldLayoutBridgeResult = ({
  message,
  ok,
  origin,
  requestId,
  target,
}: PostWorldLayoutBridgeResultParams): void => {
  if (!hasWindowPostMessage(target)) return;
  target.postMessage(
    {
      type: APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE,
      requestId,
      ok,
      message,
    },
    resolveWorldLayoutBridgeReplyOrigin(origin),
  );
};
