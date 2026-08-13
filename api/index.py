import re
import time
import uuid
from urllib.parse import urlencode

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

ONESECMAIL_API = "https://www.1secmail.com/api/v1/"
MAILBOX_TTL_SECONDS = 600
REQUEST_TIMEOUT_SECONDS = 10

# Best-effort warm-instance cache. The mailbox itself lives at the upstream
# service, so the API remains usable after a Vercel cold start.
user_sessions = {}


def get_client_ip():
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr


def upstream_get(params):
    response = requests.get(
        ONESECMAIL_API,
        params=params,
        timeout=REQUEST_TIMEOUT_SECONDS,
        headers={"accept": "application/json", "user-agent": "TempMailAPI/2.0"},
    )
    response.raise_for_status()
    return response.json()


def generate_mailbox():
    data = upstream_get({"action": "genRandomMailbox", "count": 1})
    if not isinstance(data, list) or not data or "@" not in data[0]:
        raise RuntimeError("Upstream returned an invalid mailbox response")
    return data[0]


def get_user_session(user_id, force_new=False):
    if force_new or user_id not in user_sessions:
        email = generate_mailbox()
        user_sessions[user_id] = {
            "email": email,
            "created_at": time.time(),
        }
    return user_sessions[user_id]


def split_email(email):
    login, domain = email.rsplit("@", 1)
    if not login or not domain:
        raise ValueError("Invalid mailbox address")
    return login, domain


def get_messages(email):
    login, domain = split_email(email)
    return upstream_get(
        {"action": "getMessages", "login": login, "domain": domain}
    )


def read_message(email, message_id):
    login, domain = split_email(email)
    return upstream_get(
        {
            "action": "readMessage",
            "login": login,
            "domain": domain,
            "id": message_id,
        }
    )


def message_to_public(message):
    subject = message.get("subject", "")
    otp_match = re.search(r"\b\d{6}\b", subject)
    return {
        "id": message.get("id"),
        "from": message.get("from", ""),
        "subject": subject,
        "otp": otp_match.group(0) if otp_match else "Not Found",
        "body": message.get("textBody", "") or message.get("body", ""),
        "date": message.get("date") or message.get("timestamp"),
    }


@app.route("/", methods=["GET"])
def home():
    base_url = request.host_url.rstrip("/")
    return jsonify(
        {
            "status": "ok",
            "message": "Welcome to the Temp Mail API (Python Edition)",
            "endpoints": {
                f"{base_url}/get_email?user_id=YOUR_ID": "Get a temporary email address",
                f"{base_url}/get_inbox?user_id=YOUR_ID": "Retrieve all emails in the inbox",
                f"{base_url}/reset_email?user_id=YOUR_ID": "Reset and generate a new email",
            },
        }
    )


@app.route("/get_email", methods=["GET"])
def get_email_route():
    user_id = request.args.get("user_id") or get_client_ip() or str(uuid.uuid4())
    try:
        session = get_user_session(user_id)
        expires_at = int((session["created_at"] + MAILBOX_TTL_SECONDS) * 1000)
        return jsonify(
            {
                "real_ip": get_client_ip(),
                "email": session["email"],
                "expires_at": expires_at,
                "cached": session["created_at"] + MAILBOX_TTL_SECONDS > time.time(),
            }
        )
    except Exception as exc:
        app.logger.exception("get_email failed")
        return jsonify({"error": "Failed to retrieve email address", "details": str(exc)}), 502


@app.route("/reset_email", methods=["GET"])
def reset_email_route():
    user_id = request.args.get("user_id") or get_client_ip() or str(uuid.uuid4())
    try:
        session = get_user_session(user_id, force_new=True)
        expires_at = int((session["created_at"] + MAILBOX_TTL_SECONDS) * 1000)
        return jsonify(
            {
                "email": session["email"],
                "expires_at": expires_at,
                "cached": False,
            }
        )
    except Exception as exc:
        app.logger.exception("reset_email failed")
        return jsonify({"error": "Failed to generate new email", "details": str(exc)}), 502


@app.route("/get_inbox", methods=["GET"])
def get_inbox_route():
    user_id = request.args.get("user_id") or get_client_ip() or str(uuid.uuid4())
    try:
        session = get_user_session(user_id)
        messages = get_messages(session["email"])
        if not isinstance(messages, list):
            messages = []

        parsed = []
        for message in messages:
            public_message = message_to_public(message)
            # Fetch full content only when the list endpoint did not include it.
            if not public_message["body"] and public_message["id"] is not None:
                try:
                    full = read_message(session["email"], public_message["id"])
                    public_message["body"] = full.get("textBody", "") or full.get("body", "")
                except Exception:
                    app.logger.exception("Failed to read message %s", public_message["id"])
            parsed.append(public_message)

        return jsonify(
            {
                "real_ip": get_client_ip(),
                "email": session["email"],
                "inbox": parsed if parsed else {"message": "No new emails yet."},
            }
        )
    except Exception as exc:
        app.logger.exception("get_inbox failed")
        return jsonify({"error": "Failed to check inbox", "details": str(exc)}), 502


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "tempmail-api", "upstream": "1secmail"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)
