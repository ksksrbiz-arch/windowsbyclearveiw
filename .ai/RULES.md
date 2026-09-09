# ICM Cross-Cutting Rules

## Architecture

- ICM files are the editable context/policy surface.
- Application code is the enforcement surface.
- D1 is transactional truth.
- External manufacturer/code authorities are reference inputs, not business state.
- New AI features must follow `.ai/AI-OPERATING-CONTRACT.md` for provider, budget, caching, failure, context, tool, output, and human-authority boundaries.

## AI judgment

AI may:

- route a request;
- summarize or normalize known facts;
- identify likely installation paths;
- propose a material category;
- classify uncertainty;
- draft an executable plan;
- explain a tradeoff;
- identify missing information.

AI must not silently:

- invent measurements;
- invent product-specific fasteners or spacing;
- invent purchase quantities;
- turn a visual observation into a confirmed defect;
- state a quote as a final price;
- claim credentials or legal status;
- override a deterministic validation failure;
- mark a human approval gate complete.

## Deterministic-first routing

Intent routing should use deterministic application logic when the intent can be reliably identified from explicit message/project signals. The existing ICM router is the default routing boundary.

Do not add an AI classification call ahead of deterministic ICM routing merely to classify a request. AI judgment belongs after the selected specialist/context boundary unless a documented requirement demonstrates otherwise.

## AI operating controls

New AI operations must define bounded input/context/output sizes, model-call limits, tool rounds, optional vision-call limits, timeout behavior, and safe degradation before production use. Reuse existing Groq/Gemini/Workers AI infrastructure rather than creating duplicate provider paths without a measured reason.

Provider, retrieval, vision, or tool failure must fail down to a safe deterministic result or `VERIFY` state. Failure must never cause fabricated facts or bypassed validation/gates.

Caching is allowed only for outputs with explicit isolation and invalidation/expiry rules. Cache data is never transactional truth.

## Uncertainty protocol

Use three evidence states:

- `KNOWN` — directly supported by quote data, an authoritative reference, or explicit user input.
- `INFERRED` — reasonable interpretation that must remain visibly qualified.
- `VERIFY` — missing, conflicting, product-specific, site-specific, or safety-sensitive information.

A `VERIFY` item is not a failure. It is the correct output when certainty is unavailable.

## Installation safety

For window/door work, preserve the water-management sequence: inspect the opening, identify concealed damage, establish a drained/flashed opening appropriate to the assembly, set/support the unit, fasten only per the exact product instructions, integrate flashing/WRB transitions, air-seal, finish, and verify operation/drainage.

Never invent manufacturer-specific installation details from a generic product label.

## Quote synchronization

A Build Plan is derived from a quote snapshot. When the quote changes, the plan becomes stale until regenerated/reconciled. Never silently treat a stale plan as current.

## Human gate

`draft → review → approved → job snapshot`

Approval is an explicit business action. Generated confidence is not approval.

## Documentation

Every architecture change must update the relevant ICM context, current state, and handoff documentation. A future agent should not have to reconstruct why a design exists from commit history alone.
