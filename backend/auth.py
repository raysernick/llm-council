import hmac
import hashlib
import json
import base64
import time
import os
from fastapi import Header, HTTPException, status, Depends
from typing import Dict, Any, Optional

# Load secret key from environment or use a stable generated key
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    SECRET_KEY = "llm-council-super-secret-key-1009!"

ALLOWED_EMAILS = {"aprianto.you@gmail.com", "raysernick@gmail.com"}
PASSWORD_SALT = "99ba04778b4e5a0cc9485f8e9b0f5768"
PASSWORD_HASH = "d70d21e731f416aa8069eeed90b6edf3e3fd61b75960295227b4efe19cfa01be"

def verify_password(plain_password: str) -> bool:
    """Verify password check using secure PBKDF2 hashing."""
    pw_bytes = plain_password.encode("utf-8")
    salt_bytes = bytes.fromhex(PASSWORD_SALT)
    hashed = hashlib.pbkdf2_hmac("sha256", pw_bytes, salt_bytes, 100000).hex()
    return hmac.compare_digest(hashed, PASSWORD_HASH)

def create_token(email: str, expires_in: int = 86400 * 7) -> str:
    """Create a signed JWT-like token (zero-dependency)."""
    payload = {
        "email": email,
        "exp": int(time.time()) + expires_in
    }
    payload_json = json.dumps(payload)
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode("utf-8")).decode("utf-8")
    
    # Sign the base64 payload
    signature = hmac.new(
        SECRET_KEY.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    
    return f"{payload_b64}.{signature}"

def verify_token(token: str) -> Optional[str]:
    """Verify a signed token and return the email if valid."""
    try:
        if "." not in token:
            return None
        payload_b64, signature = token.split(".", 1)
        
        # Verify signature
        expected_signature = hmac.new(
            SECRET_KEY.encode("utf-8"),
            payload_b64.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        
        if not hmac.compare_digest(signature, expected_signature):
            return None
            
        # Decode payload
        payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
        payload = json.loads(payload_json)
        
        # Check expiration
        if payload.get("exp", 0) < int(time.time()):
            return None
            
        email = payload.get("email")
        if email in ALLOWED_EMAILS:
            return email
            
    except Exception:
        pass
    return None

def get_current_user(authorization: Optional[str] = Header(None)) -> str:
    """FastAPI dependency to secure endpoints."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = authorization.split(" ", 1)[1]
    email = verify_token(token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return email
