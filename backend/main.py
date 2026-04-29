import os
import json
import uuid
import textwrap
import base64
import hmac
import hashlib
import time
from typing import Optional
import zipfile

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Body, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from contextlib import asynccontextmanager

import PyPDF2
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# Telegram Bot Config
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")

# In-memory toggle: admin can flip via /receive_pdf on | off bot command
receive_pdf_enabled = False

# In-memory IP blocklist: admin can manage via bot commands
blocked_ips: set = set()

# HMAC Challenge Secret & window (seconds) — rotating time-based token
CHALLENGE_SECRET = os.environ.get("CHALLENGE_SECRET", "labflow-ai-challenge-secret")
CHALLENGE_WINDOW = 3600  # 1 hour

# In-memory Metrics store
metrics = {
    "total_requests": 0,
    "successful_generations": 0,
    "failed_generations": 0,
    "active_users": set()
}

async def send_telegram_message(message: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "Markdown"}
    try:
        async with httpx.AsyncClient() as client:
            await client.post(url, json=payload, timeout=5.0)
    except Exception as e:
        print(f"Failed to push Telegram alert: {e}")

async def send_telegram_document(message: str, filename: str, file_content: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"
    try:
        async with httpx.AsyncClient() as client:
            files = {'document': (filename, file_content.encode('utf-8'))}
            data = {'chat_id': TELEGRAM_CHAT_ID, 'caption': message, 'parse_mode': 'Markdown'}
            await client.post(url, data=data, files=files, timeout=10.0)
    except Exception as e:
        print(f"Failed to push Telegram document: {e}")

async def send_telegram_document_bytes(caption: str, filename: str, file_bytes: bytes):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"
    try:
        async with httpx.AsyncClient() as client:
            files = {'document': (filename, file_bytes)}
            data = {'chat_id': TELEGRAM_CHAT_ID, 'caption': caption, 'parse_mode': 'Markdown'}
            await client.post(url, data=data, files=files, timeout=15.0)
    except Exception as e:
        print(f"Failed to push Telegram document (bytes): {e}")

async def send_telegram_photo(caption: str, photo_bytes: bytes, filename: str = "screenshot.png"):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    try:
        async with httpx.AsyncClient() as client:
            files = {'photo': (filename, photo_bytes)}
            data = {'chat_id': TELEGRAM_CHAT_ID, 'caption': caption}
            await client.post(url, data=data, files=files, timeout=15.0)
    except Exception as e:
        print(f"Failed to push Telegram photo: {e}")

async def send_daily_metrics():
    global metrics
    msg = (
        "📊 *Daily SubmissionApp Metrics*\n\n"
        f"🔹 *Total Requests:* `{metrics['total_requests']}`\n"
        f"✅ *Successful Generations:* `{metrics['successful_generations']}`\n"
        f"❌ *Failed Errors:* `{metrics['failed_generations']}`\n"
        f"👥 *Unique Students:* `{len(metrics['active_users'])}`\n"
    )
    await send_telegram_message(msg)
    # Reset daily metrics after reporting
    metrics["total_requests"] = 0
    metrics["successful_generations"] = 0
    metrics["failed_generations"] = 0
    metrics["active_users"].clear()

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start the scheduling job
    scheduler.add_job(send_daily_metrics, 'cron', hour=23, minute=50) # Send end of day before midnight
    scheduler.start()
    
    # Send boot-up confirmation
    await send_telegram_message("🚀 *SubmissionApp Backend is Online!*")
    yield
    # Shutdown
    scheduler.shutdown()

# Generation modules
from generator import generate_submission_document

# Initialize Modern Google GenAI SDK (2026 Unified Standard)
from google import genai

app = FastAPI(title="Lab Submission Automator", lifespan=lifespan)

# CORS: Ensure you restrict this in production!
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "https://dmlabs.kesaru.me", # SLIIT tailored deployment
        # Add your production frontend domains here
    ],
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# Your verified Project ID from gcloud auth
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT_ID", "your-project-id")
LOCATION = "us-central1"

try:
    # 1. Generic Gemini API (using API Key)
    # The client automatically picks up GEMINI_API_KEY from environment variables
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    
    # 2. Vertex AI (Commented out - uncomment to use Google Cloud project backend)
    # client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
    
    MODEL_ID = "gemini-2.5-flash"
except Exception as e:
    print(f"Warning: GenAI Client not initialized. {e}")
    client = None

