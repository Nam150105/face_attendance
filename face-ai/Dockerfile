FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app
COPY requirements.txt .
# face_recognition declares a dependency on `dlib`, which pip would then build
# from source; the wheel is already installed above, so its deps are skipped.
RUN pip install --no-cache-dir -r requirements.txt  && pip install --no-cache-dir --no-deps face_recognition==1.3.0
COPY app ./app
USER app

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
