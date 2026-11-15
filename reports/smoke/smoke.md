## Smoke

3 groups, 45 steps, 2 min: all passed.

| group | result | time |
|---|---|---|
| base | ✅ | 0.1 min |
| pki | ✅ | 1.4 min |
| certs | ✅ | 0.2 min |

### Slowest steps

| group | step | seconds |
|---|---|---|
| pki | mTLS: revocation by OCSP refuses a revoked certificate within a minute and a half, nginx is not reloaded | 62 |
| pki | mTLS: the refused request is a security event | 6 |
| certs | mTLS: a page loaded without a certificate is one event with the number of its requests | 5 |
| pki | mTLS: a refused client gets the page the host chose (404, no answer), a valid certificate still passes | 4 |
| pki | mTLS on a TCP stream: a certificate of the trust domain passes, none or a revoked one is refused | 4 |
| base | request goes through the proxy | 3 |
| certs | Certificates: a certificate of your own is checked, uploaded, served by a host | 3 |
| base | duplicate email is rejected and does not crash the backend | 2 |
| base | disabling a 404 host that does not exist answers 404 and does not crash the backend | 2 |
| pki | PKI: a revoked certificate is refused within a minute | 2 |
