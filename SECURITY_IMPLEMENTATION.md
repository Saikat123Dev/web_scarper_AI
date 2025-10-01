# Security Implementation Roadmap

## Overview
This document provides a step-by-step implementation guide to address the security vulnerabilities identified in the security analysis. Follow these steps in order of priority.

---

## Phase 1: Critical Fixes (Immediate - 24 Hours)

### Step 1.1: Revoke Exposed API Key
**Time Required:** 5 minutes  
**Priority:** CRITICAL

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to APIs & Services → Credentials
3. Find and delete the key: `AIzaSyD7LeM9h-TjfzuHl2K-Zy2YNyVpTyO59yE`
4. Generate a new API key with restrictions:
   - Set application restrictions (HTTP referrers or IP addresses)
   - Set API restrictions (limit to Generative Language API only)
   - Add rate limiting quotas

**Verification:**
```bash
# Test that old key no longer works
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyD7LeM9h-TjfzuHl2K-Zy2YNyVpTyO59yE" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'
# Should return 400 or 403
```

---

### Step 1.2: Move API Key to Environment Variable
**Time Required:** 10 minutes  
**Priority:** CRITICAL

**File:** `backend/src/routes/scrape.js`

```diff
- const genAI = "AIzaSyD7LeM9h-TjfzuHl2K-Zy2YNyVpTyO59yE" ? new GoogleGenerativeAI("AIzaSyD7LeM9h-TjfzuHl2K-Zy2YNyVpTyO59yE") : null;
+ const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
```

Create `backend/.env`:
```env
GEMINI_API_KEY=your-new-api-key-here
JWT_SECRET=your-jwt-secret-min-32-chars
GOOGLE_CLIENT_ID=your-google-client-id
DATABASE_URL=your-database-url
ALLOWED_ORIGINS=https://yourdomain.com
```

**Verification:**
```bash
cd backend
grep -r "AIzaSy" src/
# Should return no results
```

---

### Step 1.3: Verify Environment Variables on Startup
**Time Required:** 5 minutes  
**Priority:** HIGH

**File:** `backend/src/index.js`

```javascript
// Add at the top, after imports
const requiredEnvVars = [
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'DATABASE_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('FATAL: Missing required environment variables:', missingVars.join(', '));
  console.error('Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

// Validate JWT_SECRET strength
if (process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters long');
  console.error('Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

console.log('✅ Environment variables validated');
```

**Verification:**
```bash
cd backend
# Test with missing variable
JWT_SECRET="" npm start
# Should exit with error

# Test with valid variables
npm start
# Should show "✅ Environment variables validated"
```

---

## Phase 2: High Priority Fixes (1 Week)

### Step 2.1: Configure CORS Properly
**Time Required:** 10 minutes  
**Priority:** HIGH

**File:** `backend/src/index.js`

```diff
- app.use(cors());
+ const corsOptions = {
+   origin: function (origin, callback) {
+     const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
+     
+     // Allow requests with no origin (mobile apps, curl, etc.)
+     if (!origin) return callback(null, true);
+     
+     if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
+       callback(null, true);
+     } else {
+       callback(new Error('Not allowed by CORS'));
+     }
+   },
+   credentials: true,
+   methods: ['GET', 'POST', 'PUT', 'DELETE'],
+   allowedHeaders: ['Content-Type', 'Authorization'],
+   maxAge: 86400 // 24 hours
+ };
+ 
+ app.use(cors(corsOptions));
```

**Verification:**
```bash
# Test from allowed origin
curl -H "Origin: https://yourdomain.com" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -X OPTIONS http://localhost:4001/api/scrape/health

# Test from disallowed origin (should fail)
curl -H "Origin: https://evil.com" http://localhost:4001/api/scrape/scrape
```

---

### Step 2.2: Add Rate Limiting
**Time Required:** 15 minutes  
**Priority:** HIGH

**Install dependency:**
```bash
cd backend
npm install express-rate-limit
```

**File:** `backend/src/index.js`

```javascript
import rateLimit from 'express-rate-limit';

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for scraping endpoints
const scrapeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 scrapes per hour per IP
  message: {
    success: false,
    error: 'Scraping limit exceeded',
    message: 'You have exceeded the hourly scraping limit. Please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to routes
app.use('/api/', apiLimiter);

// In scrape.js routes, apply stricter limit
router.post('/scrape', scrapeLimiter, async (req, res) => { /* ... */ });
router.post('/scrape/batch', scrapeLimiter, async (req, res) => { /* ... */ });
```

