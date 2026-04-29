# LabFlow AI - Automagic Academic Submission Generator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-B73BFE?style=flat&logo=vite&logoColor=FFD62E)](https://vitejs.dev/)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-4285F4?style=flat&logo=google&logoColor=white)](https://deepmind.google/technologies/gemini/)

A professional, full-stack open-source automation framework designed to streamline the creation of academic lab submissions, assignments, and coding practicals. 

> **Live Demo (Tailored for SLIIT Students):** [dmlabs.kesaru.me](https://dmlabs.kesaru.me)
> *(Note: This repository was originally created specifically for students at SLIIT (Malabe Uni) to automate their Discrete Mathematics lab sheets. It has since been generalized so that ANY student, educator, or university can tailor it to their own formats!)*

![Frontend Preview](https://github.com/kesaruhasun/LabFlow-Public/blob/main/frontend/public/preview.png)

## 🚀 Features

- **🤖 AI-Powered Solving:** Uses Google Gemini (Vertex AI) to parse PDF question sheets, interpret context, and generate accurate Python code solutions.
- **📄 Professional Formatting (Docx):** Automatically generates beautifully formatted Word documents using a customizable template (`Generic_Lab_Template.docx`).
- **📦 Multi-Format Exports:** Export your submission instantly as a **Word Document (.docx)**, a functional **Jupyter Notebook (.ipynb)**, an **Answer Sheet PDF**, or download everything in a **ZIP Archive**.
- **🧑‍🎓 "Humanized" Code Execution:** AI is instructed to generate code without overly complex abstractions, avoiding comments or docstrings, effectively mimicking a student's natural coding style. The backend even intelligently mocks user `input()` calls so interactive scripts can be safely compiled into PDFs.
- **🔐 Secure Backend Architecture:** Implements HMAC challenge-response verification, IP-based rate limiting, and client verification tokens to protect against automated abuse.
- **📊 Developer & Admin Insights:** Integrated Telegram Bot that sends real-time metrics, generation alerts, user feedback, and detailed error tracebacks straight to the admin's phone.

## 🛠️ Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS (Modern Linear-style UI).
- **Backend:** Python, FastAPI, APScheduler, httpx.
- **AI Engine:** Google Vertex AI (Gemini 2.5 Flash).
- **Document Processing:** `python-docx`, `nbformat`, `PyPDF2`, `nbclient`, Playwright (for automated Jupyter cell rendering).

## 📂 Project Structure

```text
LabFlow-Public/
├── backend/              # FastAPI Python server
│   ├── generator.py      # Core logic for DOCX/IPYNB/PDF generation
│   ├── main.py           # API endpoints and Telegram bot integration
│   ├── Generic_Lab_Template.docx # Your customizable docx template
│   ├── Dockerfile        # Container configuration
│   └── requirements.txt  # Python dependencies
├── frontend/             # React + Vite application
│   ├── src/              # Application components and logic
│   ├── public/           # Static assets
│   └── firebase.json     # Firebase deployment config
└── README.md             # This file
```

## ⚙️ Installation & Setup

### Backend Setup
1. Navigate to the backend folder: `cd backend`
2. Create a virtual environment: `python -m venv venv`
3. Activate it:
   - macOS/Linux: `source venv/bin/activate`
   - Windows: `venv\Scripts\activate`
4. Install dependencies: `pip install -r requirements.txt`
   *(Note: You will also need `libreoffice` installed on your system if you want true docx->pdf conversion).*
5. Set up environment variables by copying the example file:
   `cp .env.example .env`
   - Add your `GOOGLE_CLOUD_PROJECT_ID` and path to your `GOOGLE_APPLICATION_CREDENTIALS` (Service Account JSON).
   - (Optional) Add your Telegram Bot credentials to receive alerts.
6. Run the server: `uvicorn main:app --reload`

### Frontend Setup
1. Navigate to the frontend folder: `cd frontend`
2. Install dependencies: `npm install`
3. Check `src/App.tsx` or `.env` files to ensure API URLs point to your local backend (`http://localhost:8000`).
4. Run the development server: `npm run dev`
5. Access the app at `http://localhost:5173`

## 🤝 Contributing
I encourage you to fork this repository, customize the `Generic_Lab_Template.docx` for your own university, and improve the logic!
If you have ideas for new features (like supporting C++ or Java compilation, adding new AI providers like OpenAI/Anthropic, or improving the frontend UI), **please submit an Issue or a Pull Request!**

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📜 License
Distributed under the MIT License. See `LICENSE` for more information.

---
**Developed and maintained by [Kesaru](https://kesaru.me)**.
