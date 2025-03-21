const express = require("express");
const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const { v4: uuidv4 } = require("uuid");

const app = express();
const HOMEPAGE_URL = "https://tempmail.so/";
const CACHE_DURATION = 600000; // 10 minutes in milliseconds
const SESSION_TTL = 3600000; // 1 hour TTL for sessions in memory

// Store user sessions in a Map
const userSessions = new Map();

// Headers to simulate browser request
const headers = {
  "authority": "tempmail.so",
  "accept": "application/json",
  "accept-language": "en-US,en;q=0.9",
  "content-type": "application/json",
  "dnt": "1",
  "referer": "https://tempmail.so/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
};

// User session data structure
class UserSession {
  constructor() {
    this.emailAddress = null;
    this.emailExpiry = 0;
    this.lastEmailRequestTime = 0;
    this.createdAt = Date.now();
    this.jar = new CookieJar();
    this.session = wrapper(axios.create({ jar: this.jar }));
  }

  async initialize() {
    try {
      await this.session.get(HOMEPAGE_URL); // Fetch homepage to store cookies
    } catch (error) {
      throw new Error("Failed to initialize session");
    }
  }
}

// Cleanup old sessions
function cleanupSessions() {
  const now = Date.now();
  for (const [sessionId, session] of userSessions) {
    if (now - session.createdAt > SESSION_TTL) {
      userSessions.delete(sessionId);
    }
  }
}
setInterval(cleanupSessions, 60000); // Run cleanup every minute

// Middleware to get or create user session
function getUserSession(req, res, next) {
  let sessionId = req.query.sessionId || req.headers["x-session-id"];
  
  if (!sessionId) {
    sessionId = uuidv4();
    res.setHeader("X-Session-ID", sessionId);
  }

  if (!userSessions.has(sessionId)) {
    const newSession = new UserSession();
    userSessions.set(sessionId, newSession);
    newSession.initialize().then(() => {
      req.userSession = newSession;
      req.sessionId = sessionId;
      next();
    }).catch(err => res.status(500).json({ error: err.message }));
  } else {
    req.userSession = userSessions.get(sessionId);
    req.sessionId = sessionId;
    next();
  }
}

// Get a temporary email
async function getEmail(userSession, forceNew = false) {
  const currentTime = Date.now();
  const isCacheValid = 
    userSession.emailAddress &&
    currentTime - userSession.lastEmailRequestTime < CACHE_DURATION &&
    currentTime < userSession.emailExpiry;

  if (!forceNew && isCacheValid) {
    return { email: userSession.emailAddress, expires_at: userSession.emailExpiry, cached: true };
  }

  const requestTime = Date.now();
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&lang=us`;

  try {
    const response = await userSession.session.get(apiUrl, { headers });
    if (response.status === 200 && response.data.data.name) {
      userSession.emailAddress = response.data.data.name;
      userSession.emailExpiry = response.data.data.expires;
      userSession.lastEmailRequestTime = currentTime;
      return { email: userSession.emailAddress, expires_at: userSession.emailExpiry, cached: false };
    } else {
      // If API returns unexpected data, reinitialize session
      await userSession.initialize();
      const retryResponse = await userSession.session.get(apiUrl, { headers });
      if (retryResponse.status === 200 && retryResponse.data.data.name) {
        userSession.emailAddress = retryResponse.data.data.name;
        userSession.emailExpiry = retryResponse.data.data.expires;
        userSession.lastEmailRequestTime = currentTime;
        return { email: userSession.emailAddress, expires_at: userSession.emailExpiry, cached: false };
      }
      return { error: "Failed to retrieve email address after retry." };
    }
  } catch (error) {
    // Retry with fresh session on error
    try {
      await userSession.initialize();
      const retryResponse = await userSession.session.get(apiUrl, { headers });
      if (retryResponse.status === 200 && retryResponse.data.data.name) {
        userSession.emailAddress = retryResponse.data.data.name;
        userSession.emailExpiry = retryResponse.data.data.expires;
        userSession.lastEmailRequestTime = currentTime;
        return { email: userSession.emailAddress, expires_at: userSession.emailExpiry, cached: false };
      }
    } catch (retryError) {
      return { error: "Failed to retrieve email address: " + retryError.message };
    }
    return { error: "Failed to retrieve email address: " + error.message };
  }
}

// Check inbox
async function checkInbox(userSession) {
  const currentTime = Date.now();
  if (currentTime > userSession.emailExpiry || !userSession.emailAddress) {
    await getEmail(userSession, true); // Force refresh if expired
  }

  const requestTime = Date.now();
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&lang=us`;

  try {
    const response = await userSession.session.get(apiUrl, { headers });
    if (response.status === 200) {
      const messages = response.data.data.inbox || [];
      if (messages.length > 0) {
        return messages.map((email) => {
          const otpMatch = email.subject.match(/\b\d{6}\b/);
          return {
            from: email.from,
            subject: email.subject,
            otp: otpMatch ? otpMatch[0] : "Not Found",
            body: email.textBody,
          };
        });
      }
      return { message: "No new emails yet." };
    }
    return { error: "Unexpected response from inbox API." };
  } catch (error) {
    return { error: "Failed to check inbox: " + error.message };
  }
}

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to the Temp Mail API",
    description: "This API allows you to generate temporary emails and fetch emails received in the inbox.",
    endpoints: {
      "/get_email": "Get a temporary email address",
      "/get_inbox": "Retrieve all emails in the inbox",
      "/reset_email": "Reset and generate a new email",
    },
    note: "Pass sessionId as query param or X-Session-ID header for multi-user support.",
  });
});

app.get("/reset_email", getUserSession, async (req, res) => {
  const userSession = new UserSession();
  userSessions.set(req.sessionId, userSession);
  await userSession.initialize();
  const result = await getEmail(userSession, true);
  res.json({ sessionId: req.sessionId, ...result });
});

app.get("/get_email", getUserSession, async (req, res) => {
  const result = await getEmail(req.userSession);
  res.json({ sessionId: req.sessionId, ...result });
});

app.get("/get_inbox", getUserSession, async (req, res) => {
  const result = await checkInbox(req.userSession);
  res.json({ sessionId: req.sessionId, ...result });
});

// Start the server
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