@app.post("/api/generate")
async def generate_submission(
    request: Request,
    it_number: str = Form(...),
    name: str = Form(...),
    center: Optional[str] = Form("WD"),
    batch: Optional[str] = Form("01.01"),
    file_format: Optional[str] = Form("LabSheet{lab_req}_{it_number}_{center}.IT.{batch}"),
    file: UploadFile = File(...)
):
    # 1. Verification token
    verification_token = request.headers.get("X-App-Verification-Token")
    expected_token = os.environ.get("APP_VERIFICATION_TOKEN", "labflow-app-v1-secret")
    if verification_token != expected_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized client.")

    # 2. HMAC Challenge token (rotating, 5-min window)
    challenge_token = request.headers.get("X-Challenge-Token", "")
    current_window = int(time.time()) // CHALLENGE_WINDOW
    valid = False
    for window in [current_window, current_window - 1]:  # allow 1 previous window for grace period
        expected = hmac.new(CHALLENGE_SECRET.encode(), str(window).encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(challenge_token, expected):
            valid = True
            break
    if not valid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or expired challenge token.")

    # 3. Extract client info
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "Unknown IP")
    # x-forwarded-for can be comma-separated list; take the first
    client_ip = client_ip.split(",")[0].strip()
    user_agent = request.headers.get("user-agent", "Unknown Browser")

    # 4. IP Blocklist check
    if client_ip in blocked_ips:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        
    metrics["total_requests"] += 1
    metrics["active_users"].add(it_number)
    
    request_id = str(uuid.uuid4())[:8]
    work_dir = f"/tmp/{request_id}"
    os.makedirs(work_dir, exist_ok=True)
    
    pdf_path = os.path.join(work_dir, "lab_sheet.pdf")
    with open(pdf_path, "wb") as buffer:
        buffer.write(await file.read())
        
    # 1. Read PDF text
    try:
        reader = PyPDF2.PdfReader(pdf_path)
        pdf_text = "".join(page.extract_text() for page in reader.pages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read PDF: {str(e)}")

    # 2. Get AI Solved Code Arrays
    if not client:
        raise HTTPException(status_code=500, detail="Google GenAI is not configured on this server.")
        
    system_instruction = textwrap.dedent("""
        You are a university student completing an IT lab practical assignment.
        Your task is to process a university lab sheet and solve every question.
        
        Instructions:
        1. Identify the Lab Sheet Number (e.g. from the title "Lab Sheet 03 - ...").
        2. Solve EVERY practical coding question in the document exactly.
        3. Determine a heading for each question (e.g., "Part 01 - Question 1").
        4. When a question asks for user input, YOU MUST STILL USE the `input()` function. Do NOT hardcode the answer if an input is requested. Our backend will handle mocking the inputs.
        5. Return your output strictly as a JSON object matching this schema:
        {
          "lab_sheet_number": "04",
          "questions": [
             {
               "heading": "Part 01 - Question 1",
               "code": "n = int(input('Enter n: '))\\nprint(n * 2)"
             }
          ]
        }
        Return ONLY valid JSON without Markdown blocks.
        
        <coding_guidelines>
        - Prefer boring, conventional solutions. Avoid clever tricks or overly complex abstractions.
        - DO NOT wrap your code in functions (like `def solve():`) unless the question explicitly asks for a function. Write linear scripts.
        - NEVER use `while` loops to continuously ask for input validation (e.g., `while password != correct: input()`). Our backend will mock exactly one successful input. Assume the user inputs the correct value on the very first try.
        - If you define a mathematical function or a class for a question, you MUST write executable code beneath it that calls the function with sample arguments and uses `print()` to display the results. Evaluators need to see the output.
        - Optimize for readability and maintainability by a mid-level engineer or student.
        - Include clear variable names.
        - NEVER include any code comments (no `#` symbols) or docstrings. Submissions with comments will be penalized.
        - Ensure the code follows standard Python best practices (e.g., PEP 8).
        </coding_guidelines>
        
        Think step by step before generating the final code.
    """)
    
    @retry(
        wait=wait_exponential(multiplier=1, min=2, max=10),
        stop=stop_after_attempt(3),
        retry=retry_if_exception_type(Exception),
        reraise=True
    )
    def call_ai(text: str):
        return client.models.generate_content(
            model=MODEL_ID,
            contents=[system_instruction, "LAB SHEET TEXT:\n" + text]
        )
    
    try:
        # Using the new models.generate_content syntax with tenacity retries
        response = call_ai(pdf_text[:30000])
        # Clean potential markdown markdown
        raw_output = response.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw_output)
        
        lab_sheet_number = data.get("lab_sheet_number", "XX").zfill(2)
        questions = data.get("questions", [])
        
    except Exception as e:
        metrics["failed_generations"] += 1
        fail_msg = f"🚨 *AI Processing Failed*\n\n*Name:* {name}\n*IT Number:* {it_number}\n*Center:* {center}\n*Batch:* {batch}\n*IP Address:* `{client_ip}`\n*Agent:* `{user_agent}`"
        await send_telegram_document(fail_msg, "ai_error_log.txt", f"Error Detail:\n{str(e)}")
        raise HTTPException(status_code=500, detail=f"AI Processing failed: {str(e)[:200]}...")
        
    # 3. Define output File Name
    output_basename = file_format.format(
        lab_req=lab_sheet_number,
        it_number=it_number,
        center=center,
        batch=batch
    ).replace('.docx', '').replace('.zip', '')
    
    # 4. Generate the Jupyter Docx Pipeline & Answer Sheet PDF
    try:
        final_docx_path, final_pdf_path = await generate_submission_document(
            work_dir=work_dir,
            questions=questions,
            it_number=it_number,
            name=name,
            lab_no=lab_sheet_number
        )
        metrics["successful_generations"] += 1
        
        success_msg = f"✅ *Successful Generation*\n\n*Name:* {name}\n*IT Number:* {it_number}\n*Center:* {center}\n*Batch:* {batch}\n*Lab Sheet:* {lab_sheet_number}\n*Filename Base:* {output_basename}\n*IP Address:* `{client_ip}`\n*Agent:* `{user_agent}`"
        await send_telegram_message(success_msg)
        
        # If admin toggled /receive_pdf on, forward the uploaded question PDF
        if receive_pdf_enabled:
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            await send_telegram_document_bytes(
                f"📄 *Lab Sheet PDF from* `{it_number}`",
                f"LabSheet_{it_number}.pdf",
                pdf_bytes
            )
        
    except Exception as e:
        metrics["failed_generations"] += 1
        fail_msg = f"🚨 *Document Generation Failed*\n\n*Name:* {name}\n*IT Number:* {it_number}\n*Center:* {center}\n*Batch:* {batch}\n*Lab Sheet:* {lab_sheet_number}\n*IP Address:* `{client_ip}`\n*Agent:* `{user_agent}`"
        # Often nbclient throws CellExecutionError which contains a massive traceback.
        await send_telegram_document(fail_msg, "execution_error_traceback.txt", f"Generation Error:\n\n{str(e)}")
        raise HTTPException(status_code=500, detail=f"Document generation failed: {str(e)[:200]}...")
        
    # 5. Create ZIP Archive
    zip_path = os.path.join(work_dir, f"{output_basename}.zip")
    ipynb_path = os.path.join(work_dir, "submission_notebook.ipynb")
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        zipf.write(final_docx_path, arcname=f"{output_basename}.docx")
        zipf.write(ipynb_path, arcname=f"{output_basename}.ipynb")
        zipf.write(final_pdf_path, arcname=f"{output_basename}.pdf")

    # 6. Read and Base64 Encode all files for JSON transmission
    def encode_file(filepath):
        with open(filepath, "rb") as f:
            return base64.b64encode(f.read()).decode('utf-8')
            
    payload = {
        "filename": output_basename,
        "docx": encode_file(final_docx_path),
        "pdf": encode_file(final_pdf_path),
        "ipynb": encode_file(ipynb_path),
        "zip": encode_file(zip_path)
    }

    return JSONResponse(status_code=200, content=payload)


