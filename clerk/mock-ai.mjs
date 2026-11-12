// TEST AND OFFLINE-DEMO ONLY. A deterministic stand-in for NEAR AI Cloud that
// implements the AI interface of clerk/calls.mjs and signs with a fake
// "mock" scheme. The production verifier (shared/tee.mjs verifyTeeSignature)
// rejects the "mock" algorithm, so nothing produced here can pass in a live
// deployment.

import { sha256, toHex, utf8, fromUtf8 } from '../shared/seal.mjs';
import { signatureText } from '../shared/tee.mjs';

export const MOCK_SIGNER = Object.freeze({ algo: 'mock', address: 'ab'.repeat(20) });
const MOCK_SECRET = 'sealgate7-mock-tee-not-a-real-signer';
const hex = (b) => toHex(sha256(b));

export const mockSign = (text) => hex(utf8(MOCK_SECRET + text));
export function verifyMockSignature({ text, signature, algo, address }) {
  return algo === MOCK_SIGNER.algo && address === MOCK_SIGNER.address && signature === mockSign(text);
}

export function chatResponseBytes({ id, model, content, finishReason = 'stop', usage }) {
  const body = {
    id, object: 'chat.completion', created: 1794057241, model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason, logprobs: null }],
  };
  if (usage) body.usage = { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.prompt_tokens + usage.completion_tokens };
  return utf8(JSON.stringify(body));
}

export const verdictContent = (verdict, reason) => JSON.stringify({ reason, verdict });
export const comparisonContent = (decision, reason) => JSON.stringify({ decision, reason });

// behavior({ model, request, index, requestBytes }) returns one of
//   { content, finishReason?, usage? | null, badSignature?, signatureKind? }
//   { respBytes }        exact bytes to return
// or throws (a transport failure). usage defaults to
// { prompt_tokens: ceil(|request| / 4), completion_tokens: 48 }; null omits it.
export function mockAi(behavior) {
  const calls = [];
  return {
    calls,
    async complete({ model, requestBytes }) {
      const request = JSON.parse(fromUtf8(requestBytes));
      const index = calls.length;
      calls.push({ model, request, requestBytes });
      const out = await behavior({ model, request, index, requestBytes });
      const usage = out.usage === undefined ? { prompt_tokens: Math.ceil(requestBytes.length / 4), completion_tokens: 48 } : out.usage;
      const respBytes = out.respBytes || chatResponseBytes({ id: `mock-${index}`, model, content: out.content, finishReason: out.finishReason, usage });
      const text = signatureText(model, hex(requestBytes), hex(respBytes));
      return {
        respBytes,
        chatId: `mock-${index}`,
        signature: {
          text,
          signature: out.badSignature ? '00'.repeat(32) : mockSign(text),
          signing_algo: MOCK_SIGNER.algo,
          signing_address: MOCK_SIGNER.address,
          signature_kind: out.signatureKind || 'provider_tee',
        },
      };
    },
  };
}

// Helpers to classify a request inside a behavior.
export const systemOf = (request) => request.messages[0].content;
export const userOf = (request) => request.messages[1].content;
export const isComparison = (request) => systemOf(request).startsWith('SEALGATE APPEAL COMPARISON SKELETON v7');
// The text of a data block of the user message ('CRITERIA' or 'SUBMISSION').
export function blockOf(request, label) {
  const m = new RegExp(`<<<${label} ([0-9a-f]{16})\\n([\\s\\S]*?)\\n${label} \\1>>>`).exec(userOf(request));
  return m ? m[2] : null;
}
