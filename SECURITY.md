# SECURITY.md

# Security disclosure policy

We take security reports seriously. If you discover a security issue in this project, please follow the instructions below so we can respond quickly and responsibly.

## Report a vulnerability (preferred)
Email (preferred, encrypted if possible): **hazemnasr@aucegypt.edu**

If this repository is hosted on GitHub, you may alternatively open a private GitHub Security Advisory for this repository.

> Do not submit security issues to the public issue tracker. Public disclosure may put users at risk.

### What to include in your report
Please provide as much of the following as possible:
- Affected component(s) and version(s) (e.g., `backend v0.6.2`, `worker image: latex-worker:1.4.0`)
- A clear, concise description of the vulnerability and potential impact
- Full reproduction steps or a minimal proof-of-concept (PoC)
- Logs, screenshots, or other evidence
- Your contact information and whether you consent to being credited
- Any remediation suggestions you may have

### Encrypting your report
If you prefer to encrypt sensitive details before sending, encrypt the message using our PGP public key. (Add your PGP key here or replace this section with instructions and a link once you publish a key.)

## Response policy & timeline
We aim to handle reports as follows:
- Acknowledge receipt within **72 hours**.
- Provide initial triage and a preliminary risk assessment within **7 days**.
- Provide a mitigation plan or fix within **30 days**, or communicate an expected schedule for a fix.
- For high/critical vulnerabilities, we will prioritize and coordinate a faster response.

We will coordinate disclosure timelines with the reporter. If a coordinated disclosure cannot be reached, we may follow a standard disclosure timeline while prioritizing user safety.

## Scope — what's in scope
Examples of in-scope components include:
- This project's codebase in this repository (backend, frontend, collab-server, worker images, tooling under `./worker`, `./backend`, `./frontend`, etc.)
- Official container images published to project registries
- CI/CD pipelines and scripts included in the repository
- Published binaries and artifacts produced by official pipelines

## Out of scope
- Third-party services or libraries (please report those to the upstream vendor)
- Self-hosted deployments run by individual users (report issues to that deployment owner)
- Physical attacks, social engineering against our staff, or incidents occurring outside the project's published infrastructure

## Rules of engagement (allowed testing)
By sending a report you confirm you have followed reasonable and responsible disclosure practices:
- Do not access, modify, or exfiltrate data belonging to other users or third parties.
- Do not perform destructive testing that damages production systems or harms users.
- Do not exceed authorized access (do not attempt privilege escalation beyond what a normal user can do).
- Avoid denial-of-service actions that may disrupt availability.
If you are unsure whether a test is permitted, ask first via the secure contact channel.

## Safe harbor
If you act in good faith and within the rules above when reporting security issues, we will not pursue legal action against you and we will treat you with appreciation. We reserve the right to refuse cooperation if the report contains evidence of malicious or criminal activity.

## Disclosure and credits
We will generally credit researchers who request credit in our security advisories or release notes, unless the reporter requests anonymity. We will also provide public advisories or release notes once issues are fixed and coordinated with reporters.

## CVE requests
If a vulnerability merits a CVE, we will coordinate with the reporter and the appropriate CNA to request a CVE ID.