@app.post("/api/feedback")
async def receive_feedback(request: Request, background_tasks: BackgroundTasks, payload: dict = Body(...)):
    verification_token = request.headers.get("X-App-Verification-Token")
    expected_token = os.environ.get("APP_VERIFICATION_TOKEN", "labflow-app-v1-secret")
    if verification_token != expected_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized client.")
        
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "Unknown IP")
    client_ip = client_ip.split(",")[0].strip()
    user_agent = request.headers.get("user-agent", "Unknown Browser")
    
    message = payload.get("message", "No message provided")
    user = payload.get("user", "Anonymous")
    phone = payload.get("phone", "").strip()
    email = payload.get("email", "").strip()
    screenshot_b64 = payload.get("screenshot", None)
    
    contact_line = ""
    if phone or email:
        contact_line = f"\n*Phone:* `{phone or 'N/A'}`  |  *Email:* `{email or 'N/A'}`"
    
    formatted_msg = (f"📣 *New Student Feedback*\n\n"
                     f"*From:* `{user}`{contact_line}\n"
                     f"*IP:* `{client_ip}`\n"
                     f"*Agent:* `{user_agent}`\n\n"
                     f"*Message:*\n{message}")
    
    # BackgroundTasks: respond instantly to user, send Telegram asynchronously
    async def _send_all():
        await send_telegram_message(formatted_msg)
        if screenshot_b64:
            try:
                photo_bytes = base64.b64decode(screenshot_b64)
                await send_telegram_photo(
                    caption=f"📸 Screenshot from `{user}`",
                    photo_bytes=photo_bytes,
                    filename="feedback_screenshot.png"
                )
            except Exception as e:
                print(f"Failed to decode/send screenshot: {e}")
    
    background_tasks.add_task(_send_all)
    return {"status": "ok"}


