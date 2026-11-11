FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# docker CLI (static binary) — lets the app drive the camera via the host docker socket
RUN python3 -c "import urllib.request; urllib.request.urlretrieve('https://download.docker.com/linux/static/stable/x86_64/docker-29.5.3.tgz', '/tmp/d.tgz')" \
 && tar xzf /tmp/d.tgz -C /usr/local/bin --strip-components=1 docker/docker \
 && chmod +x /usr/local/bin/docker && rm /tmp/d.tgz

COPY main.py schema.sql ./
COPY static ./static

RUN mkdir -p /data/media
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
