---
description: Security-focused review aligned with the OWASP Top 10, covering injection, broken auth, secrets handling and unsafe dependencies
---

# Security Analysis

Use this skill on every changed file. Treat findings here as higher priority
than style or refactoring feedback.

## What to Look For (OWASP Top 10 oriented)
1. **Broken access control** - missing ownership/role checks, IDOR, trusting client-sent IDs
2. **Cryptographic failures** - weak hashes (MD5/SHA-1 for passwords), hard-coded keys, `Math.random()` for tokens
3. **Injection** - string-built SQL/NoSQL/shell/LDAP, `eval`, `new Function`, `child_process.exec` with user input
4. **Insecure design** - no rate limiting on login or reset flows, no input size limits
5. **Security misconfiguration** - permissive CORS, debug flags on, verbose error output
6. **Vulnerable components** - unpinned or abandoned dependencies, known-bad packages
7. **Authentication failures** - weak session handling, tokens in URLs, missing expiry
8. **Integrity failures** - unsafe deserialization, unsigned updates, unvalidated redirects
9. **Logging failures** - secrets or personal data written to logs, no audit trail for sensitive actions
10. **SSRF** - fetching user-supplied URLs without an allow-list

## Front-End Specifics
- `innerHTML`, `dangerouslySetInnerHTML`, `document.write` with untrusted data
- Tokens stored in `localStorage`
- Missing `rel="noopener"` on external links

## Secrets
- API keys, passwords or tokens committed in source or fixtures
- `.env` values echoed to logs or error messages

## Severity Guide
- **critical**: exploitable remotely with no precondition (RCE, auth bypass, SQL injection)
- **high**: exploitable with some precondition (stored XSS, IDOR)
- **medium**: weakens defences (missing validation, weak crypto choice)
- **low / info**: hardening suggestions

## Output
For each finding give the line, the vulnerability class, a one-sentence attack
scenario, and a concrete fix.