@app.post("/api/telegram_bot")
async def telegram_bot_webhook(update: dict = Body(...)):
    """Webhook handler for Telegram bot commands from the admin."""
    global receive_pdf_enabled, blocked_ips
    
    message = update.get("message") or update.get("channel_post") or {}
    raw_text = (message.get("text") or "").strip()
    text = raw_text.lower()
    chat_id = str(message.get("chat", {}).get("id", ""))
    
    # Only respond to the admin's chat
    if chat_id != TELEGRAM_CHAT_ID:
        return {"ok": True}
    
    # --- PDF Receive commands ---
    if "/receive_pdf on" in text:
        receive_pdf_enabled = True
        await send_telegram_message("✅ *PDF Receive Mode:* `ON` — I will now forward every uploaded lab sheet PDF to you.")
    elif "/receive_pdf off" in text:
        receive_pdf_enabled = False
        await send_telegram_message("🔕 *PDF Receive Mode:* `OFF` — Lab sheet PDFs will no longer be forwarded.")
    elif text.startswith("/receive_pdf") or text.startswith("/status"):
        state = "ON 🟢" if receive_pdf_enabled else "OFF 🔴"
        await send_telegram_message(f"📋 *PDF Receive Mode is currently:* `{state}`")
    
    # --- IP Blocklist commands ---
    elif text.startswith("/block_ip"):
        parts = raw_text.split()
        if len(parts) < 2:
            await send_telegram_message("⚠️ Usage: `/block_ip <ip_address>`")
        else:
            ip = parts[1].strip()
            blocked_ips.add(ip)
            await send_telegram_message(f"🚫 *IP Blocked:* `{ip}`\nAll future requests from this IP will be rejected.")
    elif text.startswith("/unblock_ip"):
        parts = raw_text.split()
        if len(parts) < 2:
            await send_telegram_message("⚠️ Usage: `/unblock_ip <ip_address>`")
        else:
            ip = parts[1].strip()
            blocked_ips.discard(ip)
            await send_telegram_message(f"✅ *IP Unblocked:* `{ip}`")
    elif text.startswith("/list_blocked"):
        if not blocked_ips:
            await send_telegram_message("📋 *No IPs are currently blocked.*")
        else:
            ip_list = "\n".join(f"`{ip}`" for ip in sorted(blocked_ips))
            await send_telegram_message(f"🚫 *Currently Blocked IPs ({len(blocked_ips)}):*\n{ip_list}")
    
    # --- Help ---
    elif "/help" in text:
        await send_telegram_message(
            "🤖 *SubmissionApp Bot Commands*\n\n"
            "📋 *PDF Forwarding:*\n"
            "`/receive_pdf on` — Start receiving uploaded PDFs\n"
            "`/receive_pdf off` — Stop receiving uploaded PDFs\n"
            "`/status` — Check PDF receive status\n\n"
            "🚫 *IP Blocklist:*\n"
            "`/block_ip <ip>` — Block an IP address\n"
            "`/unblock_ip <ip>` — Unblock an IP address\n"
            "`/list_blocked` — List all blocked IPs"
        )
    
    return {"ok": True}


@app.get("/api/challenge")
async def get_challenge_token():
    """Returns a short-lived HMAC challenge token valid for 5 minutes."""
    current_window = int(time.time()) // CHALLENGE_WINDOW
    token = hmac.new(CHALLENGE_SECRET.encode(), str(current_window).encode(), hashlib.sha256).hexdigest()
    return {"token": token}
