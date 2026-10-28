FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir psycopg2-binary pdfplumber tzdata
COPY Tank-Reserviour/ ./
ENV PYTHONUTF8=1
CMD ["sh", "run-daily.sh"]
