const express = require("express");
const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const app = express();
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
  const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress; // Get real user IP
  console.log(`📌 Request from IP: ${userIp} | Path: ${req.path}`);
  next();
});

// Initialize session for a specific user
async function initializeSession(userId) {
  const jar = new CookieJar();
  const session = wrapper(axios.create({ jar }));
  await session.get(HOMEPAGE_URL); // Fetch homepage to store cookies

  userSessions.set(userId, {
    jar,
    session,
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
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&lang=us`;

  try {
    const response = await user.session.get(apiUrl, { headers });
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
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&lang=us`;

  try {
    const response = await user.session.get(apiUrl, { headers });
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
  const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress; // Get real user IP
  res.json({
    real_ip: userIp,
    message: "Welcome to the Temp Mail API",
    description: "This API allows you to generate temporary emails and fetch emails received in the inbox.",
    endpoints: {
      "/get_email?user_id=YOUR_ID": "Get a temporary email address",
      "/get_inbox?user_id=YOUR_ID": "Retrieve all emails in the inbox",
      "/reset_email?user_id=YOUR_ID": "Reset and generate a new email",
    },
    note: "This is an unofficial API wrapper for TempMail. Use responsibly.",
  });
});

// 🔄 Reset email session for a user
app.get("/reset_email", async (req, res) => {
  const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const userId = req.query.user_id || userIp;
  userSessions.delete(userId);
  await initializeSession(userId);
  const result = await getEmail(userId, true);
  res.json(result);
});

// 📧 Get email for a user
app.get("/get_email", async (req, res) => {
  const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const userId = req.query.user_id || userIp;
  const result = await getEmail(userId);

  res.json({
    real_ip: userIp,
    email: result.email,
    expires_at: result.expires_at,
    cached: result.cached,
  });
});

// 📥 Get inbox for a user
app.get("/get_inbox", async (req, res) => {
  const userIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const userId = req.query.user_id || userIp;
  const user = await getUserSession(userId);
  const result = await checkInbox(userId);

  res.json({
    real_ip: userIp,
    email: user.emailAddress || "No email assigned yet",
    inbox: result,
  });
});

// 🚀 Start server
app.listen(3000, async () => {
  console.log("🚀 Server running on http://localhost:3000");
});
