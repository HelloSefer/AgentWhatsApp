import { env } from "../../config/env";

type OllamaGenerateResponse = {
  response?: string;
};

type StructuredGenerationOptions = {
  timeoutMs?: number;
};

const defaultGenerationOptions = {
  temperature: 0.2,
  num_predict: 90,
  top_p: 0.8,
};

const structuredGenerationOptions = {
  temperature: 0,
  num_predict: 250,
  top_p: 0.7,
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
      keep_alive: "30m",
      options: defaultGenerationOptions,
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

export async function generateStructuredAIReply(
  prompt: string,
  schema?: Record<string, unknown>,
  options: StructuredGenerationOptions = {},
): Promise<string> {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error("Prompt is required");
  }

  const abortController = new AbortController();
  const timeout =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => abortController.abort(), options.timeoutMs)
      : undefined;

  let response: Response;

  try {
    response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: abortController.signal,
      body: JSON.stringify({
        model: env.ollamaModel,
        prompt: trimmedPrompt,
        stream: false,
        format: schema || "json",
        keep_alive: "30m",
        options: structuredGenerationOptions,
      }),
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(
        `Structured Ollama request timed out after ${options.timeoutMs}ms`,
      );
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Structured Ollama request failed with status ${response.status}: ${errorBody}`,
    );
  }

  const data = (await response.json()) as OllamaGenerateResponse;

  return (data.response || "").trim();
}
