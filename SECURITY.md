# Security Policy

If you find a security problem in PlumTerm, please report it privately by email
to **plumterm@pluminate.com**. Please do not open a public issue for security
reports.

Include what you found, the PlumTerm version, your operating system, and steps
to reproduce. We will acknowledge your report and keep you updated as we work
on a fix.

## What PlumTerm does on your machine

- It runs your own shell and tools in local pseudo-terminals.
- It collects no analytics or usage data.
- An internal web server for development fallback binds to `127.0.0.1` only.
- An optional mobile-access server starts only when `TERMINAL_MOBILE_TOKEN` is
  set, listens on `127.0.0.1` by default, and requires that token.
