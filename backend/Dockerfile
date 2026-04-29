FROM mcr.microsoft.com/playwright/python:v1.42.0-jammy

# Set environment variables for Python
ENV PYTHONUNBUFFERED=True \
    PYTHONDONTWRITEBYTECODE=True \
    PORT=8080

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Jupyter kernel for nbclient
RUN python -m pip install ipykernel && python -m ipykernel install --user

# Copy application code
COPY . ./

# Install Playwright browsers (in case the base image doesn't cover all for Chromium)
RUN playwright install chromium

# Start the FastAPI app using Uvicorn
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
