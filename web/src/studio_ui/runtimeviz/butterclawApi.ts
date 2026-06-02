import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";

export type ButterClawChatResponse = {
  robot_id: string;
  accepted: boolean;
  messages: string[];
  raw_text: string;
};

const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

export const sendButterClawChatCommand = async (
  robotId: string,
  text: string
): Promise<ButterClawChatResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/runtime/sessions/integrations/butterclaw/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        robot_id: robotId,
        text,
      }),
    },
    {
      ...CORE_API_OPTIONS,
      context: "ButterClaw chat command",
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `ButterClaw request failed (${response.status})`);
  }
  return (await response.json()) as ButterClawChatResponse;
};
