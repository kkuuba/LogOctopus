import logging
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

app = FastAPI()


@app.get("/logs/stream")
def stream_logs_api():
    return StreamingResponse(stream_logs(), media_type="text/plain")
