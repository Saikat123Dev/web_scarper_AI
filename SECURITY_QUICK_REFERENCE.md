# Security Quick Reference Guide

## 🚨 Critical Findings Summary

| # | Vulnerability | Severity | Location | Status |
|---|---------------|----------|----------|--------|
| 1 | Hardcoded API Key | CRITICAL | `backend/src/routes/scrape.js:11` | 🔴 Needs Immediate Action |
| 2 | Open CORS Policy | HIGH | `backend/src/index.js:11` | 🟠 Fix Required |
| 3 | Missing JWT Validation | HIGH | `backend/src/routes/signup.js:50` | 🟠 Fix Required |
| 4 | No Rate Limiting | MEDIUM | All API endpoints | 🟡 Recommended |
| 5 | Insufficient URL Validation | MEDIUM | `backend/src/routes/scrape.js` | 🟡 Recommended |
| 6 | No Authentication | MEDIUM | Scraping endpoints | 🟡 Recommended |
| 7 | Filename Injection | MEDIUM | PDF generation | 🟡 Recommended |
| 8 | Missing Security Headers | MEDIUM | `backend/src/index.js` | 🟡 Recommended |
| 9 | Error Message Disclosure | LOW | Multiple locations | 🟢 Optional |

---

## ⚡ Quick Fixes

### 1. Fix Hardcoded API Key (5 minutes)
```javascript
// backend/src/routes/scrape.js
// BEFORE:
const genAI = "AIzaSyD7LeM9h-TjfzuHl2K-Zy2YNyVpTyO59yE" ? 
    new GoogleGenerativeAI("AIzaSyD7LeM9h-TjfzuHl2K-Zy2YNyVpTyO59yE") : null;

// AFTER:
const genAI = process.env.GEMINI_API_KEY ? 
    new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
```

**Action Items:**
1. Revoke exposed key in Google Cloud Console
2. Generate new API key
3. Add to `.env` file: `GEMINI_API_KEY=your-new-key`
4. Add `.env` to `.gitignore`

---

### 2. Fix CORS Policy (2 minutes)
```javascript
// backend/src/index.js
// BEFORE:
app.use(cors());

// AFTER:
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://yourdomain.com'],
  credentials: true,
  methods: ['GET', 'POST']
}));
```

Add to `.env`: `ALLOWED_ORIGINS=https://yourdomain.com`

---

### 3. Add JWT Validation (3 minutes)
```javascript
// backend/src/index.js - Add at startup
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
  process.exit(1);
}
```

Generate strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### 4. Add Rate Limiting (5 minutes)
```bash
npm install express-rate-limit
```

```javascript
// backend/src/index.js
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

app.use('/api/', limiter);
```

---

### 5. Add Security Headers (2 minutes)
```bash
npm install helmet
```

```javascript
// backend/src/index.js
import helmet from 'helmet';

app.use(helmet());
```

---

## 📋 Complete .env.example Template

```env
# Server
PORT=4001
NODE_ENV=production

# Security (REQUIRED)
JWT_SECRET=generate-with-crypto-randomBytes-32-minimum
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# API Keys (REQUIRED - DO NOT COMMIT ACTUAL KEYS)
GEMINI_API_KEY=your-gemini-api-key-here
GOOGLE_CLIENT_ID=your-google-oauth-client-id

# Database
DATABASE_URL=your-database-url
```

---

## 🛡️ Authentication Middleware

```javascript
// backend/src/middleware/auth.js
import jwt from 'jsonwebtoken';

export const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
};
```

Apply to routes:
```javascript
import { authenticateToken } from '../middleware/auth.js';

router.post('/scrape', authenticateToken, async (req, res) => { ... });
```

---

## 🔍 URL Validation Function

```javascript
// backend/src/utils/validators.js
export function validateUrl(urlString) {
  const url = new URL(urlString);
  
  // Only HTTP/HTTPS
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols allowed');
  }
  
  // Block private IPs
  const privateIP = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|localhost)/i;
  if (privateIP.test(url.hostname)) {
    throw new Error('Private IP ranges not allowed');
  }
  
  // Block metadata endpoints
  const blocked = ['169.254.169.254', 'metadata.google.internal'];
  if (blocked.includes(url.hostname.toLowerCase())) {
    throw new Error('Metadata endpoints not allowed');
  }
  
  return url;
}
```

---

## 📦 Required Dependencies

```bash
npm install --save express-rate-limit helmet joi
```

---

## ✅ Security Checklist

### Immediate (Do First)
- [ ] Revoke exposed API key
- [ ] Move all secrets to environment variables
- [ ] Add `.env` to `.gitignore`
- [ ] Validate JWT_SECRET on startup

### High Priority (This Week)
- [ ] Configure CORS properly
- [ ] Add rate limiting
- [ ] Implement authentication on endpoints
- [ ] Add URL validation
- [ ] Add security headers

### Important (This Month)
- [ ] Implement logging and monitoring
- [ ] Add input validation library
- [ ] Improve error handling
- [ ] Set up dependency scanning
- [ ] Write security tests

### Ongoing
- [ ] Regular security audits
- [ ] Dependency updates
- [ ] Security training
- [ ] Penetration testing

---

## 🧪 Quick Security Tests

```bash
# Check for hardcoded secrets
grep -r "API" backend/src/ | grep -i "key\|secret\|password"

# Audit dependencies
npm audit

# Check environment variables
grep "process.env" backend/src/**/*.js

# Test CORS
curl -H "Origin: https://evil.com" http://localhost:4001/api/scrape/health

# Test rate limiting
for i in {1..101}; do curl http://localhost:4001/api/scrape/health; done
```

---

## 📚 Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)

---

## 🆘 Need Help?

For detailed information on any vulnerability, see the full `SECURITY_ANALYSIS.md` report.

**Emergency Contact:** If you discover a security vulnerability, report it immediately to the security team.

---

**Last Updated:** 2024  
**Version:** 1.0  
**Status:** Active Security Advisory
