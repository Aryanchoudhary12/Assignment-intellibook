const ENDPOINT = "https://openrouter.ai/api/v1/";
export const CHAT_MODEL = () => process.env.CHAT_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free";
export const EMBEDDING_MODEL = () => process.env.EMBEDDING_MODEL || "nvidia/nemotron-3.5-embed-8b:free";
export class ProviderError extends Error {}

async function request(path, body, signal) {
  if (!process.env.OPENROUTER_API_KEY) throw new ProviderError("Set OPENROUTER_API_KEY in .env and restart the app.");
  const timeout = AbortSignal.timeout(90_000);
  let response;
  try {
    response = await fetch(ENDPOINT + path, {
      method: "POST", cache: "no-store",
      headers: {Authorization: "Bearer " + process.env.OPENROUTER_API_KEY, "Content-Type": "application/json"},
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch {
    throw new ProviderError("The AI provider could not be reached. Try again shortly.");
  }
  if (response.status === 429) {
    throw new ProviderError("The AI provider rate-limited this request. Wait a minute and try again.");
  }
  if ([401, 403].includes(response.status)) {
    throw new ProviderError("The AI provider rejected the configured API key or model access.");
  }
  if (!response.ok) throw new ProviderError("The AI provider could not complete the request. Try again shortly.");
  return response;
}

async function json(response) {
  const result = await response.json().catch(() => null);
  if (!result || result.error) throw new ProviderError("The AI provider returned an error. Try again shortly.");
  return result;
}

export async function embed(texts, inputType, signal) {
  const output = [];
  for (let start = 0; start < texts.length; start += 24) {
    const input = texts.slice(start, start + 24);
    const response = await request("embeddings", {
      model: EMBEDDING_MODEL(), input, input_type: inputType, encoding_format: "float",
    }, signal);
    const result = await json(response);
    if (!Array.isArray(result.data) || result.data.length !== input.length) {
      throw new ProviderError("The AI provider returned an unexpected number of embeddings.");
    }
    const rows = result.data.sort((a, b) => a.index - b.index);
    for (let i = 0; i < rows.length; i++) {
      const {index, embedding} = rows[i];
      if (index !== i || !Array.isArray(embedding) || !embedding.every(Number.isFinite) ||
          (output.length && embedding.length !== output[0].length)) {
        throw new ProviderError("The AI provider returned invalid embeddings.");
      }
      const magnitude = Math.hypot(...embedding);
      if (!magnitude || !Number.isFinite(magnitude)) throw new ProviderError("The AI provider returned an empty embedding.");
      output.push(embedding.map((value) => value / magnitude));
    }
  }
  return output;
}

function completion(system, data, streaming) {
  return {
    model: CHAT_MODEL(), temperature: 0, max_tokens: streaming ? 2000 : 5200,
    stream: streaming,
    messages: [{role: "system", content: system}, {role: "user", content: JSON.stringify(data)}],
  };
}

export async function complete(system, data) {
  const result = await json(await request("chat/completions", completion(system, data, false)));
  const choice = result.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim() || ["length", "content_filter"].includes(choice.finish_reason)) {
    throw new ProviderError("The AI provider returned an incomplete review. Try again.");
  }
  return content;
}

export async function* stream(system, data, signal) {
  const response = await request("chat/completions", completion(system, data, true), signal);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      pending += value;
      let end = pending.indexOf("\n");
      while (end >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        end = pending.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        const item = JSON.parse(data);
        if (item.error) throw new Error("Upstream stream error");
        for (const choice of item.choices ?? []) {
          if (["length", "content_filter", "error"].includes(choice.finish_reason)) throw new Error("Upstream stream stopped");
          const delta = choice.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        }
      }
      if (pending.length > 64_000) break;
    }
    throw new Error("Upstream stream closed early");
  } catch {
    throw new ProviderError("The AI provider interrupted the answer. Try again shortly.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