**Verification:**
```bash
# Test rate limiting
for i in {1..101}; do 
  curl -s http://localhost:4001/api/scrape/health | grep -o "Too many requests" && break
done
```

---

### Step 2.3: Add Security Headers
**Time Required:** 5 minutes  
**Priority:** HIGH

**Install dependency:**
```bash
cd backend
npm install helmet
```

**File:** `backend/src/index.js`

```javascript
import helmet from 'helmet';

// Apply security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { 
    policy: 'strict-origin-when-cross-origin' 
  },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true
}));
```

**Verification:**
```bash
curl -I http://localhost:4001/api/scrape/health | grep -i "x-"
# Should see X-Content-Type-Options, X-Frame-Options, etc.
```

---

### Step 2.4: Implement Authentication Middleware
**Time Required:** 20 minutes  
**Priority:** HIGH

**Create:** `backend/src/middleware/auth.js`

```javascript
import jwt from 'jsonwebtoken';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please provide a valid access token in the Authorization header'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.'
      });
    }
    
    return res.status(403).json({
      success: false,
      error: 'Invalid token',
      message: 'The provided token is invalid or malformed'
    });
  }
};

// Optional: Rate limiter per user (requires authentication)
export const createUserRateLimiter = (options = {}) => {
  const store = new Map();
  
  return (req, res, next) => {
    const userId = req.user?.userId || req.ip;
    const now = Date.now();
    const windowMs = options.windowMs || 60 * 60 * 1000; // 1 hour
    const max = options.max || 100;
    
    if (!store.has(userId)) {
      store.set(userId, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    const userLimit = store.get(userId);
    
    if (now > userLimit.resetTime) {
      store.set(userId, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    if (userLimit.count >= max) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `You have exceeded your limit of ${max} requests per hour`
      });
    }
    
    userLimit.count++;
    next();
  };
};
```

**File:** `backend/src/routes/scrape.js`

```javascript
import { authenticateToken } from '../middleware/auth.js';

// Apply to protected routes
router.post('/scrape', authenticateToken, async (req, res) => { /* ... */ });
router.post('/scrape/batch', authenticateToken, async (req, res) => { /* ... */ });
router.post('/preview', authenticateToken, async (req, res) => { /* ... */ });
router.post('/preview/batch', authenticateToken, async (req, res) => { /* ... */ });
```

**Update Frontend:** `frontend/src/components/Scrape.jsx`

```javascript
// Add auth header to all fetch requests
const token = localStorage.getItem('token');

const response = await fetch(`${API_BASE_URL}/scrape`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ url: input })
});

// Handle auth errors
if (response.status === 401) {
  setError('Authentication required. Please log in.');
  // Redirect to login
  window.location.href = '/login';
  return;
}
```

**Verification:**
```bash
# Test without token
curl -X POST http://localhost:4001/api/scrape/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
# Should return 401

# Test with token
curl -X POST http://localhost:4001/api/scrape/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"url":"https://example.com"}'
# Should work
```

---

### Step 2.5: Implement URL Validation
**Time Required:** 15 minutes  
**Priority:** HIGH

**Create:** `backend/src/utils/validators.js`

