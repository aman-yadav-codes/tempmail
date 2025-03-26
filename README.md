# 📩 Welcome to TempMail API – Your Instant Disposable Email Solution!  

TempMail API provides a **fast, lightweight, and anonymous** way to generate temporary emails. Whether you need to receive verification codes, protect your privacy, or prevent spam, our API ensures **instant** email generation with a simple and seamless experience.

---

## ✨ Features  
- **📧 Instant Temporary Emails** – Generate disposable email addresses within seconds.  
- **📥 Real-time Inbox Access** – Fetch incoming messages instantly without delays.  
- **🔄 Email Reset Anytime** – Refresh your email and start fresh whenever needed.  
- **⚡ High-Speed & Lightweight** – Optimized for quick responses with minimal latency.  

---

## 🚀 Technologies Used  
- **Node.js & Express** – Ensuring a scalable and high-performance backend. ⚡  
- **Axios** – Seamlessly fetching email data with API requests. 🔗  
- **CORS Enabled** – Allowing smooth integration with web apps and third-party services. 🔒  
- **Vercel Deployment** – Hosted on Vercel for **reliable and fast** API performance. 🚀  

---

🚀 **Experience hassle-free disposable emails with TempMail API today!**  
🔗 **[Try it Now](https://onesecmail.vercel.app/)**  




---

## 🔹 Endpoints & Usage  
🚀 **Base URL**: [`https://onesecmail.vercel.app/`](https://onesecmail.vercel.app/)  

> ⚠️ **Note:** Generated temporary emails will automatically expire **🕒10 minutes** after creation.

### 1️⃣ Get a Temporary Email  
📌 **GET** `/get_email`  
🔗 [Try it](https://onesecmail.vercel.app/get_email)  

📥 **Response:**  
```json
{
    "email": "skipper5874@topvu.net",
    "expires_at": 1742526521000,
    "cached": false
  }

```
### 2️⃣ Reset and Get a New Email
📌 **GET** `/reset_email`  
🔗 [Try it](https://onesecmail.vercel.app/reset_email)  

📥 **Response:**  
```json
  {
    "email": "hornet6741@drivz.net",
    "expires_at": 1742526717000,
    "cached": false
  }


```
### 3️⃣ Get Inbox Messages
📌 **GET** `/get_inbox`  
🔗 [Try it](https://onesecmail.vercel.app/get_inbox)  

📥 **Response:**  
```json
{
  "inbox": [
    {
      "from": "example@example.com",
      "subject": "Welcome!",
      "body": "Your code is 123456.",
      "receivedAt": "2025-03-19T12:34:56Z"
    }
  ]
}
```
## ⚠️ Error Responses  

| Status Code | Meaning                           | Example Response                           |
|------------|-----------------------------------|-------------------------------------------|
| **400**    | Email expired, generate a new one | `{ "error": "Email expired, generate new one" }` |
| **500**    | Server error                      | `{ "error": "Failed to retrieve inbox" }` |





## 🌟 How to Contribute:
- Fork the repository.
- Create a new branch: `git checkout -b feature-name`
- Commit your changes: `git commit -am 'Add new feature'`
- Push to the branch: `git push origin feature-name`
- Open a Pull Request.

---

## 📩 Experience the Future of Temporary Emails!  

Step into a world of privacy and convenience with **TempMail API**. 🚀✨ Instantly generate disposable emails, receive messages, and stay anonymous online. Say goodbye to spam and hello to seamless communication!  
