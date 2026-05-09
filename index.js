const express = require("express");
const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", true);
const HOMEPAGE_URL = "https://tempmail.so/";
const CACHE_DURATION = 600000; // 10 minutes in milliseconds

const userSessions = new Map(); // Stores sessions per user

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

// Middleware to log IP and request path
app.use((req, res, next) => {
  const userIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress; // Get real user IP
  console.log(`📌 Request from IP: ${userIp} | Path: ${req.path}`);
  next();
});

// Proof-of-work algorithm for tempmail.so API
function computePow(nonce) {
  if (!nonce) return 0;
  const timeSpan = Math.floor(Date.now() / 300000);
  const userAgent = headers["user-agent"];
  let t = 0;
  while (true) {
    const data = `${nonce}:${t}:${timeSpan}:${userAgent}`;
    const hash = crypto.createHash("sha256").update(data).digest("hex");
    if (hash.startsWith("ff")) {
      return t;
    }
    t++;
  }
}

// Initialize session for a specific user
async function initializeSession(userId) {
  const jar = new CookieJar();
  const session = wrapper(axios.create({ jar }));
  const response = await session.get(HOMEPAGE_URL, { headers }); // Fetch homepage to store cookies

  let sessionId = null;
  const match = response.data.match(/<meta\s+name="x-session-id"\s+content="([^"]+)"/);
  if (match) {
    sessionId = match[1];
  }

  userSessions.set(userId, {
    jar,
    session,
    sessionId,
    emailAddress: null,
    emailExpiry: 0,
    lastEmailRequestTime: 0,
  });
}

// Get user session or create a new one
async function getUserSession(userId) {
  if (!userSessions.has(userId)) {
    await initializeSession(userId);
  }
  return userSessions.get(userId);
}

// Get a temporary email for a specific user
async function getEmail(userId, forceNew = false) {
  const user = await getUserSession(userId);
  const currentTime = Date.now();

  if (
    !forceNew &&
    user.emailAddress &&
    currentTime - user.lastEmailRequestTime < CACHE_DURATION &&
    currentTime < user.emailExpiry
  ) {
    return { email: user.emailAddress, expires_at: user.emailExpiry, cached: true };
  }

  const requestTime = Date.now();
  const powValue = computePow(user.sessionId);
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&x=${powValue}&lang=us`;

  try {
    const response = await user.session.get(apiUrl, {
      headers: { ...headers, "x-inbox-lifespan": "600" }
    });
    if (response.status === 200) {
      user.emailAddress = response.data.data.name;
      user.emailExpiry = response.data.data.expires;
      user.lastEmailRequestTime = currentTime;
      return { email: user.emailAddress, expires_at: user.emailExpiry, cached: false };
    }
  } catch (error) {
    return { error: "Failed to retrieve email address." };
  }
}

// Retrieve inbox for a specific user
async function checkInbox(userId) {
  const user = await getUserSession(userId);
  const currentTime = Date.now();

  if (currentTime > user.emailExpiry) {
    await getEmail(userId);
  }

  const requestTime = Date.now();
  const powValue = computePow(user.sessionId);
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&x=${powValue}&lang=us`;

  try {
    const response = await user.session.get(apiUrl, {
      headers: { ...headers, "x-inbox-lifespan": "600" }
    });
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
  } catch (error) {
    return { error: "Failed to check inbox." };
  }
}

// 🏠 Home Route: Shows IP and API Info
app.get("/", (req, res) => {
  const userIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress; // Get real user IP
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json({
    real_ip: userIp,
    message: "Welcome to the Temp Mail API",
    description: "This API allows you to generate temporary emails and fetch emails received in the inbox.",
    endpoints: {
      [`${baseUrl}/get_email`]: "Get a temporary email address",
      [`${baseUrl}/get_inbox`]: "Retrieve all emails in the inbox",
      [`${baseUrl}/reset_email`]: "Reset and generate a new email",
    },
    note: "This is an unofficial API wrapper for TempMail. Use responsibly.",
  });
});

// 🔄 Reset email session for a user
app.get("/reset_email", async (req, res) => {
  try {
    const userIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    const userId = req.query.user_id || userIp;
    userSessions.delete(userId);
    await initializeSession(userId);
    const result = await getEmail(userId, true);
    res.json(result);
  } catch (error) {
    console.error("Error in /reset_email:", error.message);
    res.status(500).json({ error: "Failed to reset email session." });
  }
});

// 📧 Get email for a user
app.get("/get_email", async (req, res) => {
  try {
    const userIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    const userId = req.query.user_id || userIp;
    const result = await getEmail(userId);

    res.json({
      real_ip: userIp,
      email: result.email,
      expires_at: result.expires_at,
      cached: result.cached,
    });
  } catch (error) {
    console.error("Error in /get_email:", error.message);
    res.status(500).json({ error: "Failed to get email." });
  }
});

// 📥 Get inbox for a user
app.get("/get_inbox", async (req, res) => {
  try {
    const userIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    const userId = req.query.user_id || userIp;
    const user = await getUserSession(userId);
    const result = await checkInbox(userId);

    res.json({
      real_ip: userIp,
      email: user.emailAddress || "No email assigned yet",
      inbox: result,
    });
  } catch (error) {
    console.error("Error in /get_inbox:", error.message);
    res.status(500).json({ error: "Failed to get inbox." });
  }
});

// 🚀 Start server
if (process.env.NODE_ENV !== "production") {
  app.listen(3000, async () => {
    console.log("🚀 Server running on http://localhost:3000");
  });
}

module.exports = app;
