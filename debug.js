const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const crypto = require("crypto");

const HOMEPAGE_URL = "https://tempmail.so/";

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

async function test() {
  try {
    console.log("Initializing session...");
    const jar = new CookieJar();
    const session = wrapper(axios.create({ jar }));
    const homeRes = await session.get(HOMEPAGE_URL, { headers });

    let sessionId = null;
    const match = homeRes.data.match(/<meta\s+name="x-session-id"\s+content="([^"]+)"/);
    if (match) {
      sessionId = match[1];
    }
    console.log("Session ID:", sessionId);

    const requestTime = Date.now();
    const powValue = computePow(sessionId);
    console.log("PoW:", powValue);

    const apiUrl = `https://tempmail.so/us/api/inbox?requestTime=${requestTime}&x=${powValue}&lang=us`;

    console.log(`Fetching from ${apiUrl}`);
    const response = await session.get(apiUrl, { 
      headers: { ...headers, "x-inbox-lifespan": "600" } 
    });
    console.log("Response:", response.status, response.data);
  } catch (err) {
    if (err.response) {
      console.error("Error Status:", err.response.status);
      console.error("Error Data:", err.response.data);
    } else {
      console.error("Error Message:", err.message);
    }
  }
}

test();
