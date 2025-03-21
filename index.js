const express = require("express");
const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const app = express();
const HOMEPAGE_URL = "https://tempmail.so/";
const CACHE_DURATION = 600000; // 10 minutes in milliseconds

let emailAddress = null;
let emailExpiry = 0;
let lastEmailRequestTime = 0;
let jar, session;

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

// Initialize session (called on startup and when resetting)
async function initializeSession() {
  jar = new CookieJar();
  session = wrapper(axios.create({ jar }));
  await session.get(HOMEPAGE_URL); // Fetch homepage to store cookies
}

// Get a temporary email (caches email for 10 minutes unless reset)
async function getEmail(forceNew = false) {
  const currentTime = Date.now();
  if (!forceNew && emailAddress && (currentTime - lastEmailRequestTime < CACHE_DURATION) && currentTime < emailExpiry) {
    return { email: emailAddress, expires_at: emailExpiry, cached: true };
  }

  const requestTime = Date.now();
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&lang=us`;

  try {
    const response = await session.get(apiUrl, { headers });
    if (response.status === 200) {
      emailAddress = response.data.data.name;
      emailExpiry = response.data.data.expires;
      lastEmailRequestTime = currentTime;
      return { email: emailAddress, expires_at: emailExpiry, cached: false };
    }
  } catch (error) {
    return { error: "Failed to retrieve email address." };
  }
}

// ✅ Return full inbox instead of just one email
async function checkInbox() {
  const currentTime = Date.now();
  if (currentTime > emailExpiry) {
    await getEmail();
  }

  const requestTime = Date.now();
  const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&lang=us`;

  try {
    const response = await session.get(apiUrl, { headers });
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

app.get("/", (req, res) => {
    res.json({
      message: "Welcome to the Temp Mail API",
      description: "This API allows you to generate temporary emails and fetch emails received in the inbox.",
      endpoints: {
        "/get_email": "Get a temporary email address",
        "/get_inbox": "Retrieve all emails in the inbox",
        "/reset_email": "Reset and generate a new email",
      },
      note: "This is an unofficial API wrapper for TempMail. Use responsibly.",
    });
  });

// Reset email session and generate a new email
app.get("/reset_email", async (req, res) => {
  emailAddress = null;
  emailExpiry = 0;
  lastEmailRequestTime = 0;
  await initializeSession(); // Reinitialize session and cookies
  const result = await getEmail(true);
  res.json(result);
});

// API endpoints
app.get("/get_email", async (req, res) => {
  const result = await getEmail();
  res.json(result);
});

app.get("/get_inbox", async (req, res) => {
  const result = await checkInbox();
  res.json(result);
});

// Start the server
app.listen(3000, async () => {
  await initializeSession();
  console.log("Server running on http://localhost:3000");
});
