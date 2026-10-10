# Privacy and data handling (draft)

> Draft engineering inventory for SES's legal review. It does **not** establish compliance with the Data Protection Act, 2012 (Act 843). SES will register with the Data Protection Commission (Act 843 s.27) later; record the number and expiry in Company settings when issued.

## Personal data held (M1)

| Data | Where | Purpose | Proposed retention |
|---|---|---|---|
| Enquiry contact details and message | `leads` | Respond to enquiries, sales follow-up | 24 months after last activity, then delete or anonymise |
| User accounts (name, e-mail, password hash, MFA seed encrypted) | `users` | Authentication | Life of account plus 12 months |
| Sessions (IP, user agent) | `sessions` | Security | 90 days |
| Audit log (actor, IP, action) | `audit_log` | Security and accountability | 7 years (aligned with financial records; confirm) |
| Password reset e-mails (dev only) | `mail_outbox` | Development only | Not used in production |
| Customer organisation and order data | `organizations`, `quotes`, `orders` | Contract performance | Per financial record rules (confirm with accountant) |

## Controls in place

- Least-privilege access with organisation isolation. Partners never receive customer personal data in integration events.
- Secrets and MFA seeds encrypted at rest. Passwords hashed with scrypt.
- All privileged and state-changing actions are audited.

## Still to do (M2)

- Automated retention jobs for the table above.
- Data-subject request tooling (export, correction, deletion).
- Cookie and analytics review (none are used today; the only cookie is the session cookie).
- Final privacy notice text (draft at `/privacy`).