```javascript
export function validateUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  let url;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new Error('Invalid URL format');
  }

  // Only allow HTTP/HTTPS protocols
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }

  const hostname = url.hostname.toLowerCase();

  // Block private IP ranges
  const privateIPPatterns = [
    /^127\./, // Loopback
    /^10\./, // Private Class A
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // Private Class B
    /^192\.168\./, // Private Class C
    /^169\.254\./, // Link-local
    /^::1$/, // IPv6 loopback
    /^fe80:/i, // IPv6 link-local
    /^fc00:/i, // IPv6 private
    /^fd00:/i, // IPv6 private
  ];

  for (const pattern of privateIPPatterns) {
    if (pattern.test(hostname)) {
      throw new Error('Access to private IP addresses is not allowed');
    }
  }

  // Block localhost variations
  const localhostPatterns = ['localhost', '0.0.0.0'];
  if (localhostPatterns.includes(hostname)) {
    throw new Error('Access to localhost is not allowed');
  }

  // Block cloud metadata endpoints
  const blockedHosts = [
    '169.254.169.254', // AWS, Azure, Google Cloud metadata
    'metadata.google.internal',
    'metadata.goog',
    '100.100.100.200', // Alibaba Cloud metadata
    'instance-data', // Oracle Cloud
  ];

  if (blockedHosts.includes(hostname)) {
    throw new Error('Access to cloud metadata endpoints is not allowed');
  }

  // Validate port (optional - prevent port scanning)
  const allowedPorts = [80, 443, 8080, 8443];
  if (url.port && !allowedPorts.includes(parseInt(url.port))) {
    throw new Error(`Port ${url.port} is not allowed. Only ports 80, 443, 8080, 8443 are permitted.`);
  }

  return url;
}

export function validateUrls(urls) {
  if (!Array.isArray(urls)) {
    throw new Error('URLs must be provided as an array');
  }

  if (urls.length === 0) {
    throw new Error('At least one URL must be provided');
  }

  if (urls.length > 20) {
    throw new Error('Maximum 20 URLs allowed per batch');
  }

  const validatedUrls = [];
  const errors = [];

  urls.forEach((url, index) => {
    try {
      validatedUrls.push(validateUrl(url));
    } catch (error) {
      errors.push({ index, url, error: error.message });
    }
  });

  if (errors.length > 0) {
    throw new Error(JSON.stringify({ invalidUrls: errors }));
  }

  return validatedUrls;
}
```

**File:** `backend/src/routes/scrape.js`

```javascript
import { validateUrl, validateUrls } from '../utils/validators.js';

router.post('/scrape', authenticateToken, async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  try {
    validateUrl(url);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL',
      message: error.message
    });
  }

  // ... rest of the code
});

router.post('/scrape/batch', authenticateToken, async (req, res) => {
  const { urls } = req.body;

  try {
    validateUrls(urls);
  } catch (error) {
    const errorData = error.message.startsWith('{') 
      ? JSON.parse(error.message) 
      : { error: error.message };
    
    return res.status(400).json({
      success: false,
      ...errorData
    });
  }

  // ... rest of the code
});
```

**Verification:**
```bash
# Test SSRF protection
curl -X POST http://localhost:4001/api/scrape/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"url":"http://169.254.169.254/latest/meta-data/"}'
# Should return 400 with error

# Test file protocol
curl -X POST http://localhost:4001/api/scrape/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"url":"file:///etc/passwd"}'
# Should return 400 with error
```

---

## Phase 3: Medium Priority Improvements (1 Month)

### Step 3.1: Improve Error Handling
**Time Required:** 30 minutes

**Create:** `backend/src/middleware/errorHandler.js`

```javascript
export const errorHandler = (err, req, res, next) => {
  // Log error details (server-side only)
  const errorLog = {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  };

  console.error('Error occurred:', errorLog);

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Generic error response for production
  const errorResponse = {
    success: false,
    error: statusCode === 500 ? 'Internal server error' : err.message,
    message: process.env.NODE_ENV === 'production' 
      ? 'An error occurred processing your request'
      : err.message
  };

  // Include stack trace in development only
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
    errorResponse.details = err.details;
  }

  res.status(statusCode).json(errorResponse);
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: 'The requested resource was not found'
  });
};
```

**File:** `backend/src/index.js`

```javascript
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// ... other middleware

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);
```

---

### Step 3.2: Add Input Validation Library
**Time Required:** 45 minutes

**Install:**
```bash
cd backend
npm install joi
```

**Create:** `backend/src/validation/schemas.js`

```javascript
import Joi from 'joi';

export const scrapeSchema = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required()
    .messages({
      'string.uri': 'Invalid URL format',
      'any.required': 'URL is required'
    })
});

export const batchScrapeSchema = Joi.object({
  urls: Joi.array()
    .items(Joi.string().uri({ scheme: ['http', 'https'] }))
    .min(1)
    .max(20)
    .required()
    .messages({
      'array.min': 'At least one URL is required',
      'array.max': 'Maximum 20 URLs allowed per batch',
      'any.required': 'URLs array is required'
    }),
  concurrent: Joi.number().integer().min(1).max(5).default(2)
});

export const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }

    req.validatedData = value;
    next();
  };
};
```

**Usage in routes:**
```javascript
import { scrapeSchema, batchScrapeSchema, validateRequest } from '../validation/schemas.js';

router.post('/scrape', 
  authenticateToken, 
  validateRequest(scrapeSchema),
  async (req, res) => {
    const { url } = req.validatedData;
    // ... rest of code
  }
);

router.post('/scrape/batch',
  authenticateToken,
  validateRequest(batchScrapeSchema),
  async (req, res) => {
    const { urls, concurrent } = req.validatedData;
    // ... rest of code
  }
);
```

