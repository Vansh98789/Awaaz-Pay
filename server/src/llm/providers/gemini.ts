const TIMEOUT_MS = 8000;

function cleanModelName(model: string): string {
  let clean = model.trim().replace(/^['"]|['"]$/g, '');
  if (clean.includes('=')) {
    clean = clean.split('=').pop()!.trim();
  }
  if (clean.startsWith('models/')) {
    clean = clean.replace(/^models\//, '');
  }
  return clean;
}

export async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
): Promise<string> {
  const sanitizedModel = cleanModelName(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${sanitizedModel}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { response_mime_type: 'application/json' },
  };

  const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty content');
  return text;
}
