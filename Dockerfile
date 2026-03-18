# Step 1: Lightweight Python base
FROM python:3.12-slim

# Step 2: Environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Default host and port
ENV HOST=0.0.0.0
ENV PORT=8050

# Step 3: Working directory
WORKDIR /app

# Step 4: Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Step 5: Copy only requirements first for caching
COPY . .

# Step 6: Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Step 7: Copy the full project (all folders)
COPY . .

# Create the data directory inside the workspace
RUN mkdir -p /app/data

# Step 8: Expose the port (default)
EXPOSE ${PORT}

# Step 9: Run app with Gunicorn using environment variables
CMD ["sh", "-c", "gunicorn frontend.app:app --bind ${HOST}:${PORT}"]