---

### Step 3.3: Implement Logging
**Time Required:** 30 minutes

**Install:**
```bash
cd backend
npm install winston
```

**Create:** `backend/src/utils/logger.js`

```javascript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'web-scraper-api' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Security event logger
export const logSecurityEvent = (event, details) => {
  logger.warn('Security Event', {
    event,
    ...details,
    timestamp: new Date().toISOString()
  });
};

export default logger;
```

**Usage:**
```javascript
import logger, { logSecurityEvent } from '../utils/logger.js';

// Log security events
logSecurityEvent('rate_limit_exceeded', {
  ip: req.ip,
  endpoint: req.path
});

// Log authentication failures
logSecurityEvent('authentication_failed', {
  ip: req.ip,
  reason: 'Invalid token'
});
```

---

## Phase 4: Ongoing Security Practices

### Regular Security Audits
```bash
# Run npm audit regularly
npm audit

# Fix vulnerabilities automatically
npm audit fix

# Check for outdated packages
npm outdated
```

### Dependency Security Scanning
```bash
# Install Snyk
npm install -g snyk

# Authenticate
snyk auth

# Test for vulnerabilities
snyk test

# Monitor continuously
snyk monitor
```

### Security Testing
Create `backend/tests/security.test.js`:

```javascript
import request from 'supertest';
import app from '../src/index.js';

describe('Security Tests', () => {
  describe('SSRF Protection', () => {
    it('should reject file:// protocol URLs', async () => {
      const response = await request(app)
        .post('/api/scrape/scrape')
        .send({ url: 'file:///etc/passwd' });
      expect(response.status).toBe(400);
    });

    it('should reject private IP addresses', async () => {
      const response = await request(app)
        .post('/api/scrape/scrape')
        .send({ url: 'http://192.168.1.1' });
      expect(response.status).toBe(400);
    });

    it('should reject metadata endpoints', async () => {
      const response = await request(app)
        .post('/api/scrape/scrape')
        .send({ url: 'http://169.254.169.254/latest/meta-data/' });
      expect(response.status).toBe(400);
    });
  });

  describe('Authentication', () => {
    it('should require authentication for scraping', async () => {
      const response = await request(app)
        .post('/api/scrape/scrape')
        .send({ url: 'https://example.com' });
      expect(response.status).toBe(401);
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .post('/api/scrape/scrape')
        .set('Authorization', 'Bearer invalid-token')
        .send({ url: 'https://example.com' });
      expect(response.status).toBe(403);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = Array(101).fill().map(() =>
        request(app).get('/api/scrape/health')
      );
      const responses = await Promise.all(requests);
      const rateLimited = responses.some(r => r.status === 429);
      expect(rateLimited).toBe(true);
    });
  });

  describe('CORS', () => {
    it('should reject requests from unauthorized origins', async () => {
      const response = await request(app)
        .get('/api/scrape/health')
        .set('Origin', 'https://evil.com');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
```

---

## Deployment Checklist

Before deploying to production:

- [ ] All environment variables are set
- [ ] API keys are revoked and regenerated
- [ ] `.env` file is not committed to git
- [ ] CORS is configured with production domains
- [ ] Rate limiting is enabled
- [ ] Security headers are configured
- [ ] Authentication is required on all sensitive endpoints
- [ ] URL validation is implemented
- [ ] Error handling doesn't expose sensitive information
- [ ] Logging is configured
- [ ] Dependencies are up to date
- [ ] Security audit has been run (`npm audit`)
- [ ] SSL/TLS is enabled (HTTPS)
- [ ] Database connections use SSL
- [ ] Secrets are managed securely (not in code)

---

## Monitoring and Maintenance

### Setup Monitoring
1. Application Performance Monitoring (APM)
2. Security event logging
3. Rate limit monitoring
4. Failed authentication attempts
5. Unusual traffic patterns

### Regular Tasks
- Weekly: Check logs for security events
- Monthly: Run security audit and update dependencies
- Quarterly: Review and rotate API keys
- Annually: Conduct penetration testing

---

## Support and Resources

- Full security analysis: See `SECURITY_ANALYSIS.md`
- Quick reference: See `SECURITY_QUICK_REFERENCE.md`
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Node.js Security: https://nodejs.org/en/docs/guides/security/

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Status:** Active Implementation Guide
