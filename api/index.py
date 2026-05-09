import os
import time
import hashlib
import re
from flask import Flask, request, jsonify
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context

app = Flask(__name__)

HOMEPAGE_URL = "https://tempmail.so/"
CACHE_DURATION_SEC = 600 # 10 minutes

user_sessions = {}

HEADERS = {
    "accept": "application/json",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "dnt": "1",
    "origin": "https://tempmail.so",
    "referer": "https://tempmail.so/",
    "sec-ch-ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Google Chrome\";v=\"134\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
}

class CipherAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        context = create_urllib3_context()
        context.set_ciphers("TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA")
        kwargs['ssl_context'] = context
        return super(CipherAdapter, self).init_poolmanager(*args, **kwargs)

def get_client_ip():
    if request.headers.get('x-forwarded-for'):
        return request.headers.get('x-forwarded-for').split(',')[0]
    return request.remote_addr

@app.before_request
def log_request_info():
    print(f"Request from IP: {get_client_ip()} | Path: {request.path}")

def compute_pow(nonce):
    if not nonce: return 0
    time_span = int(time.time() * 1000) // 300000
    user_agent = HEADERS["user-agent"]
    t = 0
    while True:
        data = f"{nonce}:{t}:{time_span}:{user_agent}"
        hash_val = hashlib.sha256(data.encode('utf-8')).hexdigest()
        if hash_val.startswith("ff"):
            return t
        t += 1

def create_session():
    session = requests.Session()
    session.mount('https://', CipherAdapter())
    return session

def initialize_session(user_id):
    session = create_session()
    response = session.get(HOMEPAGE_URL, headers=HEADERS)
    
    session_id = None
    match = re.search(r'<meta\s+name="x-session-id"\s+content="([^"]+)"', response.text)
    if match:
        session_id = match.group(1)
        
    user_sessions[user_id] = {
        "session": session,
        "session_id": session_id,
        "email_address": None,
        "email_expiry": 0,
        "last_email_request_time": 0,
    }

def get_user_session(user_id):
    if user_id not in user_sessions:
        initialize_session(user_id)
    return user_sessions[user_id]

def get_email(user_id, force_new=False):
    user = get_user_session(user_id)
    current_time = time.time() * 1000
    
    if (not force_new and 
        user["email_address"] and 
        current_time - user["last_email_request_time"] < CACHE_DURATION_SEC * 1000 and 
        current_time < user["email_expiry"]):
        return {"email": user["email_address"], "expires_at": user["email_expiry"], "cached": True}
        
    request_time = int(time.time() * 1000)
    pow_value = compute_pow(user["session_id"])
    api_url = f"https://tempmail.so/us/api/inbox?requestTime={request_time}&x={pow_value}&lang=us"
    
    req_headers = HEADERS.copy()
    req_headers["x-inbox-lifespan"] = "600"
    
    try:
        response = user["session"].get(api_url, headers=req_headers)
        if response.status_code == 200:
            data = response.json().get("data", {})
            user["email_address"] = data.get("name")
            user["email_expiry"] = data.get("expires")
            user["last_email_request_time"] = current_time
            return {"email": user["email_address"], "expires_at": user["email_expiry"], "cached": False}
    except Exception as e:
        pass
        
    return {"error": "Failed to retrieve email address."}

def check_inbox(user_id):
    user = get_user_session(user_id)
    current_time = time.time() * 1000
    
    if current_time > user["email_expiry"]:
        get_email(user_id)
        
    request_time = int(time.time() * 1000)
    pow_value = compute_pow(user["session_id"])
    api_url = f"https://tempmail.so/us/api/inbox?requestTime={request_time}&x={pow_value}&lang=us"
    
    req_headers = HEADERS.copy()
    req_headers["x-inbox-lifespan"] = "600"
    
    try:
        response = user["session"].get(api_url, headers=req_headers)
        if response.status_code == 200:
            messages = response.json().get("data", {}).get("inbox", [])
            if len(messages) > 0:
                parsed_messages = []
                for email in messages:
                    subject = email.get("subject", "")
                    otp_match = re.search(r'\b\d{6}\b', subject)
                    parsed_messages.append({
                        "from": email.get("from", ""),
                        "subject": subject,
                        "otp": otp_match.group(0) if otp_match else "Not Found",
                        "body": email.get("textBody", "")
                    })
                return parsed_messages
            return {"message": "No new emails yet."}
    except Exception as e:
        pass
        
    return {"error": "Failed to check inbox."}

@app.route('/', methods=['GET'])
def home():
    user_ip = get_client_ip()
    base_url = request.host_url.rstrip('/')
    return jsonify({
        "real_ip": user_ip,
        "message": "Welcome to the Temp Mail API (Python Edition)",
        "endpoints": {
            f"{base_url}/get_email?user_id=YOUR_ID": "Get a temporary email address",
            f"{base_url}/get_inbox?user_id=YOUR_ID": "Retrieve all emails in the inbox",
            f"{base_url}/reset_email?user_id=YOUR_ID": "Reset and generate a new email",
        }
    })

@app.route('/reset_email', methods=['GET'])
def reset_email_route():
    user_id = request.args.get('user_id') or get_client_ip()
    if user_id in user_sessions:
        del user_sessions[user_id]
    result = get_email(user_id, force_new=True)
    return jsonify(result)

@app.route('/get_email', methods=['GET'])
def get_email_route():
    user_id = request.args.get('user_id') or get_client_ip()
    result = get_email(user_id)
    return jsonify({
        "real_ip": get_client_ip(),
        "email": result.get("email"),
        "expires_at": result.get("expires_at"),
        "cached": result.get("cached")
    })

@app.route('/get_inbox', methods=['GET'])
def get_inbox_route():
    user_id = request.args.get('user_id') or get_client_ip()
    user = get_user_session(user_id)
    result = check_inbox(user_id)
    return jsonify({
        "real_ip": get_client_ip(),
        "email": user.get("email_address", "No email assigned yet"),
        "inbox": result
    })

if __name__ == '__main__':
    app.run(debug=True, port=3000)
