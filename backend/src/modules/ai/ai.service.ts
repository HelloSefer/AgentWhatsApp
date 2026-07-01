import { env } from "../../config/env";

type OllamaGenerateResponse = {
  response?: string;
};

export async function generateAIReply(message: string): Promise<string> {
  const prompt = message.trim();

  if (!prompt) {
    throw new Error("Message is required");
  }

  const response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.ollamaModel,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Ollama request failed with status ${response.status}: ${errorBody}`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;

  return (data.response || "").trim();
}
