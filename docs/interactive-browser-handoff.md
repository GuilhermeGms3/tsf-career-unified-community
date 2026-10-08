# Interactive Browser Handoff

Quando login, MFA, CAPTCHA ou challenge exigir ação humana, uma sessão interativa pode permanecer somente em memória por até dez minutos. A UI mostra estado e expiração e o backend retoma a mesma página quando possível.

Cookies, storage e tokens não são exportados nem persistidos no SQLite. Sessões headless informam que o handoff interativo não está disponível. Expiração fecha o browser e exige nova inspeção; não há bypass de challenge.
