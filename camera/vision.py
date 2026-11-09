#!/usr/bin/env python3
"""Analyze an image with the local Qwen2.5-VL vision model.
Usage: vision.py <image.jpg> [prompt] [vision_url]
Prints the model's text response to stdout.
"""
import base64, json, sys, urllib.request

img_path = sys.argv[1]
prompt = sys.argv[2] if len(sys.argv) > 2 else (
    "Describe this garden-bed image in 1-2 sentences: what plants/soil/objects are visible, "
    "their apparent health, and the lighting (sun/shade/time of day)."
)
url = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8769/v1/chat/completions"

img = base64.b64encode(open(img_path, "rb").read()).decode()
payload = {"messages": [{"role": "user", "content": [
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + img}},
    {"type": "text", "text": prompt},
]}], "temperature": 0.1, "max_tokens": 300}

req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                             headers={"Content-Type": "application/json"})
r = json.loads(urllib.request.urlopen(req, timeout=180).read())
print(r["choices"][0]["message"]["content"])
