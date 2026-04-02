# Agent Instructions: BlindDrop

## Project Context
BlindDrop is a standalone, public, one-time secret sharing service. It is designed with a zero-knowledge architecture using client-side AES-256-GCM encryption.

## Technical Stack
- **Backend**: Fastify (TypeScript) + Redis (Ephemeral storage)
- **Frontend**: Vanilla TypeScript + Vite (Static UI)
- **Security**: Cloudflare Turnstile for abuse prevention, client-side encryption (WebCrypto)

## Dependency Guardrail
This project follows the **atas-tech/dependency-guard** policy for all dependency-related tasks.

When a task involves adding, upgrading, removing, or evaluating a dependency:

1. **Alternatives First**: Check whether an existing dependency or standard-library alternative is sufficient before adding a new one.
2. **Preference**: Prefer using MCP `depscore` (Socket.dev) if available to evaluate package safety.
3. **Evaluation**:
    - Why is the package needed?
    - Are there install scripts, risky capabilities, or transitive risks present?
    - What is the Socket score/report for the package?
4. **Decision Matrix**:
    - **Allow**: Report findings and proceed.
    - **Allow with Warning**: Present the warning clearly and wait for context before proceeding.
    - **Block/Manual Review**: If the package has a low score or high risk, stop and require human approval or propose a safer path.
5. **Transparency**: Report the rationale and Socket results before touching `package.json` or lockfiles.

---
*For more details on the design, see [docs/Brainstorm_otp_service.md](docs/Brainstorm_otp_service.md) and the test plan in [docs/testing/BlindDrop.md](docs/testing/BlindDrop.md).*
