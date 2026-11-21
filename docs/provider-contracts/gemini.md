# Provider contract: Google Gemini (AI planner)

The AI planner (`backend/src/ai/`) talks to one model provider through `ai::Gateway`.
For testing this is Google Gemini, called with an AI Studio API key.

## How we call it

- Endpoint: `POST {GEMINI_API_BASE}/models/{GEMINI_MODEL}:generateContent`.
  - The default base is `https://generativelanguage.googleapis.com/v1beta`.
  - The default model is `gemini-3.8-flash`.
- The key goes in the `x-goog-api-key` header. It is never put in a URL or a log, and errors
  are reported without the request.
- Structured output: `generationConfig.responseMimeType = "application/json"` and
  `responseJsonSchema` set to our schema (`ai::planner::plan_schema`). The answer is still
  parsed strictly on our side (`deny_unknown_fields`). If it doesn't parse, we retry once
  with the error; if it still fails, the run fails and saves nothing.
- Token use comes from `usageMetadata`:
  - input is `promptTokenCount`;
  - output is `candidatesTokenCount` plus `thoughtsTokenCount`.
- A blocked prompt (`promptFeedback.blockReason`) or a finish reason other than `STOP` or
  `MAX_TOKENS` counts as a refusal. Nothing is saved.
- No tools or function calling are sent. The model can only answer; code decides what is
  saved, and it only ever saves drafts.

Docs used:
- https://ai.google.dev/gemini-api/docs/generate-content/structured-output
- https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | not set | Turns AI on. Without it, AI routes answer `503 ai_unavailable`. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Any Flash model id that supports JSON schema output. |
| `GEMINI_API_BASE` | v1beta URL | Change only for a proxy or a test double. |
| `AI_TIMEOUT_SECS` | 60 | Per call. |
| `AI_RUN_TOKEN_BUDGET` | 16000 | Max output tokens per call. |
| `AI_MONTHLY_USD_CAP` | 5 | Per workspace. Once reached, AI routes answer `429 ai_budget`. |
| `AI_USD_PER_MTOK_IN` / `_OUT` | 0.5 / 3.0 | Used to estimate spend. Set them to the current price list for the model. |

## What we send

The planner sends the following, inside a fenced "workspace data" block that the prompt
says to treat as data, never as instructions:
- the brand profile (name, what it sells, audience, tones, words to use and avoid, short
  voice samples);
- verified, current brand facts;
- names and tags of ready media;
- short summaries of posts already planned in the window.

We never send member emails, names or other personal data, tokens, or other workspaces'
data.

## Data-use risk: settle before real customers

On the **free (unpaid) tier** of the Gemini API, Google's terms allow Google to use
prompts and responses to improve its products, and people may review them. On the paid
tier they don't. Brand facts and voice samples are business data from our customers.

Until this is settled:
- use a key on a **paid (billing-enabled) project** for anything with real customer data,
  or
- use only made-up test brands with a free-tier key.

Check the current Gemini API terms (https://ai.google.dev/gemini-api/terms) before launch,
and record the decision here.

## Testing without the network

- `Gateway::fake(replies)` replays canned answers. The DB tests and the eval suite use it.
- `cargo run --bin evals -- --provider fake` is deterministic and runs in CI through
  `cargo test`.
- `cargo run --bin evals -- --provider gemini` makes live calls (about 90 of them) and
  writes a report to `backend/evals/reports/`.
